import { translate, type Language } from '@/i18n';
import type { AudioSource, SourceGroup } from '@/types';

const GROUP_KEYS = {
  input: 'source.groupInput',
  system: 'source.groupSystem',
  apps: 'source.groupApps',
} as const;

export function groupLabel(group: SourceGroup, lang: Language): string {
  return translate(lang, GROUP_KEYS[group]);
}

/**
 * Display name for a source. Microphone and application names come from the OS
 * and are shown verbatim; the single synthetic source — everything the system
 * plays — is ours to name, so it gets translated.
 */
export function sourceLabel(source: AudioSource, lang: Language): string {
  return source.id === 'sys:default' ? translate(lang, 'source.system') : source.label;
}
