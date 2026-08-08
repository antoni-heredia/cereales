/**
 * In-browser stand-ins for the native services. These keep the ported UI fully
 * interactive (and `npm run dev` useful without a Rust toolchain) until the
 * corresponding Tauri commands are implemented.
 */
import { SAMPLE_NOTES, SAMPLE_RECORDINGS, SAMPLE_SOURCES, SAMPLE_TRANSCRIPT } from '@/fixtures';
import type { Recording, Settings, Transcript, TranscriptEntry, TranscriptFormat } from '@/types';
import { serializeTranscript, transcriptExtension } from '@/lib/serialize';
import type { AudioService, StopResult, StorageService, TranscriptionService } from './types';

export const DEFAULT_SETTINGS: Settings = {
  recordingFolder: '~/Documents/cereales/grabaciones',
  transcriptFolder: '~/Documents/cereales/transcripciones',
  obsidianVaultPath: null,
  defaultSourceId: 'sys:default',
  transcriptFormat: 'Obsidian',
  transcriptionService: 'local',
  elevenLabsApiKey: '',
};

const KEY_SETTINGS = 'cereales.settings';
const KEY_RECORDINGS = 'cereales.recordings';
const KEY_TRANSCRIPT = 'cereales.transcript.';

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

export const mockAudio: AudioService = {
  async listSources() {
    await delay(120);
    return SAMPLE_SOURCES;
  },

  async start() {
    startedAt = Date.now();
  },

  async stop(): Promise<StopResult> {
    const durationSec = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
    startedAt = null;
    return { audioPath: `${DEFAULT_SETTINGS.recordingFolder}/mock-${Date.now()}.wav`, durationSec };
  },

  onLevels() {
    // No real meter — the waveform falls back to its synthetic animation.
    return () => {};
  },
};

export const mockTranscription: TranscriptionService = {
  async transcribe(): Promise<TranscriptEntry[]> {
    await delay(1200);
    return SAMPLE_TRANSCRIPT;
  },

  async modelStatus() {
    return { installed: true, name: 'mock', bytes: 0 };
  },

  async downloadModel() {
    return { installed: true, name: 'mock', bytes: 0 };
  },

  onProgress() {
    return () => {};
  },
};

export const mockStorage: StorageService = {
  async loadSettings() {
    return { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(KEY_SETTINGS, {}) };
  },

  async saveSettings(settings) {
    writeJson(KEY_SETTINGS, settings);
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

  async renameRecording(recordingId, newTitle) {
    const existing = readJson<Recording[]>(KEY_RECORDINGS, SAMPLE_RECORDINGS);
    const recording = existing.find((r) => r.id === recordingId);
    if (recording) {
      recording.title = newTitle;
      writeJson(KEY_RECORDINGS, existing);
    }
  },

  audioUrl(_audioPath) {
    // Sin backend no hay WAV que servir: un clip vacío mantiene el reproductor
    // montado en `npm run dev`.
    return 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAAB9AAACABAAZGF0YQIAAAAAAA==';
  },

  async loadTranscript(recordingId) {
    const stored = readJson<Transcript | null>(KEY_TRANSCRIPT + recordingId, null);
    if (stored) return stored;
    // Seeded history rows have no stored transcript; show the sample one.
    return { recordingId, entries: SAMPLE_TRANSCRIPT, notes: SAMPLE_NOTES };
  },

  async writeTranscript(recording, transcript, format: TranscriptFormat) {
    writeJson(KEY_TRANSCRIPT + recording.id, transcript);
    // Serialized here too so the format logic is exercised in mock mode.
    serializeTranscript(recording, transcript, format);
    return `${DEFAULT_SETTINGS.transcriptFolder}/${recording.id}.${transcriptExtension(format)}`;
  },

  async pickFolder(_title, current) {
    return current;
  },
};
