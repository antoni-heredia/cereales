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
 * Dentro de Tauri todo va contra el backend nativo. Los mocks siguen existiendo
 * para `npm run dev` en el navegador, donde no hay WASAPI ni whisper: ahí la
 * comprobación `isTauri()` los selecciona sola.
 *
 *   audio         -> src-tauri/src/audio/win.rs   (WASAPI)
 *   transcription -> src-tauri/src/transcription.rs (whisper.cpp) o ElevenLabs API
 *   storage       -> src-tauri/src/storage.rs
 */
const NATIVE_AUDIO_READY = true;
const NATIVE_TRANSCRIPTION_READY = true;
const NATIVE_STORAGE_READY = true;

function build(settings?: Settings): Services {
  const inTauri = isTauri();
  const audioNative = inTauri && NATIVE_AUDIO_READY;
  const storageNative = inTauri && NATIVE_STORAGE_READY;

  // Seleccionar servicio de transcripción según configuración
  let transcription;
  let transcriptionNative = false;

  if (settings?.transcriptionService === 'elevenlabs') {
    transcription = elevenLabsTranscription(settings.elevenLabsApiKey);
    transcriptionNative = false; // ElevenLabs es API externa
  } else {
    transcription = inTauri ? nativeTranscription : mockTranscription;
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

// Build inicial con servicio por defecto
export let services: Services = build();

// Función para actualizar el servicio cuando cambian las settings
export function updateServices(settings: Settings): void {
  services = build(settings);
}

export type { Services } from './types';
