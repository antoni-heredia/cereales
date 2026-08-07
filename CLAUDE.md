# CLAUDE.md

Guía para agentes que trabajan en este repositorio. El [README](README.md)
explica el producto, sus límites y la arquitectura con detalle; aquí está lo
operativo: qué comandos usar, qué convenciones respetar y qué no tocar a mano.

## El proyecto en una línea

Grabador de reuniones de escritorio (Tauri 2 + React + Rust) que captura audio
por WASAPI, lo transcribe en local con whisper.cpp y ancla notas a la marca de
tiempo exacta. **Solo Windows**: la captura está escrita contra WASAPI y en otros
sistemas los comandos de audio devuelven un error explícito.

## Comandos

```bash
npm install              # dependencias del frontend
npm run dev              # solo UI en el navegador, con datos de ejemplo (sin Rust)
npm run tauri:dev        # app completa (requiere toolchain de Rust + MSVC + CMake + LLVM)
npm run typecheck        # tsc --noEmit
npm run build            # typecheck + vite build
npm run tauri:build      # binario empaquetado
```

Tests de Rust (se ejecutan contra el WASAPI real de la máquina: enumeran
dispositivos y graban de verdad, por eso van en un solo hilo):

```bash
cd src-tauri && cargo test --lib -- --test-threads=1
```

El test de transcripción se omite solo si el modelo `ggml-small` no está
descargado. La descarga se hace desde la propia app en **Ajustes → Modelo de
transcripción** (~490 MB).

## Reglas del código

- **`src/services/native.ts` y `src-tauri/src/model.rs` son un contrato.** Los
  nombres de los comandos de Tauri y la forma de los datos están fijados en los
  dos sitios: si cambias uno, cambia el otro en el mismo commit. Rust serializa
  en camelCase vía serde.
- **La serialización de transcripciones (TXT/Markdown/SRT) vive en TypeScript**
  (`src/lib/serialize.ts`). Rust solo escribe los bytes. No añadas una segunda
  implementación de los formatos en Rust.
- **La captura de audio es específica de Windows** (`src-tauri/src/audio/win.rs`).
  El *process loopback* necesita Windows 10 build 19041 o posterior. Al añadir
  código nativo, mantén el patrón de devolver un error explícito fuera de Windows
  en lugar de fingir que funciona.
- **El audio se guarda en mono a 16 kHz** (`OUT_RATE` en `audio/win.rs`), que es
  lo que consume whisper. Cambiar eso obliga a remuestrear al transcribir.
- **Los silencios se rellenan a mano.** En loopback WASAPI no entrega paquetes si
  no suena nada; el hilo de captura lleva su propio reloj y rellena los huecos.
  El test `la_duracion_capturada_sigue_al_reloj` cubre esa propiedad — no lo
  desactives al tocar el bucle de captura.
- **Idioma**: el código, los comentarios, los commits y la interfaz están en
  español. Sigue esa convención.

## Convención de commits

El repositorio usa [Conventional Commits](https://www.conventionalcommits.org/)
y **el mensaje del commit decide la versión que se publica**, así que no es
cosmético:

| Prefijo del commit | Incremento | Ejemplo |
| --- | --- | --- |
| `feat!:`, `fix(scope)!:`, o `BREAKING CHANGE` en el cuerpo | **major** | `feat!: cambiar el formato del índice de grabaciones` |
| `feat:` | **minor** | `feat: exportar la transcripción a SRT` |
| `fix:`, `perf:`, `refactor:`, `docs:`, `chore:`, … | **patch** | `fix: corregir el desfase de las marcas de tiempo` |

Se analizan todos los commits desde el último tag: basta un `feat:` entre ellos
para que el incremento sea minor.

## Versionado y publicación

La versión se incrementa **sola** al hacer push a `main`. El flujo está en
[.github/workflows/version-bump.yml](.github/workflows/version-bump.yml):

1. Deduce el nivel (major/minor/patch) de los commits desde el último tag.
2. Ejecuta [.github/scripts/bump-version.mjs](.github/scripts/bump-version.mjs),
   que sincroniza la versión en los cinco sitios donde vive.
3. Commitea como `chore(release): vX.Y.Z [skip ci]`.
4. **Crea el tag anotado `vX.Y.Z` y lo pushea.**
5. Publica una GitHub Release con notas autogeneradas.

### No edites la versión a mano

La versión aparece en cinco sitios y tienen que ir sincronizados:

| Fichero | Dónde |
| --- | --- |
| `package.json` | clave `version` de raíz |
| `package-lock.json` | `version` de raíz y `packages[""].version` |
| `src-tauri/tauri.conf.json` | clave `version` de raíz |
| `src-tauri/Cargo.toml` | `version` de la sección `[package]` |
| `src-tauri/Cargo.lock` | bloque `[[package]]` de `name = "cereales"` |

Si necesitas subir la versión en local, usa el script en lugar de editar los
ficheros:

```bash
node .github/scripts/bump-version.mjs minor
```

Acepta `major`, `minor` o `patch` e imprime la nueva versión por stdout. Es
idempotente respecto al formato: reemplaza solo el valor, sin reserializar los
JSON, para no meter ruido en el diff.

### Publicar una versión concreta

Desde la pestaña **Actions → Version bump → Run workflow** se puede forzar el
nivel (`major`/`minor`/`patch`) en vez de dejar que se deduzca.

### Detalles del workflow

- No se autodispara: los pushes hechos con `GITHUB_TOKEN` no lanzan workflows, y
  además el commit de release lleva `[skip ci]`.
- Necesita `permissions: contents: write`. Si `main` tiene protección de rama,
  hay que permitir el push de `github-actions[bot]` o usar un PAT/GitHub App.
- `concurrency: version-bump` evita que dos pushes seguidos se pisen creando el
  mismo tag.

## Detalles que suelen sorprender

- **No se puede capturar una pestaña concreta del navegador.** Windows captura
  por proceso y un navegador mete todas sus pestañas en el mismo árbol; el
  desplegable ofrece la aplicación entera.
- **whisper.cpp no distingue hablantes.** La UI oculta la línea del hablante en
  vez de inventarse un "Hablante 1".
- **whisper inventa etiquetas en los silencios** (`[MÚSICA]`, `[BLANK_AUDIO]`);
  se descartan al leer los segmentos.
- **`csp` está en `null`** en `tauri.conf.json` porque la fuente Archivo se carga
  desde Google Fonts. Empaquetarla en local y activar una CSP estricta sigue
  pendiente.
- **Los iconos de `src-tauri/icons/` son marcadores de posición** generados
  (`npm run tauri icon ruta/al/icono.png` para sustituirlos).
