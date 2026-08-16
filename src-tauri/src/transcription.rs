//! Local transcription with whisper.cpp (whisper-rs).
//!
//! No model is bundled with the app: they weigh hundreds of megabytes and are
//! downloaded on demand from the whisper.cpp repository on Hugging Face. Which
//! one to use is the user's choice, and several can live on disk at once.
//!
//! whisper.cpp does not diarize, so `speaker` is left empty; the UI hides that
//! line when there is no name rather than inventing one.

use std::io::Read;
use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

use crate::errors;
use crate::model::TranscriptEntry;

struct ModelSpec {
    /// Key the frontend matches on and translates into a description. It is
    /// also what `Settings::whisper_model` stores.
    id: &'static str,
    file: &'static str,
    /// Published size, give or take. Used to label the option in the picker and
    /// to spot a truncated file that the app did not write itself.
    approx_bytes: u64,
}

const MODEL_BASE_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/";

/// The multilingual F16 models. The `.en` variants are deliberately absent:
/// the app is bilingual and an English-only model would break Spanish.
const MODELS: [ModelSpec; 5] = [
    ModelSpec {
        id: "tiny",
        file: "ggml-tiny.bin",
        approx_bytes: 78_000_000,
    },
    ModelSpec {
        id: "base",
        file: "ggml-base.bin",
        approx_bytes: 148_000_000,
    },
    ModelSpec {
        id: "small",
        file: "ggml-small.bin",
        approx_bytes: 488_000_000,
    },
    ModelSpec {
        id: "medium",
        file: "ggml-medium.bin",
        approx_bytes: 1_530_000_000,
    },
    ModelSpec {
        id: "large-v3-turbo",
        file: "ggml-large-v3-turbo.bin",
        approx_bytes: 1_620_000_000,
    },
];

/// `small` is the sensible balance for speech: clearly better than `base`
/// without the CPU cost of `medium`. It is also the only model earlier versions
/// downloaded, so an existing install keeps working without downloading again.
pub const DEFAULT_MODEL: &str = "small";

/// Languages the frontend can name explicitly. Anything else — `auto`, which
/// the frontend does send deliberately, but also a stale settings file — falls
/// back to whisper's own detection instead of failing.
///
/// Getting this wrong is not a cosmetic mistake: the language token conditions
/// the decoder, so promising English over Spanish speech yields an English
/// transcript even with `set_translate(false)`.
const SUPPORTED_LANGUAGES: [&str; 2] = ["en", "es"];

/// Resolving through the catalogue is also what keeps a model id coming from
/// the frontend from turning into an arbitrary path.
fn spec(id: &str) -> Result<&'static ModelSpec, String> {
    MODELS
        .iter()
        .find(|m| m.id == id)
        .ok_or_else(|| errors::with(errors::MODEL_UNKNOWN, id))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    /// Catalogue id: `tiny` | `base` | `small` | `medium` | `large-v3-turbo`.
    pub id: String,
    pub installed: bool,
    pub name: String,
    /// Bytes on disk; 0 when the model is not downloaded.
    pub bytes: u64,
    /// Catalogue size, so the picker can show how big a download would be.
    pub approx_bytes: u64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress {
    /// 0..100; -1 when the total is unknown.
    percent: i32,
    /// `downloading` | `transcribing`, matched by name in the frontend.
    stage: String,
}

fn model_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| errors::with(errors::MODEL_DIR, e))?
        .join("models");
    std::fs::create_dir_all(&dir).map_err(|e| errors::with(errors::MODEL_DIR, e))?;
    Ok(dir)
}

fn model_path(app: &AppHandle, spec: &ModelSpec) -> Result<PathBuf, String> {
    Ok(model_dir(app)?.join(spec.file))
}

fn status_of(app: &AppHandle, spec: &ModelSpec) -> Result<ModelStatus, String> {
    let path = model_path(app, spec)?;
    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    Ok(ModelStatus {
        id: spec.id.to_string(),
        // Completeness is really guaranteed by the `.part` rename below; this
        // only rejects a stray truncated file, and the threshold is per model
        // so a half-written `medium` cannot pass for a whole `tiny`.
        installed: bytes >= spec.approx_bytes / 2,
        name: spec.file.to_string(),
        bytes,
        approx_bytes: spec.approx_bytes,
    })
}

#[tauri::command]
pub fn model_status(app: AppHandle, model: String) -> Result<ModelStatus, String> {
    status_of(&app, spec(&model)?)
}

/// The whole catalogue with its download state: everything the model picker
/// needs in a single call.
#[tauri::command]
pub fn list_models(app: AppHandle) -> Result<Vec<ModelStatus>, String> {
    MODELS.iter().map(|spec| status_of(&app, spec)).collect()
}

#[tauri::command]
pub fn delete_model(app: AppHandle, model: String) -> Result<Vec<ModelStatus>, String> {
    let spec = spec(&model)?;
    let path = model_path(&app, spec)?;
    match std::fs::remove_file(&path) {
        Ok(()) => {}
        // Already gone is the state the caller wanted.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(errors::with(errors::MODEL_DELETE, e)),
    }
    list_models(app)
}

#[tauri::command]
pub fn download_model(app: AppHandle, model: String) -> Result<ModelStatus, String> {
    let spec = spec(&model)?;
    let current = status_of(&app, spec)?;
    if current.installed {
        return Ok(current);
    }

    let final_path = model_path(&app, spec)?;
    // Downloaded to a temporary file and renamed at the end, so an interrupted
    // download cannot leave behind a corrupt model that looks valid.
    let temp_path = final_path.with_extension("part");

    let url = format!("{MODEL_BASE_URL}{}?download=true", spec.file);
    let response = ureq::get(&url)
        .call()
        .map_err(|e| errors::with(errors::MODEL_DOWNLOAD, e))?;

    let total: u64 = response
        .header("Content-Length")
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    let mut reader = response.into_reader();
    let mut file =
        std::fs::File::create(&temp_path).map_err(|e| errors::with(errors::MODEL_SAVE, e))?;

    let mut buffer = vec![0u8; 1 << 16];
    let mut downloaded: u64 = 0;
    let mut last_percent = -1i32;

    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|e| errors::with(errors::MODEL_DOWNLOAD, e))?;
        if read == 0 {
            break;
        }
        std::io::Write::write_all(&mut file, &buffer[..read])
            .map_err(|e| errors::with(errors::MODEL_SAVE, e))?;
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
                    stage: "downloading".to_string(),
                },
            );
        }
    }

    drop(file);
    std::fs::rename(&temp_path, &final_path).map_err(|e| errors::with(errors::MODEL_SAVE, e))?;

    status_of(&app, spec)
}

/// whisper fills silences with invented annotations along the lines of
/// "[MUSIC]", "[BLANK_AUDIO]" or "(laughs)".
///
/// They are not speech, and in this app they actively hurt: the jump from a
/// note looks for the nearest entry in time, and one of these labels can steal
/// the spot from the sentence the note was actually about.
fn is_non_verbal_annotation(text: &str) -> bool {
    let t = text.trim();
    (t.starts_with('[') && t.ends_with(']')) || (t.starts_with('(') && t.ends_with(')'))
}

/// Reads the mono 16 kHz WAV the recorder writes.
fn read_wav(path: &str) -> Result<Vec<f32>, String> {
    let mut reader =
        hound::WavReader::open(path).map_err(|e| errors::with(errors::TRANSCRIBE_READ_AUDIO, e))?;
    let spec = reader.spec();

    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => reader
            .samples::<i16>()
            .map(|s| s.map(|v| v as f32 / i16::MAX as f32))
            .collect::<Result<_, _>>()
            .map_err(|e| errors::with(errors::TRANSCRIBE_READ_AUDIO, e))?,
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .collect::<Result<_, _>>()
            .map_err(|e| errors::with(errors::TRANSCRIBE_READ_AUDIO, e))?,
    };

    let mono = crate::dsp::to_mono(&samples, spec.channels as usize);
    Ok(crate::dsp::resample(&mono, spec.sample_rate, 16_000))
}

/// `lang` is the interface language, passed down as the language whisper should
/// expect in the audio. `model` is the catalogue id the user picked.
#[tauri::command]
pub fn transcribe(
    app: AppHandle,
    audio_path: String,
    lang: String,
    model: String,
) -> Result<Vec<TranscriptEntry>, String> {
    let spec = spec(&model)?;
    if !status_of(&app, spec)?.installed {
        return Err(errors::MODEL_MISSING.to_string());
    }

    let model = model_path(&app, spec)?;
    let progress_app = app.clone();
    run_whisper(&model, &audio_path, &lang, move |percent| {
        let _ = progress_app.emit(
            "model://progress",
            Progress {
                percent,
                stage: "transcribing".to_string(),
            },
        );
    })
}

/// Core of the transcription, free of Tauri dependencies so it can be exercised
/// from a test with a reference audio file.
pub fn run_whisper(
    model: &std::path::Path,
    audio_path: &str,
    lang: &str,
    on_progress: impl Fn(i32) + Send + 'static,
) -> Result<Vec<TranscriptEntry>, String> {
    let audio = read_wav(audio_path)?;
    if audio.is_empty() {
        return Ok(Vec::new());
    }

    // whisper.cpp writes a log line per token to stderr; it is redirected to the
    // tracing system instead of being left to spill onto the console.
    static LOGGING: std::sync::Once = std::sync::Once::new();
    LOGGING.call_once(whisper_rs::install_logging_hooks);

    let path_str = model.to_string_lossy().into_owned();
    let ctx = WhisperContext::new_with_params(&path_str, WhisperContextParameters::default())
        .map_err(|e| errors::with(errors::MODEL_LOAD, e))?;
    let mut state = ctx
        .create_state()
        .map_err(|e| errors::with(errors::MODEL_LOAD, e))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    let language = if SUPPORTED_LANGUAGES.contains(&lang) {
        lang
    } else {
        "auto"
    };
    params.set_language(Some(language));
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
        .map_err(|e| errors::with(errors::TRANSCRIBE_FAILED, e))?;

    let mut entries = Vec::new();
    for segment in state.as_iter() {
        let raw = segment
            .to_str_lossy()
            .map_err(|e| errors::with(errors::TRANSCRIBE_FAILED, e))?;
        let text = raw.trim().to_string();
        if text.is_empty() || is_non_verbal_annotation(&text) {
            continue;
        }
        entries.push(TranscriptEntry {
            // whisper returns timestamps in hundredths of a second.
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
    fn drops_non_verbal_annotations() {
        for t in ["[MUSIC]", "[BLANK_AUDIO]", "(laughs)", "  [Music]  "] {
            assert!(is_non_verbal_annotation(t), "should be dropped: {t}");
        }
        for t in [
            "Let us start with the review",
            "Retention [sic] dropped",
            "(2) points fewer",
        ] {
            assert!(!is_non_verbal_annotation(t), "should not be dropped: {t}");
        }
    }

    /// Every catalogue entry has to be resolvable by the id the frontend sends,
    /// and the default has to be one of them — otherwise a fresh install picks
    /// a model that cannot be downloaded.
    #[test]
    fn every_model_id_resolves() {
        for m in MODELS.iter() {
            assert_eq!(spec(m.id).expect("should resolve").file, m.file);
        }
        assert!(spec(DEFAULT_MODEL).is_ok(), "the default must be in the catalogue");
        assert!(spec("made-up").is_err(), "an unknown id must not resolve");
    }

    /// Transcribes real audio (synthesized Spanish speech) with the default
    /// model. Skipped when it is absent, so running the tests does not force a
    /// 490 MB download.
    ///
    /// The fixture stays Spanish regardless of the interface language: what it
    /// checks is that `run_whisper` honours the language it is given.
    #[test]
    fn transcribes_spanish_speech() {
        let model = std::path::PathBuf::from(std::env::var("APPDATA").unwrap_or_default())
            .join("com.cereales.app")
            .join("models")
            .join(spec(DEFAULT_MODEL).expect("default model").file);
        if !model.exists() {
            eprintln!("model not downloaded; test skipped");
            return;
        }

        let audio = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/voz-es.wav");
        let entries =
            run_whisper(&model, audio, "es", |_| {}).expect("transcription should work");

        for e in &entries {
            println!("{:>6.2}s  {}", e.time_sec, e.text);
        }
        assert!(!entries.is_empty(), "at least one segment should come out");

        let full = entries
            .iter()
            .map(|e| e.text.to_lowercase())
            .collect::<Vec<_>>()
            .join(" ");
        // Literal transcription is not required; recognising the topic is enough.
        assert!(
            full.contains("retención") || full.contains("retencion"),
            "did not recognise the keyword; got: {full}"
        );
        assert!(
            entries.iter().all(|e| e.time_sec >= 0.0),
            "timestamps must be positive"
        );
    }
}
