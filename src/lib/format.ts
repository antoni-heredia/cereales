import { localeOf, translate, type Language } from '@/i18n';
import type { TranscriptEntry } from '@/types';

/** mm:ss, zero-padded — the prototype's timestamp format throughout. */
export function formatTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatToday(lang: Language, date = new Date()): string {
  return date.toLocaleDateString(localeOf(lang), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
}

export function formatRecordingDate(iso: string, lang: Language): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const today = new Date();
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (sameDay) return translate(lang, 'date.today');

  return date.toLocaleDateString(localeOf(lang), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Index of the transcript entry closest to `timeSec`. Used to map a note's
 * timestamp onto the transcript, since notes are taken between utterances.
 */
export function nearestEntryIndex(entries: TranscriptEntry[], timeSec: number): number {
  let best = 0;
  let bestDiff = Infinity;
  entries.forEach((entry, index) => {
    const diff = Math.abs(entry.timeSec - timeSec);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = index;
    }
  });
  return best;
}

/** Model sizes, from a few dozen megabytes to a couple of gigabytes. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/** Shortens `~/Documents/cereales/audio` to `audio` for the sidebar. */
export function folderLeaf(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
