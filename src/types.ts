import type { AudioLanguageSetting, Language } from '@/i18n';

export type ScreenKey = 'record' | 'history' | 'settings' | 'transcript';

/**
 * Groups in the source dropdown, in display order. These are stable keys, not
 * labels: the backend puts them on every `AudioSource` and the UI translates
 * them, so renaming one is a change to the Rust/TypeScript contract.
 *
 * There is no browser-tab group: Windows captures per process, and a browser
 * puts all of its tabs in the same process tree, so the most that can be
 * offered is the whole application.
 */
export const SOURCE_GROUPS = ['input', 'system', 'apps'] as const;

export type SourceGroup = (typeof SOURCE_GROUPS)[number];

export interface AudioSource {
  id: string;
  /** Comes from the OS (device or process name), so it is never translated. */
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
  /** Tags used to categorise the recording in Obsidian. */
  tags?: string[];
}

export interface TranscriptEntry {
  /** Offset from the start of the recording, in seconds. */
  timeSec: number;
  /** Empty when the backend does not diarize; the UI hides the line then. */
  speaker: string;
  text: string;
}

/**
 * One entry of the local model catalogue, which lives in
 * `src-tauri/src/transcription.rs`: Rust owns the filenames and URLs because it
 * is what downloads them, and the frontend only renders what it is handed.
 */
export interface ModelStatus {
  /** Catalogue key the UI matches on and translates; also what `whisperModel` stores. */
  id: string;
  installed: boolean;
  /** The `.bin` filename. */
  name: string;
  /** Bytes on disk; 0 when not downloaded. */
  bytes: number;
  /** Published size, so the picker can show how big a download would be. */
  approxBytes: number;
}

/** Progress of a model download or of a transcription in flight. */
export interface NativeProgress {
  /** 0..100, or -1 when the total is unknown. */
  percent: number;
  /** `downloading` | `transcribing` — matches the stages the backend emits. */
  stage: string;
}

export interface Note {
  id: string;
  /** Offset from the start of the recording, in seconds. */
  timeSec: number;
  /** Empty when the note is a screenshot the user did not caption. */
  text: string;
  /**
   * Filename of the annotated PNG in `attachments/`, when the note is a
   * screenshot. A name and not a path, because that is what `![[…]]` resolves
   * and an absolute one would go stale as soon as the vault moves.
   */
  image?: string;
}

export interface Transcript {
  recordingId: string;
  entries: TranscriptEntry[];
  notes: Note[];
}

export const TRANSCRIPT_FORMATS = ['TXT', 'Markdown', 'SRT', 'Obsidian'] as const;
export type TranscriptFormat = (typeof TRANSCRIPT_FORMATS)[number];

export interface Settings {
  /**
   * Interface language. Empty means the user never chose one, in which case the
   * system language decides; see `resolveLanguage`.
   */
  language: Language | '';
  /**
   * Obsidian vault: the only folder the user picks. Linked, audio and notes
   * live inside it; unlinked, they go to the documents folder.
   */
  obsidianVaultPath: string | null;
  /** Read-only: where everything ends up. The backend derives it on load. */
  storageRoot: string;
  defaultSourceId: string;
  transcriptFormat: TranscriptFormat;
  transcriptionService: 'local' | 'elevenlabs';
  /**
   * Language the engine is told to expect in the audio, which is not the same
   * question as the interface language. Empty means "follow the interface",
   * the way it worked before this was configurable; `auto` lets the engine
   * detect it. See `resolveAudioLanguage`.
   */
  audioLanguage: AudioLanguageSetting;
  /**
   * Which model of the local catalogue to use. It is a plain string, not a
   * union: the catalogue lives in Rust and adding an entry there must not
   * require touching the type here.
   */
  whisperModel: string;
  elevenLabsApiKey: string;
}

/**
 * Recorder states. There is no transcribing phase: transcription stopped being
 * a mandatory step on stop and is now launched from the details screen, where
 * `transcribingRecordingId` tracks its progress.
 */
export type RecorderPhase = 'idle' | 'recording' | 'done';
