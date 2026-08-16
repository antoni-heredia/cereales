/**
 * In-browser stand-ins for the native services. These keep the ported UI fully
 * interactive (and `npm run dev` useful without a Rust toolchain) until the
 * corresponding Tauri commands are implemented.
 */
import {
  SAMPLE_MODELS,
  SAMPLE_NOTES,
  SAMPLE_RECORDINGS,
  SAMPLE_SOURCES,
  SAMPLE_TRANSCRIPT,
} from '@/fixtures';
import type {
  ModelStatus,
  Recording,
  Settings,
  Transcript,
  TranscriptEntry,
  TranscriptFormat,
} from '@/types';
import { serializeTranscript, transcriptRelPath } from '@/lib/serialize';
import type { AudioService, StopResult, StorageService, TranscriptionService } from './types';

export const DEFAULT_SETTINGS: Settings = {
  // Empty on purpose: the system language decides until the user picks one.
  language: '',
  obsidianVaultPath: null,
  storageRoot: '~/Documents/cereales',
  defaultSourceId: 'sys:default',
  transcriptFormat: 'Obsidian',
  transcriptionService: 'local',
  whisperModel: 'small',
  // Empty on purpose: the interface language decides until the user picks one.
  audioLanguage: '',
  elevenLabsApiKey: '',
};

/** Mirror of `storage_root` in Rust, so the mock shows the same path. */
function storageRoot(settings: Settings): string {
  const vault = settings.obsidianVaultPath?.trim();
  return vault ? `${vault}/transcripts` : '~/Documents/cereales';
}

const KEY_SETTINGS = 'cereales.settings';
const KEY_RECORDINGS = 'cereales.recordings';
const KEY_TRANSCRIPT = 'cereales.transcript.';
const KEY_SHOT = 'cereales.shot.';
const TRANSPARENT_PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
/** The names handed out so far, so the mock numbers them the way Rust does. */
const KEY_SHOT_INDEX = 'cereales.shots';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage disabled or full — the mock degrades to in-memory for the session.
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let startedAt: number | null = null;
// Remembered so `stop` reports the same id `start` handed out: the notes taken
// during the recording are filed under it.
let currentId = '';

export const mockAudio: AudioService = {
  async listSources() {
    await delay(120);
    return SAMPLE_SOURCES;
  },

  async start() {
    startedAt = Date.now();
    currentId = `mock-${Date.now()}`;
    return currentId;
  },

  async stop(): Promise<StopResult> {
    const durationSec = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
    startedAt = null;
    return {
      audioPath: `${DEFAULT_SETTINGS.storageRoot}/audio/${currentId}.wav`,
      durationSec,
    };
  },

  onLevels() {
    // No real meter — the waveform falls back to its synthetic animation.
    return () => {};
  },
};

/**
 * Which models the browser session pretends to have on disk. It starts from the
 * fixture and survives a reload, so downloading and deleting behave the way
 * they do in the app.
 */
const KEY_MODELS = 'cereales.models';

function installedModels(): string[] {
  return readJson<string[]>(
    KEY_MODELS,
    SAMPLE_MODELS.filter((m) => m.installed).map((m) => m.id),
  );
}

function catalogue(): ModelStatus[] {
  const installed = installedModels();
  return SAMPLE_MODELS.map((m) => ({
    ...m,
    installed: installed.includes(m.id),
    bytes: installed.includes(m.id) ? m.approxBytes : 0,
  }));
}

/** Rejects an id outside the catalogue with the key Rust would return. */
function statusOf(id: string): ModelStatus {
  const found = catalogue().find((m) => m.id === id);
  if (!found) throw new Error(`err.model.unknown|${id}`);
  return found;
}

export const mockTranscription = (model: string): TranscriptionService => ({
  async transcribe(): Promise<TranscriptEntry[]> {
    await delay(1200);
    return SAMPLE_TRANSCRIPT;
  },

  async modelStatus() {
    return statusOf(model);
  },

  async listModels() {
    return catalogue();
  },

  async downloadModel() {
    await delay(600);
    writeJson(KEY_MODELS, [...new Set([...installedModels(), model])]);
    return statusOf(model);
  },

  async deleteModel(id) {
    writeJson(
      KEY_MODELS,
      installedModels().filter((m) => m !== id),
    );
    return catalogue();
  },

  onProgress() {
    return () => {};
  },
});

export const mockStorage: StorageService = {
  async loadSettings() {
    const stored = { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(KEY_SETTINGS, {}) };
    return { ...stored, storageRoot: storageRoot(stored) };
  },

  async saveSettings(settings) {
    writeJson(KEY_SETTINGS, settings);
    return { ...settings, storageRoot: storageRoot(settings) };
  },

  async listRecordings() {
    return readJson<Recording[]>(KEY_RECORDINGS, SAMPLE_RECORDINGS);
  },

  async saveRecording(recording) {
    const existing = readJson<Recording[]>(KEY_RECORDINGS, SAMPLE_RECORDINGS);
    writeJson(KEY_RECORDINGS, [recording, ...existing.filter((r) => r.id !== recording.id)]);
  },

  async deleteRecording(recordingId) {
    const existing = readJson<Recording[]>(KEY_RECORDINGS, SAMPLE_RECORDINGS);
    writeJson(KEY_RECORDINGS, existing.filter((r) => r.id !== recordingId));
  },

  async renameRecording(recordingId, newTitle, _newRelPath) {
    const existing = readJson<Recording[]>(KEY_RECORDINGS, SAMPLE_RECORDINGS);
    const recording = existing.find((r) => r.id === recordingId);
    if (recording) {
      recording.title = newTitle;
      writeJson(KEY_RECORDINGS, existing);
    }
  },

  audioUrl(_audioPath) {
    // With no backend there is no WAV to serve: an empty clip keeps the player
    // mounted under `npm run dev`.
    return 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAAAAA==';
  },

  attachmentUrl(_storageRoot, fileName) {
    // A transparent pixel rather than an empty string for a screenshot the
    // browser session never took — the seeded history has one. An empty `src`
    // makes the browser re-request the page itself.
    return readJson<string>(KEY_SHOT + fileName, TRANSPARENT_PIXEL);
  },

  /**
   * A drawn placeholder rather than a real capture: the browser cannot grab the
   * screen without a permission prompt, and the point of the mock is that the
   * annotation editor can be worked on under `npm run dev`.
   */
  async captureScreen() {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, '#cfd8dc');
      gradient.addColorStop(1, '#eceff1');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#37474f';
      ctx.font = '700 64px system-ui, sans-serif';
      ctx.fillText('mock capture', 80, 360);
      ctx.font = '400 32px system-ui, sans-serif';
      ctx.fillText(new Date().toLocaleTimeString(), 80, 420);
    }
    const url = canvas.toDataURL('image/png');
    return url.slice(url.indexOf(',') + 1);
  },

  async saveScreenshot(recordingId, pngBase64) {
    const taken = readJson<string[]>(KEY_SHOT_INDEX, []);
    const mine = taken.filter((name) => name.startsWith(`${recordingId}-shot-`));
    const fileName = `${recordingId}-shot-${String(mine.length + 1).padStart(2, '0')}.png`;
    writeJson(KEY_SHOT_INDEX, [...taken, fileName]);
    // A data URL, so `attachmentUrl` can hand it straight to an `<img>`.
    writeJson(KEY_SHOT + fileName, `data:image/png;base64,${pngBase64}`);
    return fileName;
  },

  async readScreenshot(fileName) {
    const url = readJson<string>(KEY_SHOT + fileName, TRANSPARENT_PIXEL);
    return url.slice(url.indexOf(',') + 1);
  },

  async replaceScreenshot(fileName, pngBase64) {
    writeJson(KEY_SHOT + fileName, `data:image/png;base64,${pngBase64}`);
  },

  async loadTranscript(recordingId) {
    const stored = readJson<Transcript | null>(KEY_TRANSCRIPT + recordingId, null);
    if (stored) return stored;
    // Seeded history rows have no stored transcript; show the sample one.
    return { recordingId, entries: SAMPLE_TRANSCRIPT, notes: SAMPLE_NOTES };
  },

  /** Mirrors `merged_notes` in Rust: whatever was transcribed is kept. */
  async writeNotes(recordingId, notes) {
    const stored = readJson<Transcript | null>(KEY_TRANSCRIPT + recordingId, null);
    writeJson(KEY_TRANSCRIPT + recordingId, {
      recordingId,
      entries: stored?.entries ?? [],
      notes,
    });
  },

  async writeTranscript(recording, transcript, format: TranscriptFormat, lang) {
    writeJson(KEY_TRANSCRIPT + recording.id, transcript);
    // Serialized here too so the format logic is exercised in mock mode.
    serializeTranscript(recording, transcript, format, lang);
    return `${DEFAULT_SETTINGS.storageRoot}/${transcriptRelPath(recording, format)}`;
  },

  async pickFolder(_title, current) {
    return current;
  },
};
