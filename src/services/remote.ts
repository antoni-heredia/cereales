/**
 * The bits every remote engine needs: getting the WAV off disk, and reporting
 * progress to whoever is listening.
 */
import { convertFileSrc } from '@tauri-apps/api/core';
import { translate, type Language } from '@/i18n';
import type { NativeProgress } from '@/types';

/**
 * Reads the recorded WAV. It goes through Tauri's `asset://` protocol instead
 * of `file://`, which the webview blocks as a local resource.
 */
export async function readAudioFile(audioPath: string, lang: Language): Promise<ArrayBuffer> {
  const response = await fetch(convertFileSrc(audioPath));
  if (!response.ok) {
    throw new Error(
      translate(lang, 'err.remote.readAudio', { status: response.status, path: audioPath }),
    );
  }
  return response.arrayBuffer();
}

/**
 * Progress fan-out for a remote engine.
 *
 * A single stored callback would be enough if a service were only ever
 * subscribed to once, which stopped being true when the engine became a
 * per-transcription choice: the screen listening for a download and the call
 * listening for its own transcription can both be attached at the same time,
 * and with one slot the second silently evicts the first. The native engine
 * never had this problem because Tauri events are already multicast.
 */
export function progressHub() {
  const listeners = new Set<(progress: NativeProgress) => void>();

  return {
    emit(percent: number, stage: string) {
      for (const listener of listeners) listener({ percent, stage });
    },
    onProgress(cb: (progress: NativeProgress) => void): () => void {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
}
