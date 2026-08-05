import { SourcePicker } from '@/components/SourcePicker';
import { Waveform } from '@/components/Waveform';
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
    error,
    progress,
    actions,
  } = useApp();

  const recording = phase === 'recording';
  const showIdleCard = phase === 'idle' || phase === 'recording';

  return (
    <div className="screen screen--record">
      <div>
        <h1 className="screen-title">Nueva grabación</h1>
        <div className="screen-sub">{formatToday()}</div>
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
              {recording ? 'Grabando' : 'Listo para grabar'}
            </div>
            <div className="elapsed">{formatTime(elapsedSec)}</div>
          </div>

          <SourcePicker
            sources={sources}
            selectedId={selectedSourceId}
            onSelect={actions.selectSource}
            disabled={recording}
            label="Fuente"
            value={selectedSourceLabel}
          />

          <button
            type="button"
            className={`rec-button${recording ? ' rec-button--stop' : ''}`}
            disabled={!recording && !selectedSourceId}
            onClick={recording ? actions.stopRecording : actions.startRecording}
          >
            {recording ? 'Detener grabación' : 'Grabar'}
          </button>
        </div>
      )}

      {phase === 'transcribing' && (
        <div className="pending-card">
          <div className="pending-mark" aria-hidden="true" />
          <div className="pending-label">
            {progress?.stage === 'transcribiendo' && progress.percent >= 0
              ? `Transcribiendo audio… ${progress.percent}%`
              : 'Transcribiendo audio…'}
          </div>
          {progress?.stage === 'transcribiendo' && progress.percent >= 0 && (
            <div className="progress-track" style={{ width: '100%' }}>
              <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
            </div>
          )}
        </div>
      )}

      {phase === 'done' && (
        <div className="done-card">
          <div className="done-title">Grabación guardada · {formatTime(lastDurationSec)}</div>
          <div className="done-body">
            El audio quedó guardado. Puedes transcribir desde la pantalla de detalles.
          </div>
          <div className="done-actions">
            <button type="button" className="btn-solid" onClick={actions.viewLatestTranscript}>
              Ver grabación
            </button>
            <button
              type="button"
              className="btn-outline btn-outline--lg"
              onClick={actions.resetRecorder}
            >
              Nueva grabación
            </button>
          </div>
        </div>
      )}

      {recording && (
        <div className="wave-row">
          <Waveform active />
          <button
            type="button"
            className={`notes-toggle${notesOpen ? ' notes-toggle--on' : ''}`}
            onClick={actions.toggleNotes}
          >
            {notesOpen ? 'Ocultar notas' : 'Mostrar notas'}
          </button>
        </div>
      )}

      {recording && notesOpen && (
        <div className="live-notes">
          <div className="live-notes-label">
            Notas en vivo · Enter para guardar con marca de tiempo
          </div>
          <textarea
            className="note-input"
            placeholder="Escribe una nota…"
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
                <div>{note.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
