// A minimal ZIP writer: files are stored as they are (no compression, which
// barely shrinks WAV audio anyway), so every unzip tool and OS can open it.

export interface ZipEntry {
  name: string
  data: Uint8Array
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

/** The CRC-32 checksum ZIP files use. */
export function crc32(data: Uint8Array) {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++)
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Date and time in the MS-DOS format ZIP uses. */
function dosTime(d: Date) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date:
      ((Math.max(1980, d.getFullYear()) - 1980) << 9) |
      ((d.getMonth() + 1) << 5) |
      d.getDate(),
  }
}

/** Build a .zip file holding the entries. */
export function buildZip(entries: ZipEntry[], when = new Date()): Uint8Array {
  const { time, date } = dosTime(when)
  const enc = new TextEncoder()
  const files = entries.map((e) => ({
    ...e,
    name: enc.encode(e.name),
    crc: crc32(e.data),
  }))
  const localSize = files.reduce(
    (n, f) => n + 30 + f.name.length + f.data.length,
    0
  )
  const centralSize = files.reduce((n, f) => n + 46 + f.name.length, 0)
  const out = new Uint8Array(localSize + centralSize + 22)
  const view = new DataView(out.buffer)
  let at = 0
  const u16 = (v: number) => {
    view.setUint16(at, v, true)
    at += 2
  }
  const u32 = (v: number) => {
    view.setUint32(at, v, true)
    at += 4
  }
  const bytes = (b: Uint8Array) => {
    out.set(b, at)
    at += b.length
  }

  const offsets: number[] = []
  for (const f of files) {
    offsets.push(at)
    u32(0x04034b50) // local file header
    u16(20) // version needed (2.0)
    u16(0x0800) // flags: names are UTF-8
    u16(0) // stored
    u16(time)
    u16(date)
    u32(f.crc)
    u32(f.data.length)
    u32(f.data.length)
    u16(f.name.length)
    u16(0) // no extra field
    bytes(f.name)
    bytes(f.data)
  }

  const centralStart = at
  files.forEach((f, i) => {
    u32(0x02014b50) // central directory header
    u16(20) // made by
    u16(20) // version needed
    u16(0x0800)
    u16(0)
    u16(time)
    u16(date)
    u32(f.crc)
    u32(f.data.length)
    u32(f.data.length)
    u16(f.name.length)
    u16(0) // extra
    u16(0) // comment
    u16(0) // disk
    u16(0) // internal attributes
    u32(0) // external attributes
    u32(offsets[i])
    bytes(f.name)
  })

  u32(0x06054b50) // end of central directory
  u16(0)
  u16(0)
  u16(files.length)
  u16(files.length)
  u32(centralSize)
  u32(centralStart)
  u16(0) // comment length
  return out
}
