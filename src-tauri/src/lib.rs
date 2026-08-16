mod audio;
mod capture;
mod dsp;
mod errors;
mod model;
mod storage;
mod transcription;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(audio::RecorderState::default())
        .setup(|app| {
            // Before anything reads the history: brings the folder and file
            // names written by earlier versions up to date. Idempotent.
            storage::migrate_legacy_names(app.handle());
            // The player serves the WAV over `asset://`, and the audio folder
            // may fall outside the static scope in the config.
            storage::allow_storage_root(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            audio::list_audio_sources,
            audio::start_recording,
            audio::stop_recording,
            capture::capture_screen,
            transcription::transcribe,
            transcription::model_status,
            transcription::list_models,
            transcription::download_model,
            transcription::delete_model,
            storage::load_settings,
            storage::save_settings,
            storage::list_recordings,
            storage::save_recording,
            storage::load_transcript,
            storage::write_transcript,
            storage::write_notes,
            storage::save_screenshot,
            storage::read_screenshot,
            storage::replace_screenshot,
            storage::delete_recording,
            storage::rename_recording,
        ])
        .run(tauri::generate_context!())
        .expect("failed to start cereales");
}
