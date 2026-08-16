import { useI18n } from '@/i18n';
import { formatRecordingDate, formatTime } from '@/lib/format';
import { useApp } from '@/state/store';

export function HistoryScreen() {
  const { recordings, actions } = useApp();
  const { lang, t } = useI18n();

  return (
    <div className="screen screen--history">
      <h1 className="screen-title">{t('history.title')}</h1>
      <div className="rule history-rule" />

      {recordings.length === 0 ? (
        <div className="empty-state">{t('history.empty')}</div>
      ) : (
        <div className="history-list">
          {recordings.map((recording) => (
            <button
              key={recording.id}
              type="button"
              className="history-row"
              onClick={() => actions.openRecording(recording.id)}
            >
              <span className="history-row-main">
                <span className="history-title">{recording.title}</span>
                <span className="history-meta">
                  {formatRecordingDate(recording.startedAt, lang)} ·{' '}
                  {formatTime(recording.durationSec)}
                </span>
              </span>
              <span className="history-cta">{t('history.open')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
