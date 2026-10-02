//quantizers: 8-bit grey -> n of the 16 levels (n = 2..16, evenly spread)
//none with 16 levels is exactly what the host does
import { type Gray4Image, type Gray8Image, MAX_LEVEL } from './gray4.ts'
import { blueNoiseThresholds, BLUE_NOISE_SIZE } from './bluenoise.ts'

export type DitherMethod =
  | 'none'
  | 'floyd-steinberg'
  | 'atkinson'
  | 'bayer2'
  | 'bayer4'
  | 'bayer8'
  | 'blue-noise'

export const DITHER_METHODS: readonly DitherMethod[] = ['none', 'floyd-steinberg', 'atkinson', 'bayer2', 'bayer4', 'bayer8', 'blue-noise']

export interface QuantizeOptions {
  //between 2 and 16
  levels: number
  method: DitherMethod
  //screen offset so ordered patterns line up across containers
  originX?: number
  originY?: number
}

export function levelSet(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 2 || n > 16) throw new RangeError(`levels must be an integer in 2..16, got ${n}`)
  return Uint8Array.from({ length: n }, (_, i) => Math.round((i * MAX_LEVEL) / (n - 1)))
}

export function quantize(img: Gray8Image, opts: QuantizeOptions): Gray4Image {
  const set = levelSet(opts.levels)
  switch (opts.method) {
    case 'none':
      return nearest(img, set)
    case 'floyd-steinberg':
      return errorDiffusion(img, set, FLOYD_STEINBERG)
    case 'atkinson':
      return errorDiffusion(img, set, ATKINSON)
    case 'bayer2':
      return ordered(img, set, bayer(2), 2, opts)
    case 'bayer4':
      return ordered(img, set, bayer(4), 4, opts)
    case 'bayer8':
      return ordered(img, set, bayer(8), 8, opts)
    case 'blue-noise':
      return ordered(img, set, blueNoiseThresholds(), BLUE_NOISE_SIZE, opts)
  }
}

//nearest level index for every 8-bit value
function nearestTable(set: Uint8Array): Uint8Array {
  const t = new Uint8Array(256)
  for (let v = 0; v < 256; v++) {
    let best = 0
    for (let k = 1; k < set.length; k++) if (Math.abs(set[k] * 17 - v) < Math.abs(set[best] * 17 - v)) best = k
    t[v] = best
  }
  return t
}

function nearest(img: Gray8Image, set: Uint8Array): Gray4Image {
  const t = nearestTable(set)
  const levels = new Uint8Array(img.data.length)
  for (let i = 0; i < levels.length; i++) levels[i] = set[t[img.data[i]]]
  return { width: img.width, height: img.height, levels }
}

//taps are [dx, dy, weight], plus the divisor
interface Kernel {
  taps: readonly (readonly [number, number, number])[]
  divisor: number
}

const FLOYD_STEINBERG: Kernel = {
  taps: [[1, 0, 7], [-1, 1, 3], [0, 1, 5], [1, 1, 1]],
  divisor: 16,
}

//atkinson only spreads 6/8 of the error
const ATKINSON: Kernel = {
  taps: [[1, 0, 1], [2, 0, 1], [-1, 1, 1], [0, 1, 1], [1, 1, 1], [0, 2, 1]],
  divisor: 8,
}

function errorDiffusion(img: Gray8Image, set: Uint8Array, kernel: Kernel): Gray4Image {
  const { width: w, height: h } = img
  const buf = Float32Array.from(img.data)
  const levels = new Uint8Array(w * h)
  const values = Array.from(set, (l) => l * 17)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const v = buf[i]
      let best = 0
      for (let k = 1; k < values.length; k++) if (Math.abs(values[k] - v) < Math.abs(values[best] - v)) best = k
      levels[i] = set[best]
      const err = v - values[best]
      if (err === 0) continue
      for (const [dx, dy, wt] of kernel.taps) {
        const xx = x + dx
        const yy = y + dy
        if (xx < 0 || xx >= w || yy >= h) continue
        buf[yy * w + xx] += (err * wt) / kernel.divisor
      }
    }
  }
  return { width: w, height: h, levels }
}

//ordered dither: between the two levels around v, go up when the fraction beats the threshold
//values exactly on a level stay flat so flat ui costs nothing
function ordered(img: Gray8Image, set: Uint8Array, thresholds: Float32Array, size: number, opts: QuantizeOptions): Gray4Image {
  const { width: w, height: h } = img
  const ox = opts.originX ?? 0
  const oy = opts.originY ?? 0
  //per 8-bit value: lower level index + fraction to the next one
  const lower = new Uint8Array(256)
  const frac = new Float32Array(256)
  for (let v = 0; v < 256; v++) {
    let k = 0
    while (k < set.length - 2 && set[k + 1] * 17 <= v) k++
    const lo = set[k] * 17
    const hi = set[k + 1] * 17
    lower[v] = k
    frac[v] = Math.min(1, Math.max(0, (v - lo) / (hi - lo)))
  }
  const levels = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const row = ((y + oy) % size) * size
    for (let x = 0; x < w; x++) {
      const v = img.data[y * w + x]
      const k = lower[v]
      levels[y * w + x] = set[frac[v] > thresholds[row + ((x + ox) % size)] ? k + 1 : k]
    }
  }
  return { width: w, height: h, levels }
}

const bayerCache = new Map<number, Float32Array>()

//bayer matrix as thresholds in (0,1)
export function bayer(size: number): Float32Array {
  const cached = bayerCache.get(size)
  if (cached) return cached
  let m = [[0]]
  while (m.length < size) {
    const n = m.length
    const next = Array.from({ length: 2 * n }, () => new Array<number>(2 * n).fill(0))
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const v = 4 * m[y][x]
        next[y][x] = v
        next[y][x + n] = v + 2
        next[y + n][x] = v + 3
        next[y + n][x + n] = v + 1
      }
    }
    m = next
  }
  const t = new Float32Array(size * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) t[y * size + x] = (m[y][x] + 0.5) / (size * size)
  bayerCache.set(size, t)
  return t
}
