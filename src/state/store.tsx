import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { services, updateServices } from '@/services';
import { DEFAULT_SETTINGS } from '@/services/mock';
import { resolveAudioLanguage, resolveLanguage, useI18n } from '@/i18n';
import { describeError } from '@/lib/errors';
import { nearestEntryIndex } from '@/lib/format';
import { transcriptRelPath } from '@/lib/serialize';
import { sourceLabel } from '@/lib/sources';
import type {
  AudioSource,
  ModelStatus,
  NativeProgress,
  Note,
  RecorderPhase,
  Recording,
  ScreenKey,
  Settings,
  Transcript,
  TranscriptFormat,
} from '@/types';

/** A capture waiting to be annotated. */
export interface ShotDraft {
  /** Base64 PNG, exactly as the backend returned it. */
  source: string;
  /**
   * Frozen when the shot was taken. The editor can stay open for a while, and
   * the note belongs to the moment the screen looked like this.
   */
  timeSec: number;
  /**
   * Set when re-annotating one that is already saved. Saving then overwrites
   * that file instead of creating a note: the name is already in the Obsidian
   * embed, so a new one would leave the note showing the version before the
   * edit.
   */
  fileName?: string;
}

/** The screenshot being looked at full size. */
export interface ShotView {
  fileName: string;
  timeSec: number;
  caption: string;
}

interface AppState {
  screen: ScreenKey;
  settings: Settings;
  sources: AudioSource[];
  selectedSourceId: string;
  phase: RecorderPhase;
  elapsedSec: number;
  lastDurationSec: number;
  notesOpen: boolean;
  noteDraft: string;
  liveNotes: Note[];
  /** The screenshot waiting in the annotation editor, if one is open. */
  shotDraft: ShotDraft | null;
  /** The screenshot open in the viewer, if any. */
  shotView: ShotView | null;
  /** A capture or a save is in flight; the editor and the button both wait. */
  shotBusy: boolean;
  recordings: Recording[];
  selectedRecordingId: string | null;
  transcript: Transcript | null;
  activeEntryIndex: number | null;
  error: string | null;
  /** Status of the selected model; null while it is unknown. */
  model: ModelStatus | null;
  /** The whole local catalogue, for the model picker. Empty with a remote engine. */
  models: ModelStatus[];
  modelBusy: boolean;
  progress: NativeProgress | null;
  transcribingRecordingId: string | null;
}

interface AppActions {
  goScreen: (screen: ScreenKey) => void;
  selectSource: (sourceId: string) => void;
  startRecording: () => void;
  stopRecording: () => void;
  resetRecorder: () => void;
  viewLatestTranscript: () => void;
  transcribeRecording: (recordingId: string) => void;
  deleteRecording: (recordingId: string) => void;
  renameRecording: (recordingId: string, newTitle: string) => void;
  updateRecordingTags: (recordingId: string, tags: string[]) => void;
  audioUrl: (audioPath: string) => string;
  attachmentUrl: (fileName: string) => string;
  setNoteDraft: (value: string) => void;
  commitNote: () => void;
  captureScreenshot: () => void;
  commitScreenshot: (pngBase64: string, caption: string) => void;
  cancelScreenshot: () => void;
  openShot: (note: Note) => void;
  closeShot: () => void;
  /** Reopens the editor on a screenshot that is already on disk. */
  editShot: (fileName: string, timeSec: number) => void;
  toggleNotes: () => void;
  openRecording: (recordingId: string) => void;
  jumpToNote: (timeSec: number) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setTranscriptFormat: (format: TranscriptFormat) => void;
  /** Opens the picker used to link the Obsidian vault. */
  pickVault: () => void;
  unlinkVault: () => void;
  downloadModel: () => void;
  deleteModel: (id: string) => void;
  dismissError: () => void;
}

type AppContextValue = AppState & { actions: AppActions; selectedSourceLabel: string };

const AppContext = createContext<AppContextValue | null>(null);

/**
 * Id of a recording from the path of its WAV: `…/recording-123.wav` ->
 * `recording-123`. It has to match the filename because the backend rebuilds
 * the history by scanning the folder and pairs `{id}.json` with `{id}.wav`.
 *
 * Recordings made before the rename still carry a `grabacion-` stem; they are
 * migrated on startup, and either way the id is whatever the file is called.
 */
function recordingIdFromPath(audioPath: string, fallbackStamp: number): string {
  const file = audioPath.split(/[\\/]/).pop() ?? '';
  const stem = file.replace(/\.wav$/i, '');
  return stem || `recording-${Math.floor(fallbackStamp / 1000)}`;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const { lang, locale, t, setLanguage } = useI18n();
  const [screen, setScreen] = useState<ScreenKey>('record');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [sources, setSources] = useState<AudioSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>(DEFAULT_SETTINGS.defaultSourceId);
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [lastDurationSec, setLastDurationSec] = useState(0);
  const [notesOpen, setNotesOpen] = useState(true);
  const [noteDraft, setNoteDraft] = useState('');
  const [liveNotes, setLiveNotes] = useState<Note[]>([]);
  const [shotDraft, setShotDraft] = useState<ShotDraft | null>(null);
  const [shotView, setShotView] = useState<ShotView | null>(null);
  const [shotBusy, setShotBusy] = useState(false);
  // Bumped when a screenshot is overwritten in place. The filename does not
  // change on a re-edit — that is the point — so without something to vary the
  // URL, both the browser cache and the `<img>` keep showing the old pixels.
  const [shotVersion, setShotVersion] = useState(0);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [activeEntryIndex, setActiveEntryIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<ModelStatus | null>(null);
  const [models, setModels] = useState<ModelStatus[]>([]);
  const [modelBusy, setModelBusy] = useState(false);
  const [progress, setProgress] = useState<NativeProgress | null>(null);
  const [transcribingRecordingId, setTranscribingRecordingId] = useState<string | null>(null);

  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);
  // Notes are read inside async stop handling, where a stale closure would drop
  // anything typed after the recording began.
  const liveNotesRef = useRef<Note[]>([]);
  liveNotesRef.current = liveNotes;
  // The draft and the clock are read from an Enter keypress that can land
  // between renders; refs make the committed note independent of render timing.
  const noteDraftRef = useRef('');
  noteDraftRef.current = noteDraft;
  const elapsedRef = useRef(0);
  elapsedRef.current = elapsedSec;
  // The id of the recording in progress, known from the moment it starts. Notes
  // and screenshots are filed under it while the meeting is still running, so it
  // cannot wait for the recording to be built at stop.
  const recordingIdRef = useRef('');

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  // The stored preference is the source of truth for the interface language;
  // this is what applies it, both on load and whenever the user changes it.
  useEffect(() => {
    setLanguage(resolveLanguage(settings.language));
  }, [settings.language, setLanguage]);

  // Initial load: settings, source list, recording history, model status.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [loadedSettings, loadedSources, loadedRecordings] = await Promise.all([
          services.storage.loadSettings(),
          services.audio.listSources(),
          services.storage.listRecordings(),
        ]);
        if (cancelled) return;
        // First of all: the saved settings decide which transcription engine is
        // used, so startup has to rebuild the services from them.
        updateServices(loadedSettings);
        setSettings(loadedSettings);
        setSources(loadedSources);
        setRecordings(loadedRecordings);
        const preferred = loadedSources.find((s) => s.id === loadedSettings.defaultSourceId);
        setSelectedSourceId(preferred?.id ?? loadedSources[0]?.id ?? '');
      } catch (err) {
        if (!cancelled) setError(describeError(err, lang));
      }

    })();
    return () => {
      cancelled = true;
    };
    // Deliberately runs once on mount. `lang` is read inside, but only to
    // phrase an error: re-running this on a language change would reload
    // everything from disk and throw away the current session.
  }, []);

  // The model is fetched apart from the initial load: a missing or unknown one
  // must not prevent recording, so it never surfaces an error here. It reruns
  // when the selection changes, which is what keeps the settings screen honest
  // after picking another model.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [status, list] = await Promise.all([
          services.transcription.modelStatus(),
          services.transcription.listModels(),
        ]);
        if (cancelled) return;
        setModel(status);
        setModels(list);
      } catch {
        if (!cancelled) setModel(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settings.transcriptionService, settings.whisperModel, settings.elevenLabsApiKey]);

  // Model download and transcription progress. It resubscribes when the engine
  // changes: `services` is replaced wholesale and the previous subscription
  // would point at the old object.
  useEffect(
    () => services.transcription.onProgress(setProgress),
    [settings.transcriptionService, settings.whisperModel, settings.elevenLabsApiKey],
  );

  const startRecording = useCallback(() => {
    if (phase === 'recording' || !selectedSourceId) return;
    void (async () => {
      try {
        recordingIdRef.current = await services.audio.start(selectedSourceId);
        setError(null);
        setLiveNotes([]);
        setNoteDraft('');
        setShotDraft(null);
        setElapsedSec(0);
        setPhase('recording');
        startedAtRef.current = Date.now();
        clearTimer();
        // Derived from wall clock so a throttled interval doesn't drift.
        timerRef.current = window.setInterval(() => {
          setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
        }, 250);
      } catch (err) {
        setError(describeError(err, lang));
      }
    })();
  }, [clearTimer, lang, phase, selectedSourceId]);

  const stopRecording = useCallback(() => {
    if (phase !== 'recording') return;
    clearTimer();
    const wallDuration = Math.floor((Date.now() - startedAtRef.current) / 1000);

    void (async () => {
      let recording: Recording;
      try {
        const { audioPath, durationSec } = await services.audio.stop();
        const finalDuration = durationSec > 0 ? durationSec : wallDuration;
        recording = {
          // The id is the name of the WAV: the history is rebuilt by scanning
          // the folder, and the metadata is saved as `{id}.json` next to the
          // audio. An id invented here would leave the .json orphaned and the
          // recording would reload with no title, date or duration.
          id: recordingIdFromPath(audioPath, startedAtRef.current),
          title: t('recording.defaultTitle', {
            date: new Date(startedAtRef.current).toLocaleDateString(locale),
          }),
          startedAt: new Date(startedAtRef.current).toISOString(),
          durationSec: finalDuration,
          audioPath,
        };
      } catch (err) {
        setError(describeError(err, lang));
        setPhase('idle');
        return;
      }

      const notes = liveNotesRef.current;
      setRecordings((prev) => [recording, ...prev.filter((r) => r.id !== recording.id)]);
      setSelectedRecordingId(recording.id);
      setLastDurationSec(recording.durationSec);
      setTranscript({ recordingId: recording.id, entries: [], notes });
      try {
        await services.storage.saveRecording(recording);
        // Every note was already flushed as it was taken; this covers the one
        // case that was not, a recording whose id the backend renamed under us.
        if (notes.length > 0) await services.storage.writeNotes(recording.id, notes);
      } catch (err) {
        setError(describeError(err, lang));
      } finally {
        setPhase('done');
      }
    })();
  }, [clearTimer, lang, locale, phase, t]);

  const resetRecorder = useCallback(() => {
    setPhase('idle');
    setElapsedSec(0);
    setLiveNotes([]);
    setNoteDraft('');
    setShotDraft(null);
    recordingIdRef.current = '';
  }, []);

  const openRecording = useCallback(
    (recordingId: string) => {
      setSelectedRecordingId(recordingId);
      setActiveEntryIndex(null);
      setScreen('transcript');
      void (async () => {
        try {
          setTranscript(await services.storage.loadTranscript(recordingId));
        } catch (err) {
          setError(describeError(err, lang));
        }
      })();
    },
    [lang],
  );

  const viewLatestTranscript = useCallback(() => {
    setPhase('idle');
    setActiveEntryIndex(null);
    setScreen('transcript');
  }, []);

  /**
   * Writes the notes taken so far to the sidecar. Until this existed they only
   * reached disk when the recording was transcribed, so closing the app after a
   * meeting threw them away — survivable for a line of text, not for a
   * screenshot that captured something no longer on screen.
   */
  const flushNotes = useCallback(
    (notes: Note[]) => {
      const recordingId = recordingIdRef.current;
      if (!recordingId) return;
      void services.storage
        .writeNotes(recordingId, notes)
        .catch((err) => setError(describeError(err, lang)));
    },
    [lang],
  );

  /**
   * Appends and persists in one step. The next list is built from the ref
   * rather than inside a functional update because the flush is a side effect,
   * and React invokes those updaters twice in development.
   */
  const addNote = useCallback(
    (note: Omit<Note, 'id'>) => {
      const previous = liveNotesRef.current;
      const next = [...previous, { ...note, id: `note-${Date.now()}-${previous.length}` }];
      liveNotesRef.current = next;
      setLiveNotes(next);
      flushNotes(next);
    },
    [flushNotes],
  );

  const commitNote = useCallback(() => {
    const text = noteDraftRef.current.trim();
    if (!text) return;
    addNote({ timeSec: elapsedRef.current, text });
    setNoteDraft('');
  }, [addNote]);

  const captureScreenshot = useCallback(() => {
    if (phase !== 'recording' || shotBusy) return;
    // Read before the await: by the time the capture returns the clock has
    // moved on, and the note belongs to the moment the button was pressed.
    const timeSec = elapsedRef.current;
    setShotBusy(true);
    void (async () => {
      try {
        setShotDraft({ source: await services.storage.captureScreen(), timeSec });
      } catch (err) {
        setError(describeError(err, lang));
      } finally {
        setShotBusy(false);
      }
    })();
  }, [lang, phase, shotBusy]);

  const commitScreenshot = useCallback(
    (pngBase64: string, caption: string) => {
      if (!shotDraft) return;
      const { fileName, timeSec } = shotDraft;
      const recordingId = recordingIdRef.current;
      // Re-editing needs no recording in progress: the file is already on disk
      // and keeps its name, so nothing about the note has to change.
      if (!fileName && !recordingId) return;
      setShotBusy(true);
      void (async () => {
        try {
          if (fileName) {
            await services.storage.replaceScreenshot(fileName, pngBase64);
            setShotVersion((v) => v + 1);
          } else {
            // The PNG lands on disk before the note that points at it: a note
            // embedding an image that was never written is worse than no note.
            const image = await services.storage.saveScreenshot(recordingId, pngBase64);
            addNote({ timeSec, text: caption.trim(), image });
          }
          setShotDraft(null);
        } catch (err) {
          // The editor stays open, so the annotations are not thrown away.
          setError(describeError(err, lang));
        } finally {
          setShotBusy(false);
        }
      })();
    },
    [addNote, lang, shotDraft],
  );

  const cancelScreenshot = useCallback(() => setShotDraft(null), []);

  const openShot = useCallback((note: Note) => {
    if (!note.image) return;
    setShotView({ fileName: note.image, timeSec: note.timeSec, caption: note.text });
  }, []);

  const closeShot = useCallback(() => setShotView(null), []);

  /**
   * Loads a saved screenshot back into the editor. It goes through the backend
   * rather than the `<img>` already on screen, because that one came over
   * `asset://` and a canvas that drew it could never be exported again.
   */
  const editShot = useCallback(
    (fileName: string, timeSec: number) => {
      setShotBusy(true);
      setShotView(null);
      void (async () => {
        try {
          const source = await services.storage.readScreenshot(fileName);
          setShotDraft({ source, timeSec, fileName });
        } catch (err) {
          setError(describeError(err, lang));
        } finally {
          setShotBusy(false);
        }
      })();
    },
    [lang],
  );

  const jumpToNote = useCallback(
    (timeSec: number) => {
      if (!transcript || transcript.entries.length === 0) return;
      setActiveEntryIndex(nearestEntryIndex(transcript.entries, timeSec));
    },
    [transcript],
  );

  /**
   * Saves and keeps whatever the backend returns: `storageRoot` is derived from
   * the vault, so the local value would fall behind as soon as one is linked.
   */
  const persistSettings = useCallback(
    (next: Settings) => {
      setSettings(next);
      updateServices(next);
      void services.storage
        .saveSettings(next)
        .then((saved) => {
          setSettings(saved);
          updateServices(saved);
        })
        .catch((err) => setError(describeError(err, lang)));
    },
    [lang],
  );

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        persistSettings(next);
        return next;
      });
    },
    [persistSettings],
  );

  const pickVault = useCallback(() => {
    void (async () => {
      try {
        const picked = await services.storage.pickFolder(
          t('settings.vault'),
          settings.obsidianVaultPath ?? '',
        );
        if (picked) persistSettings({ ...settings, obsidianVaultPath: picked });
      } catch (err) {
        setError(describeError(err, lang));
      }
    })();
  }, [lang, persistSettings, settings, t]);

  const unlinkVault = useCallback(() => {
    persistSettings({ ...settings, obsidianVaultPath: null });
  }, [persistSettings, settings]);

  const transcribeRecording = useCallback(
    (recordingId: string) => {
      const recording = recordings.find((r) => r.id === recordingId);
      if (!recording?.audioPath) return;

      setTranscribingRecordingId(recordingId);
      setProgress(null);
      setError(null);

      void (async () => {
        try {
          // Two different languages: what was spoken, and what the reader
          // understands. `lang` alone would tell whisper the meeting was held
          // in whatever the interface happens to be set to.
          const entries = await services.transcription.transcribe(recording.audioPath ?? '', {
            audio: resolveAudioLanguage(settings.audioLanguage, lang),
            ui: lang,
          });
          const currentNotes = transcript?.notes ?? [];
          const nextTranscript: Transcript = { recordingId, entries, notes: currentNotes };
          const transcriptPath = await services.storage.writeTranscript(
            recording,
            nextTranscript,
            settings.transcriptFormat,
            lang,
          );
          const saved: Recording = { ...recording, transcriptPath };
          await services.storage.saveRecording(saved);

          setRecordings((prev) => [saved, ...prev.filter((r) => r.id !== saved.id)]);
          setTranscript(nextTranscript);
        } catch (err) {
          setError(describeError(err, lang));
        } finally {
          setProgress(null);
          setTranscribingRecordingId(null);
        }
      })();
    },
    [lang, recordings, settings.audioLanguage, settings.transcriptFormat, transcript?.notes],
  );

  const deleteRecording = useCallback(
    (recordingId: string) => {
      setError(null);
      void (async () => {
        try {
          await services.storage.deleteRecording(recordingId);
          setRecordings((prev) => prev.filter((r) => r.id !== recordingId));
          if (selectedRecordingId === recordingId) {
            setSelectedRecordingId(null);
            setScreen('history');
          }
        } catch (err) {
          setError(describeError(err, lang));
        }
      })();
    },
    [lang, selectedRecordingId],
  );

  const renameRecording = useCallback(
    (recordingId: string, newTitle: string) => {
      setError(null);
      const current = recordings.find((r) => r.id === recordingId);
      if (!current) return;
      // The title is part of the filename, so the note moves with it.
      const renamed = { ...current, title: newTitle };
      const relPath = transcriptRelPath(renamed, settings.transcriptFormat);
      void (async () => {
        try {
          await services.storage.renameRecording(recordingId, newTitle, relPath);
          setRecordings((prev) => prev.map((r) => (r.id === recordingId ? renamed : r)));
        } catch (err) {
          setError(describeError(err, lang));
        }
      })();
    },
    [lang, recordings, settings.transcriptFormat],
  );

  const updateRecordingTags = useCallback(
    (recordingId: string, tags: string[]) => {
      setError(null);
      const current = recordings.find((r) => r.id === recordingId);
      if (!current) return;
      const tagged = { ...current, tags };
      setRecordings((prev) => prev.map((r) => (r.id === recordingId ? tagged : r)));
      void services.storage
        .saveRecording(tagged)
        .catch((err) => setError(describeError(err, lang)));
    },
    [lang, recordings],
  );

  const audioUrl = useCallback((audioPath: string) => services.storage.audioUrl(audioPath), []);

  const attachmentUrl = useCallback(
    (fileName: string) => {
      const url = services.storage.attachmentUrl(settings.storageRoot, fileName);
      // A `data:` URL from the mock carries its own bytes and must be left
      // alone; only a real request needs the cache broken.
      if (url.startsWith('data:') || shotVersion === 0) return url;
      return `${url}?v=${shotVersion}`;
    },
    [settings.storageRoot, shotVersion],
  );

  const downloadModel = useCallback(() => {
    setModelBusy(true);
    setError(null);
    void (async () => {
      try {
        setModel(await services.transcription.downloadModel());
        setModels(await services.transcription.listModels());
      } catch (err) {
        setError(describeError(err, lang));
      } finally {
        setModelBusy(false);
        setProgress(null);
      }
    })();
  }, [lang]);

  /**
   * Deleting only frees disk space: the model stays in the catalogue, and the
   * selection is left alone so the settings screen simply offers to download it
   * again.
   */
  const deleteModel = useCallback(
    (id: string) => {
      setModelBusy(true);
      setError(null);
      void (async () => {
        try {
          const list = await services.transcription.deleteModel(id);
          setModels(list);
          setModel((prev) => list.find((m) => m.id === prev?.id) ?? prev);
        } catch (err) {
          setError(describeError(err, lang));
        } finally {
          setModelBusy(false);
        }
      })();
    },
    [lang],
  );

  const selectedSourceLabel = useMemo(() => {
    const source = sources.find((s) => s.id === selectedSourceId);
    return source ? sourceLabel(source, lang) : t('source.none');
  }, [lang, selectedSourceId, sources, t]);

  const actions = useMemo<AppActions>(
    () => ({
      goScreen: setScreen,
      selectSource: setSelectedSourceId,
      startRecording,
      stopRecording,
      resetRecorder,
      viewLatestTranscript,
      transcribeRecording,
      deleteRecording,
      renameRecording,
      updateRecordingTags,
      audioUrl,
      attachmentUrl,
      setNoteDraft,
      commitNote,
      captureScreenshot,
      commitScreenshot,
      cancelScreenshot,
      openShot,
      closeShot,
      editShot,
      toggleNotes: () => setNotesOpen((v) => !v),
      openRecording,
      jumpToNote,
      updateSettings,
      setTranscriptFormat: (format) => updateSettings({ transcriptFormat: format }),
      pickVault,
      unlinkVault,
      downloadModel,
      deleteModel,
      dismissError: () => setError(null),
    }),
    [
      attachmentUrl,
      audioUrl,
      cancelScreenshot,
      captureScreenshot,
      closeShot,
      commitNote,
      commitScreenshot,
      deleteModel,
      editShot,
      openShot,
      deleteRecording,
      downloadModel,
      jumpToNote,
      openRecording,
      pickVault,
      renameRecording,
      unlinkVault,
      resetRecorder,
      startRecording,
      stopRecording,
      transcribeRecording,
      updateRecordingTags,
      updateSettings,
      viewLatestTranscript,
    ],
  );

  const value: AppContextValue = {
    screen,
    settings,
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
    recordings,
    selectedRecordingId,
    transcript,
    activeEntryIndex,
    error,
    model,
    models,
    modelBusy,
    progress,
    transcribingRecordingId,
    actions,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside <AppStateProvider>');
  return value;
}
