import type { Recording, Transcript, TranscriptFormat } from '@/types';
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

function serializeObsidian(recording: Recording, transcript: Transcript): string {
  const dateISO = recording.startedAt.split('T')[0];
  const duration = formatTime(recording.durationSec);
  const audioFile = `${dateISO}-${recording.title.toLowerCase().replace(/\s+/g, '-')}.wav`;

  const lines: string[] = [
    '---',
    `date: ${dateISO}`,
    `duration: "${duration}"`,
    'source: "cereales"',
    `audioFile: "transcripciones/audio/${audioFile}"`,
    'tags:',
  ];

  if (recording.tags && recording.tags.length > 0) {
    for (const tag of recording.tags) {
      lines.push(`  - ${tag}`);
    }
  } else {
    lines.push('  - reunión');
  }

  lines.push(
    '---',
    '',
    `# ${recording.title}`,
    '',
    `**Duración:** ${duration}  `,
    `**Grabado:** ${new Date(recording.startedAt).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' })}`,
    '',
    '## Transcripción',
    '',
  );

  for (const entry of transcript.entries) {
    const time = formatTime(entry.timeSec);
    lines.push(`### [${time}]`);
    lines.push(`> ${entry.text}`);

    const notesForTime = transcript.notes.filter(
      (note) => Math.abs(note.timeSec - entry.timeSec) < 1,
    );
    for (const note of notesForTime) {
      lines.push(`> ⚠️ **Nota:** ${note.text}`);
    }
    lines.push('');
  }

  if (transcript.notes.length > 0) {
    lines.push('## Notas', '');
    for (const note of transcript.notes) {
      lines.push(`- \`${formatTime(note.timeSec)}\` ${note.text}`);
    }
    lines.push('');
  }

  lines.push('## Archivos Adjuntos', '');
  lines.push(`- Audio original: \`transcripciones/audio/${audioFile}\``);

  return lines.join('\n');
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
