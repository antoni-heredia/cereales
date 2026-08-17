import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { ModelPicker } from '@/components/ModelPicker';
import { ServicePickerTabs } from '@/components/ServicePickerTabs';
import { SourcePicker } from '@/components/SourcePicker';
import {
  AUDIO_LANGUAGES,
  LANGUAGES,
  useI18n,
  type AudioLanguageSetting,
  type MessageKey,
} from '@/i18n';
import { formatBytes } from '@/lib/format';
import { sourceLabel } from '@/lib/sources';
import { useApp } from '@/state/store';
import { TRANSCRIPT_FORMATS, type TranscriptionEngine } from '@/types';

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

/** Hint describing what the chosen default engine actually does. */
const SERVICE_HINTS: Record<TranscriptionEngine, MessageKey> = {
  local: 'settings.serviceLocalHint',
  elevenlabs: 'settings.serviceElevenLabsHint',
  deepgram: 'settings.serviceDeepgramHint',
};

/**
 * The API key of one remote service.
 *
 * A component and not repeated markup because of the draft: the key is edited
 * locally and only saved on commit, since writing it letter by letter would
 * rewrite the settings file and rebuild the services on every keystroke, and
 * leave no moment where the user can tell it was saved.
 */
function ApiKeySection({
  title,
  saved,
  placeholder,
  href,
  linkText,
  onSave,
}: {
  title: string;
  saved: string;
  placeholder: string;
  href: string;
  linkText: string;
  onSave: (key: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(saved);

  // Settings arrive from disk after the first render: without this the draft
  // would keep the initial empty value.
  useEffect(() => setDraft(saved), [saved]);

  const dirty = draft !== saved;
  const commit = () => {
    if (dirty) onSave(draft.trim());
  };

  return (
    <section className="settings-group">
      <h2 className="settings-group-label">{title}</h2>
      <div>
        <div className="setting-name">{t('settings.apiKey')}</div>
        <div className="api-key-row">
          <input
            type="password"
            className="api-key-input"
            placeholder={placeholder}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setDraft(saved);
            }}
          />
          <button type="button" className="btn-solid" disabled={!dirty} onClick={commit}>
            {t('settings.save')}
          </button>
        </div>
        <div className="setting-hint">
          {dirty ? (
            <span className="setting-dirty">{t('settings.apiKeyDirty')}</span>
          ) : saved ? (
            <span className="setting-saved">{t('settings.apiKeySaved')}</span>
          ) : (
            t('settings.apiKeyMissing')
          )}{' '}
          {t('settings.apiKeyGet')}{' '}
          <a href={href} target="_blank" rel="noreferrer">
            {linkText}
          </a>
        </div>
      </div>
    </section>
  );
}

export function SettingsScreen() {
  const { settings, sources, model, models, modelBusy, progress, error, actions } = useApp();
  const { lang, t } = useI18n();

  const defaultSource = sources.find((s) => s.id === settings.defaultSourceId);
  const defaultSourceLabel = defaultSource ? sourceLabel(defaultSource, lang) : t('source.none');

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
        <ServicePickerTabs
          tabs={[
            {
              engine: 'local',
              hint: t(SERVICE_HINTS.local),
              content: (
                <>
                  <div>
                    <h3 className="setting-hint" style={{ marginBottom: '12px' }}>
                      {t('settings.modelGroup')}
                    </h3>
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
                          {confirmingDelete
                            ? t('settings.modelDeleteConfirm')
                            : t('settings.modelDelete')}
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
                      <div
                        className="progress-track"
                        role="progressbar"
                        aria-valuenow={progress.percent}
                      >
                        <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
                      </div>
                    )}
                    <div className="setting-hint">{t('settings.modelHint')}</div>
                  </div>
                </>
              ),
            },
            {
              engine: 'elevenlabs',
              hint: t(SERVICE_HINTS.elevenlabs),
              content: (
                <ApiKeySection
                  title={t('settings.elevenLabsGroup')}
                  saved={settings.elevenLabsApiKey}
                  placeholder="sk_..."
                  href="https://elevenlabs.io/app/api-keys"
                  linkText="elevenlabs.io/app/api-keys"
                  onSave={(elevenLabsApiKey) => actions.updateSettings({ elevenLabsApiKey })}
                />
              ),
            },
            {
              engine: 'deepgram',
              hint: t(SERVICE_HINTS.deepgram),
              content: (
                <ApiKeySection
                  title={t('settings.deepgramGroup')}
                  saved={settings.deepgramApiKey}
                  placeholder="Token…"
                  href="https://console.deepgram.com/"
                  linkText="console.deepgram.com"
                  onSave={(deepgramApiKey) => actions.updateSettings({ deepgramApiKey })}
                />
              ),
            },
          ]}
          selected={settings.transcriptionService}
          onSelect={(engine) => actions.updateSettings({ transcriptionService: engine })}
          label={t('settings.serviceGroup')}
        />
        <div className="setting-hint">{t('settings.serviceDefaultHint')}</div>
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
