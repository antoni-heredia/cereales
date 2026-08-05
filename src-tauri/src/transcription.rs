//! Transcripción con whisper.cpp (whisper-rs), en local.
//!
//! El modelo no se empaqueta con la app: pesa cientos de megas y se descarga la
//! primera vez desde el repositorio de whisper.cpp en Hugging Face.
//!
//! whisper.cpp no hace diarización, así que `speaker` va vacío; la interfaz
//! oculta esa línea cuando no hay nombre en lugar de inventar uno.

use std::io::Read;
use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::model::TranscriptEntry;

/// `small` es el equilibrio razonable para español: bastante mejor que `base`
/// sin llegar al coste de `medium` en CPU.
const MODEL_FILE: &str = "ggml-small.bin";
const MODEL_URL: &str =
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin?download=true";

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub installed: bool,
    pub name: String,
    pub bytes: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    /// 0..100; -1 cuando no se conoce el total.
    percent: i32,
    stage: String,
}

fn model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("No se pudo resolver la carpeta de datos: {e}"))?
        .join("models");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("No se pudo crear la carpeta de modelos: {e}"))?;
    Ok(dir)
}

fn model_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(model_dir(app)?.join(MODEL_FILE))
}

#[tauri::command]
pub fn model_status(app: AppHandle) -> Result<ModelStatus, String> {
    let path = model_path(&app)?;
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    Ok(ModelStatus {
        // Un archivo a medio bajar no sirve; se exige un tamaño mínimo creíble.
        installed: bytes > 50_000_000,
        name: MODEL_FILE.to_string(),
        bytes,
    })
}

#[tauri::command]
pub fn download_model(app: AppHandle) -> Result<ModelStatus, String> {
    if model_status(app.clone())?.installed {
        return model_status(app);
    }

    let final_path = model_path(&app)?;
    // Se descarga a un temporal y se renombra al final, para que una descarga
    // interrumpida no deje un modelo corrupto que parezca válido.
    let temp_path = final_path.with_extension("part");

    let response = ureq::get(MODEL_URL)
        .call()
        .map_err(|e| format!("No se pudo descargar el modelo: {e}"))?;

    let total: u64 = response
        .header("Content-Length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    let mut reader = response.into_reader();
    let mut file = std::fs::File::create(&temp_path)
        .map_err(|e| format!("No se pudo crear el archivo del modelo: {e}"))?;

    let mut buffer = vec![0u8; 1 << 16];
    let mut downloaded: u64 = 0;
    let mut last_percent = -1i32;

    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|e| format!("Error descargando el modelo: {e}"))?;
        if read == 0 {
            break;
        }
        std::io::Write::write_all(&mut file, &buffer[..read])
            .map_err(|e| format!("Error escribiendo el modelo: {e}"))?;
        downloaded += read as u64;

        let percent = if total > 0 {
            (downloaded * 100 / total) as i32
        } else {
            -1
        };
        if percent != last_percent {
            last_percent = percent;
            let _ = app.emit(
                "model://progress",
                Progress {
                    percent,
                    stage: "descargando".to_string(),
                },
            );
        }
    }

    drop(file);
    std::fs::rename(&temp_path, &final_path)
        .map_err(|e| format!("No se pudo guardar el modelo: {e}"))?;

    model_status(app)
}

/// whisper rellena los silencios con anotaciones inventadas del tipo
/// "[MÚSICA]", "[BLANK_AUDIO]" o "(risas)".
///
/// No son habla, y en esta app además hacen daño: el salto desde una nota busca
/// la entrada más cercana en el tiempo, y una de estas etiquetas puede robarle
/// el sitio a la frase que la nota comentaba de verdad.
fn es_anotacion_no_verbal(text: &str) -> bool {
    let t = text.trim();
    (t.starts_with('[') && t.ends_with(']')) || (t.starts_with('(') && t.ends_with(')'))
}

/// Lee el WAV mono de 16 kHz que escribe el grabador.
fn read_wav(path: &str) -> Result<Vec<f32>, String> {
    let mut reader = hound::WavReader::open(path)
        .map_err(|e| format!("No se pudo abrir el audio grabado: {e}"))?;
    let spec = reader.spec();

    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => reader
            .samples::<i16>()
            .map(|s| s.map(|v| v as f32 / i16::MAX as f32))
            .collect::<Result<_, _>>()
            .map_err(|e| format!("Error leyendo el audio: {e}"))?,
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .collect::<Result<_, _>>()
            .map_err(|e| format!("Error leyendo el audio: {e}"))?,
    };

    let mono = crate::dsp::to_mono(&samples, spec.channels as usize);
    Ok(crate::dsp::resample(&mono, spec.sample_rate, 16_000))
}

#[tauri::command]
pub fn transcribe(app: AppHandle, audio_path: String) -> Result<Vec<TranscriptEntry>, String> {
    let status = model_status(app.clone())?;
    if !status.installed {
        return Err(
            "Falta el modelo de transcripción. Descárgalo desde Ajustes antes de grabar."
                .to_string(),
        );
    }

    let model = model_path(&app)?;
    let progress_app = app.clone();
    run_whisper(&model, &audio_path, move |percent| {
        let _ = progress_app.emit(
            "model://progress",
            Progress {
                percent,
                stage: "transcribiendo".to_string(),
            },
        );
    })
}

/// Núcleo de la transcripción, sin dependencias de Tauri para poder ejercitarlo
/// desde un test con un audio de referencia.
pub fn run_whisper(
    model: &std::path::Path,
    audio_path: &str,
    on_progress: impl Fn(i32) + Send + 'static,
) -> Result<Vec<TranscriptEntry>, String> {
    let audio = read_wav(audio_path)?;
    if audio.is_empty() {
        return Ok(Vec::new());
    }

    // whisper.cpp escribe un log por token en stderr; se redirige al sistema de
    // trazas en lugar de dejarlo salir por consola.
    static LOGGING: std::sync::Once = std::sync::Once::new();
    LOGGING.call_once(whisper_rs::install_logging_hooks);

    let path_str = model.to_string_lossy().into_owned();
    let ctx = WhisperContext::new_with_params(&path_str, WhisperContextParameters::default())
        .map_err(|e| format!("No se pudo cargar el modelo: {e}"))?;
    let mut state = ctx
        .create_state()
        .map_err(|e| format!("No se pudo inicializar el modelo: {e}"))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("es"));
    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    let threads = std::thread::available_parallelism()
        .map(|n| n.get() as i32)
        .unwrap_or(4);
    params.set_n_threads(threads);

    params.set_progress_callback_safe(on_progress);

    state
        .full(params, &audio)
        .map_err(|e| format!("La transcripción falló: {e}"))?;

    let mut entries = Vec::new();
    for segment in state.as_iter() {
        let raw = segment
            .to_str_lossy()
            .map_err(|e| format!("No se pudo leer un segmento: {e}"))?;
        let text = raw.trim().to_string();
        if text.is_empty() || es_anotacion_no_verbal(&text) {
            continue;
        }
        entries.push(TranscriptEntry {
            // whisper devuelve las marcas en centésimas de segundo.
            time_sec: segment.start_timestamp() as f64 / 100.0,
            speaker: String::new(),
            text,
        });
    }

    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn descarta_anotaciones_no_verbales() {
        for t in ["[MÚSICA]", "[BLANK_AUDIO]", "(risas)", "  [Música]  "] {
            assert!(es_anotacion_no_verbal(t), "debería descartarse: {t}");
        }
        for t in ["Empezamos con el repaso", "La retención [sic] bajó", "(2) puntos menos"] {
            assert!(!es_anotacion_no_verbal(t), "no debería descartarse: {t}");
        }
    }

    /// Transcribe un audio real (voz sintetizada en español) con el modelo
    /// descargado. Se omite si el modelo no está presente, para no obligar a
    /// bajarse 490 MB en cada ejecución de los tests.
    #[test]
    fn transcribe_voz_en_espanol() {
        let model = std::path::PathBuf::from(std::env::var("APPDATA").unwrap_or_default())
            .join("com.cereales.app")
            .join("models")
            .join(MODEL_FILE);
        if !model.exists() {
            eprintln!("modelo no descargado; test omitido");
            return;
        }

        let audio = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/voz-es.wav");
        let entries = run_whisper(&model, audio, |_| {}).expect("la transcripción debería funcionar");

        for e in &entries {
            println!("{:>6.2}s  {}", e.time_sec, e.text);
        }
        assert!(!entries.is_empty(), "debería salir al menos un segmento");

        let full = entries
            .iter()
            .map(|e| e.text.to_lowercase())
            .collect::<Vec<_>>()
            .join(" ");
        // No se exige transcripción literal; basta con que reconozca el tema.
        assert!(
            full.contains("retención") || full.contains("retencion"),
            "no reconoció la palabra clave; salió: {full}"
        );
        assert!(
            entries.iter().all(|e| e.time_sec >= 0.0),
            "las marcas de tiempo deben ser positivas"
        );
    }
}
