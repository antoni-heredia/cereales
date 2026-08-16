import { useEffect, useRef, useState } from 'react';
import { ScreenshotEditor } from '@/components/ScreenshotEditor';
import { ScreenshotViewer } from '@/components/ScreenshotViewer';
import { TagInput } from '@/components/TagInput';
import { useI18n } from '@/i18n';
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
    shotDraft,
    shotView,
    shotBusy,
    error,
    actions,
  } = useApp();
  const { lang, t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);
  const entryRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  // Clicking a note scrolls the matching transcript entry into view.
  useEffect(() => {
    if (activeEntryIndex === null) return;
    const target = entryRefs.current[activeEntryIndex];
    const container = scrollRef.current;
    if (target && container) {
      container.scrollTo({ top: target.offsetTop - 12, behavior: 'smooth' });
    }
  }, [activeEntryIndex]);

  // Every hook goes above this return: if it bailed out earlier, the number of
  // hooks would change once the first recording arrived and React would break.
  const recording = recordings.find((r) => r.id === selectedRecordingId) ?? recordings[0];
  if (!recording) {
    return (
      <div className="screen screen--transcript">
        <div className="empty-state">{t('transcript.noSelection')}</div>
      </div>
    );
  }

  const entries = transcript?.entries ?? [];
  const notes = transcript?.notes ?? [];

  const isTranscribing = transcribingRecordingId === recording.id;

  /**
   * Moves the player to the moment the note was taken.
   *
   * Before the metadata loads the element ignores `currentTime`, so in that case
   * the seek is deferred to the first `loadedmetadata`.
   */
  const seekTo = (timeSec: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const apply = () => {
      audio.currentTime = timeSec;
      void audio.play().catch(() => {
        // Playback rejected (for instance, with no prior user gesture): the
        // seek already happened and pressing play is enough.
      });
    };
    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) apply();
    else audio.addEventListener('loadedmetadata', apply, { once: true });
  };

  const handleNoteClick = (timeSec: number) => {
    seekTo(timeSec);
    // Also highlights the transcript line, if it has been transcribed already.
    actions.jumpToNote(timeSec);
  };

  const handleRename = () => {
    if (newTitle.trim()) {
      actions.renameRecording(recording.id, newTitle.trim());
      setIsRenaming(false);
      setNewTitle('');
    }
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
            {formatRecordingDate(recording.startedAt, lang)} · {formatTime(recording.durationSec)}
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
                {t('transcript.rename')}
              </button>
              <button
                type="button"
                className="btn-outline btn-sm btn-danger"
                onClick={() => {
                  if (confirm(t('transcript.deleteConfirm'))) {
                    actions.deleteRecording(recording.id);
                  }
                }}
              >
                {t('transcript.delete')}
              </button>
            </>
          )}
        </div>
      </div>
      <div className="rule" />

      <div className="tags-section">
        <div className="setting-name">{t('transcript.tags')}</div>
        <TagInput
          tags={recording.tags ?? []}
          onChange={(tags) => actions.updateRecordingTags(recording.id, tags)}
        />
        <div className="setting-hint">{t('transcript.tagsHint')}</div>
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
          <div className="transcribe-label">{t('transcript.missing')}</div>
          <button
            type="button"
            className="btn-solid"
            onClick={() => actions.transcribeRecording(recording.id)}
          >
            {t('transcript.transcribe')}
          </button>
        </div>
      )}

      {isTranscribing && (
        <div className="pending-card">
          <div className="pending-mark" aria-hidden="true" />
          <div className="pending-label">
            {progress?.stage === 'transcribing' && progress.percent >= 0
              ? t('transcript.workingPercent', { percent: progress.percent })
              : t('transcript.working')}
          </div>
          {progress?.stage === 'transcribing' && progress.percent >= 0 && (
            <div className="progress-track" style={{ width: '100%' }}>
              <div className="progress-fill" style={{ width: `${progress.percent}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Notes do not depend on the transcript: they are what was written
          during the meeting and must show even before transcribing. */}
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
                  title={t('transcript.seek')}
                >
                  <span className="entry-time">{formatTime(entry.timeSec)}</span>
                  <span className="entry-body">
                    {/* whisper.cpp does not diarize: with no name, no line. */}
                    {entry.speaker && <span className="entry-speaker">{entry.speaker}</span>}
                    <span className="entry-text">{entry.text}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="notes-column">
            <div className="live-notes-label">{t('transcript.notesTitle')}</div>
            <div className="notes-column-list">
              {notes.length === 0 && (
                <div className="empty-state">{t('transcript.notesEmpty')}</div>
              )}
              {notes.map((note) => {
                const isActive =
                  entries.length > 0 &&
                  nearestEntryIndex(entries, note.timeSec) === activeEntryIndex;
                // Two targets, so the card is a container rather than a button:
                // the text seeks the audio and the thumbnail opens the viewer.
                // Nesting one button inside another would not be valid HTML,
                // and a click handler on the image alone would not be reachable
                // from the keyboard.
                return (
                  <div
                    key={note.id}
                    className={`note-card${isActive ? ' note-card--active' : ''}`}
                  >
                    <button
                      type="button"
                      className="note-card-seek"
                      onClick={() => handleNoteClick(note.timeSec)}
                      title={t('transcript.seek')}
                    >
                      <span className="note-time">{formatTime(note.timeSec)}</span>
                      <span className="note-card-text">{note.text}</span>
                    </button>
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
                );
              })}
            </div>
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
