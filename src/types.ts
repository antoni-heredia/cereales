export type ScreenKey = 'record' | 'history' | 'settings' | 'transcript';

/**
 * Grupos del desplegable de fuentes, en orden de aparición.
 *
 * No hay grupo de pestañas: Windows deja capturar el audio de un proceso, pero
 * un navegador mezcla todas sus pestañas en el mismo árbol de procesos, así que
 * lo máximo que se puede ofrecer es la aplicación entera.
 */
export const SOURCE_GROUPS = ['Entrada', 'Audio del sistema', 'Aplicaciones'] as const;

export type SourceGroup = (typeof SOURCE_GROUPS)[number];

export interface AudioSource {
  id: string;
  label: string;
  group: SourceGroup;
}

export interface Recording {
  id: string;
  title: string;
  /** ISO 8601 timestamp of when the recording started. */
  startedAt: string;
  durationSec: number;
  /** Absolute path to the audio file, once the recorder has flushed it. */
  audioPath?: string;
  /** Absolute path to the written transcript, once transcription finishes. */
  transcriptPath?: string;
  /** Tags para categorizar la grabación en Obsidian. */
  tags?: string[];
}

export interface TranscriptEntry {
  /** Offset from the start of the recording, in seconds. */
  timeSec: number;
  /** Vacío cuando el backend no diariza; la interfaz oculta la línea entonces. */
  speaker: string;
  text: string;
}

export interface ModelStatus {
  installed: boolean;
  name: string;
  bytes: number;
}

/** Progreso de descarga del modelo o de una transcripción en curso. */
export interface NativeProgress {
  /** 0..100, o -1 si se desconoce el total. */
  percent: number;
  stage: string;
}

export interface Note {
  id: string;
  /** Offset from the start of the recording, in seconds. */
  timeSec: number;
  text: string;
}

export interface Transcript {
  recordingId: string;
  entries: TranscriptEntry[];
  notes: Note[];
}

export const TRANSCRIPT_FORMATS = ['TXT', 'Markdown', 'SRT', 'Obsidian'] as const;
export type TranscriptFormat = (typeof TRANSCRIPT_FORMATS)[number];

export interface Settings {
  recordingFolder: string;
  transcriptFolder: string;
  obsidianVaultPath: string | null;
  defaultSourceId: string;
  transcriptFormat: TranscriptFormat;
  transcriptionService: 'local' | 'elevenlabs';
  elevenLabsApiKey: string;
}

/**
 * Estados del grabador. No hay fase de transcripción: transcribir dejó de ser
 * un paso obligatorio al parar y ahora se lanza desde la pantalla de detalle,
 * donde el progreso lo sigue `transcribingRecordingId`.
 */
export type RecorderPhase = 'idle' | 'recording' | 'done';
