// Which files are recordings (for the Audio to MIDI page). Kept apart from
// the converter so the app can tell without loading it.

/** Audio files the browser can usually decode. */
export const AUDIO_FILE = /\.(wav|wave|mp3|ogg|oga|flac|m4a|aac|webm)$/i

/** A recording, but not a MIDI file (which browsers also call audio). */
export const isAudioFile = (f: File) =>
  !/\.midi?$/i.test(f.name) &&
  (AUDIO_FILE.test(f.name) ||
    (f.type.startsWith("audio/") && !/midi/.test(f.type)))
