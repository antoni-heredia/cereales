import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { ModelPicker } from '@/components/ModelPicker';
import { SourcePicker } from '@/components/SourcePicker';
import { AUDIO_LANGUAGES, LANGUAGES, useI18n, type AudioLanguageSetting } from '@/i18n';
import { formatBytes } from '@/lib/format';
import { sourceLabel } from '@/lib/sources';
import { useApp } from '@/state/store';
import { TRANSCRIPT_FORMATS } from '@/types';

/**
 * Renders a message whose `{placeholders}` become `<code>` elements. The
 * message is looked up without params on purpose, so the placeholders survive
 * to here and the catalogue keeps one whole sentence per language instead of
 * three fragments to reassemble.
 */
function withCode(template: string, values: Record<string, string>): ReactNode {
  return template.split(/(\{\w+\})/).map((part, index) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return name && name in values ? (
      <code key={index}>{values[name]}</code>
    ) : (
      <Fragment key={index}>{part}</Fragment>
    );
  });
}

export function SettingsScreen() {
  const { settings, sources, model, models, modelBusy, progress, error, actions } = useApp();
  const { lang, t } = useI18n();

  const defaultSource = sources.find((s) => s.id === settings.defaultSourceId);
  const defaultSourceLabel = defaultSource ? sourceLabel(defaultSource, lang) : t('source.none');

  // The key is edited as a draft and only saved on commit. Writing it letter by
  // letter into the settings would rewrite the file and rebuild the services on
  // every keystroke, and there would be no way to tell whether it got saved.
  const [apiKeyDraft, setApiKeyDraft] = useState(settings.elevenLabsApiKey);

  // Settings arrive from disk after the first render: without this the draft
  // would keep the initial empty value.
  useEffect(() => setApiKeyDraft(settings.elevenLabsApiKey), [settings.elevenLabsApiKey]);

  const apiKeyDirty = apiKeyDraft !== settings.elevenLabsApiKey;

  const saveApiKey = () => {
    if (apiKeyDirty) actions.updateSettings({ elevenLabsApiKey: apiKeyDraft.trim() });
  };

  // Language names stay in their own language, like the interface selector;
  // only the two options that are not a language get translated.
  const audioLanguageLabel = (code: AudioLanguageSetting): string => {
    if (code === '') return t('settings.audioLangInterface');
    if (code === 'auto') return t('settings.audioLangAuto');
    return LANGUAGES.find((l) => l.code === code)?.label ?? code;
  };

  // Deleting a model is one click away from freeing a gigabyte, so the button
  // asks first. Picking another model drops the pending confirmation.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  useEffect(() => setConfirmingDelete(false), [settings.whisperModel]);

  const downloading = modelBusy && progress?.stage === 'downloading';
  const modelValue = modelBusy
    ? downloading && progress.percent >= 0
      ? t('settings.modelDownloadingPercent', { percent: progress.percent })
      : t('settings.modelDownloading')
    : model?.installed
      ? `${model.name} · ${formatBytes(model.bytes)}`
      : t('settings.modelMissing');

  return (
    <div className="screen screen--settings">
      <h1 className="screen-title">{t('settings.title')}</h1>
      <div className="rule" />

      {/* Downloading and deleting a model both fail from this screen, so it
          needs the same error card the other two have. */}
      {error && (
        <div className="error-card" role="alert" onClick={actions.dismissError}>
          {error}
        </div>
      )}

      <section className="settings-group">
        <h2 className="settings-group-label">{t('settings.languageGroup')}</h2>
        <div className="segmented">
          {LANGUAGES.map((option) => (
            <button
              key={option.code}
              type="button"
              className={`segmented-option${
                lang === option.code ? ' segmented-option--active' : ''
              }`}
              aria-pressed={lang === option.code}
              onClick={() => actions.updateSettings({ language: option.code })}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="setting-hint">{t('settings.languageHint')}</div>
      </section>

      <section className="settings-group">
        <h2 className="settings-group-label">{t('settings.storageGroup')}</h2>
        <div className="setting-row">
          <div>
            <div className="setting-name">{t('settings.vault')}</div>
            <div className="setting-value">
              {settings.obsidianVaultPath ?? t('settings.vaultUnlinked')}
            </div>
          </div>
          <button
            type="button"
            className="btn-outline"
            onClick={settings.obsidianVaultPath ? actions.unlinkVault : actions.pickVault}
          >
            {settings.obsidianVaultPath ? t('settings.vaultUnlink') : t('settings.vaultLink')}
          </button>
        </div>
        <div className="setting-hint">
          {withCode(t('settings.storageHint'), {
            root: settings.storageRoot,
            audio: 'audio/',
          })}
          {!settings.obsidianVaultPath && t('settings.storageHintLink')}
        </div>
      </section>

      <section className="settings-group">
        <h2 className="settings-group-label">{t('settings.audioGroup')}</h2>
        <SourcePicker
          variant="row"
          sources={sources}
          selectedId={settings.defaultSourceId}
          onSelect={(sourceId) => actions.updateSettings({ defaultSourceId: sourceId })}
          label={t('settings.defaultSource')}
          value={defaultSourceLabel}
        />
      </section>

      <section className="settings-group">
        <h2 className="settings-group-label">{t('settings.serviceGroup')}</h2>
        <div className="segmented">
          <button
            type="button"
            className={`segmented-option${
              settings.transcriptionService === 'local' ? ' segmented-option--active' : ''
            }`}
            aria-pressed={settings.transcriptionService === 'local'}
            onClick={() => actions.updateSettings({ transcriptionService: 'local' })}
          >
            {t('settings.serviceLocal')}
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
            ? t('settings.serviceLocalHint')
            : t('settings.serviceElevenLabsHint')}
        </div>
      </section>

      <section className="settings-group">
        <h2 className="settings-group-label">{t('settings.audioLangGroup')}</h2>
        <div className="segmented">
          {AUDIO_LANGUAGES.map((code) => (
            <button
              key={code || 'interface'}
              type="button"
              className={`segmented-option${
                settings.audioLanguage === code ? ' segmented-option--active' : ''
              }`}
              aria-pressed={settings.audioLanguage === code}
              onClick={() => actions.updateSettings({ audioLanguage: code })}
            >
              {audioLanguageLabel(code)}
            </button>
          ))}
        </div>
        <div className="setting-hint">{t('settings.audioLangHint')}</div>
      </section>

      {settings.transcriptionService === 'local' && (
        <section className="settings-group">
          <h2 className="settings-group-label">{t('settings.modelGroup')}</h2>
          <ModelPicker
            models={models}
            selectedId={settings.whisperModel}
            onSelect={(whisperModel) => actions.updateSettings({ whisperModel })}
            disabled={modelBusy}
            label={t('settings.modelSelect')}
          />
          <div className="setting-row">
            <div>
              <div className="setting-name">{t('settings.modelStatus')}</div>
              <div className="setting-value">{modelValue}</div>
            </div>
            {model?.installed ? (
              <button
                type="button"
                className="btn-outline"
                disabled={modelBusy}
                onClick={() => {
                  if (!confirmingDelete) return setConfirmingDelete(true);
                  setConfirmingDelete(false);
                  actions.deleteModel(model.id);
                }}
              >
                {confirmingDelete ? t('settings.modelDeleteConfirm') : t('settings.modelDelete')}
              </button>
            ) : (
              <button
                type="button"
                className="btn-outline"
                disabled={modelBusy}
                onClick={actions.downloadModel}
              >
                {modelBusy ? t('settings.modelDownloading') : t('settings.modelDownload')}
              </button>
            )}
          </div>
          {downloading && progress.percent >= 0 && (
            <div className="progress-track" role="progressbar" aria-valuenow={progress.percent}>
              <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
            </div>
          )}
          <div className="setting-hint">{t('settings.modelHint')}</div>
        </section>
      )}

      {settings.transcriptionService === 'elevenlabs' && (
        <section className="settings-group">
          <h2 className="settings-group-label">{t('settings.elevenLabsGroup')}</h2>
          <div>
            <div className="setting-name">{t('settings.apiKey')}</div>
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
                {t('settings.save')}
              </button>
            </div>
            <div className="setting-hint">
              {apiKeyDirty ? (
                <span className="setting-dirty">{t('settings.apiKeyDirty')}</span>
              ) : settings.elevenLabsApiKey ? (
                <span className="setting-saved">{t('settings.apiKeySaved')}</span>
              ) : (
                t('settings.apiKeyMissing')
              )}{' '}
              {t('settings.apiKeyGet')}{' '}
              <a href="https://elevenlabs.io/app/api-keys" target="_blank" rel="noreferrer">
                elevenlabs.io/app/api-keys
              </a>
            </div>
          </div>
        </section>
      )}

      <section className="settings-group">
        <h2 className="settings-group-label">{t('settings.formatGroup')}</h2>
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
