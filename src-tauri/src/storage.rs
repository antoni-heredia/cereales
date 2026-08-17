//! Settings, recording index and transcript persistence.
//!
//! Everything the user sees hangs off a single root: the Obsidian vault if one
//! is linked, otherwise a folder under Documents. Inside that root, audio goes
//! to `audio/` and notes to `{year}/`, which is where Obsidian expects to find
//! them. The structured JSON of each transcript is kept separately, in the
//! config folder, so a transcript can be reloaded whatever format it was
//! exported to.

use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};

use tauri::{AppHandle, Manager};

use crate::errors;
use crate::model::{Note, Recording, Settings, Transcript};

fn config_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| errors::with(errors::STORAGE_WRITE, e))?;
    fs::create_dir_all(&dir).map_err(|e| errors::with(errors::STORAGE_WRITE, e))?;
    Ok(dir)
}

fn sidecar_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = config_dir(app)?.join("transcripts");
    fs::create_dir_all(&dir).map_err(|e| errors::with(errors::STORAGE_WRITE, e))?;
    Ok(dir)
}

/// Where everything is stored while no vault is linked.
fn default_root(app: &AppHandle) -> PathBuf {
    app.path()
        .document_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("cereales")
}

/// Folder cereales owns inside the vault, and the name it had before
/// `migrate_legacy_names` renamed it.
const STORAGE_FOLDER: &str = "transcripts";
const LEGACY_STORAGE_FOLDER: &str = "transcripciones";

/// Prefix of the WAV files. It is not decoration: the filename stem *is* the id
/// of a recording, both here and in the frontend.
pub const RECORDING_PREFIX: &str = "recording-";
const LEGACY_RECORDING_PREFIX: &str = "grabacion-";

/// The linked vault, if there is one.
fn vault_path(settings: &Settings) -> Option<&str> {
    settings
        .obsidian_vault_path
        .as_deref()
        .map(str::trim)
        .filter(|vault| !vault.is_empty())
}

/// Root of audio and notes. With Obsidian linked it is a subfolder of the
/// vault, not the whole vault: that keeps the notes from being mixed in with
/// the rest of it.
fn storage_root(app: &AppHandle, settings: &Settings) -> PathBuf {
    match vault_path(settings) {
        Some(vault) => PathBuf::from(vault).join(STORAGE_FOLDER),
        None => default_root(app),
    }
}

fn audio_dir(app: &AppHandle, settings: &Settings) -> PathBuf {
    storage_root(app, settings).join("audio")
}

/// Sibling of `audio/`, holding the screenshots taken during a recording.
const ATTACHMENTS_FOLDER: &str = "attachments";

fn attachments_dir(app: &AppHandle, settings: &Settings) -> PathBuf {
    storage_root(app, settings).join(ATTACHMENTS_FOLDER)
}

/// Folders used by earlier versions. They are still read so the history does
/// not empty out on upgrade or when a vault is linked — including the case
/// where `migrate_legacy_names` could not rename the vault folder, because
/// something was already sitting in the way.
fn legacy_audio_dirs(app: &AppHandle, settings: &Settings) -> Vec<PathBuf> {
    let base = default_root(app);
    let mut dirs = vec![base.join("grabaciones"), base];
    if let Some(vault) = vault_path(settings) {
        dirs.push(
            PathBuf::from(vault)
                .join(LEGACY_STORAGE_FOLDER)
                .join("audio"),
        );
    }
    dirs
}

/// Rejects path separators so a recording id can never escape its directory.
fn safe_id(recording_id: &str) -> Result<&str, String> {
    let bad = recording_id.is_empty()
        || recording_id.contains('/')
        || recording_id.contains('\\')
        || recording_id.contains("..");
    if bad {
        return Err(errors::with(errors::STORAGE_INVALID_ID, recording_id));
    }
    Ok(recording_id)
}

/// The frontend decides what notes are called (`2026/2026-08-08-title.md`);
/// here we only check that the path stays inside the root.
fn safe_rel_path(rel: &str) -> Result<PathBuf, String> {
    let candidate = Path::new(rel);
    let ok = !rel.is_empty()
        && !candidate.is_absolute()
        && candidate
            .components()
            .all(|c| matches!(c, Component::Normal(_)));
    if !ok {
        return Err(errors::with(errors::STORAGE_INVALID_PATH, rel));
    }
    Ok(candidate.to_path_buf())
}

fn default_settings() -> Settings {
    Settings {
        // Empty means "never chosen": the frontend falls back to the system
        // language rather than forcing one.
        language: String::new(),
        obsidian_vault_path: None,
        // Filled in by `load_settings`, which is what knows the real path.
        storage_root: String::new(),
        default_source_id: String::new(),
        transcript_format: "Obsidian".to_string(),
        transcription_service: "local".to_string(),
        whisper_model: crate::transcription::DEFAULT_MODEL.to_string(),
        // Empty means "never chosen": the interface language decides.
        audio_language: String::new(),
        eleven_labs_api_key: String::new(),
        deepgram_api_key: String::new(),
    }
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<Settings, String> {
    let path = config_dir(&app)?.join("settings.json");
    let mut settings: Settings = match fs::read_to_string(&path) {
        Ok(raw) => {
            serde_json::from_str(&raw).map_err(|e| errors::with(errors::STORAGE_READ, e))?
        }
        // No settings file yet (first launch) — hand back the defaults.
        Err(_) => default_settings(),
    };
    // Derived field: the vault decides, not whatever was saved to disk.
    settings.storage_root = storage_root(&app, &settings).to_string_lossy().into_owned();
    Ok(settings)
}

/// Returns the settings already reloaded: `storageRoot` changes when a vault is
/// linked, and the frontend displays it, so it has to get it back.
#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<Settings, String> {
    let path = config_dir(&app)?.join("settings.json");
    let json =
        serde_json::to_string_pretty(&settings).map_err(|e| errors::with(errors::STORAGE_WRITE, e))?;
    fs::write(path, json).map_err(|e| errors::with(errors::STORAGE_WRITE, e))?;
    // The folder may have changed: the player needs to be able to see it.
    allow_storage_root(&app);
    load_settings(app)
}

/// The history *is* the audio folder: every `X.wav` is an entry, and the
/// `X.json` next to it holds the title, date, duration and tags. There is no
/// central index, so copying the folder is enough to take the whole history.
#[tauri::command]
pub fn list_recordings(app: AppHandle) -> Result<Vec<Recording>, String> {
    let settings = load_settings(app.clone())?;

    let mut dirs = vec![audio_dir(&app, &settings)];
    dirs.extend(legacy_audio_dirs(&app, &settings));

    let mut recordings = Vec::new();
    let mut seen = HashSet::new();
    for dir in dirs {
        collect_recordings(&dir, &mut recordings, &mut seen);
    }

    // The name carries the timestamp, so reverse alphabetical order puts the
    // most recent ones on top.
    recordings.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(recordings)
}

/// Adds the recordings in `dir` to `out`. A folder that does not exist is not
/// an error: the legacy ones are only there if that version was ever used.
fn collect_recordings(dir: &Path, out: &mut Vec<Recording>, seen: &mut HashSet<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("wav") {
            continue;
        }
        let Some(id) = path.file_stem().and_then(|n| n.to_str()) else {
            continue;
        };
        // The new folder wins: if a recording was copied to both, the one in
        // `audio/` is the one in use.
        if !seen.insert(id.to_string()) {
            continue;
        }

        // A missing or corrupt .json must not hide the recording: the audio
        // exists, so it is shown with whatever can be inferred from the file.
        let mut recording = fs::read_to_string(dir.join(format!("{id}.json")))
            .ok()
            .and_then(|raw| serde_json::from_str::<Recording>(&raw).ok())
            .unwrap_or_else(|| Recording {
                id: id.to_string(),
                title: id.to_string(),
                started_at: String::new(),
                duration_sec: wav_duration_sec(&path),
                audio_path: None,
                transcript_path: None,
                tags: None,
                engine: None,
            });
        // The right path is the file we just found; the stored one goes stale
        // as soon as the folder moves.
        recording.audio_path = Some(path.to_string_lossy().into_owned());
        out.push(recording);
    }
}

/// Duration read from the WAV header alone, for recordings that ended up
/// without metadata.
fn wav_duration_sec(path: &Path) -> u64 {
    hound::WavReader::open(path)
        .map(|r| {
            let rate = r.spec().sample_rate.max(1) as u64;
            r.duration() as u64 / rate
        })
        .unwrap_or(0)
}

/// The metadata sits next to the WAV, which may still be in a legacy folder.
fn metadata_path(app: &AppHandle, settings: &Settings, recording: &Recording) -> PathBuf {
    let name = format!("{}.json", recording.id);
    recording
        .audio_path
        .as_deref()
        .map(Path::new)
        .and_then(|p| p.parent())
        .map(|dir| dir.join(&name))
        .unwrap_or_else(|| audio_dir(app, settings).join(&name))
}

#[tauri::command]
pub fn save_recording(app: AppHandle, recording: Recording) -> Result<(), String> {
    let _ = safe_id(&recording.id)?;
    let settings = load_settings(app.clone())?;

    let path = metadata_path(&app, &settings, &recording);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| errors::with(errors::STORAGE_WRITE, e))?;
    }
    let json = serde_json::to_string_pretty(&recording)
        .map_err(|e| errors::with(errors::STORAGE_WRITE, e))?;
    fs::write(path, json).map_err(|e| errors::with(errors::STORAGE_WRITE, e))
}

#[tauri::command]
pub fn load_transcript(app: AppHandle, recording_id: String) -> Result<Option<Transcript>, String> {
    let id = safe_id(&recording_id)?;
    let path = sidecar_dir(&app)?.join(format!("{id}.json"));
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|e| errors::with(errors::STORAGE_READ, e)),
        Err(_) => Ok(None),
    }
}

/// Writes the already-serialized transcript body, plus the JSON sidecar.
/// `rel_path` comes from the frontend (`2026/2026-08-08-title.md`) and is
/// resolved against the root. Returns the absolute path of the note written.
#[tauri::command]
pub fn write_transcript(
    app: AppHandle,
    recording_id: String,
    contents: String,
    rel_path: String,
    transcript: Transcript,
) -> Result<String, String> {
    let id = safe_id(&recording_id)?;
    let rel = safe_rel_path(&rel_path)?;

    let sidecar = sidecar_dir(&app)?.join(format!("{id}.json"));
    let json = serde_json::to_string_pretty(&transcript)
        .map_err(|e| errors::with(errors::STORAGE_WRITE, e))?;
    fs::write(sidecar, json).map_err(|e| errors::with(errors::STORAGE_WRITE, e))?;

    let settings = load_settings(app.clone())?;
    let out = storage_root(&app, &settings).join(rel);
    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent).map_err(|e| errors::with(errors::STORAGE_WRITE, e))?;
    }
    fs::write(&out, contents).map_err(|e| errors::with(errors::STORAGE_WRITE, e))?;
    Ok(out.to_string_lossy().into_owned())
}

/// Persists only the notes, in the JSON sidecar: no note body, and no path from
/// the frontend. It is called while a recording is still running, when there is
/// no title yet to name a note after — and a screenshot has to be safe on disk
/// the moment it is taken, not whenever transcription happens to run.
#[tauri::command]
pub fn write_notes(app: AppHandle, recording_id: String, notes: Vec<Note>) -> Result<(), String> {
    let id = safe_id(&recording_id)?;
    let path = sidecar_dir(&app)?.join(format!("{id}.json"));
    let existing = fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok());

    let transcript = merged_notes(existing, &recording_id, notes);
    let json = serde_json::to_string_pretty(&transcript)
        .map_err(|e| errors::with(errors::STORAGE_WRITE, e))?;
    fs::write(path, json).map_err(|e| errors::with(errors::STORAGE_WRITE, e))
}

/// Keeps whatever was transcribed earlier. Notes and entries arrive from
/// different places at different times, so replacing the whole file with the
/// note list would wipe a transcript that is already there.
fn merged_notes(
    existing: Option<Transcript>,
    recording_id: &str,
    notes: Vec<Note>,
) -> Transcript {
    Transcript {
        recording_id: recording_id.to_string(),
        entries: existing.map(|t| t.entries).unwrap_or_default(),
        notes,
    }
}

/// Writes an annotated screenshot into `attachments/` and returns the filename
/// it was given. The name and not the path: it is what the note embeds, and
/// Obsidian resolves `![[…]]` by filename across the whole vault.
#[tauri::command]
pub fn save_screenshot(
    app: AppHandle,
    recording_id: String,
    png_base64: String,
) -> Result<String, String> {
    let id = safe_id(&recording_id)?;
    let bytes = crate::capture::decode_base64(&png_base64)?;

    let settings = load_settings(app.clone())?;
    let dir = attachments_dir(&app, &settings);
    fs::create_dir_all(&dir).map_err(|e| errors::with(errors::STORAGE_WRITE, e))?;

    let name = next_screenshot_name(&dir, id);
    fs::write(dir.join(&name), bytes).map_err(|e| errors::with(errors::STORAGE_WRITE, e))?;
    Ok(name)
}

/// Reads an attachment back as base64, so it can be annotated again.
///
/// It does not travel over `asset://` like the thumbnails do: that is a
/// different origin, and a canvas that drew a cross-origin image can no longer
/// be exported. A `data:` URL keeps the editor able to save what it produced.
#[tauri::command]
pub fn read_screenshot(app: AppHandle, file_name: String) -> Result<String, String> {
    let name = safe_attachment_name(&file_name)?;
    let settings = load_settings(app.clone())?;
    let path = attachments_dir(&app, &settings).join(name);
    let bytes = fs::read(&path).map_err(|e| errors::with(errors::STORAGE_READ, e))?;
    Ok(crate::capture::encode_base64(&bytes))
}

/// Overwrites an attachment that already exists, keeping its name.
///
/// Re-annotating a screenshot must not produce a second file: the name is
/// already written into the note as `![[…]]`, and into the sidecar, so a new one
/// would leave the note pointing at the version before the edit.
#[tauri::command]
pub fn replace_screenshot(
    app: AppHandle,
    file_name: String,
    png_base64: String,
) -> Result<(), String> {
    let name = safe_attachment_name(&file_name)?;
    let bytes = crate::capture::decode_base64(&png_base64)?;

    let settings = load_settings(app.clone())?;
    let path = attachments_dir(&app, &settings).join(name);
    if !path.exists() {
        return Err(errors::with(errors::STORAGE_NOT_FOUND, name));
    }
    fs::write(&path, bytes).map_err(|e| errors::with(errors::STORAGE_WRITE, e))
}

/// A bare filename inside `attachments/`, never a path. The frontend only ever
/// holds the name it was given by `save_screenshot`, so anything with a
/// separator in it is not something we handed out.
fn safe_attachment_name(file_name: &str) -> Result<&str, String> {
    let bad = file_name.is_empty()
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name.contains("..")
        || !file_name.ends_with(".png");
    if bad {
        return Err(errors::with(errors::STORAGE_INVALID_PATH, file_name));
    }
    Ok(file_name)
}

/// First free `{id}-shot-NN.png`. The recording id is part of the name because
/// the embed resolves by filename vault-wide, so a bare `shot-01.png` would
/// collide with whatever the user already has. The directory is scanned rather
/// than the note list counted: a name that is taken must never be reused, even
/// if the note that claimed it is gone.
fn next_screenshot_name(dir: &Path, recording_id: &str) -> String {
    for n in 1..1000u32 {
        let name = format!("{recording_id}-shot-{n:02}.png");
        if !dir.join(&name).exists() {
            return name;
        }
    }
    format!("{recording_id}-shot-{}.png", timestamp_suffix())
}

/// Deletes every screenshot of a recording. Scanned off disk instead of read
/// from the transcript: one saved in a session that never got as far as writing
/// its notes would otherwise sit in the vault forever.
fn remove_screenshots(dir: &Path, recording_id: &str) {
    let prefix = format!("{recording_id}-shot-");
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        if name.starts_with(&prefix) && name.ends_with(".png") {
            let _ = fs::remove_file(entry.path());
        }
    }
}

/// Only reached if a recording somehow has a thousand screenshots: the point is
/// that the command returns a usable name rather than failing.
fn timestamp_suffix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Deletes a recording: audio, metadata, note and structured JSON.
#[tauri::command]
pub fn delete_recording(app: AppHandle, recording_id: String) -> Result<(), String> {
    let id = safe_id(&recording_id)?;
    let settings = load_settings(app.clone())?;
    let recording = list_recordings(app.clone())?
        .into_iter()
        .find(|r| r.id == recording_id);

    if let Some(recording) = &recording {
        // The stored paths win: that way the file is deleted where it actually
        // lives, even if that is a legacy folder.
        if let Some(audio) = &recording.audio_path {
            let _ = fs::remove_file(audio);
        }
        let _ = fs::remove_file(metadata_path(&app, &settings, recording));
        if let Some(note) = &recording.transcript_path {
            let _ = fs::remove_file(note);
        }
    }

    let sidecar = sidecar_dir(&app)?.join(format!("{id}.json"));
    let _ = fs::remove_file(sidecar);

    remove_screenshots(&attachments_dir(&app, &settings), id);

    Ok(())
}

/// Renames a recording. The note carries the title in its filename, so it has
/// to be moved: otherwise Obsidian keeps the old name and the next transcript
/// would create a duplicate note beside it.
#[tauri::command]
pub fn rename_recording(
    app: AppHandle,
    recording_id: String,
    new_title: String,
    new_rel_path: String,
) -> Result<(), String> {
    let _ = safe_id(&recording_id)?;
    let settings = load_settings(app.clone())?;

    let mut recording = list_recordings(app.clone())?
        .into_iter()
        .find(|r| r.id == recording_id)
        .ok_or_else(|| errors::STORAGE_NOT_FOUND.to_string())?;
    recording.title = new_title;

    if let Some(old) = recording.transcript_path.clone() {
        let old_path = PathBuf::from(&old);
        let dest = storage_root(&app, &settings).join(safe_rel_path(&new_rel_path)?);
        if old_path.exists() && old_path != dest {
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent).map_err(|e| errors::with(errors::STORAGE_WRITE, e))?;
            }
            fs::rename(&old_path, &dest).map_err(|e| errors::with(errors::STORAGE_WRITE, e))?;
            recording.transcript_path = Some(dest.to_string_lossy().into_owned());
        }
    }

    let path = metadata_path(&app, &settings, &recording);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| errors::with(errors::STORAGE_WRITE, e))?;
    }
    let json = serde_json::to_string_pretty(&recording)
        .map_err(|e| errors::with(errors::STORAGE_WRITE, e))?;
    fs::write(path, json).map_err(|e| errors::with(errors::STORAGE_WRITE, e))
}

/// Folder where the recorder drops the WAV. It is the only one created ahead of
/// time, because WASAPI needs the file open from the very first packet.
pub fn recording_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let settings = load_settings(app.clone())?;
    let dir = audio_dir(app, &settings);
    fs::create_dir_all(&dir).map_err(|e| errors::with(errors::AUDIO_CREATE_DIR, e))?;
    Ok(dir)
}

/// Opens the audio and attachment folders up to the `asset://` protocol, so the
/// player can request the WAV over the internal HTTP server (with Range support,
/// and without loading the whole thing into memory the way a data URL would) and
/// the notes list can show its screenshots.
///
/// The static scope in `tauri.conf.json` only covers $HOME and $DOCUMENT; the
/// vault can live on any drive, so it is widened at runtime.
pub fn allow_storage_root(app: &AppHandle) {
    let Ok(settings) = load_settings(app.clone()) else {
        return;
    };
    let scope = app.asset_protocol_scope();
    let _ = scope.allow_directory(audio_dir(app, &settings), false);
    let _ = scope.allow_directory(attachments_dir(app, &settings), false);
    for dir in legacy_audio_dirs(app, &settings) {
        let _ = scope.allow_directory(dir, false);
    }
}

// ------------------------------------------------------------------ migration

/// One-off rename of the Spanish names the first versions wrote to disk: the
/// `transcripciones/` folder inside the vault, and the `grabacion-` prefix of
/// every WAV.
///
/// The prefix is not cosmetic — the filename stem *is* the id of a recording —
/// so renaming a WAV drags along its metadata, its structured transcript and
/// the `![[…]]` embed inside the Obsidian note. All of that moves together here.
///
/// Nothing is ever deleted, and anything that would overwrite an existing file
/// is skipped and left readable through `legacy_audio_dirs`. Running it twice
/// is a no-op, so it is safe on every startup.
pub fn migrate_legacy_names(app: &AppHandle) {
    let Ok(settings) = load_settings(app.clone()) else {
        return;
    };

    if let Some(vault) = vault_path(&settings) {
        rename_vault_folder(Path::new(vault));
    }

    let Ok(sidecars) = sidecar_dir(app) else {
        return;
    };

    // `audio_dir` already points at the renamed folder: only the constant
    // changed, and the rename above made the disk match it.
    let mut dirs = vec![audio_dir(app, &settings)];
    dirs.extend(legacy_audio_dirs(app, &settings));
    for dir in dirs {
        migrate_audio_dir(&dir, &sidecars);
    }
}

/// Renames `{vault}/transcripciones` to `{vault}/transcripts`.
///
/// Obsidian resolves `![[name]]` by filename across the whole vault, so moving
/// the folder does not break the audio embeds in notes that already exist.
fn rename_vault_folder(vault: &Path) -> bool {
    let old = vault.join(LEGACY_STORAGE_FOLDER);
    let new = vault.join(STORAGE_FOLDER);
    if !old.is_dir() || new.exists() {
        return false;
    }
    fs::rename(&old, &new).is_ok()
}

/// Migrates every `grabacion-*.wav` in `dir`, and returns how many moved.
fn migrate_audio_dir(dir: &Path, sidecars: &Path) -> usize {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    // Collected up front: renaming files while the directory iterator is still
    // open is not something to rely on.
    let stems: Vec<String> = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|e| e.to_str()) == Some("wav"))
        .filter_map(|path| path.file_stem().and_then(|s| s.to_str()).map(str::to_owned))
        .filter(|stem| stem.starts_with(LEGACY_RECORDING_PREFIX))
        .collect();

    stems
        .iter()
        .filter(|stem| migrate_recording(dir, sidecars, stem))
        .count()
}

/// Migrates one recording and everything keyed to its id. Returns false when
/// something was in the way, in which case the recording is left exactly as it
/// was rather than half-renamed.
///
/// Screenshots are deliberately not handled: a `grabacion-` recording only
/// exists if it predates the rename, and screenshots came later, so no such
/// file can exist. Anything named after a recording id that ships *after* this
/// point does belong here.
fn migrate_recording(dir: &Path, sidecars: &Path, old_stem: &str) -> bool {
    let new_stem = format!(
        "{RECORDING_PREFIX}{}",
        &old_stem[LEGACY_RECORDING_PREFIX.len()..]
    );

    let old_wav = dir.join(format!("{old_stem}.wav"));
    let new_wav = dir.join(format!("{new_stem}.wav"));
    if new_wav.exists() {
        return false;
    }

    // Read before renaming anything: this is what says where the note lives.
    let old_meta = dir.join(format!("{old_stem}.json"));
    let recording: Option<Recording> = fs::read_to_string(&old_meta)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok());

    if fs::rename(&old_wav, &new_wav).is_err() {
        return false;
    }

    // Moved whether or not it parsed: metadata left behind under the old name
    // would be orphaned, since the history looks it up as `{id}.json`.
    let new_meta = dir.join(format!("{new_stem}.json"));
    if old_meta.exists() && !new_meta.exists() {
        let _ = fs::rename(&old_meta, &new_meta);
    }

    if let Some(mut recording) = recording {
        if let Some(note) = recording.transcript_path.as_deref() {
            rewrite_note_audio_link(Path::new(note), old_stem, &new_stem);
        }
        recording.id = new_stem.clone();
        recording.audio_path = Some(new_wav.to_string_lossy().into_owned());
        // Rewritten in place over the file just renamed: no path in this
        // function ever deletes anything.
        if let Ok(json) = serde_json::to_string_pretty(&recording) {
            let _ = fs::write(&new_meta, json);
        }
    }

    // The structured transcript lives in the config folder, keyed by id.
    let old_sidecar = sidecars.join(format!("{old_stem}.json"));
    let new_sidecar = sidecars.join(format!("{new_stem}.json"));
    if old_sidecar.exists() && !new_sidecar.exists() {
        let _ = fs::rename(&old_sidecar, &new_sidecar);
    }

    true
}

/// Points the `![[…]]` embed and the `audio:` frontmatter of an existing note at
/// the renamed WAV.
///
/// A surgical replacement of the filename and nothing else: the note is a
/// document the user may well have edited by hand since it was written.
fn rewrite_note_audio_link(note: &Path, old_stem: &str, new_stem: &str) {
    let Ok(body) = fs::read_to_string(note) else {
        return;
    };
    let updated = body.replace(&format!("{old_stem}.wav"), &format!("{new_stem}.wav"));
    if updated != body {
        let _ = fs::write(note, updated);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_relative_path_cannot_escape_the_root() {
        assert!(safe_rel_path("2026/2026-08-08-meeting.md").is_ok());
        assert!(safe_rel_path("").is_err());
        assert!(safe_rel_path("../outside.md").is_err());
        assert!(safe_rel_path("2026/../../outside.md").is_err());
        assert!(safe_rel_path("/absolute.md").is_err());
    }

    /// Errors leaving a command must be keys the frontend can translate, not
    /// prose: a raw message would reach a Spanish user in English.
    #[test]
    fn errors_travel_as_keys() {
        let id = safe_id("../escape").expect_err("should be rejected");
        assert!(id.starts_with("err."), "got: {id}");
        let rel = safe_rel_path("/absolute.md").expect_err("should be rejected");
        assert!(rel.starts_with("err."), "got: {rel}");
    }

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("cereales-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("scratch dir");
        dir
    }

    /// Writes a recording in the pre-migration layout and returns
    /// (audio dir, sidecar dir, note path).
    fn seed_legacy(root: &Path, stem: &str) -> (PathBuf, PathBuf, PathBuf) {
        let audio = root.join("audio");
        let sidecars = root.join("sidecars");
        let notes = root.join("2026");
        for dir in [&audio, &sidecars, &notes] {
            fs::create_dir_all(dir).expect("dirs");
        }

        let note = notes.join("2026-08-08-meeting.md");
        fs::write(&audio.join(format!("{stem}.wav")), b"RIFF").expect("wav");
        fs::write(
            &sidecars.join(format!("{stem}.json")),
            r#"{"recordingId":"x","entries":[],"notes":[]}"#,
        )
        .expect("sidecar");
        fs::write(
            &note,
            format!("---\naudio: \"audio/{stem}.wav\"\n---\n\n![[{stem}.wav]]\n\nMy own edits.\n"),
        )
        .expect("note");

        let recording = Recording {
            id: stem.to_string(),
            title: "Meeting".to_string(),
            started_at: "2026-08-08T09:00:00.000Z".to_string(),
            duration_sec: 60,
            audio_path: Some(audio.join(format!("{stem}.wav")).to_string_lossy().into_owned()),
            transcript_path: Some(note.to_string_lossy().into_owned()),
            tags: None,
            engine: None,
        };
        fs::write(
            audio.join(format!("{stem}.json")),
            serde_json::to_string_pretty(&recording).expect("metadata"),
        )
        .expect("metadata");

        (audio, sidecars, note)
    }

    /// The whole chain has to move together: WAV, metadata, id, structured
    /// transcript and the embed inside the Obsidian note. Leaving any one of
    /// them behind orphans the recording.
    #[test]
    fn the_migration_renames_a_recording_and_everything_keyed_to_it() {
        let root = scratch("migrate");
        let (audio, sidecars, note) = seed_legacy(&root, "grabacion-1");

        assert_eq!(migrate_audio_dir(&audio, &sidecars), 1);

        assert!(audio.join("recording-1.wav").exists(), "the WAV moved");
        assert!(!audio.join("grabacion-1.wav").exists(), "no leftover WAV");
        assert!(sidecars.join("recording-1.json").exists(), "sidecar moved");
        assert!(!sidecars.join("grabacion-1.json").exists());

        let raw = fs::read_to_string(audio.join("recording-1.json")).expect("metadata");
        let migrated: Recording = serde_json::from_str(&raw).expect("valid metadata");
        assert_eq!(migrated.id, "recording-1", "the id follows the filename");
        assert!(migrated.audio_path.unwrap().ends_with("recording-1.wav"));

        let body = fs::read_to_string(&note).expect("note");
        assert!(body.contains("![[recording-1.wav]]"), "embed repointed: {body}");
        assert!(body.contains("audio: \"audio/recording-1.wav\""), "got: {body}");
        assert!(!body.contains("grabacion-1"), "no stale reference: {body}");
        assert!(body.contains("My own edits."), "the rest of the note is untouched");

        let _ = fs::remove_dir_all(&root);
    }

    /// It runs on every startup, so a second pass must do nothing — and a name
    /// already taken must never be overwritten.
    #[test]
    fn the_migration_is_idempotent_and_never_overwrites() {
        let root = scratch("migrate-twice");
        let (audio, sidecars, _) = seed_legacy(&root, "grabacion-1");

        assert_eq!(migrate_audio_dir(&audio, &sidecars), 1);
        assert_eq!(migrate_audio_dir(&audio, &sidecars), 0, "nothing left to do");

        // A destination that already exists: the old file stays put rather than
        // being clobbered, and remains readable through the legacy folders.
        fs::write(audio.join("grabacion-2.wav"), b"old").expect("wav");
        fs::write(audio.join("recording-2.wav"), b"new").expect("wav");
        assert_eq!(migrate_audio_dir(&audio, &sidecars), 0, "conflict is skipped");
        assert_eq!(fs::read(audio.join("grabacion-2.wav")).unwrap(), b"old");
        assert_eq!(fs::read(audio.join("recording-2.wav")).unwrap(), b"new");

        let _ = fs::remove_dir_all(&root);
    }

    /// Metadata that will not parse still has to travel with its WAV: the
    /// history looks it up as `{id}.json`, so leaving it behind orphans it.
    #[test]
    fn the_migration_moves_metadata_it_cannot_parse() {
        let root = scratch("migrate-corrupt");
        let (audio, sidecars, _) = seed_legacy(&root, "grabacion-1");
        fs::write(audio.join("grabacion-1.json"), "{ not json").expect("metadata");

        assert_eq!(migrate_audio_dir(&audio, &sidecars), 1);

        assert!(audio.join("recording-1.wav").exists());
        assert!(audio.join("recording-1.json").exists(), "metadata followed");
        assert!(!audio.join("grabacion-1.json").exists(), "nothing orphaned");
        // Left untouched rather than "repaired" into something invented.
        assert_eq!(
            fs::read_to_string(audio.join("recording-1.json")).unwrap(),
            "{ not json"
        );

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn the_vault_folder_is_renamed_only_when_the_name_is_free() {
        let vault = scratch("vault");
        fs::create_dir_all(vault.join(LEGACY_STORAGE_FOLDER).join("audio")).expect("dirs");

        assert!(rename_vault_folder(&vault));
        assert!(vault.join(STORAGE_FOLDER).join("audio").is_dir());
        assert!(!vault.join(LEGACY_STORAGE_FOLDER).exists());

        // Second run, and the case where both exist: neither must be touched.
        assert!(!rename_vault_folder(&vault));
        fs::create_dir_all(vault.join(LEGACY_STORAGE_FOLDER)).expect("dirs");
        assert!(!rename_vault_folder(&vault), "an occupied name is left alone");
        assert!(vault.join(LEGACY_STORAGE_FOLDER).is_dir());

        let _ = fs::remove_dir_all(&vault);
    }

    /// Two screenshots of the same recording must never land on the same name,
    /// and the id has to be part of it: Obsidian resolves the embed by filename
    /// across the whole vault, so the name is shared with everything the user
    /// has stored there.
    #[test]
    fn a_screenshot_never_reuses_a_name() {
        let dir = scratch("shots");

        assert_eq!(next_screenshot_name(&dir, "recording-1"), "recording-1-shot-01.png");
        fs::write(dir.join("recording-1-shot-01.png"), b"PNG").expect("shot");
        assert_eq!(next_screenshot_name(&dir, "recording-1"), "recording-1-shot-02.png");

        // A gap is not filled in: the numbering follows what is on disk.
        fs::write(dir.join("recording-1-shot-02.png"), b"PNG").expect("shot");
        fs::write(dir.join("recording-1-shot-03.png"), b"PNG").expect("shot");
        assert_eq!(next_screenshot_name(&dir, "recording-1"), "recording-1-shot-04.png");

        // Another recording starts from scratch.
        assert_eq!(next_screenshot_name(&dir, "recording-2"), "recording-2-shot-01.png");

        let _ = fs::remove_dir_all(&dir);
    }

    /// The name travels to the frontend and comes back when a screenshot is
    /// re-annotated, so it is untrusted input by the time we see it again.
    #[test]
    fn an_attachment_name_cannot_escape_its_folder() {
        assert!(safe_attachment_name("recording-1-shot-01.png").is_ok());
        assert!(safe_attachment_name("").is_err());
        assert!(safe_attachment_name("../../secrets.png").is_err());
        assert!(safe_attachment_name("sub/shot.png").is_err());
        assert!(safe_attachment_name("shot.png\\..\\x.png").is_err());
        // Only ever PNGs: nothing else is written there.
        assert!(safe_attachment_name("settings.json").is_err());

        let message = safe_attachment_name("../x.png").expect_err("should be rejected");
        assert!(message.starts_with("err."), "got: {message}");
    }

    #[test]
    fn deleting_a_recording_takes_only_its_own_screenshots() {
        let dir = scratch("shots-delete");
        for name in [
            "recording-1-shot-01.png",
            "recording-1-shot-02.png",
            "recording-2-shot-01.png",
        ] {
            fs::write(dir.join(name), b"PNG").expect("shot");
        }
        // Nothing else in the folder is ours to remove.
        fs::write(dir.join("holiday.png"), b"PNG").expect("unrelated");

        remove_screenshots(&dir, "recording-1");

        assert!(!dir.join("recording-1-shot-01.png").exists());
        assert!(!dir.join("recording-1-shot-02.png").exists());
        assert!(dir.join("recording-2-shot-01.png").exists(), "another recording");
        assert!(dir.join("holiday.png").exists(), "not ours");

        let _ = fs::remove_dir_all(&dir);
    }

    /// Notes are written while a recording runs and entries only arrive when it
    /// is transcribed, so the merge has to keep whichever it did not receive.
    #[test]
    fn writing_notes_keeps_the_entries_already_on_disk() {
        let note = |id: &str| Note {
            id: id.to_string(),
            time_sec: 1.0,
            text: "note".to_string(),
            image: None,
        };

        let existing = Transcript {
            recording_id: "recording-1".to_string(),
            entries: vec![crate::model::TranscriptEntry {
                time_sec: 0.0,
                speaker: String::new(),
                text: "hello".to_string(),
            }],
            notes: vec![note("old")],
        };

        let merged = merged_notes(Some(existing), "recording-1", vec![note("a"), note("b")]);
        assert_eq!(merged.entries.len(), 1, "the transcript survives");
        assert_eq!(merged.notes.len(), 2, "the notes are replaced, not appended");

        // Nothing on disk yet: the first note of a recording still writes.
        let fresh = merged_notes(None, "recording-2", vec![note("a")]);
        assert_eq!(fresh.recording_id, "recording-2");
        assert!(fresh.entries.is_empty());
    }
}
