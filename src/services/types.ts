import type { AudioLanguage, Language } from '@/i18n';
import type {
  AudioSource,
  ModelStatus,
  NativeProgress,
  Note,
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
  /** Enumerate capturable inputs, system audio and per-application streams. */
  listSources(): Promise<AudioSource[]>;
  /**
   * Resolves with the id of the recording that just started. It exists from
   * this moment, and a note or a screenshot taken mid-meeting is filed under
   * it: waiting for `stop` to learn it would mean nothing could be saved until
   * the recording ended.
   */
  start(sourceId: string): Promise<string>;
  stop(): Promise<StopResult>;
  /**
   * Subscribe to the live level meter. `levels` is a fixed-length array of
   * normalized 0..1 amplitudes, newest last. Returns an unsubscribe function.
   * Implementations that cannot produce levels simply never invoke `cb`, and
   * the waveform falls back to a synthetic animation.
   */
  onLevels(cb: (levels: number[]) => void): () => void;
}

/**
 * The two languages a transcription involves. They used to be one value, and
 * conflating them is not cosmetic: announcing English audio to whisper makes it
 * decode Spanish speech *as* English and hand back an English transcript, even
 * with translation switched off.
 */
export interface TranscribeLanguages {
  /**
   * What the engine is told to expect in the audio. `auto` lets it detect,
   * though an explicit hint beats detection on a small whisper model.
   */
  audio: AudioLanguage;
  /**
   * The interface language, for the user-visible text the engine makes us
   * produce — speaker labels, error messages. It is what the person reading the
   * transcript understands, whatever was spoken.
   */
  ui: Language;
}

export interface TranscriptionService {
  transcribe(audioPath: string, lang: TranscribeLanguages): Promise<TranscriptEntry[]>;
  /**
   * Whether the selected model is downloaded, and how big it is. Which model
   * that is comes from the settings the service was built with, so the callers
   * never have to pass it around.
   */
  modelStatus(): Promise<ModelStatus>;
  /** The whole catalogue with its download state, for the model picker. */
  listModels(): Promise<ModelStatus[]>;
  /** Downloads the selected model; progress arrives through `onProgress`. */
  downloadModel(): Promise<ModelStatus>;
  /** Removes a downloaded model and resolves with the updated catalogue. */
  deleteModel(id: string): Promise<ModelStatus[]>;
  /**
   * Progress of both the download and the transcription. Returns the
   * unsubscribe function.
   */
  onProgress(cb: (progress: NativeProgress) => void): () => void;
}

export interface StorageService {
  loadSettings(): Promise<Settings>;
  /** Resolves with the reloaded settings: `storageRoot` is derived. */
  saveSettings(settings: Settings): Promise<Settings>;

  listRecordings(): Promise<Recording[]>;
  saveRecording(recording: Recording): Promise<void>;
  deleteRecording(recordingId: string): Promise<void>;
  /**
   * The title is part of the note's filename, so renaming also moves it to
   * `newRelPath` (built with `transcriptRelPath`).
   */
  renameRecording(recordingId: string, newTitle: string, newRelPath: string): Promise<void>;
  /** URL an `<audio>` element can play for the WAV at `audioPath`. */
  audioUrl(audioPath: string): string;
  /** URL an `<img>` can show for a screenshot stored under `attachments/`. */
  attachmentUrl(storageRoot: string, fileName: string): string;

  /**
   * The whole screen as a base64 PNG, for the annotation editor. It never
   * reaches disk: only the annotated result does, and only if the user saves.
   */
  captureScreen(): Promise<string>;
  /**
   * Writes an annotated screenshot and resolves with the filename it was given.
   * A name and not a path, because that is what the Obsidian note embeds.
   */
  saveScreenshot(recordingId: string, pngBase64: string): Promise<string>;
  /**
   * A saved screenshot as base64, so it can be annotated again. Not the
   * `attachmentUrl`: that is a different origin, and a canvas that drew a
   * cross-origin image can no longer be exported.
   */
  readScreenshot(fileName: string): Promise<string>;
  /**
   * Overwrites a saved screenshot, keeping its name. Re-annotating must not
   * produce a second file: the name is already written into the note.
   */
  replaceScreenshot(fileName: string, pngBase64: string): Promise<void>;

  loadTranscript(recordingId: string): Promise<Transcript | null>;
  /**
   * Persists the notes taken so far without writing a transcript. Called while
   * the recording is still running: a note, and above all a screenshot, has to
   * survive the app closing before transcription ever happens.
   */
  writeNotes(recordingId: string, notes: Note[]): Promise<void>;
  /**
   * Writes the transcript in `format` and resolves with the path written to.
   * `lang` decides the section headings of the generated note.
   */
  writeTranscript(
    recording: Recording,
    transcript: Transcript,
    format: TranscriptFormat,
    lang: Language,
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
