/**
 * Transcription through the ElevenLabs Scribe API.
 *
 * The alternative to the local model: the audio leaves the machine, but in
 * exchange there is no half-gigabyte model to download and no CPU time to pay.
 * And unlike whisper.cpp it does diarize, so lines can carry a speaker.
 */
import { convertFileSrc } from '@tauri-apps/api/core';
import { translate, type Language } from '@/i18n';
import type { ModelStatus, NativeProgress, TranscriptEntry } from '@/types';
import type { TranscribeLanguages, TranscriptionService } from './types';

const ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text';
/** Scribe model. `model_id` is mandatory: without it the API answers 422. */
const MODEL_ID = 'scribe_v1';

/** ISO 639-3 codes, which is what Scribe's `language_code` expects. */
const LANGUAGE_CODES: Record<Language, string> = { en: 'eng', es: 'spa' };

/** The remote engine dressed as a `ModelStatus`: a key is all it takes to be ready. */
const scribe = (apiKey: string): ModelStatus => ({
  id: MODEL_ID,
  installed: !!apiKey,
  name: 'ElevenLabs Scribe',
  bytes: 0,
  approxBytes: 0,
});

/** A single word as Scribe returns it; `start`/`end` are in seconds. */
interface ScribeWord {
  text: string;
  start?: number;
  end?: number;
  /** "word" | "spacing" | "audio_event" */
  type?: string;
  speaker_id?: string;
}

export interface ScribeResponse {
  text?: string;
  words?: ScribeWord[];
}

/** Closes a segment at the end of a sentence, so entries are not per word. */
const SENTENCE_END = /[.!?…]["')\]]?$/;
/** Safety ceilings, in case the audio comes back without punctuation. */
const MAX_SEGMENT_SEC = 15;
const MAX_SEGMENT_CHARS = 220;

export const elevenLabsTranscription = (apiKey: string): TranscriptionService => {
  let onProgressCb: ((progress: NativeProgress) => void) | null = null;
  const emit = (percent: number, stage: string) => onProgressCb?.({ percent, stage });

  return {
    async transcribe(audioPath: string, lang: TranscribeLanguages): Promise<TranscriptEntry[]> {
      if (!apiKey) {
        throw new Error('err.elevenlabs.noKey');
      }

      emit(0, 'transcribing');
      const audio = await readAudioFile(audioPath, lang.ui);

      const form = new FormData();
      // The filename matters: the API uses it to infer the container.
      form.append('file', new Blob([audio], { type: 'audio/wav' }), 'recording.wav');
      form.append('model_id', MODEL_ID);
      // Omitted entirely on `auto`: Scribe detects the language when the field
      // is absent, and there is no code that means "detect it".
      if (lang.audio !== 'auto') form.append('language_code', LANGUAGE_CODES[lang.audio]);
      form.append('diarize', 'true');
      form.append('timestamps_granularity', 'word');

      emit(30, 'transcribing');
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey },
        body: form,
      });

      if (!response.ok) {
        // The ElevenLabs error body says which field is missing or extra, so it
        // is passed through: guessing from the status code is no help.
        const detail = await response.text().catch(() => '');
        throw new Error(
          translate(lang.ui, 'err.elevenlabs.http', {
            status: response.status,
            detail: detail || '—',
          }),
        );
      }

      emit(80, 'transcribing');
      const result = (await response.json()) as ScribeResponse;
      emit(100, 'transcribing');

      // The interface language, not the audio one: "Speaker 1" is a label the
      // reader sees, not something that was spoken.
      return groupIntoSegments(result, lang.ui);
    },

    // Nothing to install: the "model" is ready as soon as there is a key.
    async modelStatus(): Promise<ModelStatus> {
      return scribe(apiKey);
    },

    async downloadModel(): Promise<ModelStatus> {
      return scribe(apiKey);
    },

    // No local catalogue to manage: the settings screen hides the model section
    // entirely while this engine is selected.
    async listModels(): Promise<ModelStatus[]> {
      return [];
    },

    async deleteModel(): Promise<ModelStatus[]> {
      return [];
    },

    onProgress(cb) {
      onProgressCb = cb;
      return () => {
        onProgressCb = null;
      };
    },
  };
};

/**
 * Scribe returns one word at a time. An entry per word would make the
 * transcript unreadable and would break the jump from a note, which looks for
 * the nearest entry in time: words are grouped into sentences.
 */
export function groupIntoSegments(result: ScribeResponse, lang: Language): TranscriptEntry[] {
  const words = result.words ?? [];
  if (words.length === 0) {
    const text = result.text?.trim();
    return text ? [{ timeSec: 0, speaker: '', text }] : [];
  }

  // With a single speaker the name adds nothing, and the UI already hides the
  // line when it is empty.
  const speakers = new Set(
    words.filter((w) => w.type !== 'spacing').map((w) => w.speaker_id).filter(Boolean),
  );
  const diarizes = speakers.size > 1;

  const entries: TranscriptEntry[] = [];
  // An open segment is an object rather than "the buffer is not empty":
  // spacing dirties the buffer and would make it look like one is still open.
  let open: { start: number; speaker?: string; parts: string[] } | null = null;

  const close = () => {
    if (!open) return;
    const text = open.parts.join('').trim();
    if (text) {
      entries.push({
        timeSec: open.start,
        speaker: diarizes ? speakerLabel(open.speaker, lang) : '',
        text,
      });
    }
    open = null;
  };

  for (const word of words) {
    // Spacing only separates words: it never opens a segment or picks a speaker.
    if (word.type === 'spacing') {
      open?.parts.push(word.text ?? ' ');
      continue;
    }

    if (open && word.speaker_id !== open.speaker) close();
    if (!open) {
      open = { start: word.start ?? 0, speaker: word.speaker_id, parts: [] };
    }
    open.parts.push(word.text ?? '');

    const text = open.parts.join('');
    const end = word.end ?? word.start ?? open.start;
    const tooLong = text.length >= MAX_SEGMENT_CHARS;
    const tooSlow = end - open.start >= MAX_SEGMENT_SEC;
    if (SENTENCE_END.test(text.trimEnd()) || tooLong || tooSlow) close();
  }
  close();

  return entries;
}

/** "speaker_0" -> "Speaker 1". */
function speakerLabel(speakerId: string | undefined, lang: Language): string {
  if (!speakerId) return '';
  const n = Number(speakerId.match(/\d+/)?.[0]);
  return Number.isFinite(n) ? translate(lang, 'transcript.speaker', { n: n + 1 }) : speakerId;
}

/**
 * Reads the recorded WAV. It goes through Tauri's `asset://` protocol instead
 * of `file://`, which the webview blocks as a local resource.
 */
async function readAudioFile(audioPath: string, lang: Language): Promise<ArrayBuffer> {
  const response = await fetch(convertFileSrc(audioPath));
  if (!response.ok) {
    throw new Error(
      translate(lang, 'err.elevenlabs.readAudio', { status: response.status, path: audioPath }),
    );
  }
  return response.arrayBuffer();
}
