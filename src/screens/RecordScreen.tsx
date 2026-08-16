import { ScreenshotEditor } from '@/components/ScreenshotEditor';
import { ScreenshotViewer } from '@/components/ScreenshotViewer';
import { SourcePicker } from '@/components/SourcePicker';
import { Waveform } from '@/components/Waveform';
import { useI18n } from '@/i18n';
import { formatTime, formatToday } from '@/lib/format';
import { useApp } from '@/state/store';

export function RecordScreen() {
  const {
    sources,
    selectedSourceId,
    selectedSourceLabel,
    phase,
    elapsedSec,
    lastDurationSec,
    notesOpen,
    noteDraft,
    liveNotes,
    shotDraft,
    shotView,
    shotBusy,
    error,
    actions,
  } = useApp();
  const { lang, t } = useI18n();

  const recording = phase === 'recording';
  const showIdleCard = phase === 'idle' || phase === 'recording';

  return (
    <div className="screen screen--record">
      <div>
        <h1 className="screen-title">{t('record.title')}</h1>
        <div className="screen-sub">{formatToday(lang)}</div>
      </div>
      <div className="rule" />

      {error && (
        <div className="error-card" role="alert" onClick={actions.dismissError}>
          {error}
        </div>
      )}

      {showIdleCard && (
        <div className="rec-card">
          <div className="rec-head">
            <div className={`status-tag${recording ? ' status-tag--live' : ''}`}>
              {recording ? t('record.statusLive') : t('record.statusReady')}
            </div>
            <div className="elapsed">{formatTime(elapsedSec)}</div>
          </div>

          <SourcePicker
            sources={sources}
            selectedId={selectedSourceId}
            onSelect={actions.selectSource}
            disabled={recording}
            label={t('record.source')}
            value={selectedSourceLabel}
          />

          <button
            type="button"
            className={`rec-button${recording ? ' rec-button--stop' : ''}`}
            disabled={!recording && !selectedSourceId}
            onClick={recording ? actions.stopRecording : actions.startRecording}
          >
            {recording ? t('record.stop') : t('record.start')}
          </button>
        </div>
      )}

      {phase === 'done' && (
        <div className="done-card">
          <div className="done-title">
            {t('record.saved', { duration: formatTime(lastDurationSec) })}
          </div>
          <div className="done-body">{t('record.savedBody')}</div>
          <div className="done-actions">
            <button type="button" className="btn-solid" onClick={actions.viewLatestTranscript}>
              {t('record.view')}
            </button>
            <button
              type="button"
              className="btn-outline btn-outline--lg"
              onClick={actions.resetRecorder}
            >
              {t('record.again')}
            </button>
          </div>
        </div>
      )}

      {recording && (
        <div className="wave-row">
          <Waveform active />
          <div className="wave-actions">
            <button
              type="button"
              className="notes-toggle"
              onClick={actions.captureScreenshot}
              disabled={shotBusy}
            >
              {shotBusy ? t('record.shotBusy') : t('record.shot')}
            </button>
            <button
              type="button"
              className={`notes-toggle${notesOpen ? ' notes-toggle--on' : ''}`}
              onClick={actions.toggleNotes}
            >
              {notesOpen ? t('record.hideNotes') : t('record.showNotes')}
            </button>
          </div>
        </div>
      )}

      {recording && notesOpen && (
        <div className="live-notes">
          <div className="live-notes-label">{t('record.notesLabel')}</div>
          <textarea
            className="note-input"
            placeholder={t('record.notePlaceholder')}
            value={noteDraft}
            onChange={(event) => actions.setNoteDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                actions.commitNote();
              }
            }}
          />
          <div className="note-list">
            {liveNotes.map((note) => (
              <div key={note.id} className="note-row">
                <div className="note-time">{formatTime(note.timeSec)}</div>
                <div className="note-row-body">
                  <div>{note.text}</div>
                  {note.image && (
                    <button
                      type="button"
                      className="shot-thumb-button"
                      title={t('shot.view')}
                      onClick={() => actions.openShot(note)}
                    >
                      <img
                        className="shot-thumb"
                        src={actions.attachmentUrl(note.image)}
                        alt={t('transcript.shotAlt', { time: formatTime(note.timeSec) })}
                      />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {shotView && (
        <ScreenshotViewer
          src={actions.attachmentUrl(shotView.fileName)}
          timeSec={shotView.timeSec}
          caption={shotView.caption}
          onEdit={() => actions.editShot(shotView.fileName, shotView.timeSec)}
          onClose={actions.closeShot}
        />
      )}

      {shotDraft && (
        <ScreenshotEditor
          source={shotDraft.source}
          timeSec={shotDraft.timeSec}
          editing={Boolean(shotDraft.fileName)}
          onSave={actions.commitScreenshot}
          onCancel={actions.cancelScreenshot}
          busy={shotBusy}
        />
      )}
    </div>
  );
}
