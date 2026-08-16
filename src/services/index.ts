import { mockAudio, mockStorage, mockTranscription } from './mock';
import { nativeAudio, nativeStorage, nativeTranscription } from './native';
import { elevenLabsTranscription } from './elevenlabs';
import type { Services } from './types';
import type { Settings } from '@/types';

/** True when running inside the Tauri webview rather than a plain browser. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/*
 * Inside Tauri everything goes through the native backend. The mocks still
 * exist for `npm run dev` in a browser, where there is no WASAPI and no
 * whisper: the `isTauri()` check picks them on its own there.
 *
 *   audio         -> src-tauri/src/audio/win.rs      (WASAPI)
 *   transcription -> src-tauri/src/transcription.rs  (whisper.cpp) or the ElevenLabs API
 *   storage       -> src-tauri/src/storage.rs
 */
const NATIVE_AUDIO_READY = true;
const NATIVE_TRANSCRIPTION_READY = true;
const NATIVE_STORAGE_READY = true;

function build(settings?: Settings): Services {
  const inTauri = isTauri();
  const audioNative = inTauri && NATIVE_AUDIO_READY;
  const storageNative = inTauri && NATIVE_STORAGE_READY;

  // Pick the transcription service according to the settings.
  let transcription;
  let transcriptionNative = false;

  if (settings?.transcriptionService === 'elevenlabs') {
    transcription = elevenLabsTranscription(settings.elevenLabsApiKey);
    // ElevenLabs is an external API, not the native backend.
    transcriptionNative = false;
  } else {
    // Before the settings arrive from disk, the historical model is the safe
    // guess: it is the one an existing install already has downloaded.
    const model = settings?.whisperModel || 'small';
    transcription = inTauri ? nativeTranscription(model) : mockTranscription(model);
    transcriptionNative = inTauri && NATIVE_TRANSCRIPTION_READY;
  }

  return {
    audio: audioNative ? nativeAudio : mockAudio,
    transcription,
    storage: storageNative ? nativeStorage : mockStorage,
    capabilities: {
      audio: audioNative,
      transcription: transcriptionNative,
      storage: storageNative,
    },
  };
}

/** Initial build, with the default transcription service. */
export let services: Services = build();

/** Rebuilds the services when the settings change. */
export function updateServices(settings: Settings): void {
  services = build(settings);
}

export type { Services } from './types';
