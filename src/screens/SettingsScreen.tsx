import { useEffect, useState } from 'react';
import { SourcePicker } from '@/components/SourcePicker';
import { useApp } from '@/state/store';
import { TRANSCRIPT_FORMATS } from '@/types';

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export function SettingsScreen() {
  const { settings, sources, model, modelBusy, progress, actions } = useApp();
  const defaultSourceLabel =
    sources.find((s) => s.id === settings.defaultSourceId)?.label ?? 'Sin fuente';

  // La clave se edita en borrador y solo se guarda al pulsar. Escribir letra a
  // letra contra los ajustes reescribiría el archivo y reconstruiría los
  // servicios en cada tecla, y además no habría forma de saber si quedó guardada.
  const [apiKeyDraft, setApiKeyDraft] = useState(settings.elevenLabsApiKey);

  // Los ajustes llegan de disco después del primer render: sin esto el borrador
  // se quedaría con el valor vacío inicial.
  useEffect(() => setApiKeyDraft(settings.elevenLabsApiKey), [settings.elevenLabsApiKey]);

  const apiKeyDirty = apiKeyDraft !== settings.elevenLabsApiKey;

  const saveApiKey = () => {
    if (apiKeyDirty) actions.updateSettings({ elevenLabsApiKey: apiKeyDraft.trim() });
  };

  const downloading = modelBusy && progress?.stage === 'descargando';
  const modelValue = modelBusy
    ? downloading && progress.percent >= 0
      ? `Descargando… ${progress.percent}%`
      : 'Descargando…'
    : model?.installed
      ? `${model.name} · ${formatBytes(model.bytes)}`
      : 'No descargado';

  return (
    <div className="screen screen--settings">
      <h1 className="screen-title">Ajustes</h1>
      <div className="rule" />

      <section className="settings-group">
        <h2 className="settings-group-label">Almacenamiento</h2>
        <div>
          <div className="setting-row">
            <div>
              <div className="setting-name">Carpeta de grabaciones</div>
              <div className="setting-value">{settings.recordingFolder}</div>
            </div>
            <button
              type="button"
              className="btn-outline"
              onClick={() => actions.pickFolder('recordingFolder')}
            >
              Cambiar
            </button>
          </div>
          <div className="setting-row">
            <div>
              <div className="setting-name">Carpeta de transcripciones</div>
              <div className="setting-value">{settings.transcriptFolder}</div>
            </div>
            <button
              type="button"
              className="btn-outline"
              onClick={() => actions.pickFolder('transcriptFolder')}
            >
              Cambiar
            </button>
          </div>
        </div>
      </section>

      <section className="settings-group">
        <h2 className="settings-group-label">Integración Obsidian</h2>
        <div className="setting-row">
          <div>
            <div className="setting-name">Vault de Obsidian</div>
            <div className="setting-value">
              {settings.obsidianVaultPath ?? 'No vinculado'}
            </div>
            <div className="setting-hint">
              Las transcripciones se guardarán en transcripciones/YYYY/ dentro de tu vault.
            </div>
          </div>
          {settings.obsidianVaultPath ? (
            <button
              type="button"
              className="btn-outline"
              onClick={() => actions.updateSettings({ obsidianVaultPath: null })}
            >
              Desvinvular
            </button>
          ) : (
            <button
              type="button"
              className="btn-outline"
              onClick={() => actions.pickFolder('obsidianVaultPath')}
            >
              Vincular
            </button>
          )}
        </div>
      </section>

      <section className="settings-group">
        <h2 className="settings-group-label">Audio</h2>
        <SourcePicker
          variant="row"
          sources={sources}
          selectedId={settings.defaultSourceId}
          onSelect={(sourceId) => actions.updateSettings({ defaultSourceId: sourceId })}
          label="Fuente de audio predeterminada"
          value={defaultSourceLabel}
        />
      </section>

      <section className="settings-group">
        <h2 className="settings-group-label">Servicio de transcripción</h2>
        <div className="segmented">
          <button
            type="button"
            className={`segmented-option${
              settings.transcriptionService === 'local' ? ' segmented-option--active' : ''
            }`}
            aria-pressed={settings.transcriptionService === 'local'}
            onClick={() => actions.updateSettings({ transcriptionService: 'local' })}
          >
            Local
          </button>
          <button
            type="button"
            className={`segmented-option${
              settings.transcriptionService === 'elevenlabs' ? ' segmented-option--active' : ''
            }`}
            aria-pressed={settings.transcriptionService === 'elevenlabs'}
            onClick={() => actions.updateSettings({ transcriptionService: 'elevenlabs' })}
          >
            ElevenLabs
          </button>
        </div>
        <div className="setting-hint">
          {settings.transcriptionService === 'local'
            ? 'La transcripción se hace en tu equipo: el audio no sale de la máquina.'
            : 'Usa la API de ElevenLabs para transcribir. Requiere una API key válida.'}
        </div>
      </section>

      {settings.transcriptionService === 'local' && (
        <section className="settings-group">
          <h2 className="settings-group-label">Modelo local (whisper.cpp)</h2>
          <div className="setting-row">
            <div>
              <div className="setting-name">Estado del modelo</div>
              <div className="setting-value">{modelValue}</div>
            </div>
            {!model?.installed && (
              <button
                type="button"
                className="btn-outline"
                disabled={modelBusy}
                onClick={actions.downloadModel}
              >
                {modelBusy ? 'Descargando…' : 'Descargar'}
              </button>
            )}
          </div>
          {downloading && progress.percent >= 0 && (
            <div className="progress-track" role="progressbar" aria-valuenow={progress.percent}>
              <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
            </div>
          )}
          <div className="setting-hint">
            El modelo pesa ~490 MB. Una vez descargado, no necesitas conexión a internet.
            El modelo no distingue hablantes, así que las líneas salen sin nombre.
          </div>
        </section>
      )}

      {settings.transcriptionService === 'elevenlabs' && (
        <section className="settings-group">
          <h2 className="settings-group-label">Configuración de ElevenLabs</h2>
          <div>
            <div className="setting-name">API Key</div>
            <div className="api-key-row">
              <input
                type="password"
                className="api-key-input"
                placeholder="sk_..."
                value={apiKeyDraft}
                onChange={(e) => setApiKeyDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveApiKey();
                  if (e.key === 'Escape') setApiKeyDraft(settings.elevenLabsApiKey);
                }}
              />
              <button
                type="button"
                className="btn-solid"
                disabled={!apiKeyDirty}
                onClick={saveApiKey}
              >
                Guardar
              </button>
            </div>
            <div className="setting-hint">
              {apiKeyDirty ? (
                <span className="setting-dirty">Sin guardar · Enter para guardar</span>
              ) : settings.elevenLabsApiKey ? (
                <span className="setting-saved">Clave guardada.</span>
              ) : (
                'Sin clave: la transcripción con ElevenLabs fallará.'
              )}{' '}
              Obtén la tuya en{' '}
              <a href="https://elevenlabs.io/app/api-keys" target="_blank" rel="noreferrer">
                elevenlabs.io/app/api-keys
              </a>
            </div>
          </div>
        </section>
      )}

      <section className="settings-group">
        <h2 className="settings-group-label">Formato de transcripción</h2>
        <div className="segmented">
          {TRANSCRIPT_FORMATS.map((format) => (
            <button
              key={format}
              type="button"
              className={`segmented-option${
                settings.transcriptFormat === format ? ' segmented-option--active' : ''
              }`}
              aria-pressed={settings.transcriptFormat === format}
              onClick={() => actions.setTranscriptFormat(format)}
            >
              {format}
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
