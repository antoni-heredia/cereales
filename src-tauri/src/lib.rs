mod audio;
mod dsp;
mod model;
mod storage;
mod transcription;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(audio::RecorderState::default())
        .setup(|app| {
            // El reproductor sirve el WAV por `asset://`; la carpeta de audio
            // puede estar fuera del scope estático de la config.
            storage::allow_storage_root(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            audio::list_audio_sources,
            audio::start_recording,
            audio::stop_recording,
            transcription::transcribe,
            transcription::model_status,
            transcription::download_model,
            storage::load_settings,
            storage::save_settings,
            storage::list_recordings,
            storage::save_recording,
            storage::load_transcript,
            storage::write_transcript,
            storage::delete_recording,
            storage::rename_recording,
        ])
        .run(tauri::generate_context!())
        .expect("error al arrancar cereales");
}
