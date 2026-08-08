import type { Note, Recording, Transcript, TranscriptEntry, TranscriptFormat } from '@/types';
import { formatTime } from './format';

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
): string {
  switch (format) {
    case 'TXT':
      return serializeTxt(recording, transcript);
    case 'Markdown':
      return serializeMarkdown(recording, transcript);
    case 'SRT':
      return serializeSrt(recording, transcript);
    case 'Obsidian':
      return serializeObsidian(recording, transcript);
  }
}

function serializeTxt(recording: Recording, transcript: Transcript): string {
  const lines: string[] = [recording.title, ''];
  for (const entry of transcript.entries) {
    lines.push(`[${formatTime(entry.timeSec)}] ${entry.speaker}: ${entry.text}`);
  }
  if (transcript.notes.length > 0) {
    lines.push('', 'NOTAS', '');
    for (const note of transcript.notes) {
      lines.push(`[${formatTime(note.timeSec)}] ${note.text}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function serializeMarkdown(recording: Recording, transcript: Transcript): string {
  const lines: string[] = [
    `# ${recording.title}`,
    '',
    `_${recording.startedAt} · ${formatTime(recording.durationSec)}_`,
    '',
    '## Transcripción',
    '',
  ];
  for (const entry of transcript.entries) {
    lines.push(`**${formatTime(entry.timeSec)} · ${entry.speaker}** — ${entry.text}`);
    lines.push('');
  }
  if (transcript.notes.length > 0) {
    lines.push('## Notas', '');
    for (const note of transcript.notes) {
      lines.push(`- \`${formatTime(note.timeSec)}\` ${note.text}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

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
 * Fecha local en formato ISO corto. No vale cortar `startedAt` por la `T`: es
 * UTC, y una reunión de madrugada acabaría archivada en el día anterior.
 */
function localDate(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `Reunión con el cliente` -> `reunion-con-el-cliente`. */
export function slugify(text: string): string {
  const plain = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return plain || 'grabacion';
}

/**
 * Ruta de la nota dentro de la raíz de almacenamiento, agrupada por año:
 * `2026/2026-08-08-reunion-con-el-cliente.md`. El backend la resuelve contra el
 * vault y solo comprueba que no se salga de él.
 */
export function transcriptRelPath(recording: Recording, format: TranscriptFormat): string {
  const date = localDate(recording.startedAt);
  const folder = date ? date.slice(0, 4) : 'sin-fecha';
  const prefix = date ? `${date}-` : '';
  return `${folder}/${prefix}${slugify(recording.title)}.${transcriptExtension(format)}`;
}

/** Índice de la última frase dicha antes de la nota, o -1 si no hay ninguna. */
function entryBefore(entries: TranscriptEntry[], timeSec: number): number {
  let found = -1;
  entries.forEach((entry, index) => {
    if (entry.timeSec <= timeSec) found = index;
  });
  return found;
}

function serializeObsidian(recording: Recording, transcript: Transcript): string {
  const date = localDate(recording.startedAt);
  const duration = formatTime(recording.durationSec);
  // El WAV se llama como la grabación y vive en `audio/` dentro de la misma
  // raíz. El embed `![[...]]` lo resuelve Obsidian por nombre, así que el
  // reproductor sigue funcionando aunque la nota se mueva de carpeta.
  const audioFile = `${recording.id}.wav`;

  // Cada nota cuelga de la frase en la que se escribió. Las de antes de la
  // primera frase (o de una grabación aún sin transcribir) van en su sección,
  // que si no se perderían.
  const anchored = new Map<number, Note[]>();
  const loose: Note[] = [];
  for (const note of transcript.notes) {
    const index = entryBefore(transcript.entries, note.timeSec);
    if (index === -1) loose.push(note);
    else anchored.set(index, [...(anchored.get(index) ?? []), note]);
  }

  const tags = (recording.tags ?? [])
    // Obsidian no admite espacios dentro de una etiqueta.
    .map((tag) => tag.trim().replace(/\s+/g, '-'))
    .filter(Boolean);

  const lines: string[] = ['---'];
  if (date) lines.push(`date: ${date}`);
  lines.push(`duration: "${duration}"`, 'source: cereales', `audio: "audio/${audioFile}"`);
  if (tags.length > 0) {
    lines.push('tags:');
    for (const tag of tags) lines.push(`  - ${tag}`);
  }
  lines.push('---', '', `# ${recording.title}`, '', `![[${audioFile}]]`, '');

  if (loose.length > 0) {
    lines.push('## Notas', '');
    for (const note of loose) lines.push(`- \`${formatTime(note.timeSec)}\` ${note.text}`);
    lines.push('');
  }

  if (transcript.entries.length > 0) {
    lines.push('## Transcripción', '');
    transcript.entries.forEach((entry, index) => {
      const speaker = entry.speaker ? `**${entry.speaker}:** ` : '';
      lines.push(`**${formatTime(entry.timeSec)}** — ${speaker}${entry.text}`, '');
      for (const note of anchored.get(index) ?? []) {
        lines.push(`> [!note] ${formatTime(note.timeSec)}`, `> ${note.text}`, '');
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
