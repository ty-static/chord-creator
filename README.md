# Chord Creator

Write chord progressions, melodies, bass and drums in any key, hear them with
sampled instruments, and export a multi-track MIDI file for your DAW.

**Live:** https://chord-creator-wheat.vercel.app

## Features

- **Key & tempo** — 12 roots × 9 scales (major, minor and the modes); chords
  and melody are stored as scale degrees, so changing key moves everything.
- **Song sections** — verse, chorus, bridge and more, each with its own
  chords, melody and drum beat. Order and repeat them as a form (`A A B A`):
  drag, type the letters, loop one part, or split off a variation.
- **Chords** — diatonic palette, presets, randomize, triads/7ths/9ths/sus,
  inversions, drag to reorder, optional automatic voice leading.
- **Chords outside the key** — secondary dominants (V7/V…), borrowed chords
  (iv, ♭VI, ♭VII, ♭III, the Neapolitan ♭II; V, IV and a Picardy I in minor),
  and "next chord" suggestions from common progressions. A MIDI keyboard
  recognises them too.
- **Melody** — piano-roll editor (draw, drag, resize, keyboard nudging),
  generator with density control, per-bar regenerate / repeat motif
  (exact or following the chords), and note locking.
- **Drums** — 16-step pattern with accents, 9 preset grooves, fill and crash
  options, five sampled drum machines.
- **Sound** — sampled piano, pads, strings, bass and more (via
  [smplr](https://github.com/danigb/smplr)), per-track volume / mute / solo,
  reverb, built-in synth fallback when offline.
- **Timeline** — the whole form with section colours; click to play from a
  bar, drag to loop bars. Playback keeps going while you edit.
- **MIDI export** — format-1 file with tempo, key signature, programs,
  section markers and separate chord / melody / bass / drum tracks (drums on
  channel 10).
- **WAV export** — renders the song offline with the same instruments, mix
  and reverb, as 16-bit 44.1 kHz stereo.
- **MIDI import** — reads `.mid` files, guesses each track's role and the key,
  and converts them into chords, melody and a drum pattern.
- **MIDI keyboard** — Web MIDI input (Chrome/Edge): play through the current
  instrument, add chords by playing them, step-enter melody notes.
- **Section style** — per section: which tracks play (no drums in the intro,
  melody only in the chorus…), its own chord rhythm, an energy level, and a
  key change (lift the last chorus up a step). A key change shows everywhere:
  chord names, palette and piano roll in the new key, a key badge on the
  timeline, and a key signature change in the MIDI export.
- **Bass patterns** — roots, root–fifth, octaves, a walking line that steps
  into the next chord, a syncopated groove, or following the kick drum. Set
  for the song and changed per section.
- **Fills and transitions** — snare fill, tom run, snare roll or drop-out at
  the end of a section; a crash on every new section; and a build-up that
  swells into the next section.
- **Swing and humanize** — a shuffle feel and small, repeatable changes in
  timing and loudness, so playback and exports sound less mechanical.
- **My songs** — every song is saved in the browser as you work. Open,
  rename, duplicate, download or delete songs; back them all up to one
  `.json` file and open song files or backups again (by button or drop).
- **Share links** — the whole song is compressed into the link's `#song=`
  hash, so no server is needed; opening one adds a copy to My songs.
- Undo/redo, example songs, a welcome tour, light/dark theme, mobile layout.

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm run lint
npm run build    # type-check + production build into dist/
```

Built with Vite, React 19, TypeScript, Tailwind CSS v4 and
[shadcn/ui](https://ui.shadcn.com).

### Layout

| Path                      | What it does                                                              |
| ------------------------- | ------------------------------------------------------------------------- |
| `src/lib/music.ts`        | Keys, scales, chords, melody generator, bar tools, voice leading          |
| `src/lib/arrange.ts`      | Song model; lays out the form and turns it into timed note events         |
| `src/lib/sections.ts`     | Section and form editing, form letters, saved-song migration              |
| `src/lib/bass.ts`         | Bass line patterns                                                        |
| `src/lib/feel.ts`         | Swing and humanize timing                                                 |
| `src/lib/drums.ts`        | Drum pieces, presets and pattern expansion                                |
| `src/lib/audio-engine.ts` | Web Audio engine: sampled instruments, buses, mixer, reverb               |
| `src/lib/scheduler.ts`    | Look-ahead playback scheduling with looping and live edits (pure, tested) |
| `src/lib/use-player.ts`   | React hook that drives the scheduler with the real audio clock            |
| `src/lib/render.ts`       | Offline WAV rendering and encoding                                        |
| `src/lib/song-file.ts`    | Song validation, `.json` song files and backups, share-link encoding      |
| `src/lib/library.ts`      | The song library in local storage (and moving the old single save in)     |
| `src/lib/midi.ts`         | MIDI file writer                                                          |
| `src/lib/midi-import.ts`  | MIDI file parser and song converter                                       |
| `src/lib/harmony.ts`      | Chord / key recognition shared by import and keyboard input               |
| `src/lib/midi-input.ts`   | Web MIDI keyboard input                                                   |
| `src/components/`         | Editors, timeline, sound panel, dialogs and shadcn/ui components          |

## Deployment

Hosted on Vercel. Pushing to `main` deploys to production; other branches and
pull requests get preview deployments.
