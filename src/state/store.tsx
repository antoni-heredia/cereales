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
import { nearestEntryIndex } from '@/lib/format';
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
  recordings: Recording[];
  selectedRecordingId: string | null;
  transcript: Transcript | null;
  activeEntryIndex: number | null;
  error: string | null;
  model: ModelStatus | null;
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
  setNoteDraft: (value: string) => void;
  commitNote: () => void;
  toggleNotes: () => void;
  openRecording: (recordingId: string) => void;
  jumpToNote: (timeSec: number) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setTranscriptFormat: (format: TranscriptFormat) => void;
  pickFolder: (which: 'recordingFolder' | 'transcriptFolder' | 'obsidianVaultPath') => void;
  downloadModel: () => void;
  dismissError: () => void;
}

type AppContextValue = AppState & { actions: AppActions; selectedSourceLabel: string };

const AppContext = createContext<AppContextValue | null>(null);

/**
 * Id de una grabación a partir de la ruta de su WAV: `…/grabacion-123.wav` ->
 * `grabacion-123`. Debe coincidir con el nombre del archivo porque el backend
 * lista el historial escaneando la carpeta y empareja `{id}.json` con `{id}.wav`.
 */
function recordingIdFromPath(audioPath: string, fallbackStamp: number): string {
  const file = audioPath.split(/[\\/]/).pop() ?? '';
  const stem = file.replace(/\.wav$/i, '');
  return stem || `grabacion-${Math.floor(fallbackStamp / 1000)}`;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'Ha ocurrido un error inesperado.';
}

export function AppStateProvider({ children }: { children: ReactNode }) {
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
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [activeEntryIndex, setActiveEntryIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<ModelStatus | null>(null);
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

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  // Initial load: settings, source list, recording history, estado del modelo.
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
        // Antes de nada: los ajustes guardados deciden qué motor de
        // transcripción se usa, así que el arranque tiene que reconstruirlo.
        updateServices(loadedSettings);
        setSettings(loadedSettings);
        setSources(loadedSources);
        setRecordings(loadedRecordings);
        const preferred = loadedSources.find((s) => s.id === loadedSettings.defaultSourceId);
        setSelectedSourceId(preferred?.id ?? loadedSources[0]?.id ?? '');
      } catch (err) {
        if (!cancelled) setError(describeError(err));
      }

      // El modelo va aparte: que falte no debe impedir grabar.
      try {
        const status = await services.transcription.modelStatus();
        if (!cancelled) setModel(status);
      } catch {
        if (!cancelled) setModel({ installed: false, name: '', bytes: 0 });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Progreso de descarga del modelo y de la transcripción. Se resuscribe cuando
  // cambia el motor: `services` se reemplaza entero y la suscripción anterior
  // apuntaría al objeto viejo.
  useEffect(
    () => services.transcription.onProgress(setProgress),
    [settings.transcriptionService, settings.elevenLabsApiKey],
  );

  const startRecording = useCallback(() => {
    if (phase === 'recording' || !selectedSourceId) return;
    void (async () => {
      try {
        await services.audio.start(selectedSourceId);
        setError(null);
        setLiveNotes([]);
        setNoteDraft('');
        setElapsedSec(0);
        setPhase('recording');
        startedAtRef.current = Date.now();
        clearTimer();
        // Derived from wall clock so a throttled interval doesn't drift.
        timerRef.current = window.setInterval(() => {
          setElapsedSec(Math.floor((Date.now() - startedAtRef.current) / 1000));
        }, 250);
      } catch (err) {
        setError(describeError(err));
      }
    })();
  }, [clearTimer, phase, selectedSourceId]);

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
          // El id es el nombre del WAV: el historial se reconstruye escaneando
          // la carpeta, y los metadatos se guardan como `{id}.json` al lado del
          // audio. Un id inventado aquí dejaría el .json huérfano y la
          // grabación se recargaría sin título, fecha ni duración.
          id: recordingIdFromPath(audioPath, startedAtRef.current),
          title: `Grabación ${new Date(startedAtRef.current).toLocaleDateString('es-ES')}`,
          startedAt: new Date(startedAtRef.current).toISOString(),
          durationSec: finalDuration,
          audioPath,
        };
      } catch (err) {
        setError(describeError(err));
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
      } catch (err) {
        setError(describeError(err));
      } finally {
        setPhase('done');
      }
    })();
  }, [clearTimer, phase]);

  const resetRecorder = useCallback(() => {
    setPhase('idle');
    setElapsedSec(0);
    setLiveNotes([]);
    setNoteDraft('');
  }, []);

  const openRecording = useCallback((recordingId: string) => {
    setSelectedRecordingId(recordingId);
    setActiveEntryIndex(null);
    setScreen('transcript');
    void (async () => {
      try {
        setTranscript(await services.storage.loadTranscript(recordingId));
      } catch (err) {
        setError(describeError(err));
      }
    })();
  }, []);

  const viewLatestTranscript = useCallback(() => {
    setPhase('idle');
    setActiveEntryIndex(null);
    setScreen('transcript');
  }, []);

  const commitNote = useCallback(() => {
    const text = noteDraftRef.current.trim();
    if (!text) return;
    const timeSec = elapsedRef.current;
    setLiveNotes((prev) => [...prev, { id: `note-${Date.now()}-${prev.length}`, timeSec, text }]);
    setNoteDraft('');
  }, []);

  const jumpToNote = useCallback(
    (timeSec: number) => {
      if (!transcript || transcript.entries.length === 0) return;
      setActiveEntryIndex(nearestEntryIndex(transcript.entries, timeSec));
    },
    [transcript],
  );

  const persistSettings = useCallback((next: Settings) => {
    setSettings(next);
    updateServices(next);
    void services.storage.saveSettings(next).catch((err) => setError(describeError(err)));
  }, []);

  const updateSettings = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        updateServices(next);
        void services.storage.saveSettings(next).catch((err) => setError(describeError(err)));
        return next;
      });
    },
    [],
  );

  const pickFolder = useCallback(
    (which: 'recordingFolder' | 'transcriptFolder' | 'obsidianVaultPath') => {
      const titleMap = {
        recordingFolder: 'Carpeta de grabaciones',
        transcriptFolder: 'Carpeta de transcripciones',
        obsidianVaultPath: 'Vault de Obsidian',
      };
      const title = titleMap[which];
      void (async () => {
        try {
          const current = settings[which];
          const currentPath = (typeof current === 'string' ? current : '') || '';
          const picked = await services.storage.pickFolder(title, currentPath);
          if (picked) persistSettings({ ...settings, [which]: picked });
        } catch (err) {
          setError(describeError(err));
        }
      })();
    },
    [persistSettings, settings],
  );

  const transcribeRecording = useCallback(
    (recordingId: string) => {
      const recording = recordings.find((r) => r.id === recordingId);
      if (!recording?.audioPath) return;

      setTranscribingRecordingId(recordingId);
      setProgress(null);
      setError(null);

      void (async () => {
        try {
          const entries = await services.transcription.transcribe(recording.audioPath ?? '');
          const currentNotes = transcript?.notes ?? [];
          const nextTranscript: Transcript = { recordingId, entries, notes: currentNotes };
          const transcriptPath = await services.storage.writeTranscript(
            recording,
            nextTranscript,
            settings.transcriptFormat,
          );
          const saved: Recording = { ...recording, transcriptPath };
          await services.storage.saveRecording(saved);

          setRecordings((prev) => [saved, ...prev.filter((r) => r.id !== saved.id)]);
          setTranscript(nextTranscript);
        } catch (err) {
          setError(describeError(err));
        } finally {
          setProgress(null);
          setTranscribingRecordingId(null);
        }
      })();
    },
    [recordings, settings.transcriptFormat, transcript?.notes],
  );

  const deleteRecording = useCallback((recordingId: string) => {
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
        setError(describeError(err));
      }
    })();
  }, [selectedRecordingId]);

  const renameRecording = useCallback((recordingId: string, newTitle: string) => {
    setError(null);
    void (async () => {
      try {
        await services.storage.renameRecording(recordingId, newTitle);
        setRecordings((prev) =>
          prev.map((r) => (r.id === recordingId ? { ...r, title: newTitle } : r)),
        );
        setTranscript((prev) => (prev?.recordingId === recordingId ? prev : prev));
      } catch (err) {
        setError(describeError(err));
      }
    })();
  }, []);

  const updateRecordingTags = useCallback((recordingId: string, tags: string[]) => {
    setError(null);
    setRecordings((prev) =>
      prev.map((r) => (r.id === recordingId ? { ...r, tags } : r)),
    );
    void (async () => {
      try {
        const updated = [...recordings].find((r) => r.id === recordingId);
        if (updated) {
          await services.storage.saveRecording({ ...updated, tags });
        }
      } catch (err) {
        setError(describeError(err));
      }
    })();
  }, [recordings]);

  const audioUrl = useCallback((audioPath: string) => services.storage.audioUrl(audioPath), []);

  const downloadModel = useCallback(() => {
    setModelBusy(true);
    setError(null);
    void (async () => {
      try {
        setModel(await services.transcription.downloadModel());
      } catch (err) {
        setError(describeError(err));
      } finally {
        setModelBusy(false);
        setProgress(null);
      }
    })();
  }, []);

  const selectedSourceLabel = useMemo(
    () => sources.find((s) => s.id === selectedSourceId)?.label ?? 'Sin fuente',
    [selectedSourceId, sources],
  );

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
      setNoteDraft,
      commitNote,
      toggleNotes: () => setNotesOpen((v) => !v),
      openRecording,
      jumpToNote,
      updateSettings,
      setTranscriptFormat: (format) => updateSettings({ transcriptFormat: format }),
      pickFolder,
      downloadModel,
      dismissError: () => setError(null),
    }),
    [
      audioUrl,
      commitNote,
      deleteRecording,
      downloadModel,
      jumpToNote,
      openRecording,
      pickFolder,
      renameRecording,
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
    recordings,
    selectedRecordingId,
    transcript,
    activeEntryIndex,
    error,
    model,
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
