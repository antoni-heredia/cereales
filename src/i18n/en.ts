/**
 * English message catalogue — the source of truth for the message keys.
 *
 * `es.ts` is typed as `Messages`, so a key added here without a Spanish
 * translation fails `npm run typecheck` instead of silently rendering English
 * to a Spanish user.
 *
 * Keys under `err.` mirror the error keys the Rust side returns; see
 * `src-tauri/src/errors.rs`.
 */
export const en = {
  // ------------------------------------------------------------------ chrome
  'nav.record': 'Record',
  'nav.history': 'History',
  'nav.settings': 'Settings',
  'sidebar.obsidian': 'Obsidian',
  'sidebar.savingTo': 'Saving to',

  // ----------------------------------------------------------- record screen
  'record.title': 'New recording',
  'record.statusReady': 'Ready to record',
  'record.statusLive': 'Recording',
  'record.source': 'Source',
  'record.start': 'Record',
  'record.stop': 'Stop recording',
  'record.saved': 'Recording saved · {duration}',
  'record.savedBody': 'The audio is stored. You can transcribe it from the details screen.',
  'record.view': 'View recording',
  'record.again': 'New recording',
  'record.hideNotes': 'Hide notes',
  'record.showNotes': 'Show notes',
  'record.notesLabel': 'Live notes · Enter to save with a timestamp',
  'record.notePlaceholder': 'Write a note…',
  'record.shot': 'Screenshot',
  'record.shotBusy': 'Capturing…',

  // ------------------------------------------------------- screenshot editor
  'shot.title': 'Annotate screenshot',
  'shot.editTitle': 'Edit screenshot',
  'shot.viewTitle': 'Screenshot',
  'shot.at': 'Taken at {time}',
  'shot.view': 'View screenshot',
  'shot.edit': 'Annotate again',
  'shot.close': 'Close',
  'shot.editSave': 'Save changes',
  'shot.editCancel': 'Discard changes',
  'shot.tool.arrow': 'Arrow',
  'shot.tool.rect': 'Rectangle',
  'shot.tool.pen': 'Pen',
  'shot.tool.text': 'Text',
  'shot.tool.highlight': 'Highlighter',
  'shot.tool.blur': 'Redact',
  'shot.tool.crop': 'Crop',
  'shot.colorGroup': 'Colour',
  'shot.color.accent': 'Red',
  'shot.color.yellow': 'Yellow',
  'shot.color.green': 'Green',
  'shot.color.blue': 'Blue',
  'shot.color.dark': 'Black',
  'shot.color.white': 'White',
  'shot.weightGroup': 'Thickness',
  'shot.cropApply': 'Apply crop',
  'shot.cropHint':
    'Drag to choose what to keep. Adjust it by the corners, drag inside to move it, then apply.',
  'shot.blurHint': 'What you redact is erased from the image, not covered up.',
  'shot.undo': 'Undo',
  'shot.canvas': 'Screenshot being annotated',
  'shot.textPlaceholder': 'Type and press Enter',
  'shot.caption': 'Note',
  'shot.captionPlaceholder': 'What does this show?',
  'shot.save': 'Add to notes',
  'shot.saving': 'Saving…',
  'shot.cancel': 'Discard',

  // ---------------------------------------------------------- history screen
  'history.title': 'Recording history',
  'history.empty': 'No recordings yet.',
  'history.open': 'View transcript →',

  // ------------------------------------------------------- transcript screen
  'transcript.noSelection': 'No recording selected.',
  'transcript.rename': 'Rename',
  'transcript.delete': 'Delete',
  'transcript.deleteConfirm': 'Delete this recording and all of its files?',
  'transcript.tags': 'Tags',
  'transcript.tagsHint': 'A comma closes the tag. Tags go into the Obsidian note frontmatter.',
  'transcript.missing': 'No transcript available',
  'transcript.transcribe': 'Transcribe',
  'transcript.engine': 'Transcribe with',
  'transcript.noEngine':
    'Nothing can transcribe yet. Download a model, or add an API key, in Settings.',
  'engine.local': 'Local',
  'engine.onDevice': 'on this machine',
  'engine.uploads': 'uploads the audio to {service}',
  'transcript.working': 'Transcribing audio…',
  'transcript.workingPercent': 'Transcribing audio… {percent}%',
  'transcript.seek': 'Jump to this point in the audio',
  'transcript.notesTitle': 'Notes taken during the meeting',
  'transcript.notesEmpty': 'No notes were taken in this meeting.',
  'transcript.speaker': 'Speaker {n}',
  'transcript.shotAlt': 'Screenshot taken at {time}',

  // ------------------------------------------------------------- tag editor
  'tags.placeholder': 'meeting, client',
  'tags.add': 'Add tag',
  'tags.remove': 'Remove tag {tag}',

  // --------------------------------------------------------- settings screen
  'settings.title': 'Settings',
  'settings.languageGroup': 'Language',
  'settings.languageHint':
    'Applies to the interface and to the generated notes: their headings, their dates and the speaker labels. What is spoken in the recordings is a separate setting.',
  'settings.storageGroup': 'Storage',
  'settings.vault': 'Obsidian vault',
  'settings.vaultUnlinked': 'Not linked',
  'settings.vaultLink': 'Link',
  'settings.vaultUnlink': 'Unlink',
  'settings.storageHint':
    'Everything is saved under {root}: audio in {audio} and notes in a folder per year.',
  'settings.storageHintLink': ' Link your vault so Obsidian picks them up directly.',
  'settings.audioGroup': 'Audio',
  'settings.defaultSource': 'Default audio source',
  'settings.serviceGroup': 'Transcription service',
  'settings.serviceLocal': 'Local',
  'settings.serviceLocalHint':
    'Transcription runs on your machine: the audio never leaves the computer.',
  'settings.serviceElevenLabsHint':
    'Uses the ElevenLabs API to transcribe. Requires a valid API key.',
  'settings.serviceDeepgramHint':
    'Uses the Deepgram API to transcribe. Requires a valid API key.',
  'settings.serviceDefaultHint':
    'This is only what gets proposed: the engine can be changed for a single recording before transcribing it.',
  'settings.audioLangGroup': 'Language spoken in the recordings',
  'settings.audioLangInterface': 'Same as the interface',
  'settings.audioLangAuto': 'Detect',
  'settings.audioLangHint':
    'What the engine is told to expect in the audio. Getting it wrong is not harmless: told the wrong language, whisper writes the transcript in that language instead of the one that was spoken. Pick the language when you know it — it beats detection on the smaller models.',
  'settings.modelGroup': 'Local model (whisper.cpp)',
  'settings.modelSelect': 'Model',
  'settings.modelStatus': 'Model status',
  'settings.modelMissing': 'Not downloaded',
  'settings.modelInstalled': 'Downloaded',
  'settings.modelDownload': 'Download',
  'settings.modelDownloading': 'Downloading…',
  'settings.modelDownloadingPercent': 'Downloading… {percent}%',
  'settings.modelDelete': 'Delete',
  'settings.modelDeleteConfirm': 'Delete it?',
  'settings.modelHint':
    'The bigger the model, the more accurate the transcription and the longer it takes. Once downloaded you no longer need an internet connection, and models you already have stay on disk. None of them tells speakers apart, so lines come out unattributed.',
  // The ids come from the catalogue in `src-tauri/src/transcription.rs`.
  'model.tiny': 'Tiny — the fastest, clearly the least accurate',
  'model.base': 'Base — quick, fine for clean audio',
  'model.small': 'Small — the recommended balance',
  'model.medium': 'Medium — more accurate, noticeably slower',
  'model.large-v3-turbo': 'Large v3 Turbo — the most accurate, needs a capable machine',
  'settings.elevenLabsGroup': 'ElevenLabs configuration',
  'settings.deepgramGroup': 'Deepgram configuration',
  'settings.apiKey': 'API key',
  'settings.save': 'Save',
  'settings.apiKeyDirty': 'Unsaved · Enter to save',
  'settings.apiKeySaved': 'Key saved.',
  'settings.apiKeyMissing': 'No key: transcription with ElevenLabs will fail.',
  'settings.apiKeyGet': 'Get yours at',
  'settings.formatGroup': 'Transcript format',

  // ---------------------------------------------------------- audio sources
  'source.none': 'No source',
  'source.empty': 'No sources available',
  'source.system': 'System audio (everything)',
  'source.microphone': 'Microphone',
  'source.groupInput': 'Input',
  'source.groupSystem': 'System audio',
  'source.groupApps': 'Applications',

  // ------------------------------------------------------- recordings, dates
  'recording.defaultTitle': 'Recording {date}',
  'date.today': 'Today',

  // --------------------------------------------- generated transcript bodies
  'note.section': 'Notes',
  'note.sectionPlain': 'NOTES',
  'note.screenshot': 'Screenshot',
  'transcript.section': 'Transcript',

  // ------------------------------------------------------------------ errors
  'error.unexpected': 'Something went wrong.',

  'err.audio.onlyWindows': 'Native audio capture is only implemented on Windows.',
  'err.audio.recorderState': 'The recorder state became inconsistent.',
  'err.audio.alreadyRecording': 'A recording is already in progress.',
  'err.audio.notRecording': 'There is no recording in progress.',
  'err.audio.unknownSource': 'Unknown audio source.',
  'err.audio.threadCrashed': 'The audio thread ended abnormally.',
  'err.audio.threadStart': 'The capture thread never started.',
  'err.audio.com': 'Could not initialise the Windows audio subsystem.',
  'err.audio.enumerate': 'Could not list the audio devices.',
  'err.audio.openDevice': 'Could not open the selected audio device.',
  'err.audio.deviceFormat': 'The device did not report a usable audio format.',
  'err.audio.startCapture': 'Could not start the audio capture.',
  'err.audio.appCapture': 'Could not capture this application’s audio.',
  'err.audio.read': 'Failed while reading from the audio buffer.',
  'err.audio.createFile': 'Could not create the audio file.',
  'err.audio.write': 'Could not write the audio file.',
  'err.audio.closeFile': 'Could not close the audio file.',
  'err.audio.createDir': 'Could not create the audio folder.',

  'err.capture.onlyWindows': 'Screen capture is only implemented on Windows.',
  'err.capture.com': 'Could not initialise the Windows imaging subsystem.',
  'err.capture.screen': 'Could not read the screen.',
  'err.capture.bitmap': 'Could not reserve memory for the screenshot.',
  'err.capture.blit': 'Could not copy the contents of the screen.',
  'err.capture.encode': 'Could not encode the screenshot as PNG.',
  'err.capture.decode': 'The annotated screenshot could not be read.',
  'err.capture.tooLarge': 'The screenshot is too large to save.',

  'err.model.missing': 'The transcription model is missing. Download it from Settings.',
  'err.model.unknown': 'That transcription model does not exist. Pick another one in Settings.',
  'err.model.dir': 'Could not resolve the model folder.',
  'err.model.download': 'Could not download the model.',
  'err.model.save': 'Could not save the downloaded model.',
  'err.model.load': 'Could not load the transcription model.',
  'err.model.delete': 'Could not delete the model.',

  'err.transcribe.readAudio': 'Could not read the recorded audio.',
  'err.transcribe.failed': 'Transcription failed.',

  'err.storage.invalidId': 'Invalid recording identifier.',
  'err.storage.invalidPath': 'Invalid transcript path.',
  'err.storage.notFound': 'Recording not found.',
  'err.storage.read': 'Could not read from disk.',
  'err.storage.write': 'Could not write to disk.',

  'err.elevenlabs.noKey': 'The ElevenLabs API key is missing. Add it in Settings.',
  'err.elevenlabs.http': 'ElevenLabs replied with {status}: {detail}',
  'err.deepgram.noKey': 'The Deepgram API key is missing. Add it in Settings.',
  'err.deepgram.http': 'Deepgram replied with {status}: {detail}',
  // Reading the recorded WAV has nothing to do with which service was picked,
  // so both remote engines share the one message.
  'err.remote.readAudio': 'Could not read the audio file ({status}): {path}',
} as const;

export type MessageKey = keyof typeof en;
/** Every key, any string: `as const` above must not pin translations to the English text. */
export type Messages = Record<MessageKey, string>;
