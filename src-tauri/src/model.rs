//! Wire types shared with the frontend. Field names must stay in sync with
//! `src/types.ts`; serde renames them to camelCase to match the TypeScript side.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AudioSource {
    pub id: String,
    pub label: String,
    /// One of the groups listed in `SOURCE_GROUPS` in `src/types.ts`.
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
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub recording_id: String,
    pub entries: Vec<TranscriptEntry>,
    pub notes: Vec<Note>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub recording_folder: String,
    pub transcript_folder: String,
    pub default_source_id: String,
    /// "TXT" | "Markdown" | "SRT"
    pub transcript_format: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StopResult {
    pub audio_path: String,
    pub duration_sec: u64,
}
