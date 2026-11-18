import { describe, expect, it } from "vitest"

import { buildZip, crc32 } from "@/lib/zip"

const enc = new TextEncoder()

/** Read a stored (uncompressed) zip back: names, data and checksums. */
function readZip(zip: Uint8Array) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const end = zip.length - 22
  expect(view.getUint32(end, true)).toBe(0x06054b50)
  const count = view.getUint16(end + 10, true)
  const centralSize = view.getUint32(end + 12, true)
  let at = view.getUint32(end + 16, true)
  expect(at + centralSize).toBe(end)
  const out: { name: string; data: Uint8Array; crc: number }[] = []
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50)
    const crc = view.getUint32(at + 16, true)
    const size = view.getUint32(at + 20, true)
    const nameLen = view.getUint16(at + 28, true)
    const offset = view.getUint32(at + 42, true)
    const name = new TextDecoder().decode(zip.slice(at + 46, at + 46 + nameLen))
    // The local header says the same, and the data follows it.
    expect(view.getUint32(offset, true)).toBe(0x04034b50)
    expect(view.getUint16(offset + 8, true)).toBe(0) // stored
    expect(view.getUint32(offset + 14, true)).toBe(crc)
    const localName = view.getUint16(offset + 26, true)
    const extra = view.getUint16(offset + 28, true)
    const from = offset + 30 + localName + extra
    out.push({ name, crc, data: zip.slice(from, from + size) })
    at += 46 + nameLen
  }
  return out
}

describe("zip", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(enc.encode("hello"))).toBe(0x3610a686)
    expect(crc32(enc.encode("123456789"))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array())).toBe(0)
  })

  it("stores files so they come back byte for byte", () => {
    const big = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 7) & 0xff)
    const zip = buildZip([
      { name: "song_chords.wav", data: big },
      { name: "señor.txt", data: enc.encode("olé") },
      { name: "empty", data: new Uint8Array() },
    ])
    const files = readZip(zip)
    expect(files.map((f) => f.name)).toEqual([
      "song_chords.wav",
      "señor.txt",
      "empty",
    ])
    expect(files[0].data).toEqual(big)
    expect(new TextDecoder().decode(files[1].data)).toBe("olé")
    for (const f of files) expect(f.crc).toBe(crc32(f.data))
  })

  it("writes the date it was made", () => {
    const zip = buildZip(
      [{ name: "a", data: new Uint8Array([1]) }],
      new Date(2026, 10, 17, 14, 30, 10)
    )
    const view = new DataView(zip.buffer)
    expect(view.getUint16(10, true)).toBe((14 << 11) | (30 << 5) | 5)
    expect(view.getUint16(12, true)).toBe((46 << 9) | (11 << 5) | 17)
  })
})
