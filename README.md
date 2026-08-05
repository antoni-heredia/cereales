# cereales

Grabador de reuniones de escritorio: graba el audio del sistema, de un micrófono
o de una aplicación concreta, lo transcribe **en local** y te deja tomar notas con
marca de tiempo que enlazan con el punto exacto de la transcripción.

La interfaz está portada del prototipo de Claude Design (`cereales.dc.html`).

## Cómo funciona

- **Captura**: WASAPI directamente (`src-tauri/src/audio/win.rs`). Tres modos por
  el mismo camino de código: micrófono, loopback del endpoint de salida
  (todo el audio del sistema) y *process loopback* para una aplicación concreta.
- **Transcripción**: whisper.cpp vía `whisper-rs`, con el modelo `ggml-small`
  corriendo en tu CPU. El audio nunca sale de la máquina.
- **Almacenamiento**: los ajustes y el índice de grabaciones viven en la carpeta
  de configuración de la app; las transcripciones se escriben en la carpeta que
  elijas, en TXT, Markdown o SRT.

### Solo Windows

La captura es específica de Windows. En otros sistemas la app compila, pero los
comandos de audio devuelven un error explícito en lugar de fingir que funcionan.
El *process loopback* necesita Windows 10 2004 (build 19041) o posterior.

### Dos límites que conviene saber

- **No se puede capturar una pestaña concreta del navegador.** El prototipo lo
  ofrecía, pero Windows captura por *proceso* y un navegador mete todas sus
  pestañas en el mismo árbol. Lo que verás en el desplegable es la aplicación
  entera ("chrome", "Zoom"), y por eso el grupo "Pestañas del navegador" ya no
  existe.
- **whisper.cpp no distingue hablantes.** Las líneas de la transcripción salen sin
  nombre; la interfaz oculta esa línea en vez de inventarse un "Hablante 1". Para
  tener diarización de verdad haría falta un backend distinto (Deepgram,
  AssemblyAI), que implica subir el audio a un tercero.
- **whisper inventa etiquetas en los silencios** ("[MÚSICA]", "[BLANK_AUDIO]").
  Se descartan al leer los segmentos: además de no ser habla, competían por el
  salto desde una nota y podían robarle el sitio a la frase real.

### Los silencios se rellenan a mano

En loopback, WASAPI no entrega paquetes mientras no suena nada. Sin compensarlo,
el WAV sale más corto que la reunión y las marcas de tiempo dejan de cuadrar con
las notas. El hilo de captura lleva su propio reloj y rellena los huecos con
silencio; `la_duracion_capturada_sigue_al_reloj` cubre esa propiedad.

### El audio se guarda en mono a 16 kHz

Es lo que consume whisper y sobra para voz; evita guardar el original y volver a
remuestrear. Si te interesa conservar la calidad completa de la grabación, hay que
cambiar `OUT_RATE` y el `WavSpec` en `audio/win.rs` y remuestrear al transcribir.

## Requisitos

- Node 20+
- Rust (toolchain `x86_64-pc-windows-msvc`)
- MSVC Build Tools con "Desktop development with C++"
- CMake y LLVM/libclang — los necesita `whisper-rs` para compilar whisper.cpp

```bash
winget install Rustlang.Rustup Kitware.CMake LLVM.LLVM
```

## Uso

```bash
npm install
npm run tauri:dev
```

La primera vez hay que descargar el modelo desde **Ajustes → Modelo de
transcripción** (~490 MB). Sin él se puede grabar, pero la transcripción falla con
un aviso y la grabación se conserva igual.

Solo la interfaz, en el navegador y con datos de ejemplo (no necesita Rust):

```bash
npm run dev
```

Comprobaciones:

```bash
npm run typecheck && npm run build
```

Los tests de Rust se ejecutan contra el WASAPI real de la máquina: enumeran
dispositivos, graban de verdad del micrófono, del sistema y de una aplicación, y
transcriben un audio de voz. El de transcripción se omite solo si el modelo no
está descargado.

```bash
cd src-tauri && cargo test --lib -- --test-threads=1
```

## Arquitectura

```
src/
  services/        Frontera con el mundo nativo
    types.ts       Interfaces (AudioService, TranscriptionService, StorageService)
    native.ts      Envoltorio de los comandos de Tauri
    mock.ts        Equivalente en navegador, para `npm run dev`
    index.ts       Elige uno u otro según isTauri()
  state/store.tsx  Estado de la app (contexto de React)
  screens/         Grabar · Historial · Ajustes · Transcripción
  components/      Sidebar, SourcePicker, Waveform
  lib/             Formato de tiempo y serialización TXT/Markdown/SRT
  styles/          tokens.css (paleta del prototipo) + global.css + app.css
src-tauri/src/
  audio/win.rs     Captura WASAPI: enumeración y los tres modos
  audio/mod.rs     Comandos y estado del grabador
  transcription.rs whisper.cpp + descarga del modelo
  dsp.rs           Mezcla a mono, remuestreo y medidor de niveles
  storage.rs       Ajustes, índice de grabaciones, escritura de transcripciones
  model.rs         Tipos compartidos con el frontend (camelCase vía serde)
```

Los nombres de los comandos y las formas de los datos están fijados en
`src/services/native.ts` y `src-tauri/src/model.rs`: si cambias uno, cambia el otro.

Eventos que emite el backend:

| Evento | Carga | Para qué |
| --- | --- | --- |
| `audio://levels` | `number[]` de 24 valores 0..1 | Barras del medidor durante la grabación |
| `model://progress` | `{ percent, stage }` | Descarga del modelo y avance de la transcripción |

## Notas

- La serialización de transcripciones vive en TypeScript (`src/lib/serialize.ts`);
  Rust solo escribe los bytes, para no tener dos implementaciones de los formatos.
- Los iconos de `src-tauri/icons/` son marcadores de posición generados.
  Para sustituirlos: `npm run tauri icon ruta/al/icono.png`.
- `csp` está en `null` en `tauri.conf.json` porque la fuente Archivo se carga desde
  Google Fonts. Empaquetar la fuente en local y activar una CSP estricta es
  pendiente.
