/**
 * Thin wrappers over the Tauri commands defined in `src-tauri/src/`. Command
 * names and payload shapes must stay in sync with the `#[tauri::command]`
 * functions there.
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import type {
  AudioSource,
  ModelStatus,
  NativeProgress,
  Recording,
  Settings,
  Transcript,
  TranscriptEntry,
} from '@/types';
import { serializeTranscript, transcriptRelPath } from '@/lib/serialize';
import type { AudioService, StopResult, StorageService, TranscriptionService } from './types';

/** Subscribes to a Tauri event, safe to cancel before the listener resolves. */
function subscribe<T>(event: string, cb: (payload: T) => void): () => void {
  const pending = listen<T>(event, (e) => cb(e.payload));
  let disposed = false;
  let unlisten: (() => void) | undefined;
  void pending.then((fn) => {
    if (disposed) fn();
    else unlisten = fn;
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

export const nativeAudio: AudioService = {
  listSources: () => invoke<AudioSource[]>('list_audio_sources'),
  start: (sourceId) => invoke<string>('start_recording', { sourceId }),
  stop: () => invoke<StopResult>('stop_recording'),

  onLevels: (cb) => subscribe<number[]>('audio://levels', cb),
};

/**
 * `model` is the catalogue id the user picked. It is baked into the service
 * rather than threaded through every call site: `updateServices` rebuilds this
 * whenever the setting changes, exactly like the ElevenLabs API key.
 */
export const nativeTranscription = (model: string): TranscriptionService => ({
  // Rust only needs the audio language; whisper produces no labels of its own.
  transcribe: (audioPath, lang) =>
    invoke<TranscriptEntry[]>('transcribe', { audioPath, lang: lang.audio, model }),
  modelStatus: () => invoke<ModelStatus>('model_status', { model }),
  listModels: () => invoke<ModelStatus[]>('list_models'),
  downloadModel: () => invoke<ModelStatus>('download_model', { model }),
  deleteModel: (id) => invoke<ModelStatus[]>('delete_model', { model: id }),
  onProgress: (cb) => subscribe<NativeProgress>('model://progress', cb),
});

export const nativeStorage: StorageService = {
  loadSettings: () => invoke<Settings>('load_settings'),
  saveSettings: (settings) => invoke<Settings>('save_settings', { settings }),

  listRecordings: () => invoke<Recording[]>('list_recordings'),
  saveRecording: (recording) => invoke<void>('save_recording', { recording }),

  loadTranscript: (recordingId) => invoke<Transcript | null>('load_transcript', { recordingId }),
  writeNotes: (recordingId, notes) => invoke<void>('write_notes', { recordingId, notes }),

  captureScreen: () => invoke<string>('capture_screen'),
  saveScreenshot: (recordingId, pngBase64) =>
    invoke<string>('save_screenshot', { recordingId, pngBase64 }),
  readScreenshot: (fileName) => invoke<string>('read_screenshot', { fileName }),
  replaceScreenshot: (fileName, pngBase64) =>
    invoke<void>('replace_screenshot', { fileName, pngBase64 }),

  async writeTranscript(recording, transcript, format, lang) {
    // Serialization stays in TS so every format has one implementation, and the
    // note's name travels with it; Rust only owns the bytes-to-disk step.
    const contents = serializeTranscript(recording, transcript, format, lang);
    return invoke<string>('write_transcript', {
      recordingId: recording.id,
      contents,
      relPath: transcriptRelPath(recording, format),
      transcript,
    });
  },

  deleteRecording: (recordingId) => invoke<void>('delete_recording', { recordingId }),
  renameRecording: (recordingId, newTitle, newRelPath) =>
    invoke<void>('rename_recording', { recordingId, newTitle, newRelPath }),
  // `asset://` is served by Tauri itself and supports Range requests, so the
  // player's scrub bar works without loading the whole WAV into memory.
  audioUrl: (audioPath) => convertFileSrc(audioPath),
  // The backend widens the `asset://` scope to cover `attachments/`, which the
  // static scope in the config would miss for a vault on another drive.
  attachmentUrl: (storageRoot, fileName) =>
    convertFileSrc(`${storageRoot}\\attachments\\${fileName}`),

  async pickFolder(title, current) {
    const selected = await open({ directory: true, multiple: false, title, defaultPath: current });
    return typeof selected === 'string' ? selected : null;
  },
};
