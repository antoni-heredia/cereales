import { mockAudio, mockStorage, mockTranscription } from './mock';
import { nativeAudio, nativeStorage, nativeTranscription } from './native';
import { deepgramTranscription } from './deepgram';
import { elevenLabsTranscription } from './elevenlabs';
import type { Services, TranscriptionService } from './types';
import type { Settings, TranscriptionChoice } from '@/types';

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
 *   transcription -> src-tauri/src/transcription.rs  (whisper.cpp), or the
 *                    ElevenLabs / Deepgram APIs
 *   storage       -> src-tauri/src/storage.rs
 */
const NATIVE_AUDIO_READY = true;
const NATIVE_TRANSCRIPTION_READY = true;
const NATIVE_STORAGE_READY = true;

/**
 * Before the settings arrive from disk, the historical model is the safe guess:
 * it is the one an existing install already has downloaded.
 */
const FALLBACK_MODEL = 'small';

function localTranscriptionFor(model: string): TranscriptionService {
  return isTauri() ? nativeTranscription(model) : mockTranscription(model);
}

function build(settings?: Settings): Services {
  const inTauri = isTauri();
  const audioNative = inTauri && NATIVE_AUDIO_READY;
  const storageNative = inTauri && NATIVE_STORAGE_READY;

  const elevenLabsKey = settings?.elevenLabsApiKey ?? '';
  const deepgramKey = settings?.deepgramApiKey ?? '';
  const defaultModel = settings?.whisperModel || FALLBACK_MODEL;

  return {
    audio: audioNative ? nativeAudio : mockAudio,
    storage: storageNative ? nativeStorage : mockStorage,

    // The local engine is always around, whatever the default engine is. It
    // owns the model catalogue, so the settings screen has to be able to list
    // and download models even while the user transcribes everything remotely.
    localTranscription: localTranscriptionFor(defaultModel),

    /**
     * The engine is decided per transcription, so the service is built per
     * transcription too. That is also what lets the whisper model be part of
     * the choice: the local service bakes its model in, and here it is simply
     * built with the one that was picked.
     */
    transcriptionFor(choice: TranscriptionChoice): TranscriptionService {
      switch (choice.engine) {
        case 'elevenlabs':
          return elevenLabsTranscription(elevenLabsKey);
        case 'deepgram':
          return deepgramTranscription(deepgramKey);
        case 'local':
          return localTranscriptionFor(choice.model || defaultModel);
      }
    },

    capabilities: {
      audio: audioNative,
      // Only ever describes the local engine: the remote ones are HTTP calls
      // that work the same in the browser and in the app.
      transcription: inTauri && NATIVE_TRANSCRIPTION_READY,
      storage: storageNative,
    },
  };
}

/** Initial build, before the settings have been read from disk. */
export let services: Services = build();

/** Rebuilds the services when the settings change. */
export function updateServices(settings: Settings): void {
  services = build(settings);
}

export type { Services } from './types';
