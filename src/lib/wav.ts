// 16-bit PCM WAV encoding, shared by the exports and microphone recordings.

/** Encode interleaved 16-bit PCM WAV. Samples outside -1..1 are clipped. */
export function encodeWav(channels: Float32Array[], sampleRate: number) {
  const n = channels.length
  const length = channels[0]?.length ?? 0
  const dataSize = length * n * 2
  const buf = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buf)
  const text = (at: number, s: string) =>
    [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)))
  text(0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  text(8, "WAVE")
  text(12, "fmt ")
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, n, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * n * 2, true) // bytes per second
  view.setUint16(32, n * 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  text(36, "data")
  view.setUint32(40, dataSize, true)
  let at = 44
  for (let i = 0; i < length; i++)
    for (let c = 0; c < n; c++) {
      const x = Math.max(-1, Math.min(1, channels[c][i]))
      view.setInt16(at, Math.round(x < 0 ? x * 0x8000 : x * 0x7fff), true)
      at += 2
    }
  return new Uint8Array(buf)
}
