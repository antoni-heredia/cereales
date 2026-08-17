#!/usr/bin/env node
/**
 * Finds the cereales transcripts that have not been summarised yet, and marks
 * one as done once it has been.
 *
 * Two commands:
 *
 *   node pending.mjs [--vault <path>] [--all] [--json]
 *   node pending.mjs --mark <note path> [--tag <tag>]
 *
 * Listing prints, for every transcript, where it is, what its frontmatter says
 * and which daily note its date maps to. Marking adds the tag to the note's
 * frontmatter and is idempotent, so a re-run cannot double-tag a note.
 *
 * The vault is read out of the app's own settings, so this does not have to be
 * told where anything lives. Only `obsidianVaultPath` is read from that file —
 * it also holds the ElevenLabs API key, which has no business being printed.
 */
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve, relative, basename } from 'node:path';

/** The tag that says "this one has a summary already". */
const DONE_TAG = 'cereales/summarised';

/** Where the Tauri app keeps `settings.json`, per platform. */
function configDir() {
  const home = homedir();
  const id = 'com.cereales.app';
  switch (platform()) {
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), id);
    case 'darwin':
      return join(home, 'Library', 'Application Support', id);
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), id);
  }
}

function readSettings() {
  const path = join(configDir(), 'settings.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Root of the notes: `{vault}/transcripts` with a vault linked, and
 * `Documents/cereales` without one. Mirrors `storage_root` in
 * `src-tauri/src/storage.rs`.
 */
function resolveRoots(vaultArg) {
  const settings = readSettings();
  const vault = (vaultArg ?? process.env.CEREALES_VAULT ?? settings?.obsidianVaultPath ?? '').trim();
  if (vault) return { vault, storageRoot: join(vault, 'transcripts') };
  return { vault: null, storageRoot: join(homedir(), 'Documents', 'cereales') };
}

/**
 * Splits a note into its frontmatter block and the body. Returns null when
 * there is no frontmatter, which is enough to tell that a file is not one of
 * ours.
 */
function splitFrontmatter(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const headerEnd = text.indexOf('\n', end + 1);
  return {
    header: text.slice(text.indexOf('\n') + 1, end + 1),
    headerStart: text.indexOf('\n') + 1,
    headerEnd: end + 1,
    body: headerEnd === -1 ? '' : text.slice(headerEnd + 1),
  };
}

/**
 * Enough YAML for the frontmatter cereales writes: `key: value` and a `tags:`
 * block or inline list. Anything more exotic is somebody's hand edit, and the
 * worst case is that a note looks untagged and gets offered again.
 */
function parseFrontmatter(header) {
  const out = { tags: [] };
  const lines = header.split('\n');
  let inTags = false;
  for (const line of lines) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (inTags && item) {
      out.tags.push(item[1].trim().replace(/^["']|["']$/g, ''));
      continue;
    }
    inTags = false;
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!pair) continue;
    const [, key, rawValue] = pair;
    const value = rawValue.trim().replace(/^["']|["']$/g, '');
    if (key === 'tags') {
      if (!value) inTags = true;
      else if (value.startsWith('[')) {
        out.tags = value
          .slice(1, -1)
          .split(',')
          .map((t) => t.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
      } else out.tags = [value];
      continue;
    }
    out[key] = value;
  }
  return out;
}

function walk(dir, found = []) {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    // `audio/` and `attachments/` hold no notes, and `.obsidian` is config.
    if (entry.startsWith('.') || entry === 'audio' || entry === 'attachments') continue;
    if (statSync(path).isDirectory()) walk(path, found);
    else if (entry.endsWith('.md')) found.push(path);
  }
  return found;
}

/** `YYYY/YYYY-MM-DD` -> `2026/2026-08-03`. The subset Obsidian actually uses. */
function formatDate(pattern, iso) {
  const [year, month, day] = iso.split('-');
  return pattern
    .replace(/YYYY/g, year)
    .replace(/MM/g, month)
    .replace(/DD/g, day);
}

/** Folder and filename pattern of the daily notes, straight from the vault. */
function dailyNotesConfig(vault) {
  if (!vault) return null;
  const path = join(vault, '.obsidian', 'daily-notes.json');
  if (!existsSync(path)) return { folder: '', format: 'YYYY-MM-DD', template: null };
  try {
    const cfg = JSON.parse(readFileSync(path, 'utf8'));
    return {
      folder: cfg.folder ?? '',
      format: cfg.format || 'YYYY-MM-DD',
      template: cfg.template || null,
    };
  } catch {
    return { folder: '', format: 'YYYY-MM-DD', template: null };
  }
}

function list({ vaultArg, all, asJson }) {
  const { vault, storageRoot } = resolveRoots(vaultArg);
  const daily = dailyNotesConfig(vault);

  const transcripts = [];
  for (const path of walk(storageRoot)) {
    const text = readFileSync(path, 'utf8');
    const parts = splitFrontmatter(text);
    if (!parts) continue;
    const fm = parseFrontmatter(parts.header);
    // `source: cereales` is what the serializer writes; it is how a note the
    // app generated is told apart from the rest of the vault.
    if (fm.source !== 'cereales') continue;
    const summarised = fm.tags.includes(DONE_TAG);
    if (summarised && !all) continue;

    let dailyNote = null;
    if (daily && fm.date) {
      const rel = `${formatDate(daily.format, fm.date)}.md`;
      const abs = join(vault, daily.folder, rel);
      dailyNote = { path: abs, exists: existsSync(abs) };
    }

    transcripts.push({
      path,
      name: basename(path, '.md'),
      date: fm.date ?? null,
      duration: fm.duration ?? null,
      audio: fm.audio ?? null,
      tags: fm.tags,
      summarised,
      // Rough size signal, so a caller can tell a 3-minute note from an hour.
      noteCount: (parts.body.match(/^> \[!note\]/gm) ?? []).length,
      dailyNote,
    });
  }

  transcripts.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''));
  const result = { vault, storageRoot, dailyNotes: daily, doneTag: DONE_TAG, transcripts };

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`vault:   ${vault ?? '(none linked, using Documents/cereales)'}`);
  console.log(`notes:   ${storageRoot}`);
  if (daily) console.log(`diary:   ${join(daily.folder, daily.format)}.md`);
  console.log('');
  if (transcripts.length === 0) {
    console.log(all ? 'No cereales transcripts found.' : 'Nothing pending — every transcript is summarised.');
    return;
  }
  for (const t of transcripts) {
    const flag = t.summarised ? '[done]' : '[    ]';
    const notes = t.noteCount > 0 ? `${t.noteCount} notes` : 'no notes';
    const diary = t.dailyNote ? (t.dailyNote.exists ? 'diary exists' : 'diary missing') : '';
    console.log(`${flag} ${t.date ?? '????-??-??'}  ${t.duration ?? '--:--'}  ${notes.padEnd(9)} ${diary}`);
    console.log(`       ${relative(process.cwd(), t.path)}`);
  }
}

/**
 * Adds the tag to a note's frontmatter, touching nothing else. Re-running is a
 * no-op, which is what makes it safe to call at the end of every summary
 * without checking first.
 */
function mark(notePath, tag) {
  const path = resolve(notePath);
  const text = readFileSync(path, 'utf8');
  const parts = splitFrontmatter(text);
  if (!parts) {
    console.error(`${path}: no frontmatter to tag`);
    process.exit(1);
  }
  const fm = parseFrontmatter(parts.header);
  if (fm.tags.includes(tag)) {
    console.log(`already tagged: ${path}`);
    return;
  }

  const header = parts.header;
  let nextHeader;
  if (/^tags:\s*$/m.test(header)) {
    // Existing block list: append one more item under it.
    nextHeader = header.replace(/^tags:\s*$/m, `tags:\n  - ${tag}`);
  } else if (/^tags:\s*\[/m.test(header)) {
    nextHeader = header.replace(/^(tags:\s*\[)(.*)(\])\s*$/m, (_, open, inner, close) =>
      `${open}${inner.trim() ? `${inner.trim()}, ` : ''}${tag}${close}`,
    );
  } else if (/^tags:\s*\S/m.test(header)) {
    nextHeader = header.replace(/^tags:\s*(\S.*)$/m, (_, only) => `tags:\n  - ${only.trim()}\n  - ${tag}`);
  } else {
    nextHeader = `${header}tags:\n  - ${tag}\n`;
  }

  writeFileSync(path, text.slice(0, parts.headerStart) + nextHeader + text.slice(parts.headerEnd), 'utf8');
  console.log(`tagged ${tag}: ${path}`);
}

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? null;
};

if (argv.includes('--mark')) {
  mark(flag('--mark'), flag('--tag') ?? DONE_TAG);
} else {
  list({ vaultArg: flag('--vault'), all: argv.includes('--all'), asJson: argv.includes('--json') });
}
