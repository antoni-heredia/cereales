/**
 * Transcription through the Deepgram pre-recorded API.
 *
 * Like ElevenLabs it diarizes, so lines can carry a speaker, and like
 * ElevenLabs the audio leaves the machine. What makes it cheaper to support
 * than Scribe is `utterances=true`: Deepgram returns speech already grouped
 * into utterances with a start time and a speaker, which is what a
 * `TranscriptEntry` is. Scribe hands back one word at a time and has to be
 * reassembled into sentences here.
 */
import { translate } from '@/i18n';
import type { ModelStatus, NativeProgress, TranscriptEntry } from '@/types';
import type { AudioLanguage, Language } from '@/i18n';
import { progressHub, readAudioFile } from './remote';
import type { TranscribeLanguages, TranscriptionService } from './types';

const ENDPOINT = 'https://api.deepgram.com/v1/listen';

/**
 * Deepgram's current general model. Omitting `model` falls back to `base`,
 * which is markedly worse, so it is always sent.
 */
export const DEEPGRAM_MODEL = 'nova-3';

/**
 * `multi` is nova-3's multilingual mode rather than a detector: it lets the
 * audio switch language mid-sentence, which is the closest thing to "work it
 * out yourself" the API offers, and what `auto` means everywhere else here.
 */
const LANGUAGE_CODES: Record<AudioLanguage, string> = { en: 'en', es: 'es', auto: 'multi' };

/** The remote engine dressed as a `ModelStatus`: a key is all it takes to be ready. */
const nova = (apiKey: string): ModelStatus => ({
  id: DEEPGRAM_MODEL,
  installed: !!apiKey,
  name: `Deepgram ${DEEPGRAM_MODEL}`,
  bytes: 0,
  approxBytes: 0,
});

/** One utterance: speech between pauses, already grouped by the API. */
interface DeepgramUtterance {
  start?: number;
  transcript?: string;
  /** Present only with `diarize=true`; numeric, zero-based. */
  speaker?: number;
}

export interface DeepgramResponse {
  results?: {
    utterances?: DeepgramUtterance[];
    /** Fallback shape: the flat transcript, when utterances were not returned. */
    channels?: { alternatives?: { transcript?: string }[] }[];
  };
}

export const deepgramTranscription = (apiKey: string): TranscriptionService => {
  const progress = progressHub();

  return {
    async transcribe(audioPath: string, lang: TranscribeLanguages): Promise<TranscriptEntry[]> {
      if (!apiKey) {
        throw new Error('err.deepgram.noKey');
      }

      progress.emit(0, 'transcribing');
      const audio = await readAudioFile(audioPath, lang.ui);

      // Everything is a query parameter here; the body is the audio itself.
      const query = new URLSearchParams({
        model: DEEPGRAM_MODEL,
        language: LANGUAGE_CODES[lang.audio],
        // Utterances are the segments; punctuation is what closes them
        // sensibly, so it is not optional in practice.
        punctuate: 'true',
        smart_format: 'true',
        diarize: 'true',
        utterances: 'true',
      });

      progress.emit(30, 'transcribing');
      const response = await fetch(`${ENDPOINT}?${query}`, {
        method: 'POST',
        headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'audio/wav' },
        body: audio,
      });

      if (!response.ok) {
        // The body names the parameter Deepgram objected to, which the status
        // code alone never does.
        const detail = await response.text().catch(() => '');
        throw new Error(
          translate(lang.ui, 'err.deepgram.http', {
            status: response.status,
            detail: detail || '—',
          }),
        );
      }

      progress.emit(80, 'transcribing');
      const result = (await response.json()) as DeepgramResponse;
      progress.emit(100, 'transcribing');

      // The interface language, not the audio one: "Speaker 1" is a label the
      // reader sees, not something that was spoken.
      return toEntries(result, lang.ui);
    },

    // Nothing to install: the "model" is ready as soon as there is a key.
    async modelStatus(): Promise<ModelStatus> {
      return nova(apiKey);
    },

    async downloadModel(): Promise<ModelStatus> {
      return nova(apiKey);
    },

    // No local catalogue to manage. The settings screen gets the catalogue from
    // the local engine, which is always around now.
    async listModels(): Promise<ModelStatus[]> {
      return [];
    },

    async deleteModel(): Promise<ModelStatus[]> {
      return [];
    },

    onProgress(cb: (progress: NativeProgress) => void) {
      return progress.onProgress(cb);
    },
  };
};

/**
 * Utterances to transcript entries. The grouping is already done, so this only
 * has to decide whether the speaker labels are worth showing and drop the empty
 * utterances Deepgram emits over silence.
 */
export function toEntries(result: DeepgramResponse, lang: Language): TranscriptEntry[] {
  const utterances = (result.results?.utterances ?? []).filter((u) => u.transcript?.trim());

  if (utterances.length === 0) {
    const text = result.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim();
    return text ? [{ timeSec: 0, speaker: '', text }] : [];
  }

  // With a single speaker the name adds nothing, and the UI already hides the
  // line when it is empty.
  const speakers = new Set(utterances.map((u) => u.speaker).filter((s) => s !== undefined));
  const diarizes = speakers.size > 1;

  return utterances.map((utterance) => ({
    timeSec: utterance.start ?? 0,
    speaker: diarizes ? speakerLabel(utterance.speaker, lang) : '',
    text: utterance.transcript!.trim(),
  }));
}

/** `0` -> "Speaker 1". Deepgram counts from zero; people do not. */
function speakerLabel(speaker: number | undefined, lang: Language): string {
  if (speaker === undefined) return '';
  return translate(lang, 'transcript.speaker', { n: speaker + 1 });
}
