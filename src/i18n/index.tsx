/**
 * Minimal i18n layer: a plain `translate()` function plus a React wrapper.
 *
 * `translate` is deliberately usable outside React, because the pieces that
 * produce user-visible text are not all components: the service layer builds
 * Obsidian notes and speaker labels, and it must not depend on a React context
 * to do it.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { en, type MessageKey, type Messages } from './en';
import { es } from './es';

export type Language = 'en' | 'es';

/**
 * What the transcription engine is told to expect in the audio. It is a
 * separate question from the interface language: the app can be in English
 * while the meeting is held in Spanish, and announcing the wrong language does
 * not merely mislabel the result — whisper conditions its decoder on that
 * token and ends up writing the transcript in the language it was promised.
 */
export type AudioLanguage = Language | 'auto';

/** Selectable languages, in the order the settings screen shows them. */
export const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
];

/**
 * Values the audio-language setting can hold, in the order the settings screen
 * shows them. Empty means "whatever the interface is set to", which is what
 * every settings file written before this option existed implies.
 */
export const AUDIO_LANGUAGES = ['', 'auto', 'es', 'en'] as const;
export type AudioLanguageSetting = (typeof AUDIO_LANGUAGES)[number];

const CATALOGUES: Record<Language, Messages> = { en, es };

/** Locale passed to `toLocaleDateString`, per language. */
const LOCALES: Record<Language, string> = { en: 'en-US', es: 'es-ES' };

export function localeOf(lang: Language): string {
  return LOCALES[lang];
}

/**
 * Resolves the stored preference. An empty value means "never chosen", which is
 * the state of every settings file written before this setting existed: fall
 * back to the system language so the app opens in Spanish for a Spanish user.
 */
export function resolveLanguage(stored: string | null | undefined): Language {
  if (stored === 'en' || stored === 'es') return stored;
  const system = typeof navigator === 'undefined' ? '' : navigator.language;
  return system.toLowerCase().startsWith('es') ? 'es' : 'en';
}

/**
 * Same idea one level down: empty means "never chosen", and the interface
 * language decides. That is exactly what the app did before the audio language
 * was its own setting, so an existing install keeps transcribing the way it
 * always has.
 */
export function resolveAudioLanguage(
  stored: string | null | undefined,
  ui: Language,
): AudioLanguage {
  if (stored === 'en' || stored === 'es' || stored === 'auto') return stored;
  return ui;
}

type Params = Record<string, string | number>;

/** Replaces `{name}` placeholders. A missing param is left as-is, not blanked. */
function interpolate(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

export function translate(lang: Language, key: MessageKey, params?: Params): string {
  const message = CATALOGUES[lang][key] ?? en[key];
  return interpolate(message, params);
}

export type Translate = (key: MessageKey, params?: Params) => string;

interface I18nValue {
  lang: Language;
  locale: string;
  t: Translate;
  setLanguage: (lang: Language) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

/**
 * Wraps the app above the state provider: the store reads `t` to build error
 * messages and default titles, so i18n has to exist before it does. The store
 * pushes the persisted preference back down through `setLanguage` once the
 * settings have loaded from disk.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>(() => resolveLanguage(null));

  // Keeps the document in sync for screen readers and for `:lang()` selectors.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const t = useCallback<Translate>((key, params) => translate(lang, key, params), [lang]);

  const value = useMemo<I18nValue>(
    () => ({ lang, locale: localeOf(lang), t, setLanguage: setLang }),
    [lang, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
}

export type { MessageKey, Messages } from './en';
