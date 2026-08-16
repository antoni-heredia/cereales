/**
 * Spanish message catalogue. Typed against `Messages`, so it cannot drift out of
 * sync with `en.ts`: a missing key is a type error.
 */
import type { Messages } from './en';

export const es: Messages = {
  // ------------------------------------------------------------------ chrome
  'nav.record': 'Grabar',
  'nav.history': 'Historial',
  'nav.settings': 'Ajustes',
  'sidebar.obsidian': 'Obsidian',
  'sidebar.savingTo': 'Guardando en',

  // ------------------------------------------------------ pantalla de grabar
  'record.title': 'Nueva grabación',
  'record.statusReady': 'Listo para grabar',
  'record.statusLive': 'Grabando',
  'record.source': 'Fuente',
  'record.start': 'Grabar',
  'record.stop': 'Detener grabación',
  'record.saved': 'Grabación guardada · {duration}',
  'record.savedBody':
    'El audio quedó guardado. Puedes transcribir desde la pantalla de detalles.',
  'record.view': 'Ver grabación',
  'record.again': 'Nueva grabación',
  'record.hideNotes': 'Ocultar notas',
  'record.showNotes': 'Mostrar notas',
  'record.notesLabel': 'Notas en vivo · Enter para guardar con marca de tiempo',
  'record.notePlaceholder': 'Escribe una nota…',
  'record.shot': 'Captura',
  'record.shotBusy': 'Capturando…',

  // ------------------------------------------------------ editor de capturas
  'shot.title': 'Anotar captura',
  'shot.editTitle': 'Editar captura',
  'shot.viewTitle': 'Captura',
  'shot.at': 'Tomada en {time}',
  'shot.view': 'Ver la captura',
  'shot.edit': 'Volver a anotar',
  'shot.close': 'Cerrar',
  'shot.editSave': 'Guardar cambios',
  'shot.editCancel': 'Descartar cambios',
  'shot.tool.arrow': 'Flecha',
  'shot.tool.rect': 'Rectángulo',
  'shot.tool.pen': 'Lápiz',
  'shot.tool.text': 'Texto',
  'shot.tool.highlight': 'Marcador',
  'shot.tool.blur': 'Ocultar',
  'shot.tool.crop': 'Recortar',
  'shot.colorGroup': 'Color',
  'shot.color.accent': 'Rojo',
  'shot.color.yellow': 'Amarillo',
  'shot.color.green': 'Verde',
  'shot.color.blue': 'Azul',
  'shot.color.dark': 'Negro',
  'shot.color.white': 'Blanco',
  'shot.weightGroup': 'Grosor',
  'shot.cropApply': 'Aplicar recorte',
  'shot.cropHint':
    'Arrastra para elegir qué conservar. Ajústalo por las esquinas, arrastra dentro para moverlo y luego aplica.',
  'shot.blurHint': 'Lo que ocultas se borra de la imagen, no se tapa.',
  'shot.undo': 'Deshacer',
  'shot.canvas': 'Captura que se está anotando',
  'shot.textPlaceholder': 'Escribe y pulsa Enter',
  'shot.caption': 'Nota',
  'shot.captionPlaceholder': '¿Qué se ve aquí?',
  'shot.save': 'Añadir a las notas',
  'shot.saving': 'Guardando…',
  'shot.cancel': 'Descartar',

  // --------------------------------------------------- pantalla de historial
  'history.title': 'Historial de grabaciones',
  'history.empty': 'Todavía no hay grabaciones.',
  'history.open': 'Ver transcripción →',

  // ------------------------------------------------ pantalla de transcripción
  'transcript.noSelection': 'No hay ninguna grabación seleccionada.',
  'transcript.rename': 'Renombrar',
  'transcript.delete': 'Eliminar',
  'transcript.deleteConfirm': '¿Eliminar grabación y todos sus archivos?',
  'transcript.tags': 'Etiquetas',
  'transcript.tagsHint':
    'Una coma cierra la etiqueta. Van al frontmatter de la nota de Obsidian.',
  'transcript.missing': 'No hay transcripción disponible',
  'transcript.transcribe': 'Transcribir',
  'transcript.working': 'Transcribiendo audio…',
  'transcript.workingPercent': 'Transcribiendo audio… {percent}%',
  'transcript.seek': 'Ir a este momento del audio',
  'transcript.notesTitle': 'Notas tomadas durante la reunión',
  'transcript.notesEmpty': 'No se tomaron notas en esta reunión.',
  'transcript.speaker': 'Hablante {n}',
  'transcript.shotAlt': 'Captura tomada en {time}',

  // ----------------------------------------------------- editor de etiquetas
  'tags.placeholder': 'reunión, cliente',
  'tags.add': 'Añadir etiqueta',
  'tags.remove': 'Quitar la etiqueta {tag}',

  // ------------------------------------------------------ pantalla de ajustes
  'settings.title': 'Ajustes',
  'settings.languageGroup': 'Idioma',
  'settings.languageHint':
    'Afecta a la interfaz y a las notas que se generan: sus encabezados, sus fechas y las etiquetas de hablante. Lo que se habla en las grabaciones es otro ajuste.',
  'settings.storageGroup': 'Almacenamiento',
  'settings.vault': 'Vault de Obsidian',
  'settings.vaultUnlinked': 'Sin vincular',
  'settings.vaultLink': 'Vincular',
  'settings.vaultUnlink': 'Desvincular',
  'settings.storageHint':
    'Todo se guarda en {root}: el audio en {audio} y las notas en una carpeta por año.',
  'settings.storageHintLink': ' Vincula tu vault para que Obsidian las vea directamente.',
  'settings.audioGroup': 'Audio',
  'settings.defaultSource': 'Fuente de audio predeterminada',
  'settings.serviceGroup': 'Servicio de transcripción',
  'settings.serviceLocal': 'Local',
  'settings.serviceLocalHint':
    'La transcripción se hace en tu equipo: el audio no sale de la máquina.',
  'settings.serviceElevenLabsHint':
    'Usa la API de ElevenLabs para transcribir. Requiere una API key válida.',
  'settings.audioLangGroup': 'Idioma que se habla en las grabaciones',
  'settings.audioLangInterface': 'Igual que la interfaz',
  'settings.audioLangAuto': 'Detectar',
  'settings.audioLangHint':
    'Lo que se le anuncia al motor que va a oír. Equivocarse no es inocuo: si le dices un idioma que no es, whisper escribe la transcripción en ese idioma en vez de en el que se habló. Elige el idioma cuando lo sepas — le gana a la detección en los modelos pequeños.',
  'settings.modelGroup': 'Modelo local (whisper.cpp)',
  'settings.modelSelect': 'Modelo',
  'settings.modelStatus': 'Estado del modelo',
  'settings.modelMissing': 'No descargado',
  'settings.modelInstalled': 'Descargado',
  'settings.modelDownload': 'Descargar',
  'settings.modelDownloading': 'Descargando…',
  'settings.modelDownloadingPercent': 'Descargando… {percent}%',
  'settings.modelDelete': 'Borrar',
  'settings.modelDeleteConfirm': '¿Lo borro?',
  'settings.modelHint':
    'Cuanto más grande es el modelo, más precisa es la transcripción y más tarda. Una vez descargado no necesitas conexión a internet, y los que ya tengas se quedan en disco. Ninguno distingue hablantes, así que las líneas salen sin nombre.',
  // Los ids vienen del catálogo de `src-tauri/src/transcription.rs`.
  'model.tiny': 'Tiny — el más rápido, claramente el menos preciso',
  'model.base': 'Base — ágil, suficiente con audio limpio',
  'model.small': 'Small — el equilibrio recomendado',
  'model.medium': 'Medium — más preciso, bastante más lento',
  'model.large-v3-turbo': 'Large v3 Turbo — el más preciso, pide una máquina potente',
  'settings.elevenLabsGroup': 'Configuración de ElevenLabs',
  'settings.apiKey': 'API key',
  'settings.save': 'Guardar',
  'settings.apiKeyDirty': 'Sin guardar · Enter para guardar',
  'settings.apiKeySaved': 'Clave guardada.',
  'settings.apiKeyMissing': 'Sin clave: la transcripción con ElevenLabs fallará.',
  'settings.apiKeyGet': 'Obtén la tuya en',
  'settings.formatGroup': 'Formato de transcripción',

  // ---------------------------------------------------------- fuentes de audio
  'source.none': 'Sin fuente',
  'source.empty': 'No hay fuentes disponibles',
  'source.system': 'Audio del sistema (todo)',
  'source.microphone': 'Micrófono',
  'source.groupInput': 'Entrada',
  'source.groupSystem': 'Audio del sistema',
  'source.groupApps': 'Aplicaciones',

  // ------------------------------------------------------ grabaciones y fechas
  'recording.defaultTitle': 'Grabación {date}',
  'date.today': 'Hoy',

  // ------------------------------------------- cuerpo de las notas generadas
  'note.section': 'Notas',
  'note.sectionPlain': 'NOTAS',
  'note.screenshot': 'Captura',
  'transcript.section': 'Transcripción',

  // ------------------------------------------------------------------ errores
  'error.unexpected': 'Ha ocurrido un error inesperado.',

  'err.audio.onlyWindows': 'La captura de audio nativa solo está implementada en Windows.',
  'err.audio.recorderState': 'El estado del grabador quedó inconsistente.',
  'err.audio.alreadyRecording': 'Ya hay una grabación en curso.',
  'err.audio.notRecording': 'No hay ninguna grabación en curso.',
  'err.audio.unknownSource': 'Fuente de audio desconocida.',
  'err.audio.threadCrashed': 'El hilo de audio terminó de forma anómala.',
  'err.audio.threadStart': 'El hilo de captura no llegó a arrancar.',
  'err.audio.com': 'No se pudo inicializar el subsistema de audio de Windows.',
  'err.audio.enumerate': 'No se pudieron enumerar los dispositivos de audio.',
  'err.audio.openDevice': 'No se pudo abrir el dispositivo de audio seleccionado.',
  'err.audio.deviceFormat': 'El dispositivo no devolvió un formato de audio utilizable.',
  'err.audio.startCapture': 'No se pudo iniciar la captura de audio.',
  'err.audio.appCapture': 'No se pudo capturar el audio de esta aplicación.',
  'err.audio.read': 'Fallo leyendo del búfer de audio.',
  'err.audio.createFile': 'No se pudo crear el archivo de audio.',
  'err.audio.write': 'No se pudo escribir el archivo de audio.',
  'err.audio.closeFile': 'No se pudo cerrar el archivo de audio.',
  'err.audio.createDir': 'No se pudo crear la carpeta de audio.',

  'err.capture.onlyWindows': 'La captura de pantalla solo está implementada en Windows.',
  'err.capture.com': 'No se pudo inicializar el subsistema de imagen de Windows.',
  'err.capture.screen': 'No se pudo leer la pantalla.',
  'err.capture.bitmap': 'No se pudo reservar memoria para la captura.',
  'err.capture.blit': 'No se pudo copiar el contenido de la pantalla.',
  'err.capture.encode': 'No se pudo codificar la captura como PNG.',
  'err.capture.decode': 'No se pudo leer la captura anotada.',
  'err.capture.tooLarge': 'La captura es demasiado grande para guardarla.',

  'err.model.missing': 'Falta el modelo de transcripción. Descárgalo desde Ajustes.',
  'err.model.unknown': 'Ese modelo de transcripción no existe. Elige otro en Ajustes.',
  'err.model.dir': 'No se pudo resolver la carpeta de modelos.',
  'err.model.download': 'No se pudo descargar el modelo.',
  'err.model.save': 'No se pudo guardar el modelo descargado.',
  'err.model.load': 'No se pudo cargar el modelo de transcripción.',
  'err.model.delete': 'No se pudo borrar el modelo.',

  'err.transcribe.readAudio': 'No se pudo leer el audio grabado.',
  'err.transcribe.failed': 'La transcripción falló.',

  'err.storage.invalidId': 'Identificador de grabación inválido.',
  'err.storage.invalidPath': 'Ruta de transcripción inválida.',
  'err.storage.notFound': 'Grabación no encontrada.',
  'err.storage.read': 'No se pudo leer del disco.',
  'err.storage.write': 'No se pudo escribir en el disco.',

  'err.elevenlabs.noKey': 'Falta la API key de ElevenLabs. Añádela en Ajustes.',
  'err.elevenlabs.http': 'ElevenLabs respondió {status}: {detail}',
  'err.elevenlabs.readAudio': 'No se pudo leer el audio ({status}): {path}',
};
