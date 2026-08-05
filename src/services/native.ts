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
import { serializeTranscript, transcriptExtension } from '@/lib/serialize';
import type { AudioService, StopResult, StorageService, TranscriptionService } from './types';

/** Suscripción a un evento de Tauri con cancelación segura antes de resolverse. */
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
  start: (sourceId) => invoke<void>('start_recording', { sourceId }),
  stop: () => invoke<StopResult>('stop_recording'),

  onLevels: (cb) => subscribe<number[]>('audio://levels', cb),
};

export const nativeTranscription: TranscriptionService = {
  transcribe: (audioPath) => invoke<TranscriptEntry[]>('transcribe', { audioPath }),
  modelStatus: () => invoke<ModelStatus>('model_status'),
  downloadModel: () => invoke<ModelStatus>('download_model'),
  onProgress: (cb) => subscribe<NativeProgress>('model://progress', cb),
};

export const nativeStorage: StorageService = {
  loadSettings: () => invoke<Settings>('load_settings'),
  saveSettings: (settings) => invoke<void>('save_settings', { settings }),

  listRecordings: () => invoke<Recording[]>('list_recordings'),
  saveRecording: (recording) => invoke<void>('save_recording', { recording }),

  loadTranscript: (recordingId) => invoke<Transcript | null>('load_transcript', { recordingId }),

  async writeTranscript(recording, transcript, format) {
    // Serialization stays in TS so all three formats have one implementation;
    // Rust only owns the bytes-to-disk step.
    const contents = serializeTranscript(recording, transcript, format);
    return invoke<string>('write_transcript', {
      recordingId: recording.id,
      contents,
      extension: transcriptExtension(format),
      transcript,
    });
  },

  deleteRecording: (recordingId) => invoke<void>('delete_recording', { recordingId }),
  renameRecording: (recordingId, newTitle) =>
    invoke<void>('rename_recording', { recordingId, newTitle }),
  // `asset://` lo sirve el propio Tauri: soporta Range, así que la barra de
  // progreso del reproductor funciona sin cargar el WAV entero en memoria.
  audioUrl: (audioPath) => convertFileSrc(audioPath),

  async pickFolder(title, current) {
    const selected = await open({ directory: true, multiple: false, title, defaultPath: current });
    return typeof selected === 'string' ? selected : null;
  },
};
