//! Settings, recording index and transcript persistence.
//!
//! Todo lo que el usuario ve cuelga de una sola raíz: el vault de Obsidian si
//! lo ha vinculado, y si no una carpeta en Documentos. Dentro de esa raíz el
//! audio va a `audio/` y las notas a `{año}/`, que es la forma en la que
//! Obsidian espera encontrarlas. El JSON estructurado de cada transcripción se
//! queda aparte, en la carpeta de configuración, para poder recargarla sea cual
//! sea el formato que se exportó.

use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::model::{Recording, Settings, Transcript};

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn sidecar_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = config_dir(app)?.join("transcripts");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Dónde se guarda todo mientras no haya vault vinculado.
fn default_root(app: &AppHandle) -> PathBuf {
    app.path()
        .document_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("cereales")
}

/// Raíz de audio y notas. Con Obsidian vinculado es una subcarpeta del vault,
/// no el vault entero: así las notas no se mezclan con el resto de la bóveda.
fn storage_root(app: &AppHandle, settings: &Settings) -> PathBuf {
    match settings.obsidian_vault_path.as_deref() {
        Some(vault) if !vault.trim().is_empty() => PathBuf::from(vault).join("transcripciones"),
        _ => default_root(app),
    }
}

fn audio_dir(app: &AppHandle, settings: &Settings) -> PathBuf {
    storage_root(app, settings).join("audio")
}

/// Carpetas de versiones anteriores. Se siguen leyendo para que el historial no
/// se vacíe al actualizar ni al vincular un vault.
fn legacy_audio_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let base = default_root(app);
    vec![base.join("grabaciones"), base]
}

/// Rejects path separators so a recording id can never escape its directory.
fn safe_id(recording_id: &str) -> Result<&str, String> {
    let bad = recording_id.is_empty()
        || recording_id.contains('/')
        || recording_id.contains('\\')
        || recording_id.contains("..");
    if bad {
        return Err(format!("Identificador de grabación inválido: {recording_id}"));
    }
    Ok(recording_id)
}

/// El frontend decide cómo se llaman las notas (`2026/2026-08-08-titulo.md`);
/// aquí solo se comprueba que la ruta se queda dentro de la raíz.
fn safe_rel_path(rel: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(rel);
    let ok = !rel.is_empty()
        && !candidate.is_absolute()
        && candidate
            .components()
            .all(|c| matches!(c, Component::Normal(_)));
    if !ok {
        return Err(format!("Ruta de transcripción inválida: {rel}"));
    }
    Ok(candidate.to_path_buf())
}

fn default_settings() -> Settings {
    Settings {
        obsidian_vault_path: None,
        // Lo rellena `load_settings`, que es quien sabe la ruta real.
        storage_root: String::new(),
        default_source_id: String::new(),
        transcript_format: "Obsidian".to_string(),
        transcription_service: "local".to_string(),
        eleven_labs_api_key: String::new(),
    }
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<Settings, String> {
    let path = config_dir(&app)?.join("settings.json");
    let mut settings: Settings = match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| e.to_string())?,
        // No settings file yet (first launch) — hand back the defaults.
        Err(_) => default_settings(),
    };
    // Campo derivado: manda el vault, no lo que hubiera guardado en disco.
    settings.storage_root = storage_root(&app, &settings).to_string_lossy().into_owned();
    Ok(settings)
}

/// Devuelve los ajustes ya recargados: `storageRoot` cambia al vincular un
/// vault, y el frontend lo enseña, así que tiene que recibirlo de vuelta.
#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<Settings, String> {
    let path = config_dir(&app)?.join("settings.json");
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())?;
    // La carpeta puede haber cambiado: el reproductor necesita verla.
    allow_storage_root(&app);
    load_settings(app)
}

/// El historial es la carpeta de audio: cada `X.wav` es una entrada, y su
/// `X.json` de al lado guarda título, fecha, duración y etiquetas. Sin índice
/// central, así que copiar la carpeta basta para llevarse el historial entero.
#[tauri::command]
pub fn list_recordings(app: AppHandle) -> Result<Vec<Recording>, String> {
    let settings = load_settings(app.clone())?;

    let mut dirs = vec![audio_dir(&app, &settings)];
    dirs.extend(legacy_audio_dirs(&app));

    let mut recordings = Vec::new();
    let mut seen = HashSet::new();
    for dir in dirs {
        collect_recordings(&dir, &mut recordings, &mut seen);
    }

    // El nombre lleva la marca de tiempo, así que el orden alfabético inverso
    // deja las más recientes arriba.
    recordings.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(recordings)
}

/// Añade a `out` las grabaciones de `dir`. Una carpeta que no existe no es un
/// error: las heredadas solo están si esa versión llegó a usarse.
fn collect_recordings(dir: &Path, out: &mut Vec<Recording>, seen: &mut HashSet<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("wav") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|n| n.to_str()) else {
            continue;
        };
        // La carpeta nueva gana: si una grabación se copió a las dos, la de
        // `audio/` es la que se está usando.
        if !seen.insert(id.to_string()) {
            continue;
        }

        // Un .json ausente o corrupto no puede esconder la grabación: el audio
        // existe, así que se muestra con lo que se pueda deducir del archivo.
        let mut recording = fs::read_to_string(dir.join(format!("{id}.json")))
            .ok()
            .and_then(|raw| serde_json::from_str::<Recording>(&raw).ok())
            .unwrap_or_else(|| Recording {
                id: id.to_string(),
                title: id.to_string(),
                started_at: String::new(),
                duration_sec: wav_duration_sec(&path),
                audio_path: None,
                transcript_path: None,
                tags: None,
            });
        // La ruta buena es la del archivo que acabamos de encontrar; la
        // guardada se queda obsoleta si se mueve la carpeta.
        recording.audio_path = Some(path.to_string_lossy().into_owned());
        out.push(recording);
    }
}

/// Duración leyendo solo la cabecera del WAV, para las grabaciones que se
/// quedaron sin metadatos.
fn wav_duration_sec(path: &Path) -> u64 {
    hound::WavReader::open(path)
        .map(|r| {
            let rate = r.spec().sample_rate.max(1) as u64;
            r.duration() as u64 / rate
        })
        .unwrap_or(0)
}

/// Los metadatos van pegados al WAV, que puede seguir en una carpeta heredada.
fn metadata_path(app: &AppHandle, settings: &Settings, recording: &Recording) -> PathBuf {
    let name = format!("{}.json", recording.id);
    recording
        .audio_path
        .as_deref()
        .map(Path::new)
        .and_then(|p| p.parent())
        .map(|dir| dir.join(&name))
        .unwrap_or_else(|| audio_dir(app, settings).join(&name))
}

#[tauri::command]
pub fn save_recording(app: AppHandle, recording: Recording) -> Result<(), String> {
    let _ = safe_id(&recording.id)?;
    let settings = load_settings(app.clone())?;

    let path = metadata_path(&app, &settings, &recording);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&recording).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_transcript(app: AppHandle, recording_id: String) -> Result<Option<Transcript>, String> {
    let id = safe_id(&recording_id)?;
    let path = sidecar_dir(&app)?.join(format!("{id}.json"));
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).map(Some).map_err(|e| e.to_string()),
        Err(_) => Ok(None),
    }
}

/// Writes the already-serialized transcript body, plus the JSON sidecar.
/// `rel_path` viene del frontend (`2026/2026-08-08-titulo.md`) y se resuelve
/// contra la raíz. Devuelve la ruta absoluta de la nota escrita.
#[tauri::command]
pub fn write_transcript(
    app: AppHandle,
    recording_id: String,
    contents: String,
    rel_path: String,
    transcript: Transcript,
) -> Result<String, String> {
    let id = safe_id(&recording_id)?;
    let rel = safe_rel_path(&rel_path)?;

    let sidecar = sidecar_dir(&app)?.join(format!("{id}.json"));
    let json = serde_json::to_string_pretty(&transcript).map_err(|e| e.to_string())?;
    fs::write(sidecar, json).map_err(|e| e.to_string())?;

    let settings = load_settings(app.clone())?;
    let out = storage_root(&app, &settings).join(rel);
    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&out, contents).map_err(|e| e.to_string())?;
    Ok(out.to_string_lossy().into_owned())
}

/// Borra una grabación: audio, metadatos, nota y JSON estructurado.
#[tauri::command]
pub fn delete_recording(app: AppHandle, recording_id: String) -> Result<(), String> {
    let id = safe_id(&recording_id)?;
    let settings = load_settings(app.clone())?;
    let recording = list_recordings(app.clone())?
        .into_iter()
        .find(|r| r.id == recording_id);

    if let Some(recording) = &recording {
        // Las rutas guardadas mandan: así se borra donde de verdad está el
        // archivo, aunque sea una carpeta heredada.
        if let Some(audio) = &recording.audio_path {
            let _ = fs::remove_file(audio);
        }
        let _ = fs::remove_file(metadata_path(&app, &settings, recording));
        if let Some(note) = &recording.transcript_path {
            let _ = fs::remove_file(note);
        }
    }

    let sidecar = sidecar_dir(&app)?.join(format!("{id}.json"));
    let _ = fs::remove_file(sidecar);

    Ok(())
}

/// Renombra una grabación. La nota lleva el título en el nombre del archivo, así
/// que hay que moverla: si no, Obsidian se queda con el nombre viejo y la
/// siguiente transcripción crearía una nota duplicada al lado.
#[tauri::command]
pub fn rename_recording(
    app: AppHandle,
    recording_id: String,
    new_title: String,
    new_rel_path: String,
) -> Result<(), String> {
    let _ = safe_id(&recording_id)?;
    let settings = load_settings(app.clone())?;

    let mut recording = list_recordings(app.clone())?
        .into_iter()
        .find(|r| r.id == recording_id)
        .ok_or_else(|| "Grabación no encontrada".to_string())?;
    recording.title = new_title;

    if let Some(old) = recording.transcript_path.clone() {
        let old_path = PathBuf::from(&old);
        let dest = storage_root(&app, &settings).join(safe_rel_path(&new_rel_path)?);
        if old_path.exists() && old_path != dest {
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::rename(&old_path, &dest).map_err(|e| e.to_string())?;
            recording.transcript_path = Some(dest.to_string_lossy().into_owned());
        }
    }

    let path = metadata_path(&app, &settings, &recording);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(&recording).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

/// Carpeta donde el grabador deja el WAV. Es la única que la crea antes de
/// tiempo, porque WASAPI necesita el archivo abierto desde el primer paquete.
pub fn recording_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let settings = load_settings(app.clone())?;
    let dir = audio_dir(app, &settings);
    fs::create_dir_all(&dir).map_err(|e| format!("No se pudo crear la carpeta de audio: {e}"))?;
    Ok(dir)
}

/// Abre la carpeta de audio al protocolo `asset://`, para que el reproductor
/// pueda pedirla por HTTP interno (con soporte de Range, y sin cargar el WAV
/// entero en memoria como haría un data URL).
///
/// El scope estático de `tauri.conf.json` solo cubre $HOME y $DOCUMENT; el vault
/// puede estar en cualquier unidad, así que se amplía en tiempo de ejecución.
pub fn allow_storage_root(app: &AppHandle) {
    let Ok(settings) = load_settings(app.clone()) else {
        return;
    };
    let scope = app.asset_protocol_scope();
    let _ = scope.allow_directory(audio_dir(app, &settings), false);
    for dir in legacy_audio_dirs(app) {
        let _ = scope.allow_directory(dir, false);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn una_ruta_relativa_no_puede_salirse_de_la_raiz() {
        assert!(safe_rel_path("2026/2026-08-08-reunion.md").is_ok());
        assert!(safe_rel_path("").is_err());
        assert!(safe_rel_path("../fuera.md").is_err());
        assert!(safe_rel_path("2026/../../fuera.md").is_err());
        assert!(safe_rel_path("/absoluta.md").is_err());
    }
}
