/**
 * What can transcribe right now, and how to name it.
 *
 * The engine is chosen per transcription, not once in the settings, so the
 * question the picker has to answer is not "which engines exist" but "which
 * ones would work if I pressed the button". A model that is in the catalogue
 * but not downloaded would fail, and so would a service whose key is missing:
 * neither belongs in the list. Offering them and failing afterwards is worse
 * than a short list, because the failure arrives minutes later, after the audio
 * has already been uploaded or the model download has started by surprise.
 */
import { translate, type Language } from '@/i18n';
import { DEEPGRAM_MODEL } from '@/services/deepgram';
import { SCRIBE_MODEL } from '@/services/elevenlabs';
import type { ModelStatus, Settings, TranscriptionChoice, TranscriptionEngine } from '@/types';

/**
 * Brand names, deliberately not translated and deliberately not in the message
 * catalogues: "Deepgram" is Deepgram in every language, and putting it in
 * `en.ts` would invite someone to translate it.
 */
const ENGINE_NAMES: Record<TranscriptionEngine, string> = {
  local: 'whisper.cpp',
  elevenlabs: 'ElevenLabs Scribe',
  deepgram: 'Deepgram',
};

export function engineName(engine: TranscriptionEngine): string {
  return ENGINE_NAMES[engine];
}

/**
 * Stable string for one choice, so it can be the value of an option element and
 * be compared without deep equality. `local:small`, `deepgram`.
 */
export function choiceId(choice: TranscriptionChoice): string {
  return choice.model ? `${choice.engine}:${choice.model}` : choice.engine;
}

/**
 * What the user sees in the dropdown: `Local · small`, `Deepgram`.
 *
 * The catalogue id and not `modelLabel`, which is a whole sentence of advice —
 * right in the settings screen, where the model is being chosen on its merits,
 * and far too long for a row that is only being switched between.
 */
export function choiceLabel(choice: TranscriptionChoice, lang: Language): string {
  if (choice.engine !== 'local') return engineName(choice.engine);
  const local = translate(lang, 'engine.local');
  return choice.model ? `${local} · ${choice.model}` : local;
}

/**
 * The secondary line: where the audio ends up. It is the fact worth repeating
 * at the moment of choosing — the whole premise of the app is that recordings
 * do not have to leave the machine, and picking a remote engine for one meeting
 * is the one place that stops being true.
 */
export function choiceMeta(choice: TranscriptionChoice, lang: Language): string {
  return choice.engine === 'local'
    ? translate(lang, 'engine.onDevice')
    : translate(lang, 'engine.uploads', { service: engineName(choice.engine) });
}

/**
 * What gets written into the recording's metadata and the note's frontmatter.
 * Independent of the interface language, because it ends up on disk and is read
 * back by whoever opens the vault, not necessarily in the same language.
 */
export function engineStamp(choice: TranscriptionChoice): string {
  switch (choice.engine) {
    case 'local':
      return `whisper.cpp/${choice.model ?? 'unknown'}`;
    case 'elevenlabs':
      return `elevenlabs/${SCRIBE_MODEL}`;
    case 'deepgram':
      return `deepgram/${DEEPGRAM_MODEL}`;
  }
}

/**
 * Everything that could transcribe right now: one entry per downloaded model,
 * plus each remote service that has a key. Catalogue order is kept so the list
 * does not reshuffle as models are downloaded — a dropdown whose entries move
 * is one you have to read every time.
 */
export function availableChoices(
  settings: Settings,
  models: ModelStatus[],
): TranscriptionChoice[] {
  const choices: TranscriptionChoice[] = models
    .filter((model) => model.installed)
    .map((model) => ({ engine: 'local' as const, model: model.id }));

  if (settings.elevenLabsApiKey.trim()) choices.push({ engine: 'elevenlabs' });
  if (settings.deepgramApiKey.trim()) choices.push({ engine: 'deepgram' });

  return choices;
}

/**
 * The choice to propose, given the defaults in the settings. It falls back
 * rather than insisting: a default pointing at a model that has since been
 * deleted, or at a service whose key was removed, must not leave the button
 * dead when something else is perfectly usable.
 *
 * Returns null when nothing at all is ready, which is a real state — a fresh
 * install with no model downloaded and no keys — and the caller says so instead
 * of showing an empty dropdown.
 */
export function defaultChoice(
  settings: Settings,
  available: TranscriptionChoice[],
): TranscriptionChoice | null {
  if (available.length === 0) return null;

  const preferred: TranscriptionChoice =
    settings.transcriptionService === 'local'
      ? { engine: 'local', model: settings.whisperModel }
      : { engine: settings.transcriptionService };

  const exact = available.find((c) => choiceId(c) === choiceId(preferred));
  if (exact) return exact;

  // The engine is right but that model is gone: any other model of the same
  // engine is closer to what was asked for than a different engine entirely.
  const sameEngine = available.find((c) => c.engine === preferred.engine);
  // `available` is not empty here, but the index signature does not know that.
  return sameEngine ?? available[0] ?? null;
}
