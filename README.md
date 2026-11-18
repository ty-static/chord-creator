# Chord Creator

Write chord progressions, melodies, bass and drums in any key, hear them with
sampled instruments, and export a multi-track MIDI file for your DAW.

**Live:** https://chord-creator-wheat.vercel.app

## Features

- **Key & tempo** — 12 roots × 9 scales (major, minor and the modes); chords
  and melody are stored as scale degrees, so changing key moves everything.
- **Time signatures** — 4/4, 3/4, 2/4, 5/4, 6/8, 7/8 and 12/8. Chord
  lengths, the melody grid, drum grooves, the bass and the chord rhythm
  follow the bar (dotted-quarter beats in 6/8); switching fits the song to
  the new bar, and MIDI files keep the time signature both ways.
- **Song sections** — verse, chorus, bridge and more, each with its own
  chords, melody and drum beat. Order and repeat them as a form (`A A B A`):
  drag, type the letters, loop one part, or split off a variation.
- **Chords** — diatonic palette, presets, randomize, triads/7ths/9ths/sus,
  inversions, drag to reorder, optional automatic voice leading.
- **Chord rhythm** — block, pulse or arpeggio, or a pattern: guitar strums
  (down, down-up, up-down-up), off-beat skanks, the Charleston and
  oom-pah. Patterns follow the time signature (oom-pah-pah in 3/4) and can
  change per section.
- **Chords outside the key** — secondary dominants (V7/V…), borrowed chords
  (iv, ♭VI, ♭VII, ♭III, the Neapolitan ♭II; V, IV and a Picardy I in minor),
  and "next chord" suggestions from common progressions. A MIDI keyboard
  recognises them too.
- **Melody** — piano-roll editor (draw, drag, resize, keyboard nudging),
  generator with density control, per-bar regenerate / repeat motif
  (exact or following the chords), and note locking. Melodies can tie
  sections together: reuse another section's tune (same notes, moved to fit
  the chords, or its rhythm with new notes), and lead the end of a section
  into the first note of the next one.
- **Drums** — a one-bar step pattern with accents, preset grooves, fill and crash
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
- **Tempo changes** — a section can play at its own tempo (half time, a
  little faster, double time…) and slow down over its last bars. Playback,
  the playhead, WAV and MIDI export (as tempo events) all follow the changes.
- **Bass patterns** — roots, root–fifth, octaves, a walking line that steps
  into the next chord, a syncopated groove, or following the kick drum. Set
  for the song and changed per section.
- **Fills and transitions** — snare fill, tom run, snare roll or drop-out at
  the end of a section; a crash on every new section; and a build-up that
  swells into the next section.
- **Intros, outros and endings** — add an intro made from the first
  section's opening bars or an outro from the last section's closing bars
  (chords and beat, no melody, a little softer, slowing down at the end), and end the song with a
  held final chord, a short stab or a fade-out. Endings play in exports and
  whenever the song isn't looping.
- **Count-in** — an optional bar of clicks before Play starts.
- **Swing and humanize** — a shuffle feel and small, repeatable changes in
  timing and loudness, so playback and exports sound less mechanical.
- **My songs** — every song is saved in the browser as you work. Open,
  rename, duplicate, download or delete songs; back them all up to one
  `.json` file and open song files or backups again (by button or drop).
- **Share links** — the whole song is compressed into the link's `#song=`
  hash, so no server is needed; opening one adds a copy to My songs.
- **Accessible** — works from the keyboard (a skip link, arrow keys in the
  drum grid, Tab and `[` / `]` through melody notes), every control named
  for screen readers, cards as headings, and colours that meet WCAG AA
  contrast in both themes. Checked with axe in the browser tests.
- **Fast first load** — dialogs, exports, MIDI import and the sampler are
  separate downloads, fetched in the background once the page is idle
  (skipped when the browser is set to save data).
- Undo/redo, example songs, a welcome tour, light/dark theme, mobile layout.

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm run lint
npm test         # unit tests (Vitest)
npm run e2e      # browser tests (Playwright)
npm run build    # type-check + production build into dist/
```

### Testing

- **Unit tests** (`src/**/*.test.ts`, Vitest) cover the music logic: keys and
  chords, melody tools, bass and drums, arranging, MIDI and WAV encoding,
  song files and share links.
- **Browser tests** (`e2e/*.e2e.ts`, Playwright) build the app and click
  through it in Chromium: adding chords, undo/redo, playback, My songs, share
  links, MIDI/WAV export, MIDI and song-file import, key changes, melody
  linking, and the header and layout at phone, tablet and desktop widths.
  An accessibility suite runs axe on each screen in both themes and checks
  keyboard use of the drum grid and the piano roll.
  They block the network, so instruments use the built-in synth, and fail on
  any error in the page. Run `npx playwright install chromium` once first;
  `npm run e2e:ui` opens Playwright's UI.

Both run in CI on every push and pull request.

Built with Vite, React 19, TypeScript, Tailwind CSS v4 and
[shadcn/ui](https://ui.shadcn.com).

### Layout

| Path                      | What it does                                                              |
| ------------------------- | ------------------------------------------------------------------------- |
| `src/lib/music.ts`        | Keys, scales, chords, melody generator, bar tools, voice leading          |
| `src/lib/arrange.ts`      | Song model; lays out the form and turns it into timed note events         |
| `src/lib/sections.ts`     | Section and form editing, form letters, saved-song migration              |
| `src/lib/bass.ts`         | Bass line patterns                                                        |
| `src/lib/rhythm.ts`       | Chord rhythms: block, pulse, arpeggio, strums and other patterns          |
| `src/lib/feel.ts`         | Swing and humanize timing                                                 |
| `src/lib/melody-links.ts` | Melody from another section, and lead-ins into the next section           |
| `src/lib/meter.ts`        | Time signatures: bar lengths, felt beats, MIDI time-signature bytes       |
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
