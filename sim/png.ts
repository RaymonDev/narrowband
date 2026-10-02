//tiny png codec on node zlib, non-interlaced. enough for patterns, screenshots and previews
import { deflateSync, inflateSync } from 'node:zlib'

export interface RawImage {
  width: number
  height: number
  //samples per pixel: 1 grey, 2 grey+alpha, 3 rgb, 4 rgba
  channels: 1 | 2 | 3 | 4
  data: Uint8Array
}

const SIGNATURE = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  const t = new TextEncoder().encode(type)
  out.set(t, 4)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32([t, data]))
  return out
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const COLOR_TYPE: Record<RawImage['channels'], number> = { 1: 0, 2: 4, 3: 2, 4: 6 }

export function encodePng(img: RawImage): Uint8Array {
  const { width: w, height: h, channels: c } = img
  const stride = w * c
  const raw = new Uint8Array((stride + 1) * h)
  for (let y = 0; y < h; y++) raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
  return assemble(w, h, 8, COLOR_TYPE[c], raw)
}

//levels 0-15 -> 4-bit grey png
export function encodePngGray4(width: number, height: number, levels: Uint8Array): Uint8Array {
  const stride = Math.ceil(width / 2)
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      raw[y * (stride + 1) + 1 + (x >> 1)] |= (levels[y * width + x] & 15) << (x & 1 ? 0 : 4)
    }
  }
  return assemble(width, height, 4, 0, raw)
}

function assemble(w: number, h: number, depth: number, colorType: number, raw: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13)
  const dv = new DataView(ihdr.buffer)
  dv.setUint32(0, w)
  dv.setUint32(4, h)
  ihdr[8] = depth
  ihdr[9] = colorType
  return concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0))])
}

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 8 && SIGNATURE.every((b, i) => bytes[i] === b)
}

//palette images get expanded to rgb(a)
export function decodePng(bytes: Uint8Array): RawImage {
  if (!isPng(bytes)) throw new Error('not a PNG')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let o = 8
  let w = 0
  let h = 0
  let depth = 0
  let ct = 0
  let palette: Uint8Array | undefined
  let trns: Uint8Array | undefined
  const idat: Uint8Array[] = []
  while (o < bytes.length) {
    const len = dv.getUint32(o)
    const type = String.fromCharCode(...bytes.subarray(o + 4, o + 8))
    const data = bytes.subarray(o + 8, o + 8 + len)
    if (type === 'IHDR') {
      w = dv.getUint32(o + 8)
      h = dv.getUint32(o + 12)
      depth = data[8]
      ct = data[9]
      if (data[12] !== 0) throw new Error('interlaced PNG not supported')
    } else if (type === 'PLTE') palette = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    o += 12 + len
  }
  const samples = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct as 0 | 2 | 3 | 4 | 6]
  if (!samples) throw new Error(`unsupported colour type ${ct}`)
  if (depth !== 8 && !((ct === 0 || ct === 3) && [1, 2, 4].includes(depth))) throw new Error(`unsupported bit depth ${depth}`)
  const raw = inflateSync(concat(idat))
  const bpp = Math.max(1, (samples * depth) >> 3)
  const stride = Math.ceil((w * samples * depth) / 8)
  const px = new Uint8Array(stride * h)
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const cur = px.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride)
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[i] = v
    }
  }
  //unpack sub-byte samples
  const unpacked = new Uint8Array(w * h * samples)
  if (depth === 8) unpacked.set(px)
  else {
    const per = 8 / depth
    const mask = (1 << depth) - 1
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const byte = px[y * stride + Math.floor(x / per)]
        const v = (byte >> (8 - depth * ((x % per) + 1))) & mask
        unpacked[y * w + x] = ct === 0 ? Math.round((v * 255) / mask) : v
      }
    }
  }
  if (ct === 3) {
    if (!palette) throw new Error('palette image without PLTE')
    const ch = trns ? 4 : 3
    const out = new Uint8Array(w * h * ch)
    for (let i = 0; i < w * h; i++) {
      const k = unpacked[i]
      out[i * ch] = palette[k * 3]
      out[i * ch + 1] = palette[k * 3 + 1]
      out[i * ch + 2] = palette[k * 3 + 2]
      if (ch === 4) out[i * ch + 3] = trns && k < trns.length ? trns[k] : 255
    }
    return { width: w, height: h, channels: ch, data: out }
  }
  return { width: w, height: h, channels: samples as RawImage['channels'], data: unpacked }
}
