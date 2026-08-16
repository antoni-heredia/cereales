# CLAUDE.md

Guide for agents working in this repository. The [README](README.md) explains
the product, its limits and the architecture in detail; this is the operational
part: which commands to use, which conventions to respect and what not to touch
by hand.

## The project in one line

Desktop meeting recorder (Tauri 2 + React + Rust) that captures audio through
WASAPI, transcribes it locally with whisper.cpp and anchors notes to the exact
timestamp. **Windows only**: capture is written against WASAPI and on other
systems the audio commands return an explicit error.

## Commands

```bash
npm install              # frontend dependencies
npm run dev              # UI only, in the browser, with sample data (no Rust)
npm run tauri:dev        # full app (needs the Rust toolchain + MSVC + CMake + LLVM)
npm run typecheck        # tsc --noEmit
npm run build            # typecheck + vite build
npm run tauri:build      # packaged binary
```

Rust tests (they run against the machine's real WASAPI: they enumerate devices
and actually record, which is why they run on a single thread):

```bash
cd src-tauri && cargo test --lib -- --test-threads=1
```

The transcription test is skipped only when `DEFAULT_MODEL` (`ggml-small`) is
not downloaded. The download happens from the app itself, in **Settings → Local
model** (~490 MB).

## Code rules

- **Everything is written in English**: code, comments, documentation, commit
  messages and identifiers. The interface is a separate matter — it is bilingual,
  see below. The user may well talk to you in Spanish; that does not change what
  gets written to disk.
- **User-visible text never gets hardcoded.** Every string lives in `src/i18n/`.
  `en.ts` is the source of truth for the keys; `es.ts` is typed as `Messages`, so
  a key added without a Spanish translation is a `npm run typecheck` failure, not
  a silent fallback. Adding a string means adding it in both files.
- **Rust never returns prose to the user.** It cannot know the interface
  language, so a failing command returns a stable key from
  `src-tauri/src/errors.rs` (`err.audio.openDevice`), optionally followed by `|`
  and an untranslatable OS detail. `src/lib/errors.ts` translates it. Every key
  needs a matching `err.*` entry in **both** catalogues.
- **`src/services/native.ts` and `src-tauri/src/model.rs` are a contract.** Tauri
  command names and data shapes are pinned in both places: if you change one,
  change the other in the same commit. Rust serializes to camelCase via serde.
  The `group` of an `AudioSource` (`input` | `system` | `apps`), the `stage`
  of a progress event (`downloading` | `transcribing`) and the `id` of a
  `ModelStatus` (`tiny` | … | `large-v3-turbo`) are part of that contract — they
  are keys the frontend matches on and translates, not labels.
- **The catalogue of local models lives in Rust** (`MODELS` in
  `src-tauri/src/transcription.rs`). It owns the filenames and the download
  URLs, because it is what downloads them, and `list_models` hands the frontend
  the whole list with its state. Adding a model there means adding a `model.<id>`
  description to **both** i18n catalogues; without it the picker falls back to
  showing the raw id (`modelLabel` in `src/lib/models.ts`). Resolving an id
  through the catalogue is also what stops one coming from the frontend from
  turning into an arbitrary path, so never build a model path any other way.
- **Transcript serialization lives in TypeScript** (`src/lib/serialize.ts`). Rust
  only writes the bytes. Do not add a second implementation of the formats in
  Rust. The note's **name** is also decided in TypeScript
  (`transcriptRelPath`): Rust receives a relative path and only checks that it
  does not escape the root.
- **There is only one configurable folder: the Obsidian vault.** Everything
  hangs off `storage_root` (`src-tauri/src/storage.rs`): with a vault linked it
  is `{vault}/transcripts`, otherwise `Documents/cereales`. Inside, audio goes
  to `audio/`, screenshots to `attachments/` and notes to `{year}/`.
  `Settings.storageRoot` is derived — `load_settings` recomputes it on every
  load; never write it by hand. Anything the webview has to *display* from
  there also needs adding to `allow_storage_root`, or a vault on another drive
  falls outside the `asset://` scope.
- **A recording's id is the stem of its WAV file.** `RECORDING_PREFIX` plus a
  timestamp; the frontend derives the id from the path and the metadata sidecar
  is stored under `{id}.json`. Renaming a WAV therefore drags along its
  metadata, the structured transcript in the config folder, and the `![[…]]`
  embed inside the Obsidian note — `migrate_recording` is what does all of that
  at once. Do not rename recording files any other way.
- **Notes are durable from the moment they are taken.** `write_notes` writes the
  JSON sidecar while the recording is still running, which is why
  `start_recording` returns the id: it exists from the start, and waiting for
  `stop_recording` would mean nothing could be saved until the meeting ended.
  `write_transcript` is a different job — it also writes the note body, under a
  title that does not exist yet mid-recording — so do not use it for this.
- **A screenshot is a note with a picture** (`Note.image`), not a separate kind
  of object. That is what gives it the timestamp anchoring, the notes column and
  the Obsidian callout for free. Annotations are **baked into the PNG**: a
  redaction stored as a shape over the original is not a redaction. The capture
  crosses the IPC boundary as base64 in both directions — a staged file loaded
  over `asset://` would taint the editor's canvas and make it unable to export.
- **Renaming anything on disk needs a migration.** The Spanish names of the
  first versions (`transcripciones/`, `grabacion-`) are handled by
  `migrate_legacy_names`, which runs on every startup and must stay idempotent:
  never delete, never overwrite a name that is taken, and keep the old location
  in `legacy_audio_dirs` so anything it could not move is still listed. Follow
  that shape for any future rename.
- **Audio capture is Windows-specific** (`src-tauri/src/audio/win.rs`). *Process
  loopback* needs Windows 10 build 19041 or later. When adding native code, keep
  the pattern of returning an explicit error off Windows instead of pretending it
  works.
- **Audio is stored as mono 16 kHz** (`OUT_RATE` in `audio/win.rs`), which is
  what whisper consumes. Changing that forces a resample at transcription time.
- **Silences are padded by hand.** In WASAPI loopback no packets arrive while
  nothing is playing; the capture thread keeps its own clock and fills the gaps.
  The `captured_duration_tracks_the_clock` test covers that property — do not
  disable it when touching the capture loop.

## Interface languages

The app ships in English and Spanish. `Settings.language` holds `"es"`, `"en"`
or empty; empty means the user has never chosen, and `resolveLanguage` falls
back to the system language so an existing install does not flip on upgrade.

The language reaches further than the chrome:

- the section headings of generated notes (`serializeTranscript` takes a `lang`),
- the speaker labels ElevenLabs makes us name ("Speaker 1"),
- date formatting (`localeOf`).

**It does not decide what language is being spoken.** That is
`Settings.audioLanguage` — `"es"`, `"en"`, `"auto"`, or empty to follow the
interface, resolved by `resolveAudioLanguage`. The two were one value once, and
conflating them is not cosmetic: whisper conditions its decoder on the language
token, so telling it English over Spanish speech yields an *English* transcript
even with `set_translate(false)`. ElevenLabs is blunter still — it just obeys
`language_code`.

That is why `TranscriptionService.transcribe` takes a `TranscribeLanguages`
(`{ audio, ui }`) instead of one `lang`: the two questions look alike at a call
site and a single parameter invites putting the wrong one in. Rust only ever
receives `audio`; anything user-visible uses `ui`.

`translate(lang, key, params)` is a plain function on purpose: the service layer
builds notes and speaker labels outside React and must not depend on a context
to do it. `useI18n()` is only the React wrapper around it.

## Commit convention

The repository uses [Conventional Commits](https://www.conventionalcommits.org/)
and **the commit message decides the version that gets published**, so it is not
cosmetic:

| Commit prefix | Bump | Example |
| --- | --- | --- |
| `feat!:`, `fix(scope)!:`, or `BREAKING CHANGE` in the body | **major** | `feat!: change the recording index format` |
| `feat:` | **minor** | `feat: export the transcript to SRT` |
| `fix:`, `perf:`, `refactor:`, `docs:`, `chore:`, … | **patch** | `fix: correct the timestamp drift` |

Every commit since the last tag is analysed: a single `feat:` among them makes
the bump minor.

## Versioning and publishing

The version bumps **by itself** on a push to `main`. The flow is in
[.github/workflows/version-bump.yml](.github/workflows/version-bump.yml):

1. Infers the level (major/minor/patch) from the commits since the last tag.
2. Runs [.github/scripts/bump-version.mjs](.github/scripts/bump-version.mjs),
   which syncs the version across the five places it lives.
3. Commits as `chore(release): vX.Y.Z [skip ci]`.
4. **Creates the annotated tag `vX.Y.Z` and pushes it.**
5. Publishes a GitHub Release with autogenerated notes.

### Do not edit the version by hand

The version appears in five files and they have to stay in sync:

| File | Where |
| --- | --- |
| `package.json` | root `version` key |
| `package-lock.json` | root `version` and `packages[""].version` |
| `src-tauri/tauri.conf.json` | root `version` key |
| `src-tauri/Cargo.toml` | `version` in the `[package]` section |
| `src-tauri/Cargo.lock` | the `[[package]]` block for `name = "cereales"` |

If you need to bump the version locally, use the script instead of editing the
files:

```bash
node .github/scripts/bump-version.mjs minor
```

It accepts `major`, `minor` or `patch` and prints the new version to stdout. It
is format-idempotent: it replaces only the value, without re-serializing the
JSON, so the diff stays clean.

### Publishing a specific version

From **Actions → Version bump → Run workflow** you can force the level
(`major`/`minor`/`patch`) instead of letting it be inferred.

### Workflow details

- It does not retrigger itself: pushes made with `GITHUB_TOKEN` do not start
  workflows, and the release commit also carries `[skip ci]`.
- It needs `permissions: contents: write`. If `main` is branch-protected, either
  allow pushes from `github-actions[bot]` or use a PAT / GitHub App.
- `concurrency: version-bump` keeps two consecutive pushes from racing to create
  the same tag.

## Things that tend to surprise people

- **You cannot capture one specific browser tab.** Windows captures per process
  and a browser puts all of its tabs in the same tree; the dropdown offers the
  whole application.
- **whisper.cpp does not tell speakers apart.** The UI hides the speaker line
  rather than inventing a "Speaker 1".
- **whisper invents labels during silences** (`[MUSIC]`, `[BLANK_AUDIO]`); they
  are dropped when the segments are read.
- **`csp` is `null`** in `tauri.conf.json` because the Archivo font is loaded
  from Google Fonts. Bundling it locally and turning on a strict CSP is still
  pending.
- **The icons in `src-tauri/icons/` are generated placeholders**
  (`npm run tauri icon path/to/icon.png` to replace them).
