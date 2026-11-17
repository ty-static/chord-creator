# Chord Creator

Write chord progressions, melodies, bass and drums in any key, hear them with
sampled instruments, and export a multi-track MIDI file for your DAW.

**Live:** https://chord-creator-wheat.vercel.app

## Features

- **Key & tempo** — 12 roots × 9 scales (major, minor and the modes); chords
  and melody are stored as scale degrees, so changing key moves everything.
- **Chords** — diatonic palette, presets, randomize, triads/7ths/9ths/sus,
  inversions, drag to reorder, optional automatic voice leading.
- **Melody** — piano-roll editor (draw, drag, resize, keyboard nudging),
  generator with density control, per-bar regenerate / repeat motif
  (exact or following the chords), and note locking.
- **Drums** — 16-step pattern with accents, 9 preset grooves, fill and crash
  options, five sampled drum machines.
- **Sound** — sampled piano, pads, strings, bass and more (via
  [smplr](https://github.com/danigb/smplr)), per-track volume / mute / solo,
  reverb, built-in synth fallback when offline.
- **Timeline** — click to play from a bar, drag to loop a section.
- **MIDI export** — format-1 file with tempo, key signature, programs and
  separate chord / melody / bass / drum tracks (drums on channel 10).
- **MIDI import** — reads `.mid` files, guesses each track's role and the key,
  and converts them into chords, melody and a drum pattern.
- **MIDI keyboard** — Web MIDI input (Chrome/Edge): play through the current
  instrument, add chords by playing them, step-enter melody notes.
- Undo/redo, example songs, a welcome tour, light/dark theme, mobile layout.
  The current song is saved in the browser's local storage.

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

| Path | What it does |
| --- | --- |
| `src/lib/music.ts` | Keys, scales, chords, melody generator, bar tools, voice leading |
| `src/lib/arrange.ts` | Turns a song into timed note events (chords, melody, bass, drums) |
| `src/lib/drums.ts` | Drum pieces, presets and pattern expansion |
| `src/lib/audio-engine.ts` | Web Audio engine: sampled instruments, buses, mixer, reverb |
| `src/lib/use-player.ts` | Look-ahead playback scheduler with looping |
| `src/lib/midi.ts` | MIDI file writer |
| `src/lib/midi-import.ts` | MIDI file parser and song converter |
| `src/lib/harmony.ts` | Chord / key recognition shared by import and keyboard input |
| `src/lib/midi-input.ts` | Web MIDI keyboard input |
| `src/components/` | Editors, timeline, sound panel, dialogs and shadcn/ui components |

## Deployment

Hosted on Vercel. Pushing to `main` deploys to production; other branches and
pull requests get preview deployments.
