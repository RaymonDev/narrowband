//gray8 / gray4 helpers. host mapping and packing layout come from phase 0 (docs/phase0-pipeline.md)

export interface Gray8Image {
  width: number
  height: number
  data: Uint8Array
}

//one level 0-15 per byte, not packed
export interface Gray4Image {
  width: number
  height: number
  levels: Uint8Array
}

export const MAX_LEVEL = 15

export type NibbleOrder = 'high-first' | 'low-first'

//host conversion for pngs: round(v/17), no dithering, no gamma
export function gray8ToLevel(v: number): number {
  return Math.round(v / 17)
}

//raw gray8 on the host: same but 1-15 stay as levels 1-15 (sim 0.9.5 bug, see readme)
export function rawGray8ToLevel(v: number): number {
  return v > 0 && v < 16 ? v : Math.round(v / 17)
}

//v that lands exactly on level
export function levelToGray8(level: number): number {
  return level * 17
}

const GRAY8_TO_LEVEL = Uint8Array.from({ length: 256 }, (_, v) => gray8ToLevel(v))

export function quantizeLikeHost(img: Gray8Image): Gray4Image {
  const levels = new Uint8Array(img.data.length)
  for (let i = 0; i < levels.length; i++) levels[i] = GRAY8_TO_LEVEL[img.data[i]]
  return { width: img.width, height: img.height, levels }
}

//levels back to 8-bit (L*17)
export function gray4ToGray8(img: Gray4Image): Gray8Image {
  const data = new Uint8Array(img.levels.length)
  for (let i = 0; i < data.length; i++) data[i] = img.levels[i] * 17
  return { width: img.width, height: img.height, data }
}

//rows padded to a whole byte, the host rejects any other length
export function packedGray4Size(width: number, height: number): number {
  return Math.ceil(width / 2) * height
}

//left pixel in the high nibble, every row starts on a new byte
export function packGray4(img: Gray4Image, order: NibbleOrder = 'high-first'): Uint8Array {
  const { width: w, height: h, levels } = img
  const stride = Math.ceil(w / 2)
  const out = new Uint8Array(stride * h)
  const hi = order === 'high-first'
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x += 2) {
      const a = levels[y * w + x] & 15
      const b = x + 1 < w ? levels[y * w + x + 1] & 15 : 0
      out[y * stride + (x >> 1)] = hi ? (a << 4) | b : (b << 4) | a
    }
  }
  return out
}

export function unpackGray4(packed: Uint8Array, width: number, height: number, order: NibbleOrder = 'high-first'): Gray4Image {
  const stride = Math.ceil(width / 2)
  const levels = new Uint8Array(width * height)
  const hi = order === 'high-first'
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const b = packed[y * stride + (x >> 1)]
      levels[y * width + x] = ((x & 1) === 0) === hi ? b >> 4 : b & 15
    }
  }
  return { width, height, levels }
}

export function crop<T extends Gray8Image | Gray4Image>(img: T, x: number, y: number, w: number, h: number): T {
  const src = 'data' in img ? img.data : img.levels
  const out = new Uint8Array(w * h)
  for (let r = 0; r < h; r++) out.set(src.subarray((y + r) * img.width + x, (y + r) * img.width + x + w), r * w)
  return ('data' in img ? { width: w, height: h, data: out } : { width: w, height: h, levels: out }) as T
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export const SCREEN_WIDTH = 576
export const SCREEN_HEIGHT = 288
export const MAX_CONTAINER_WIDTH = 288
export const MAX_CONTAINER_HEIGHT = 144

//the 4 quadrants = full screen with the max 4 image containers
export const QUADRANTS: readonly Rect[] = [
  { x: 0, y: 0, width: 288, height: 144 },
  { x: 288, y: 0, width: 288, height: 144 },
  { x: 0, y: 144, width: 288, height: 144 },
  { x: 288, y: 144, width: 288, height: 144 },
]
