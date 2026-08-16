/**
 * Sample content carried over from the design prototype. The mock services read
 * from here so the UI is fully explorable before the native recorder and the
 * transcription backend exist. Nothing outside `services/mock.ts` should import
 * this file.
 */
import type { AudioSource, ModelStatus, Note, Recording, TranscriptEntry } from '@/types';

/**
 * Mirror of the catalogue in `src-tauri/src/transcription.rs`, so the model
 * picker is explorable in the browser. Only the mock reads it: inside Tauri the
 * real list comes from `list_models`, which is the single source of truth.
 */
export const SAMPLE_MODELS: ModelStatus[] = [
  { id: 'tiny', installed: false, name: 'ggml-tiny.bin', bytes: 0, approxBytes: 78_000_000 },
  { id: 'base', installed: false, name: 'ggml-base.bin', bytes: 0, approxBytes: 148_000_000 },
  {
    id: 'small',
    installed: true,
    name: 'ggml-small.bin',
    bytes: 487_601_967,
    approxBytes: 488_000_000,
  },
  { id: 'medium', installed: false, name: 'ggml-medium.bin', bytes: 0, approxBytes: 1_530_000_000 },
  {
    id: 'large-v3-turbo',
    installed: false,
    name: 'ggml-large-v3-turbo.bin',
    bytes: 0,
    approxBytes: 1_620_000_000,
  },
];

export const SAMPLE_SOURCES: AudioSource[] = [
  { id: 'mic:internal', label: 'Internal microphone', group: 'input' },
  { id: 'mic:usb', label: 'USB microphone (Blue Yeti)', group: 'input' },
  // Its label is translated at render time; see `sourceLabel`.
  { id: 'sys:default', label: 'System audio (everything)', group: 'system' },
  { id: 'app:1001', label: 'Zoom', group: 'apps' },
  { id: 'app:1002', label: 'Slack', group: 'apps' },
  { id: 'app:1003', label: 'chrome', group: 'apps' },
];

// `audioPath` is filled in so the player also exists in the browser;
// `mockStorage.audioUrl` returns an empty clip, so it shows but stays silent.
export const SAMPLE_RECORDINGS: Recording[] = [
  {
    id: 'rec-1',
    title: 'Weekly product sync',
    startedAt: '2026-08-03T10:00:00.000Z',
    durationSec: 1450,
    audioPath: 'mock/rec-1.wav',
  },
  {
    id: 'rec-2',
    title: 'Call with Acme',
    startedAt: '2026-07-30T15:30:00.000Z',
    durationSec: 2512,
    audioPath: 'mock/rec-2.wav',
  },
  {
    id: 'rec-3',
    title: 'Q3 design review',
    startedAt: '2026-07-28T09:15:00.000Z',
    durationSec: 1117,
    audioPath: 'mock/rec-3.wav',
  },
];

export const SAMPLE_TRANSCRIPT: TranscriptEntry[] = [
  { timeSec: 8, speaker: 'Ana', text: 'Let us start with last week’s retention numbers.' },
  {
    timeSec: 42,
    speaker: 'Diego',
    text: 'Seven-day retention dropped two points versus last month, mostly among new users.',
  },
  {
    timeSec: 95,
    speaker: 'Marta',
    text: 'That may be related to the onboarding change we shipped on Thursday.',
  },
  { timeSec: 135, speaker: 'Ana', text: 'We will need the updated dataset to confirm that.' },
  {
    timeSec: 180,
    speaker: 'Diego',
    text: 'I can ask analytics for it today and share it before Friday.',
  },
  {
    timeSec: 240,
    speaker: 'Marta',
    text: 'Moving on to the roadmap. We have three initiatives for next quarter.',
  },
  {
    timeSec: 300,
    speaker: 'Ana',
    text: 'The first is better audio source detection when several tabs are open.',
  },
  {
    timeSec: 355,
    speaker: 'Diego',
    text: 'The second is an offline mode, so recording does not depend on the network.',
  },
  { timeSec: 420, speaker: 'Marta', text: 'And the third, note templates for recurring meetings.' },
  { timeSec: 482, speaker: 'Ana', text: 'We need to pick a launch date before the month ends.' },
  {
    timeSec: 540,
    speaker: 'Diego',
    text: 'I suggest we revisit it next week with real data from the first tests.',
  },
  { timeSec: 590, speaker: 'Marta', text: 'Agreed. Let us wrap up here, thanks everyone.' },
];

export const SAMPLE_NOTES: Note[] = [
  { id: 'note-1', timeSec: 40, text: 'Look into why 7-day retention dropped' },
  { id: 'note-2', timeSec: 130, text: 'Ask Marta for the updated dataset' },
  // A screenshot note, so the thumbnail path is exercised under `npm run dev`.
  // The mock has no file for it, which is also worth seeing: a missing image
  // must not break the row.
  { id: 'note-shot', timeSec: 210, text: 'Retention chart', image: 'sample-shot-01.png' },
  { id: 'note-3', timeSec: 295, text: 'Prioritise audio source detection' },
  { id: 'note-4', timeSec: 415, text: 'Templates for recurring meetings' },
  { id: 'note-5', timeSec: 480, text: 'Decide the launch date' },
];
