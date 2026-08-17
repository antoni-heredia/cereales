import { translate, type Language } from '@/i18n';
import type { Note, Recording, Transcript, TranscriptEntry, TranscriptFormat } from '@/types';
import { formatTime } from './format';

/**
 * Folder the screenshots live in, mirroring `ATTACHMENTS_FOLDER` in
 * `src-tauri/src/storage.rs`. Rust decides the filenames; this side only has to
 * know where they end up relative to the note.
 */
const ATTACHMENTS_FOLDER = 'attachments';

function srtTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  const millis = Math.round((safe - Math.floor(safe)) * 1000);
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

/**
 * The end of an entry is the start of the next one; the last entry runs to the
 * end of the recording (or a 3s tail if the duration is unknown).
 */
function entryEnd(transcript: Transcript, index: number, durationSec: number): number {
  const next = transcript.entries[index + 1];
  if (next) return next.timeSec;
  const current = transcript.entries[index];
  const fallback = (current?.timeSec ?? 0) + 3;
  return durationSec > 0 ? Math.max(durationSec, fallback) : fallback;
}

export function serializeTranscript(
  recording: Recording,
  transcript: Transcript,
  format: TranscriptFormat,
  lang: Language,
): string {
  switch (format) {
    case 'TXT':
      return serializeTxt(recording, transcript, lang);
    case 'Markdown':
      return serializeMarkdown(recording, transcript, lang);
    case 'SRT':
      return serializeSrt(recording, transcript);
    case 'Obsidian':
      return serializeObsidian(recording, transcript, lang);
  }
}

function serializeTxt(recording: Recording, transcript: Transcript, lang: Language): string {
  const lines: string[] = [recording.title, ''];
  for (const entry of transcript.entries) {
    lines.push(`[${formatTime(entry.timeSec)}] ${entry.speaker}: ${entry.text}`);
  }
  if (transcript.notes.length > 0) {
    lines.push('', translate(lang, 'note.sectionPlain'), '');
    for (const note of transcript.notes) {
      lines.push(`[${formatTime(note.timeSec)}] ${noteText(note, lang)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * A note as plain text. Plain formats cannot embed the screenshot, so they name
 * the file instead: dropping it would quietly lose the fact that there was one.
 */
function noteText(note: Note, lang: Language): string {
  if (!note.image) return note.text;
  const label = `(${translate(lang, 'note.screenshot')}: ${note.image})`;
  return note.text ? `${note.text} ${label}` : label;
}

function serializeMarkdown(recording: Recording, transcript: Transcript, lang: Language): string {
  const lines: string[] = [
    `# ${recording.title}`,
    '',
    `_${recording.startedAt} · ${formatTime(recording.durationSec)}_`,
    '',
    `## ${translate(lang, 'transcript.section')}`,
    '',
  ];
  for (const entry of transcript.entries) {
    lines.push(`**${formatTime(entry.timeSec)} · ${entry.speaker}** — ${entry.text}`);
    lines.push('');
  }
  if (transcript.notes.length > 0) {
    lines.push(`## ${translate(lang, 'note.section')}`, '');
    for (const note of transcript.notes) {
      lines.push(`- \`${formatTime(note.timeSec)}\`${note.text ? ` ${note.text}` : ''}`);
      // A wikilink only resolves inside a vault, so plain Markdown gets a
      // relative one: the note is in `{year}/` and the image in `attachments/`,
      // both directly under the storage root.
      if (note.image) lines.push(`  ![](../${ATTACHMENTS_FOLDER}/${note.image})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/** Notes never appear in SRT: it is a subtitle track, keyed to utterances. */
function serializeSrt(recording: Recording, transcript: Transcript): string {
  return (
    transcript.entries
      .map((entry, index) => {
        const start = srtTimestamp(entry.timeSec);
        const end = srtTimestamp(entryEnd(transcript, index, recording.durationSec));
        return `${index + 1}\n${start} --> ${end}\n${entry.speaker}: ${entry.text}\n`;
      })
      .join('\n') + '\n'
  );
}

/**
 * Local date in short ISO form. Slicing `startedAt` at the `T` will not do: it
 * is UTC, and a late-night meeting would be filed under the previous day.
 */
function localDate(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `Meeting with the client` -> `meeting-with-the-client`. */
export function slugify(text: string): string {
  const plain = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return plain || 'recording';
}

/**
 * Path of the note inside the storage root, grouped by year:
 * `2026/2026-08-08-meeting-with-the-client.md`. The backend resolves it against
 * the vault and only checks that it does not escape it.
 */
export function transcriptRelPath(recording: Recording, format: TranscriptFormat): string {
  const date = localDate(recording.startedAt);
  const folder = date ? date.slice(0, 4) : 'undated';
  const prefix = date ? `${date}-` : '';
  return `${folder}/${prefix}${slugify(recording.title)}.${transcriptExtension(format)}`;
}

/** Index of the last utterance before the note, or -1 if there is none. */
function entryBefore(entries: TranscriptEntry[], timeSec: number): number {
  let found = -1;
  entries.forEach((entry, index) => {
    if (entry.timeSec <= timeSec) found = index;
  });
  return found;
}

function serializeObsidian(recording: Recording, transcript: Transcript, lang: Language): string {
  const date = localDate(recording.startedAt);
  const duration = formatTime(recording.durationSec);
  // The WAV is named after the recording and lives in `audio/` under the same
  // root. Obsidian resolves the `![[...]]` embed by name, so the player keeps
  // working even if the note is moved to another folder.
  const audioFile = `${recording.id}.wav`;

  // Every note hangs off the utterance it was written during. The ones taken
  // before the first utterance (or in a recording that is not transcribed yet)
  // go in their own section, otherwise they would be lost.
  const anchored = new Map<number, Note[]>();
  const loose: Note[] = [];
  for (const note of transcript.notes) {
    const index = entryBefore(transcript.entries, note.timeSec);
    if (index === -1) loose.push(note);
    else anchored.set(index, [...(anchored.get(index) ?? []), note]);
  }

  const tags = (recording.tags ?? [])
    // Obsidian does not allow spaces inside a tag.
    .map((tag) => tag.trim().replace(/\s+/g, '-'))
    .filter(Boolean);

  const lines: string[] = ['---'];
  if (date) lines.push(`date: ${date}`);
  lines.push(`duration: "${duration}"`, 'source: cereales', `audio: "audio/${audioFile}"`);
  // What produced the text. With the engine picked per transcription, two notes
  // in the same folder can differ in whether they have speaker names and in how
  // good the text is, and the note is the only place that survives to explain
  // it — the app can be uninstalled, the vault stays.
  if (recording.engine) lines.push(`engine: "${recording.engine}"`);
  if (tags.length > 0) {
    lines.push('tags:');
    for (const tag of tags) lines.push(`  - ${tag}`);
  }
  lines.push('---', '', `# ${recording.title}`, '', `![[${audioFile}]]`, '');

  if (loose.length > 0) {
    lines.push(`## ${translate(lang, 'note.section')}`, '');
    for (const note of loose) {
      lines.push(`- \`${formatTime(note.timeSec)}\`${note.text ? ` ${note.text}` : ''}`);
      // Indented under the bullet, and preceded by a blank line so the embed is
      // a block of its own rather than running into the text of the note.
      if (note.image) lines.push('', `  ![[${note.image}]]`);
    }
    lines.push('');
  }

  if (transcript.entries.length > 0) {
    lines.push(`## ${translate(lang, 'transcript.section')}`, '');
    transcript.entries.forEach((entry, index) => {
      const speaker = entry.speaker ? `**${entry.speaker}:** ` : '';
      lines.push(`**${formatTime(entry.timeSec)}** — ${speaker}${entry.text}`, '');
      for (const note of anchored.get(index) ?? []) {
        // Every line of a callout body carries the `>`, the embed included. An
        // uncaptioned screenshot skips the text line rather than emitting a
        // bare `>`, which would render as an empty paragraph.
        lines.push(`> [!note] ${formatTime(note.timeSec)}`);
        if (note.text) lines.push(`> ${note.text}`);
        if (note.image) lines.push(`> ![[${note.image}]]`);
        lines.push('');
      }
    });
  }

  return `${lines.join('\n')}\n`;
}

const EXTENSIONS: Record<TranscriptFormat, string> = {
  TXT: 'txt',
  Markdown: 'md',
  SRT: 'srt',
  Obsidian: 'md',
};

export function transcriptExtension(format: TranscriptFormat): string {
  return EXTENSIONS[format];
}
