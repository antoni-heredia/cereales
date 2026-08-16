//! Wire types shared with the frontend. Field names must stay in sync with
//! `src/types.ts`; serde renames them to camelCase to match the TypeScript side.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioSource {
    pub id: String,
    /// Comes from the OS (device or process name); the UI shows it verbatim.
    pub label: String,
    /// One of the group keys listed in `SOURCE_GROUPS` in `src/types.ts`. It is
    /// a key, not a label: the frontend translates it.
    pub group: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Recording {
    pub id: String,
    pub title: String,
    /// ISO 8601, produced by the frontend when the recording starts.
    pub started_at: String,
    pub duration_sec: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transcript_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptEntry {
    pub time_sec: f64,
    pub speaker: String,
    pub text: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub time_sec: f64,
    pub text: String,
    /// Filename of the annotated PNG in `attachments/`, when the note is a
    /// screenshot. A name and not a path, because that is what `![[…]]`
    /// resolves and an absolute one would go stale as soon as the vault moves.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub recording_id: String,
    pub entries: Vec<TranscriptEntry>,
    pub notes: Vec<Note>,
}

/// Default engine for a `settings.json` written before the option existed:
/// transcribing locally is what the app did back then.
fn default_transcription_service() -> String {
    "local".to_string()
}

fn default_transcript_format() -> String {
    "Obsidian".to_string()
}

/// Default model for a `settings.json` written before the option existed:
/// `small` is the one those installs already have on disk.
fn default_whisper_model() -> String {
    crate::transcription::DEFAULT_MODEL.to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// "es" | "en", or empty when the user has never picked one — which is the
    /// state of every settings file written before this field existed. The
    /// frontend resolves an empty value against the system language.
    #[serde(default)]
    pub language: String,
    /// Obsidian vault. It is the only folder the user picks: when set, audio and
    /// notes live inside it. Without it, the documents folder is used.
    #[serde(default)]
    pub obsidian_vault_path: Option<String>,
    /// Derived, not configurable: the folder everything ends up in.
    /// `load_settings` recomputes it on every load, so whatever is on disk is
    /// irrelevant.
    #[serde(default)]
    pub storage_root: String,
    #[serde(default)]
    pub default_source_id: String,
    /// "TXT" | "Markdown" | "SRT" | "Obsidian"
    #[serde(default = "default_transcript_format")]
    pub transcript_format: String,
    /// "local" | "elevenlabs"
    #[serde(default = "default_transcription_service")]
    pub transcription_service: String,
    /// Language announced to the transcription engine: "es" | "en" | "auto", or
    /// empty to follow the interface language — which is what every settings
    /// file written before this option existed meant. Resolved in TypeScript by
    /// `resolveAudioLanguage`; Rust only stores it.
    #[serde(default)]
    pub audio_language: String,
    /// Id from the catalogue in `transcription.rs`: "tiny" | "base" | "small" |
    /// "medium" | "large-v3-turbo". Only meaningful with the local engine.
    #[serde(default = "default_whisper_model")]
    pub whisper_model: String,
    /// Empty until configured. Stored in the clear in the settings file, like
    /// the rest of the configuration.
    #[serde(default)]
    pub eleven_labs_api_key: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StopResult {
    pub audio_path: String,
    pub duration_sec: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every `Settings` field in TypeScript has to survive the round trip
    /// through Rust. A missing field here does not error: serde ignores unknown
    /// input when deserializing and `save_settings` silently drops it from the
    /// file, so the setting appears to work until the app restarts.
    #[test]
    fn settings_survive_the_round_trip() {
        let json = r#"{
            "language": "en",
            "obsidianVaultPath": "G:\\My Drive\\obsidian\\Personal",
            "defaultSourceId": "sys:default",
            "transcriptFormat": "Obsidian",
            "transcriptionService": "elevenlabs",
            "whisperModel": "large-v3-turbo",
            "audioLanguage": "auto",
            "elevenLabsApiKey": "sk_secret"
        }"#;

        let parsed: Settings = serde_json::from_str(json).expect("should deserialize");
        assert_eq!(parsed.language, "en");
        assert_eq!(parsed.transcription_service, "elevenlabs");
        assert_eq!(parsed.whisper_model, "large-v3-turbo");
        assert_eq!(parsed.audio_language, "auto");
        assert_eq!(parsed.eleven_labs_api_key, "sk_secret");
        assert_eq!(
            parsed.obsidian_vault_path,
            Some("G:\\My Drive\\obsidian\\Personal".to_string())
        );

        let back = serde_json::to_string(&parsed).expect("should serialize");
        assert!(back.contains("\"language\":\"en\""), "got: {back}");
        assert!(
            back.contains("\"transcriptionService\":\"elevenlabs\""),
            "got: {back}"
        );
        assert!(back.contains("\"elevenLabsApiKey\":\"sk_secret\""), "got: {back}");
        assert!(
            back.contains("\"whisperModel\":\"large-v3-turbo\""),
            "got: {back}"
        );
        assert!(back.contains("\"audioLanguage\":\"auto\""), "got: {back}");
        assert!(back.contains("\"obsidianVaultPath\""), "got: {back}");
    }

    /// A `settings.json` from an earlier version (with the two folders that no
    /// longer exist, and no language) must still load rather than leaving the
    /// app with no settings at all.
    #[test]
    fn an_old_file_gets_defaults() {
        let json = r#"{
            "recordingFolder": "C:\\audio",
            "transcriptFolder": "C:\\text",
            "defaultSourceId": "",
            "transcriptFormat": "Markdown"
        }"#;

        let parsed: Settings = serde_json::from_str(json).expect("the old format must load");
        assert_eq!(parsed.transcription_service, "local");
        assert_eq!(parsed.eleven_labs_api_key, "");
        // The model those installs already downloaded: no forced re-download.
        assert_eq!(parsed.whisper_model, "small");
        // Empty, not "auto": the interface language keeps deciding, which is how
        // those installs already transcribed.
        assert_eq!(parsed.audio_language, "");
        assert_eq!(parsed.obsidian_vault_path, None);
        // Empty, not "en": the frontend must be free to fall back to the system
        // language instead of flipping an existing user to English.
        assert_eq!(parsed.language, "");
        // The format chosen back then is honoured; only absent fields fall back
        // to their default.
        assert_eq!(parsed.transcript_format, "Markdown");
    }

    /// Every sidecar already on disk was written before screenshots existed.
    /// They have to keep loading, and a plain text note has to keep serializing
    /// exactly as it did, so re-saving one does not rewrite the whole file.
    #[test]
    fn a_note_without_an_image_is_unchanged() {
        let json = r#"{"id":"note-1","timeSec":12.5,"text":"no picture"}"#;

        let parsed: Note = serde_json::from_str(json).expect("an old note must load");
        assert_eq!(parsed.image, None);

        let back = serde_json::to_string(&parsed).expect("should serialize");
        assert!(!back.contains("image"), "got: {back}");
    }

    #[test]
    fn a_screenshot_note_carries_its_filename() {
        let json = r#"{"id":"n","timeSec":1,"text":"","image":"recording-1-shot-01.png"}"#;

        let parsed: Note = serde_json::from_str(json).expect("should deserialize");
        assert_eq!(parsed.image.as_deref(), Some("recording-1-shot-01.png"));

        let back = serde_json::to_string(&parsed).expect("should serialize");
        assert!(back.contains("\"image\":\"recording-1-shot-01.png\""), "got: {back}");
    }
}
