/**
 * Transcripción con la API Scribe de ElevenLabs.
 *
 * Alternativa al modelo local: el audio sale de la máquina, pero a cambio no
 * hay que bajarse medio giga de modelo ni pagar el rato de CPU. Y, a diferencia
 * de whisper.cpp, sí diariza, así que las líneas pueden salir con hablante.
 */
import { convertFileSrc } from '@tauri-apps/api/core';
import type { ModelStatus, NativeProgress, TranscriptEntry } from '@/types';
import type { TranscriptionService } from './types';

const ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text';
/** Modelo de Scribe. `model_id` es obligatorio: sin él la API responde 422. */
const MODEL_ID = 'scribe_v1';

/** Palabra suelta tal y como la devuelve Scribe; `start`/`end` van en segundos. */
interface ScribeWord {
  text: string;
  start?: number;
  end?: number;
  /** "word" | "spacing" | "audio_event" */
  type?: string;
  speaker_id?: string;
}

export interface ScribeResponse {
  text?: string;
  words?: ScribeWord[];
}

/** Corta un segmento al cerrar frase, para no pintar una entrada por palabra. */
const FIN_DE_FRASE = /[.!?…]["')\]]?$/;
/** Techos de seguridad por si el audio no trae puntuación. */
const MAX_SEGMENTO_SEG = 15;
const MAX_SEGMENTO_CHARS = 220;

export const elevenLabsTranscription = (apiKey: string): TranscriptionService => {
  let onProgressCb: ((progress: NativeProgress) => void) | null = null;
  const emit = (percent: number, stage: string) => onProgressCb?.({ percent, stage });

  return {
    async transcribe(audioPath: string): Promise<TranscriptEntry[]> {
      if (!apiKey) {
        throw new Error('Falta la API key de ElevenLabs. Añádela en Ajustes.');
      }

      emit(0, 'transcribiendo');
      const audio = await readAudioFile(audioPath);

      const form = new FormData();
      // El nombre de archivo importa: la API lo usa para deducir el contenedor.
      form.append('file', new Blob([audio], { type: 'audio/wav' }), 'grabacion.wav');
      form.append('model_id', MODEL_ID);
      form.append('language_code', 'spa');
      form.append('diarize', 'true');
      form.append('timestamps_granularity', 'word');

      emit(30, 'transcribiendo');
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey },
        body: form,
      });

      if (!response.ok) {
        // El cuerpo del error de ElevenLabs dice qué campo sobra o falta; se
        // propaga tal cual porque adivinarlo desde el código de estado no sirve.
        const detalle = await response.text().catch(() => '');
        throw new Error(`ElevenLabs respondió ${response.status}: ${detalle || 'sin detalle'}`);
      }

      emit(80, 'transcribiendo');
      const result = (await response.json()) as ScribeResponse;
      emit(100, 'transcribiendo');

      return agruparEnSegmentos(result);
    },

    // No hay nada que instalar: el "modelo" está listo en cuanto hay clave.
    async modelStatus(): Promise<ModelStatus> {
      return { installed: !!apiKey, name: 'ElevenLabs Scribe', bytes: 0 };
    },

    async downloadModel(): Promise<ModelStatus> {
      return { installed: !!apiKey, name: 'ElevenLabs Scribe', bytes: 0 };
    },

    onProgress(cb) {
      onProgressCb = cb;
      return () => {
        onProgressCb = null;
      };
    },
  };
};

/**
 * Scribe devuelve palabra a palabra. Una entrada por palabra dejaría la
 * transcripción ilegible y rompería el salto desde una nota, que busca la
 * entrada más cercana en el tiempo: se agrupan en frases.
 */
export function agruparEnSegmentos(result: ScribeResponse): TranscriptEntry[] {
  const words = result.words ?? [];
  if (words.length === 0) {
    const text = result.text?.trim();
    return text ? [{ timeSec: 0, speaker: '', text }] : [];
  }

  // Con un solo hablante el nombre no aporta nada, y la interfaz ya oculta la
  // línea cuando va vacío.
  const hablantes = new Set(
    words.filter((w) => w.type !== 'spacing').map((w) => w.speaker_id).filter(Boolean),
  );
  const diariza = hablantes.size > 1;

  const entries: TranscriptEntry[] = [];
  // Un segmento abierto se representa con un objeto, no con "el buffer no está
  // vacío": el espaciado ensucia el buffer y haría creer que sigue abierto.
  let abierto: { inicio: number; hablante?: string; partes: string[] } | null = null;

  const cerrar = () => {
    if (!abierto) return;
    const text = abierto.partes.join('').trim();
    if (text) {
      entries.push({
        timeSec: abierto.inicio,
        speaker: diariza ? etiqueta(abierto.hablante) : '',
        text,
      });
    }
    abierto = null;
  };

  for (const word of words) {
    // El espaciado solo separa palabras: nunca abre segmento ni decide hablante.
    if (word.type === 'spacing') {
      abierto?.partes.push(word.text ?? ' ');
      continue;
    }

    if (abierto && word.speaker_id !== abierto.hablante) cerrar();
    if (!abierto) {
      abierto = { inicio: word.start ?? 0, hablante: word.speaker_id, partes: [] };
    }
    abierto.partes.push(word.text ?? '');

    const texto = abierto.partes.join('');
    const fin = word.end ?? word.start ?? abierto.inicio;
    const largo = texto.length >= MAX_SEGMENTO_CHARS;
    const duracion = fin - abierto.inicio >= MAX_SEGMENTO_SEG;
    if (FIN_DE_FRASE.test(texto.trimEnd()) || largo || duracion) cerrar();
  }
  cerrar();

  return entries;
}

/** "speaker_0" -> "Hablante 1". */
function etiqueta(speakerId: string | undefined): string {
  if (!speakerId) return '';
  const n = Number(speakerId.match(/\d+/)?.[0]);
  return Number.isFinite(n) ? `Hablante ${n + 1}` : speakerId;
}

/**
 * Lee el WAV grabado. Va por el protocolo `asset://` de Tauri en lugar de
 * `file://`, que el webview bloquea como recurso local.
 */
async function readAudioFile(audioPath: string): Promise<ArrayBuffer> {
  const response = await fetch(convertFileSrc(audioPath));
  if (!response.ok) {
    throw new Error(`No se pudo leer el audio (${response.status}): ${audioPath}`);
  }
  return response.arrayBuffer();
}
