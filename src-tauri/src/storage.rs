//! Settings, recording index and transcript persistence.
//!
//! Settings and the recording index live in the app config directory. Rendered
//! transcripts go to the user-chosen transcript folder; a JSON sidecar is kept
//! alongside the index so `load_transcript` can round-trip structured data
//! regardless of which output format the user picked.

use std::fs;
use std::path::PathBuf;

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

fn default_settings(app: &AppHandle) -> Settings {
    let base = app
        .path()
        .document_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("cereales");
    Settings {
        recording_folder: base.join("grabaciones").to_string_lossy().into_owned(),
        transcript_folder: base.join("transcripciones").to_string_lossy().into_owned(),
        default_source_id: String::new(),
        transcript_format: "Markdown".to_string(),
    }
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

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<Settings, String> {
    let path = config_dir(&app)?.join("settings.json");
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| e.to_string()),
        // No settings file yet (first launch) — hand back the defaults.
        Err(_) => Ok(default_settings(&app)),
    }
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let path = config_dir(&app)?.join("settings.json");
    let json = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())?;
    // La carpeta puede haber cambiado: el reproductor necesita verla.
    allow_recording_folder(&app);
    Ok(())
}

/// El historial es la carpeta de grabaciones: cada `X.wav` es una entrada, y su
/// `X.json` de al lado guarda título, fecha y duración. Sin índice central, así
/// que copiar la carpeta basta para llevarse el historial entero.
#[tauri::command]
pub fn list_recordings(app: AppHandle) -> Result<Vec<Recording>, String> {
    let settings = load_settings(app)?;
    let recording_dir = PathBuf::from(&settings.recording_folder);
    if !recording_dir.exists() {
        return Ok(Vec::new());
    }

    let mut recordings = Vec::new();
    for entry in fs::read_dir(&recording_dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("wav") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|n| n.to_str()) else {
            continue;
        };

        // Un .json ausente o corrupto no puede esconder la grabación: el audio
        // existe, así que se muestra con lo que se pueda deducir del archivo.
        let mut recording = fs::read_to_string(recording_dir.join(format!("{id}.json")))
            .ok()
            .and_then(|raw| serde_json::from_str::<Recording>(&raw).ok())
            .unwrap_or_else(|| Recording {
                id: id.to_string(),
                title: id.to_string(),
                started_at: String::new(),
                duration_sec: wav_duration_sec(&path),
                audio_path: None,
                transcript_path: None,
            });
        // La ruta buena es la del archivo que acabamos de encontrar; la
        // guardada se queda obsoleta si se mueve la carpeta.
        recording.audio_path = Some(path.to_string_lossy().into_owned());
        recordings.push(recording);
    }

    // El nombre lleva la marca de tiempo, así que el orden alfabético inverso
    // deja las más recientes arriba.
    recordings.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(recordings)
}

/// Duración leyendo solo la cabecera del WAV, para las grabaciones que se
/// quedaron sin metadatos.
fn wav_duration_sec(path: &std::path::Path) -> u64 {
    hound::WavReader::open(path)
        .map(|r| {
            let rate = r.spec().sample_rate.max(1) as u64;
            r.duration() as u64 / rate
        })
        .unwrap_or(0)
}

#[tauri::command]
pub fn save_recording(app: AppHandle, recording: Recording) -> Result<(), String> {
    let settings = load_settings(app)?;
    let recording_dir = PathBuf::from(&settings.recording_folder);
    fs::create_dir_all(&recording_dir).map_err(|e| e.to_string())?;

    // Guardar metadatos en archivo .json junto al .wav
    let id = safe_id(&recording.id)?;
    let metadata_path = recording_dir.join(format!("{}.json", id));
    let json = serde_json::to_string_pretty(&recording).map_err(|e| e.to_string())?;
    fs::write(metadata_path, json).map_err(|e| e.to_string())
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
/// Returns the path of the rendered transcript.
#[tauri::command]
pub fn write_transcript(
    app: AppHandle,
    recording_id: String,
    contents: String,
    extension: String,
    transcript: Transcript,
) -> Result<String, String> {
    let id = safe_id(&recording_id)?;

    let sidecar = sidecar_dir(&app)?.join(format!("{id}.json"));
    let json = serde_json::to_string_pretty(&transcript).map_err(|e| e.to_string())?;
    fs::write(sidecar, json).map_err(|e| e.to_string())?;

    let settings = load_settings(app)?;
    let folder = PathBuf::from(&settings.transcript_folder);
    fs::create_dir_all(&folder).map_err(|e| e.to_string())?;

    let out = folder.join(format!("{id}.{extension}"));
    fs::write(&out, contents).map_err(|e| e.to_string())?;
    Ok(out.to_string_lossy().into_owned())
}

/// Borra una grabación (audio, metadatos y transcripción)
#[tauri::command]
pub fn delete_recording(app: AppHandle, recording_id: String) -> Result<(), String> {
    let id = safe_id(&recording_id)?;
    let settings = load_settings(app.clone())?;
    let recording_dir = PathBuf::from(&settings.recording_folder);

    // Borrar archivo .wav
    let audio_path = recording_dir.join(format!("{}.wav", id));
    if audio_path.exists() {
        fs::remove_file(&audio_path).map_err(|e| e.to_string())?;
    }

    // Borrar archivo .json de metadatos
    let metadata_path = recording_dir.join(format!("{}.json", id));
    if metadata_path.exists() {
        fs::remove_file(&metadata_path).map_err(|e| e.to_string())?;
    }

    // Borrar transcripción si existe
    let sidecar = sidecar_dir(&app)?.join(format!("{}.json", id));
    if sidecar.exists() {
        fs::remove_file(&sidecar).map_err(|e| e.to_string())?;
    }

    // Borrar archivos de transcripción renderizados
    let transcript_dir = PathBuf::from(&settings.transcript_folder);
    for ext in &["txt", "md", "srt"] {
        let transcript_path = transcript_dir.join(format!("{}.{}", id, ext));
        if transcript_path.exists() {
            let _ = fs::remove_file(&transcript_path);
        }
    }

    Ok(())
}

/// Renombra una grabación (metadata y archivos asociados)
#[tauri::command]
pub fn rename_recording(
    app: AppHandle,
    recording_id: String,
    new_title: String,
) -> Result<(), String> {
    let id = safe_id(&recording_id)?;

    // Cargar la grabación existente
    let mut all = list_recordings(app.clone())?;
    let recording = all
        .iter_mut()
        .find(|r| r.id == recording_id)
        .ok_or_else(|| "Grabación no encontrada".to_string())?;

    // Actualizar el título
    recording.title = new_title;

    // Guardar metadatos actualizados
    let settings = load_settings(app)?;
    let recording_dir = PathBuf::from(&settings.recording_folder);
    let metadata_path = recording_dir.join(format!("{}.json", id));
    let json = serde_json::to_string_pretty(&recording).map_err(|e| e.to_string())?;
    fs::write(metadata_path, json).map_err(|e| e.to_string())
}

/// Abre la carpeta de grabaciones al protocolo `asset://`, para que el
/// reproductor pueda pedirla por HTTP interno (con soporte de Range, y sin
/// cargar el WAV entero en memoria como haría un data URL).
///
/// El scope estático de `tauri.conf.json` solo cubre $HOME y $DOCUMENT; la
/// carpeta es configurable, así que se amplía en tiempo de ejecución.
pub fn allow_recording_folder(app: &AppHandle) {
    if let Ok(settings) = load_settings(app.clone()) {
        let _ = app
            .asset_protocol_scope()
            .allow_directory(&settings.recording_folder, false);
    }
}
