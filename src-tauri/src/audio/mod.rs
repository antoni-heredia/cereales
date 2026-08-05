//! Comandos de grabación y estado del grabador.

#[cfg(windows)]
mod win;

use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::AppHandle;

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

#[cfg(not(windows))]
const ONLY_WINDOWS: &str = "La captura de audio nativa solo está implementada en Windows.";

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
        Err(ONLY_WINDOWS.to_string())
    }
}

#[tauri::command]
pub fn start_recording(
    app: AppHandle,
    state: tauri::State<'_, RecorderState>,
    source_id: String,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        let mut slot = state
            .session
            .lock()
            .map_err(|_| "El estado del grabador quedó inconsistente.".to_string())?;
        if slot.is_some() {
            return Err("Ya hay una grabación en curso.".to_string());
        }

        let settings = crate::storage::load_settings(app.clone())?;
        let folder = std::path::PathBuf::from(&settings.recording_folder);
        std::fs::create_dir_all(&folder)
            .map_err(|e| format!("No se pudo crear la carpeta de grabaciones: {e}"))?;
        let path = folder.join(format!("grabacion-{}.wav", timestamp()));

        let spec = win::SourceSpec::parse(&source_id)?;
        let emitter = app.clone();
        let sink: win::LevelSink = Box::new(move |levels| {
            let _ = tauri::Emitter::emit(&emitter, "audio://levels", levels);
        });
        *slot = Some(win::start(spec, path, sink)?);
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (app, state, source_id);
        Err(ONLY_WINDOWS.to_string())
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
                .map_err(|_| "El estado del grabador quedó inconsistente.".to_string())?;
            slot.take()
        };
        let handle = handle.ok_or_else(|| "No hay ninguna grabación en curso.".to_string())?;

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
        Err(ONLY_WINDOWS.to_string())
    }
}
