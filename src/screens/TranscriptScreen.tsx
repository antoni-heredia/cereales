import { useEffect, useRef, useState } from 'react';
import { formatRecordingDate, formatTime, nearestEntryIndex } from '@/lib/format';
import { useApp } from '@/state/store';

export function TranscriptScreen() {
  const {
    recordings,
    selectedRecordingId,
    transcript,
    activeEntryIndex,
    progress,
    transcribingRecordingId,
    error,
    actions,
  } = useApp();
  const scrollRef = useRef<HTMLDivElement>(null);
  const entryRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [tagsInput, setTagsInput] = useState('');

  // Clicking a note scrolls the matching transcript entry into view.
  useEffect(() => {
    if (activeEntryIndex === null) return;
    const target = entryRefs.current[activeEntryIndex];
    const container = scrollRef.current;
    if (target && container) {
      container.scrollTo({ top: target.offsetTop - 12, behavior: 'smooth' });
    }
  }, [activeEntryIndex]);

  // Sincronizar tags al cambiar de grabación
  useEffect(() => {
    const rec = recordings.find((r) => r.id === selectedRecordingId) ?? recordings[0];
    setTagsInput((rec?.tags ?? []).join(', '));
  }, [selectedRecordingId, recordings]);

  // Todo hook va antes de este return: si saliera antes, el número de hooks
  // cambiaría al llegar la primera grabación y React se rompería.
  const recording = recordings.find((r) => r.id === selectedRecordingId) ?? recordings[0];
  if (!recording) {
    return (
      <div className="screen screen--transcript">
        <div className="empty-state">No hay ninguna grabación seleccionada.</div>
      </div>
    );
  }

  const entries = transcript?.entries ?? [];
  const notes = transcript?.notes ?? [];

  const isTranscribing = transcribingRecordingId === recording.id;

  /**
   * Lleva el reproductor al momento en que se tomó la nota.
   *
   * Antes de que carguen los metadatos el elemento ignora `currentTime`, así que
   * en ese caso el salto se aplaza al primer `loadedmetadata`.
   */
  const seekTo = (timeSec: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const apply = () => {
      audio.currentTime = timeSec;
      void audio.play().catch(() => {
        // Reproducción rechazada (por ejemplo, sin gesto previo del usuario):
        // el salto ya está hecho y basta con darle al play.
      });
    };
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) apply();
    else audio.addEventListener('loadedmetadata', apply, { once: true });
  };

  const handleNoteClick = (timeSec: number) => {
    seekTo(timeSec);
    // Además resalta la frase de la transcripción, si ya se transcribió.
    actions.jumpToNote(timeSec);
  };

  const handleRename = () => {
    if (newTitle.trim()) {
      actions.renameRecording(recording.id, newTitle.trim());
      setIsRenaming(false);
      setNewTitle('');
    }
  };

  const parsedTags = tagsInput
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  const savedTags = recording.tags ?? [];
  const tagsDirty = parsedTags.join(',') !== savedTags.join(',');

  const handleSaveTags = () => {
    if (tagsDirty) actions.updateRecordingTags(recording.id, parsedTags);
  };

  return (
    <div className="screen screen--transcript">
      <div className="transcript-header">
        <div>
          {isRenaming ? (
            <input
              type="text"
              className="title-input"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onBlur={handleRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename();
                if (e.key === 'Escape') setIsRenaming(false);
              }}
              autoFocus
            />
          ) : (
            <h1 className="screen-title screen-title--sm">{recording.title}</h1>
          )}
          <div className="screen-sub">
            {formatRecordingDate(recording.startedAt)} · {formatTime(recording.durationSec)}
          </div>
        </div>
        <div className="transcript-actions">
          {!isRenaming && (
            <>
              <button
                type="button"
                className="btn-outline btn-sm"
                onClick={() => {
                  setNewTitle(recording.title);
                  setIsRenaming(true);
                }}
              >
                Renombrar
              </button>
              <button
                type="button"
                className="btn-outline btn-sm btn-danger"
                onClick={() => {
                  if (confirm('¿Eliminar grabación y todos sus archivos?')) {
                    actions.deleteRecording(recording.id);
                  }
                }}
              >
                Eliminar
              </button>
            </>
          )}
        </div>
      </div>
      <div className="rule" />

      <div className="tags-section">
        <div className="setting-name">Etiquetas</div>
        <div className="tags-row">
          <input
            type="text"
            className="tags-input"
            placeholder="reunión, cliente, urgente"
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveTags();
              if (e.key === 'Escape') setTagsInput(savedTags.join(', '));
            }}
          />
          <button
            type="button"
            className="btn-solid btn-sm"
            disabled={!tagsDirty}
            onClick={handleSaveTags}
          >
            Guardar
          </button>
        </div>
        <div className="setting-hint">
          {tagsDirty ? (
            <span className="setting-dirty">Sin guardar · Enter para guardar</span>
          ) : (
            'Separadas por comas. Van al frontmatter de la nota de Obsidian.'
          )}
        </div>
      </div>

      {error && (
        <div className="error-card" role="alert" onClick={actions.dismissError}>
          {error}
        </div>
      )}

      {recording.audioPath && (
        <div className="audio-player-section">
          <audio
            ref={audioRef}
            controls
            className="audio-player"
            src={actions.audioUrl(recording.audioPath)}
            key={recording.id}
          />
        </div>
      )}

      {entries.length === 0 && !isTranscribing && (
        <div className="transcribe-card">
          <div className="transcribe-label">No hay transcripción disponible</div>
          <button
            type="button"
            className="btn-solid"
            onClick={() => actions.transcribeRecording(recording.id)}
          >
            Transcribir
          </button>
        </div>
      )}

      {isTranscribing && (
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

      {/* Las notas no dependen de la transcripción: son lo que se escribió
          durante la reunión y deben verse aunque aún no se haya transcrito. */}
      {(entries.length > 0 || notes.length > 0) && (
        <div className="transcript-layout">
          {entries.length > 0 && (
            <div className="transcript-scroll" ref={scrollRef}>
              {entries.map((entry, index) => (
                <button
                  key={`${entry.timeSec}-${index}`}
                  type="button"
                  ref={(el) => {
                    entryRefs.current[index] = el;
                  }}
                  className={`entry${activeEntryIndex === index ? ' entry--active' : ''}`}
                  onClick={() => seekTo(entry.timeSec)}
                  title="Ir a este momento del audio"
                >
                  <span className="entry-time">{formatTime(entry.timeSec)}</span>
                  <span className="entry-body">
                    {/* whisper.cpp no diariza: sin nombre, no se pinta la línea. */}
                    {entry.speaker && <span className="entry-speaker">{entry.speaker}</span>}
                    <span className="entry-text">{entry.text}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="notes-column">
            <div className="live-notes-label">Notas tomadas durante la reunión</div>
            <div className="notes-column-list">
              {notes.length === 0 && (
                <div className="empty-state">No se tomaron notas en esta reunión.</div>
              )}
              {notes.map((note) => {
                const isActive =
                  entries.length > 0 && nearestEntryIndex(entries, note.timeSec) === activeEntryIndex;
                return (
                  <button
                    key={note.id}
                    type="button"
                    className={`note-card${isActive ? ' note-card--active' : ''}`}
                    onClick={() => handleNoteClick(note.timeSec)}
                    title="Ir a este momento del audio"
                  >
                    <span className="note-time">{formatTime(note.timeSec)}</span>
                    <span className="note-card-text">{note.text}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
