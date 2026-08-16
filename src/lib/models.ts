import { translate, type Language } from '@/i18n';
import { en, type MessageKey } from '@/i18n/en';

/**
 * Description of a model of the local catalogue. The catalogue itself lives in
 * `src-tauri/src/transcription.rs` — Rust owns the filenames and URLs because it
 * is what downloads them — and each entry's `id` doubles as a message key here.
 *
 * A model added there before its description is translated falls back to its
 * raw id rather than blowing up: the list has to keep rendering.
 */
export function modelLabel(id: string, lang: Language): string {
  const key = `model.${id}` as MessageKey;
  return key in en ? translate(lang, key) : id;
}
