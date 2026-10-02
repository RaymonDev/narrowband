//phase 0 test patterns. everything is generated here and served to the probe page,
//analyze.ts reads the same defs back to know what went where
import { readFileSync } from 'node:fs'
import { decodePng, encodePng, encodePngGray4 } from '../sim/png.ts'

export interface ProbeContainer {
  id: number
  name: string
  x: number
  y: number
  width: number
  height: number
}

export type PayloadFormat = 'gray8' | 'gray4' | 'png-gray8' | 'png-gray4' | 'png-rgb' | 'png-rgba'

export interface ProbeImage {
  containerID: number
  format: PayloadFormat
  data: Uint8Array
  note?: string
}

export interface BlockGrid {
  containerID: number
  cols: number
  rows: number
  //value per block, row-major
  values: number[]
}

export interface ProbeCase {
  id: string
  title: string
  containers: ProbeContainer[]
  images: ProbeImage[]
  grids: BlockGrid[]
}

const W = 288
const H = 144
const quadrants = (): ProbeContainer[] =>
  [0, 1, 2, 3].map((q) => ({ id: q + 1, name: `q${q}`, x: (q % 2) * W, y: (q >> 1) * H, width: W, height: H }))

//cols x rows grid of flat blocks
function blocks(w: number, h: number, cols: number, rows: number, value: (k: number) => number): Uint8Array {
  const out = new Uint8Array(w * h)
  const bw = w / cols
  const bh = h / rows
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = value(Math.floor(y / bh) * cols + Math.floor(x / bw))
  }
  return out
}

function colorBlocks(w: number, h: number, cols: number, rows: number, channels: 3 | 4, color: (k: number) => number[]): Uint8Array {
  const out = new Uint8Array(w * h * channels)
  const bw = w / cols
  const bh = h / rows
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = color(Math.floor(y / bh) * cols + Math.floor(x / bw))
      for (let k = 0; k < channels; k++) out[(y * w + x) * channels + k] = c[k]
    }
  }
  return out
}

const range = (n: number, f: (k: number) => number) => Array.from({ length: n }, (_, k) => f(k))

function allValuesCase(id: string, title: string, format: 'gray8' | 'png-gray8' | 'gray4'): ProbeCase {
  const containers = quadrants()
  const images: ProbeImage[] = []
  const grids: BlockGrid[] = []
  for (const c of containers) {
    const base = (c.id - 1) * 64
    const values = range(64, (k) => base + k)
    const px = blocks(W, H, 8, 8, (k) => base + k)
    let data: Uint8Array
    if (format === 'gray4') {
      //each byte = block value, so both nibbles show side by side
      data = new Uint8Array((W * H) / 2)
      for (let i = 0; i < data.length; i++) data[i] = px[i * 2]
    } else data = format === 'gray8' ? px : encodePng({ width: W, height: H, channels: 1, data: px })
    images.push({ containerID: c.id, format, data })
    grids.push({ containerID: c.id, cols: 8, rows: 8, values })
  }
  return { id, title, containers, images, grids }
}

//evenly spaced values over 0..255, 64 of them
const steps64 = range(64, (k) => Math.round((k * 255) / 63))

function rgbChannelsCase(): ProbeCase {
  const containers = quadrants()
  const colors: ((v: number) => number[])[] = [(v) => [v, 0, 0], (v) => [0, v, 0], (v) => [0, 0, v], (v) => [v, v, v]]
  const images = containers.map((c, q) => ({
    containerID: c.id,
    format: 'png-rgb' as const,
    data: encodePng({ width: W, height: H, channels: 3, data: colorBlocks(W, H, 8, 8, 3, (k) => colors[q](steps64[k])) }),
    note: ['red', 'green', 'blue', 'grey as RGB'][q],
  }))
  const grids = containers.map((c) => ({ containerID: c.id, cols: 8, rows: 8, values: steps64 }))
  return { id: 'png-rgb-channels', title: 'RGB PNG: pure red, green, blue and neutral ramps (luma weights)', containers, images, grids }
}

function alphaCase(): ProbeCase {
  const containers = quadrants()
  const colors: ((a: number) => number[])[] = [
    (a) => [255, 255, 255, a],
    (a) => [128, 128, 128, a],
    (a) => [0, 0, 0, a],
    (a) => [255, 255, 255, 255 - a],
  ]
  const images = containers.map((c, q) => ({
    containerID: c.id,
    format: 'png-rgba' as const,
    data: encodePng({ width: W, height: H, channels: 4, data: colorBlocks(W, H, 8, 8, 4, (k) => colors[q](steps64[k])) }),
    note: ['white, alpha ramp', 'mid grey, alpha ramp', 'black, alpha ramp', 'white, inverse alpha ramp'][q],
  }))
  const grids = containers.map((c) => ({ containerID: c.id, cols: 8, rows: 8, values: steps64 }))
  return { id: 'png-rgba-alpha', title: 'RGBA PNG: how alpha is flattened', containers, images, grids }
}

//levels 0-15 sent 4 different ways, should all look the same
function levelsFourWaysCase(): ProbeCase {
  const containers = quadrants()
  const lv = blocks(W, H, 4, 4, (k) => k)
  const gray4 = new Uint8Array((W * H) / 2)
  for (let i = 0; i < gray4.length; i++) gray4[i] = (lv[i * 2] << 4) | lv[i * 2 + 1]
  const images: ProbeImage[] = [
    { containerID: 1, format: 'png-gray4', data: encodePngGray4(W, H, lv), note: '4-bit grey PNG' },
    { containerID: 2, format: 'gray4', data: gray4, note: 'packed Gray4, both nibbles equal per pair' },
    { containerID: 3, format: 'gray8', data: lv.map((l) => l * 17), note: 'Gray8 L×17' },
    { containerID: 4, format: 'png-gray8', data: encodePng({ width: W, height: H, channels: 1, data: lv.map((l) => l * 17) }), note: '8-bit PNG L×17' },
  ]
  const grids = containers.map((c) => ({ containerID: c.id, cols: 4, rows: 4, values: range(16, (k) => k) }))
  return { id: 'levels-four-ways', title: 'Levels 0–15 as 4-bit PNG, packed Gray4, Gray8 and 8-bit PNG', containers, images, grids }
}

//does the host dither?
function ditherCase(): ProbeCase {
  const containers = quadrants()
  const ramp = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ramp[y * W + x] = Math.floor((x * 256) / W)
  //values between levels, a dithering host would mix two levels here
  const flats = [8, 25, 42, 76, 110, 127, 161, 195]
  const flat = blocks(W, H, 4, 2, (k) => flats[k])
  const images: ProbeImage[] = [
    { containerID: 1, format: 'gray8', data: ramp, note: 'Gray8 horizontal ramp, column x has value floor(256x/288)' },
    { containerID: 2, format: 'png-gray8', data: encodePng({ width: W, height: H, channels: 1, data: ramp }), note: '8-bit PNG, same ramp' },
    { containerID: 3, format: 'gray8', data: flat, note: 'Gray8 flat fields between levels' },
    { containerID: 4, format: 'png-gray8', data: encodePng({ width: W, height: H, channels: 1, data: flat }), note: '8-bit PNG, same flat fields' },
  ]
  const grids = [3, 4].map((id) => ({ containerID: id, cols: 4, rows: 2, values: flats }))
  return { id: 'dither-check', title: 'Ramps and off-level flat fields (host dithering?)', containers, images, grids }
}

//odd width: is gray4 continuous or padded per row? a 1px diagonal shears if read wrong
function oddWidthCase(): ProbeCase {
  const w = 21
  const h = 21
  const diag = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) diag[y * w + y] = 15
  const continuous = new Uint8Array(Math.ceil((w * h) / 2))
  for (let i = 0; i < w * h; i++) continuous[i >> 1] |= diag[i] << (i & 1 ? 0 : 4)
  const stride = Math.ceil(w / 2)
  const padded = new Uint8Array(stride * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) padded[y * stride + (x >> 1)] |= diag[y * w + x] << (x & 1 ? 0 : 4)
  const containers: ProbeContainer[] = [
    { id: 1, name: 'cont', x: 40, y: 40, width: w, height: h },
    { id: 2, name: 'padded', x: 120, y: 40, width: w, height: h },
    { id: 3, name: 'gray8', x: 200, y: 40, width: w, height: h },
    { id: 4, name: 'short', x: 280, y: 40, width: w, height: h },
  ]
  const images: ProbeImage[] = [
    { containerID: 1, format: 'gray4', data: continuous, note: `packed continuously, ${continuous.length} bytes` },
    { containerID: 2, format: 'gray4', data: padded, note: `rows padded to whole bytes, ${padded.length} bytes` },
    { containerID: 3, format: 'gray8', data: diag.map((l) => l * 17), note: `Gray8 reference, ${w * h} bytes` },
    { containerID: 4, format: 'gray4', data: continuous.subarray(0, continuous.length - 1), note: 'one byte short (expect rejection)' },
  ]
  return { id: 'odd-width', title: 'Odd width 21×21: Gray4 row packing', containers, images, grids: [] }
}

//raw buffers that start with an image magic number
function magicCollisionCase(): ProbeCase {
  const containers = quadrants()
  const gray8 = (prefix: number[]) => {
    const d = blocks(W, H, 4, 4, (k) => k * 17)
    d.set(prefix)
    return d
  }
  const gray4 = (prefix: number[]) => {
    const d = new Uint8Array((W * H) / 2).fill(0x88)
    d.set(prefix)
    return d
  }
  const images: ProbeImage[] = [
    { containerID: 1, format: 'gray8', data: gray8([0xff, 0xd8, 0xff]), note: 'Gray8 starting FF D8 FF (JPEG magic)' },
    { containerID: 2, format: 'gray4', data: gray4([0x42, 0x4d]), note: 'Gray4 starting 42 4D ("BM", BMP magic)' },
    { containerID: 3, format: 'gray8', data: gray8([0x47, 0x49, 0x46, 0x38]), note: 'Gray8 starting "GIF8"' },
    { containerID: 4, format: 'gray4', data: gray4([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), note: 'Gray4 starting with the PNG signature' },
  ]
  return { id: 'magic-collision', title: 'Raw buffers that begin with image magic numbers', containers, images, grids: [] }
}

//bug repro cases (see readme)

//corpus photo downscaled to 288x144 and darkened, like a night shot
function darkPhoto(gain: number): Uint8Array {
  const img = decodePng(new Uint8Array(readFileSync(new URL('../corpus/photo/kodim23-parrots.png', import.meta.url))))
  const out = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = 2 * y * img.width + 2 * x
      const v = (img.data[i] + img.data[i + 1] + img.data[i + img.width] + img.data[i + img.width + 1]) / 4
      out[y * W + x] = Math.round(v * gain)
    }
  }
  return out
}

//bug 1: raw gray8 1-15 show up as levels 1-15. ramp 0-31 + dark photo, each raw vs png
function bug1Case(): ProbeCase {
  const containers = quadrants()
  const ramp = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ramp[y * W + x] = Math.floor(x / 9)
  const photo = darkPhoto(0.1)
  const png = (d: Uint8Array) => encodePng({ width: W, height: H, channels: 1, data: d })
  const images: ProbeImage[] = [
    { containerID: 1, format: 'gray8', data: ramp, note: 'raw Gray8, values 0–31 in 9 px bands' },
    { containerID: 2, format: 'png-gray8', data: png(ramp), note: 'same ramp as 8-bit PNG (control)' },
    { containerID: 3, format: 'gray8', data: photo, note: 'raw Gray8 dark photo (kodim23 × 0.1, values 0–25)' },
    { containerID: 4, format: 'png-gray8', data: png(photo), note: 'same dark photo as 8-bit PNG (control)' },
  ]
  return { id: 'bug1-raw-gray8-low-values', title: 'Bug 1: raw Gray8 values 1–15', containers, images, grids: [] }
}

//normal content with the first bytes swapped for prefix
function withPrefix(format: 'gray8' | 'gray4', prefix: number[]): Uint8Array {
  const lv = blocks(W, H, 4, 4, (k) => k)
  let d: Uint8Array
  if (format === 'gray8') d = lv.map((l) => l * 17)
  else {
    d = new Uint8Array((W * H) / 2)
    for (let i = 0; i < d.length; i++) d[i] = (lv[i * 2] << 4) | lv[i * 2 + 1]
  }
  d.set(prefix)
  return d
}

const hex = (b: number[]) => b.map((x) => x.toString(16).padStart(2, '0').toUpperCase()).join(' ')

//bug 2: magic sniffing. every prefix has a control one value off
function bug2Case(id: string, title: string, format: 'gray8' | 'gray4', prefixes: [number[], string][]): ProbeCase {
  const containers = quadrants()
  const images = prefixes.map(([p, what], i) => ({
    containerID: i + 1,
    format,
    data: withPrefix(format, p),
    note: `${format} starting ${hex(p)} (${what})`,
  }))
  return { id, title, containers, images, grids: [] }
}

export function bugCases(): ProbeCase[] {
  return [
    bug1Case(),
    bug2Case('bug2-magic-gray8', 'Bug 2: Gray8 pixels that spell BMP / JPEG magic', 'gray8', [
      [[66, 77], 'pixels 66, 77 = "BM", BMP magic'],
      [[66, 78], 'pixels 66, 78, control'],
      [[255, 216, 255], 'pixels 255, 216, 255 = JPEG magic'],
      [[255, 216, 254], 'pixels 255, 216, 254, control'],
    ]),
    bug2Case('bug2-magic-gray8-more', 'Bug 2: other magic numbers in Gray8', 'gray8', [
      [[80, 53], 'pixels 80, 53 = "P5", PNM magic'],
      [[0, 0, 1, 0], 'pixels 0, 0, 1, 0 = ICO magic'],
      [[73, 73, 42, 0], 'pixels 73, 73, 42, 0 = "II*" NUL, TIFF magic'],
      [[80, 56], 'pixels 80, 56 = "P8", control (not a magic number)'],
    ]),
    bug2Case('bug2-magic-gray4', 'Bug 2: packed Gray4 bytes that spell magic numbers', 'gray4', [
      [[0x00, 0x00, 0x01, 0x00], 'levels 0,0,0,0,0,1,0,0 = ICO magic'],
      [[0x50, 0x35], 'levels 5,0,3,5 = "P5", PNM magic'],
      [[0x42, 0x4d], 'levels 4,2,4,13 = "BM", BMP magic'],
      [[0x00, 0x00, 0x02, 0x00], 'levels 0,0,0,0,0,2,0,0, control'],
    ]),
  ]
}

export function probeCases(): ProbeCase[] {
  return [
    levelsFourWaysCase(),
    allValuesCase('gray8-all-values', 'Raw Gray8: all 256 values (64 per quadrant)', 'gray8'),
    allValuesCase('png8-all-values', '8-bit grey PNG: all 256 values', 'png-gray8'),
    allValuesCase('gray4-all-bytes', 'Packed Gray4: all 256 byte values (nibble order)', 'gray4'),
    ditherCase(),
    rgbChannelsCase(),
    alphaCase(),
    oddWidthCase(),
    magicCollisionCase(),
    ...bugCases(),
  ]
}
