/**
 * Turns whatever a failed call threw into a sentence the user can read.
 *
 * The Rust side cannot know the interface language, so it returns a stable
 * error key instead of prose — optionally followed by `|` and an OS-level
 * detail, which stays verbatim because it is not translatable. See
 * `src-tauri/src/errors.rs`.
 */
import { translate, type Language, type MessageKey } from '@/i18n';

const KEY_PREFIX = 'err.';

function isMessageKey(value: string): value is MessageKey {
  return value.startsWith(KEY_PREFIX);
}

/** `err.audio.openDevice|Device in use` -> "Could not open… (Device in use)". */
export function translateNativeError(message: string, lang: Language): string {
  const separator = message.indexOf('|');
  const key = separator === -1 ? message : message.slice(0, separator);
  if (!isMessageKey(key)) return message;

  const text = translate(lang, key);
  // An unknown key translates to itself; showing the raw message is more useful.
  if (text === key) return message;

  const detail = separator === -1 ? '' : message.slice(separator + 1).trim();
  return detail ? `${text} (${detail})` : text;
}

export function describeError(err: unknown, lang: Language): string {
  if (err instanceof Error) return translateNativeError(err.message, lang);
  if (typeof err === 'string') return translateNativeError(err, lang);
  return translate(lang, 'error.unexpected');
}
