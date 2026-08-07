#!/usr/bin/env node
// Sube la versión del proyecto en todos los ficheros que la declaran.
//
//   node .github/scripts/bump-version.mjs <major|minor|patch>
//
// Imprime la nueva versión por stdout.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const level = (process.argv[2] || 'patch').toLowerCase();

if (!['major', 'minor', 'patch'].includes(level)) {
  console.error(`Nivel no válido: ${level} (usa major, minor o patch)`);
  process.exit(1);
}

const pkgPath = resolve(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const match = /^(\d+)\.(\d+)\.(\d+)/.exec(pkg.version ?? '');
if (!match) {
  console.error(`Versión no semver en package.json: ${pkg.version}`);
  process.exit(1);
}

let [major, minor, patch] = match.slice(1).map(Number);
if (level === 'major') [major, minor, patch] = [major + 1, 0, 0];
else if (level === 'minor') [minor, patch] = [minor + 1, 0];
else patch += 1;

const next = `${major}.${minor}.${patch}`;
const crateName = 'cereales';

/** Reescribe un fichero solo si existe. */
function edit(relPath, fn) {
  const abs = resolve(root, relPath);
  if (!existsSync(abs)) return;
  const before = readFileSync(abs, 'utf8');
  const after = fn(before);
  if (after !== before) writeFileSync(abs, after);
}

/**
 * Reemplaza las `count` primeras claves `"version"` de un JSON sin
 * reserializarlo, para no alterar el formato del resto del fichero.
 */
function replaceJsonVersion(raw, count) {
  let hits = 0;
  return raw.replace(/"version"(\s*):(\s*)"[^"]*"/g, (match, s1, s2) =>
    hits++ < count ? `"version"${s1}:${s2}"${next}"` : match,
  );
}

// package.json — la clave de nivel raíz es la primera del fichero.
edit('package.json', (raw) => replaceJsonVersion(raw, 1));

// package-lock.json — la versión aparece en la raíz y en el paquete "".
edit('package-lock.json', (raw) => replaceJsonVersion(raw, 2));

// tauri.conf.json
edit('src-tauri/tauri.conf.json', (raw) => replaceJsonVersion(raw, 1));

// Cargo.toml — solo el `version` de la sección [package].
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

// Cargo.lock — el bloque [[package]] del propio crate.
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
