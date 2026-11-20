/** A 16-bit mono WAV of a few notes, each a tone with a couple of overtones. */
export function melodyWav(
  notes: number[],
  seconds = 0.45,
  gap = 0.05,
  rate = 22050,
  lead = 0
) {
  const len = Math.round((lead + notes.length * (seconds + gap)) * rate)
  const data = Buffer.alloc(len * 2)
  notes.forEach((midi, k) => {
    const f = 440 * 2 ** ((midi - 69) / 12)
    const from = Math.round((lead + k * (seconds + gap)) * rate)
    for (let i = 0; i < seconds * rate; i++) {
      const t = i / rate
      const env = Math.min(1, t / 0.01) * Math.exp(-t * 2)
      const v =
        0.4 *
        env *
        (Math.sin(2 * Math.PI * f * t) + 0.4 * Math.sin(4 * Math.PI * f * t))
      data.writeInt16LE(Math.round(v * 32767), (from + i) * 2)
    }
  })
  const head = Buffer.alloc(44)
  head.write("RIFF", 0, "latin1")
  head.writeUInt32LE(36 + data.length, 4)
  head.write("WAVEfmt ", 8, "latin1")
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20) // PCM
  head.writeUInt16LE(1, 22) // mono
  head.writeUInt32LE(rate, 24)
  head.writeUInt32LE(rate * 2, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write("data", 36, "latin1")
  head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}
