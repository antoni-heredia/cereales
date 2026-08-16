#!/usr/bin/env node
// Bumps the project version in every file that declares it.
//
//   node .github/scripts/bump-version.mjs <major|minor|patch>
//
// Prints the new version to stdout.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const level = (process.argv[2] || 'patch').toLowerCase();

if (!['major', 'minor', 'patch'].includes(level)) {
  console.error(`Invalid level: ${level} (use major, minor or patch)`);
  process.exit(1);
}

const pkgPath = resolve(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const match = /^(\d+)\.(\d+)\.(\d+)/.exec(pkg.version ?? '');
if (!match) {
  console.error(`Non-semver version in package.json: ${pkg.version}`);
  process.exit(1);
}

let [major, minor, patch] = match.slice(1).map(Number);
if (level === 'major') [major, minor, patch] = [major + 1, 0, 0];
else if (level === 'minor') [minor, patch] = [minor + 1, 0];
else patch += 1;

const next = `${major}.${minor}.${patch}`;
const crateName = 'cereales';

/** Rewrites a file only if it exists. */
function edit(relPath, fn) {
  const abs = resolve(root, relPath);
  if (!existsSync(abs)) return;
  const before = readFileSync(abs, 'utf8');
  const after = fn(before);
  if (after !== before) writeFileSync(abs, after);
}

/**
 * Replaces the first `count` `"version"` keys of a JSON file without
 * re-serializing it, so the formatting of the rest of the file is untouched.
 */
function replaceJsonVersion(raw, count) {
  let hits = 0;
  return raw.replace(/"version"(\s*):(\s*)"[^"]*"/g, (match, s1, s2) =>
    hits++ < count ? `"version"${s1}:${s2}"${next}"` : match,
  );
}

// package.json — the root key is the first one in the file.
edit('package.json', (raw) => replaceJsonVersion(raw, 1));

// package-lock.json — the version appears at the root and in the "" package.
edit('package-lock.json', (raw) => replaceJsonVersion(raw, 2));

// tauri.conf.json
edit('src-tauri/tauri.conf.json', (raw) => replaceJsonVersion(raw, 1));

// Cargo.toml — only the `version` in the [package] section.
edit('src-tauri/Cargo.toml', (raw) => {
  let section = '';
  let done = false;
  return raw
    .split('\n')
    .map((line) => {
      const header = /^\s*\[([^\]]+)\]/.exec(line);
      if (header) section = header[1];
      if (!done && section === 'package' && /^\s*version\s*=\s*"/.test(line)) {
        done = true;
        return line.replace(/"[^"]*"/, `"${next}"`);
      }
      return line;
    })
    .join('\n');
});

// Cargo.lock — the [[package]] block of the crate itself.
edit('src-tauri/Cargo.lock', (raw) => {
  const blocks = raw.split(/(?=\[\[package\]\])/);
  return blocks
    .map((block) => {
      if (!new RegExp(`^name = "${crateName}"$`, 'm').test(block)) return block;
      return block.replace(/^version = "[^"]*"$/m, `version = "${next}"`);
    })
    .join('');
});

process.stdout.write(next);
