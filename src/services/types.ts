import type {
  AudioSource,
  ModelStatus,
  NativeProgress,
  Recording,
  Settings,
  Transcript,
  TranscriptEntry,
  TranscriptFormat,
} from '@/types';

export interface StopResult {
  audioPath: string;
  durationSec: number;
}

export interface AudioService {
  /** Enumerate capturable inputs, system audio, browser tabs and app streams. */
  listSources(): Promise<AudioSource[]>;
  start(sourceId: string): Promise<void>;
  stop(): Promise<StopResult>;
  /**
   * Subscribe to the live level meter. `levels` is a fixed-length array of
   * normalized 0..1 amplitudes, newest last. Returns an unsubscribe function.
   * Implementations that cannot produce levels simply never invoke `cb`, and
   * the waveform falls back to a synthetic animation.
   */
  onLevels(cb: (levels: number[]) => void): () => void;
}

export interface TranscriptionService {
  transcribe(audioPath: string): Promise<TranscriptEntry[]>;
  /** Si el modelo local está descargado y su tamaño. */
  modelStatus(): Promise<ModelStatus>;
  /** Descarga el modelo; el progreso llega por `onProgress`. */
  downloadModel(): Promise<ModelStatus>;
  /**
   * Progreso de la descarga y de la transcripción. Devuelve la función para
   * cancelar la suscripción.
   */
  onProgress(cb: (progress: NativeProgress) => void): () => void;
}

export interface StorageService {
  loadSettings(): Promise<Settings>;
  /** Resuelve con los ajustes recargados: `storageRoot` es derivado. */
  saveSettings(settings: Settings): Promise<Settings>;

  listRecordings(): Promise<Recording[]>;
  saveRecording(recording: Recording): Promise<void>;
  deleteRecording(recordingId: string): Promise<void>;
  /**
   * El título va en el nombre de la nota, así que renombrar también la mueve a
   * `newRelPath` (calculado con `transcriptRelPath`).
   */
  renameRecording(recordingId: string, newTitle: string, newRelPath: string): Promise<void>;
  /** URL reproducible por `<audio>` para el WAV en `audioPath`. */
  audioUrl(audioPath: string): string;

  loadTranscript(recordingId: string): Promise<Transcript | null>;
  /** Writes the transcript in `format` and resolves with the path written to. */
  writeTranscript(
    recording: Recording,
    transcript: Transcript,
    format: TranscriptFormat,
  ): Promise<string>;

  /** Opens a native folder picker. Resolves to null if the user cancels. */
  pickFolder(title: string, current: string): Promise<string | null>;
}

export interface Services {
  audio: AudioService;
  transcription: TranscriptionService;
  storage: StorageService;
  /** Which parts are backed by the real native implementation. */
  capabilities: {
    audio: boolean;
    transcription: boolean;
    storage: boolean;
  };
}
