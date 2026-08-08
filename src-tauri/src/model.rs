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
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Transcript {
    pub recording_id: String,
    pub entries: Vec<TranscriptEntry>,
    pub notes: Vec<Note>,
}

/// Motor por defecto para un `settings.json` escrito antes de que existiera la
/// opción: transcribir en local es lo que hacía la app entonces.
fn default_transcription_service() -> String {
    "local".to_string()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub recording_folder: String,
    pub transcript_folder: String,
    #[serde(default)]
    pub obsidian_vault_path: Option<String>,
    pub default_source_id: String,
    /// "TXT" | "Markdown" | "SRT" | "Obsidian"
    pub transcript_format: String,
    /// "local" | "elevenlabs"
    #[serde(default = "default_transcription_service")]
    pub transcription_service: String,
    /// Vacío mientras no se configure. Se guarda en claro en el archivo de
    /// ajustes, igual que el resto de la configuración.
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

    /// Todo campo de `Settings` en TypeScript tiene que sobrevivir al viaje de
    /// ida y vuelta por Rust. Un campo que falte aquí no da error: serde ignora
    /// lo desconocido al deserializar y `save_settings` lo borra del archivo en
    /// silencio, así que el ajuste parece funcionar hasta que se reinicia.
    #[test]
    fn los_ajustes_sobreviven_la_ida_y_vuelta() {
        let json = r#"{
            "recordingFolder": "C:\\audio",
            "transcriptFolder": "C:\\texto",
            "obsidianVaultPath": "G:\\Mi unidad\\obsidian\\Personal",
            "defaultSourceId": "sys:default",
            "transcriptFormat": "Obsidian",
            "transcriptionService": "elevenlabs",
            "elevenLabsApiKey": "sk_secreto"
        }"#;

        let parsed: Settings = serde_json::from_str(json).expect("debería deserializar");
        assert_eq!(parsed.transcription_service, "elevenlabs");
        assert_eq!(parsed.eleven_labs_api_key, "sk_secreto");
        assert_eq!(parsed.obsidian_vault_path, Some("G:\\Mi unidad\\obsidian\\Personal".to_string()));

        let vuelta = serde_json::to_string(&parsed).expect("debería serializar");
        assert!(vuelta.contains("\"transcriptionService\":\"elevenlabs\""), "salió: {vuelta}");
        assert!(vuelta.contains("\"elevenLabsApiKey\":\"sk_secreto\""), "salió: {vuelta}");
        assert!(vuelta.contains("\"obsidianVaultPath\""), "salió: {vuelta}");
    }

    /// Un `settings.json` escrito antes de existir estos campos debe seguir
    /// cargando, no dejar la app sin ajustes.
    #[test]
    fn un_archivo_antiguo_recibe_valores_por_defecto() {
        let json = r#"{
            "recordingFolder": "C:\\audio",
            "transcriptFolder": "C:\\texto",
            "defaultSourceId": "",
            "transcriptFormat": "Markdown"
        }"#;

        let parsed: Settings = serde_json::from_str(json).expect("el formato antiguo debe cargar");
        assert_eq!(parsed.transcription_service, "local");
        assert_eq!(parsed.eleven_labs_api_key, "");
    }
}
