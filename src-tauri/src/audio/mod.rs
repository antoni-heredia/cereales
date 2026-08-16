//! Recording commands and recorder state.

#[cfg(windows)]
mod win;

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::AppHandle;

use crate::errors;
use crate::model::{AudioSource, StopResult};

#[cfg(windows)]
#[derive(Default)]
pub struct RecorderState {
    session: Mutex<Option<win::CaptureHandle>>,
}

#[cfg(not(windows))]
#[derive(Default)]
pub struct RecorderState {
    _unused: Mutex<()>,
}

fn timestamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

#[tauri::command]
pub fn list_audio_sources() -> Result<Vec<AudioSource>, String> {
    #[cfg(windows)]
    {
        win::list_sources()
    }
    #[cfg(not(windows))]
    {
        Err(errors::AUDIO_ONLY_WINDOWS.to_string())
    }
}

/// Starts capturing and returns the id of the recording that just began.
///
/// The id exists from this moment — it is the stem of the WAV — and the
/// frontend needs it right away: a note or a screenshot taken mid-meeting is
/// filed under it, and waiting until `stop_recording` to learn it would mean
/// nothing could be persisted until then.
#[tauri::command]
pub fn start_recording(
    app: AppHandle,
    state: tauri::State<'_, RecorderState>,
    source_id: String,
) -> Result<String, String> {
    #[cfg(windows)]
    {
        let mut slot = state
            .session
            .lock()
            .map_err(|_| errors::AUDIO_RECORDER_STATE.to_string())?;
        if slot.is_some() {
            return Err(errors::AUDIO_ALREADY_RECORDING.to_string());
        }

        let folder = crate::storage::recording_dir(&app)?;
        // The filename stem is the id of the recording: the frontend derives it
        // from this path, and the metadata sidecar is stored under it.
        let path = folder.join(format!(
            "{}{}.wav",
            crate::storage::RECORDING_PREFIX,
            timestamp()
        ));

        let id = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .ok_or_else(|| errors::AUDIO_CREATE_FILE.to_string())?
            .to_string();

        let spec = win::SourceSpec::parse(&source_id)?;
        let emitter = app.clone();
        let sink: win::LevelSink = Box::new(move |levels| {
            let _ = tauri::Emitter::emit(&emitter, "audio://levels", levels);
        });
        *slot = Some(win::start(spec, path, sink)?);
        Ok(id)
    }
    #[cfg(not(windows))]
    {
        let _ = (app, state, source_id, timestamp);
        Err(errors::AUDIO_ONLY_WINDOWS.to_string())
    }
}

#[tauri::command]
pub fn stop_recording(state: tauri::State<'_, RecorderState>) -> Result<StopResult, String> {
    #[cfg(windows)]
    {
        let handle = {
            let mut slot = state
                .session
                .lock()
                .map_err(|_| errors::AUDIO_RECORDER_STATE.to_string())?;
            slot.take()
        };
        let handle = handle.ok_or_else(|| errors::AUDIO_NOT_RECORDING.to_string())?;

        let path = handle.path.clone();
        let duration_sec = handle.started.elapsed().as_secs();
        handle.stop()?;

        Ok(StopResult {
            audio_path: path.to_string_lossy().into_owned(),
            duration_sec,
        })
    }
    #[cfg(not(windows))]
    {
        let _ = state;
        Err(errors::AUDIO_ONLY_WINDOWS.to_string())
    }
}
