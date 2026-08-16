//! Stable error keys shared with the frontend.
//!
//! Rust cannot know which language the interface is in, so a command that fails
//! returns a key instead of a sentence. The frontend looks it up in its message
//! catalogue (`src/i18n/en.ts`, `es.ts`) and renders it in the right language;
//! see `src/lib/errors.ts`.
//!
//! A key may carry an OS-level detail after `|` — a WASAPI HRESULT, an IO
//! error. That part is not translatable and is shown verbatim in parentheses,
//! so it must never be the only thing returned.
//!
//! Every constant here needs a matching `err.*` entry in **both** catalogues.

use std::fmt::Display;

/// Attaches an untranslatable detail to a key: `err.audio.write|Access denied`.
pub fn with(key: &str, detail: impl Display) -> String {
    format!("{key}|{detail}")
}

// ------------------------------------------------------------------- audio
/// Only referenced on non-Windows builds, where the audio commands refuse.
#[cfg_attr(windows, allow(dead_code))]
pub const AUDIO_ONLY_WINDOWS: &str = "err.audio.onlyWindows";
pub const AUDIO_RECORDER_STATE: &str = "err.audio.recorderState";
pub const AUDIO_ALREADY_RECORDING: &str = "err.audio.alreadyRecording";
pub const AUDIO_NOT_RECORDING: &str = "err.audio.notRecording";
pub const AUDIO_UNKNOWN_SOURCE: &str = "err.audio.unknownSource";
pub const AUDIO_THREAD_CRASHED: &str = "err.audio.threadCrashed";
pub const AUDIO_THREAD_START: &str = "err.audio.threadStart";
pub const AUDIO_COM: &str = "err.audio.com";
pub const AUDIO_ENUMERATE: &str = "err.audio.enumerate";
pub const AUDIO_OPEN_DEVICE: &str = "err.audio.openDevice";
pub const AUDIO_DEVICE_FORMAT: &str = "err.audio.deviceFormat";
pub const AUDIO_START_CAPTURE: &str = "err.audio.startCapture";
pub const AUDIO_APP_CAPTURE: &str = "err.audio.appCapture";
pub const AUDIO_READ: &str = "err.audio.read";
pub const AUDIO_CREATE_FILE: &str = "err.audio.createFile";
pub const AUDIO_WRITE: &str = "err.audio.write";
pub const AUDIO_CLOSE_FILE: &str = "err.audio.closeFile";
pub const AUDIO_CREATE_DIR: &str = "err.audio.createDir";

// ------------------------------------------------------------------- model
pub const MODEL_MISSING: &str = "err.model.missing";
pub const MODEL_UNKNOWN: &str = "err.model.unknown";
pub const MODEL_DIR: &str = "err.model.dir";
pub const MODEL_DOWNLOAD: &str = "err.model.download";
pub const MODEL_SAVE: &str = "err.model.save";
pub const MODEL_LOAD: &str = "err.model.load";
pub const MODEL_DELETE: &str = "err.model.delete";

// ------------------------------------------------------------- transcription
pub const TRANSCRIBE_READ_AUDIO: &str = "err.transcribe.readAudio";
pub const TRANSCRIBE_FAILED: &str = "err.transcribe.failed";

// ----------------------------------------------------------------- capture
/// Only referenced on non-Windows builds, where the capture command refuses.
#[cfg_attr(windows, allow(dead_code))]
pub const CAPTURE_ONLY_WINDOWS: &str = "err.capture.onlyWindows";
pub const CAPTURE_COM: &str = "err.capture.com";
pub const CAPTURE_SCREEN: &str = "err.capture.screen";
pub const CAPTURE_BITMAP: &str = "err.capture.bitmap";
pub const CAPTURE_BLIT: &str = "err.capture.blit";
pub const CAPTURE_ENCODE: &str = "err.capture.encode";
pub const CAPTURE_DECODE: &str = "err.capture.decode";
pub const CAPTURE_TOO_LARGE: &str = "err.capture.tooLarge";

// ----------------------------------------------------------------- storage
pub const STORAGE_INVALID_ID: &str = "err.storage.invalidId";
pub const STORAGE_INVALID_PATH: &str = "err.storage.invalidPath";
pub const STORAGE_NOT_FOUND: &str = "err.storage.notFound";
pub const STORAGE_READ: &str = "err.storage.read";
pub const STORAGE_WRITE: &str = "err.storage.write";
