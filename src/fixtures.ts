/**
 * Sample content carried over from the design prototype. The mock services read
 * from here so the UI is fully explorable before the native recorder and the
 * transcription backend exist. Nothing outside `services/mock.ts` should import
 * this file.
 */
import type { AudioSource, Note, Recording, TranscriptEntry } from '@/types';

export const SAMPLE_SOURCES: AudioSource[] = [
  { id: 'mic:internal', label: 'Micrófono interno', group: 'Entrada' },
  { id: 'mic:usb', label: 'Micrófono USB (Blue Yeti)', group: 'Entrada' },
  { id: 'sys:default', label: 'Audio del sistema (todo)', group: 'Audio del sistema' },
  { id: 'app:1001', label: 'Zoom', group: 'Aplicaciones' },
  { id: 'app:1002', label: 'Slack', group: 'Aplicaciones' },
  { id: 'app:1003', label: 'chrome', group: 'Aplicaciones' },
];

// `audioPath` va relleno para que el reproductor exista también en el navegador;
// `mockStorage.audioUrl` devuelve un clip vacío, así que se ve pero no suena.
export const SAMPLE_RECORDINGS: Recording[] = [
  {
    id: 'rec-1',
    title: 'Sync semanal de producto',
    startedAt: '2026-08-03T10:00:00.000Z',
    durationSec: 1450,
    audioPath: 'mock/rec-1.wav',
  },
  {
    id: 'rec-2',
    title: 'Llamada con cliente Acme',
    startedAt: '2026-07-30T15:30:00.000Z',
    durationSec: 2512,
    audioPath: 'mock/rec-2.wav',
  },
  {
    id: 'rec-3',
    title: 'Revisión de diseño Q3',
    startedAt: '2026-07-28T09:15:00.000Z',
    durationSec: 1117,
    audioPath: 'mock/rec-3.wav',
  },
];

export const SAMPLE_TRANSCRIPT: TranscriptEntry[] = [
  { timeSec: 8, speaker: 'Ana', text: 'Empezamos con el repaso de métricas de retención de la última semana.' },
  {
    timeSec: 42,
    speaker: 'Diego',
    text: 'La retención a 7 días bajó dos puntos respecto al mes pasado, sobre todo en usuarios nuevos.',
  },
  {
    timeSec: 95,
    speaker: 'Marta',
    text: 'Puede estar relacionado con el cambio de onboarding que lanzamos el jueves.',
  },
  { timeSec: 135, speaker: 'Ana', text: 'Vamos a necesitar el dataset actualizado para confirmar esa hipótesis.' },
  {
    timeSec: 180,
    speaker: 'Diego',
    text: 'Yo puedo pedirlo a analítica hoy mismo y compartirlo antes del viernes.',
  },
  {
    timeSec: 240,
    speaker: 'Marta',
    text: 'Pasamos al roadmap de producto. Tenemos tres iniciativas para el próximo trimestre.',
  },
  {
    timeSec: 300,
    speaker: 'Ana',
    text: 'La primera es mejorar la detección de fuente de audio cuando hay varias pestañas abiertas.',
  },
  {
    timeSec: 355,
    speaker: 'Diego',
    text: 'La segunda es un modo sin conexión para grabar sin depender de la red.',
  },
  { timeSec: 420, speaker: 'Marta', text: 'Y la tercera, plantillas de notas para reuniones recurrentes.' },
  { timeSec: 482, speaker: 'Ana', text: 'Necesitamos decidir la fecha de lanzamiento antes de que acabe el mes.' },
  {
    timeSec: 540,
    speaker: 'Diego',
    text: 'Propongo revisarlo la semana que viene con datos reales de los primeros tests.',
  },
  { timeSec: 590, speaker: 'Marta', text: 'De acuerdo. Cerramos aquí, gracias a todos.' },
];

export const SAMPLE_NOTES: Note[] = [
  { id: 'note-1', timeSec: 40, text: 'Repasar por qué bajó la retención a 7 días' },
  { id: 'note-2', timeSec: 130, text: 'Pedir a Marta el dataset actualizado' },
  { id: 'note-3', timeSec: 295, text: 'Priorizar detección de fuente de audio' },
  { id: 'note-4', timeSec: 415, text: 'Plantillas para reuniones recurrentes' },
  { id: 'note-5', timeSec: 480, text: 'Decidir fecha de lanzamiento' },
];
