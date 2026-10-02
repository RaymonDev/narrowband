//model of the host image path, measured on simulator 0.9.5 (docs/phase0-pipeline.md)
//magic numbers first, then raw gray8 (w*h) or gray4 (ceil(w/2)*h) by length, else sendFailed
//png -> bt.601 grey -> round(v/17), alpha ignored. raw gray8 the same but 1-15 stay literal. no dithering
//the lz4 step can't be seen in the simulator, it comes from the docs + the timing fit
import { compressedSize } from '../src/lz4.ts'
import { type Gray4Image, gray8ToLevel, packedGray4Size, packGray4, rawGray8ToLevel, unpackGray4 } from '../src/gray4.ts'
import { decodePng } from './png.ts'

export type PayloadKind = 'png' | 'jpeg' | 'gif' | 'bmp' | 'webp' | 'tiff' | 'ico' | 'pnm' | 'other-image' | 'gray8' | 'gray4' | 'invalid'

//the 22 magic numbers of the image crate's guess_format, as [prefix, mask, kind]
const MAGIC: [number[], number[] | null, PayloadKind][] = [
  [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], null, 'png'],
  [[0xff, 0xd8, 0xff], null, 'jpeg'],
  [[...'GIF89a'].map((c) => c.charCodeAt(0)), null, 'gif'],
  [[...'GIF87a'].map((c) => c.charCodeAt(0)), null, 'gif'],
  [[...'RIFF\0\0\0\0WEBP'].map((c) => c.charCodeAt(0)), [0xff, 0xff, 0xff, 0xff, 0, 0, 0, 0, 0xff, 0xff, 0xff, 0xff], 'webp'],
  [[0x4d, 0x4d, 0x00, 0x2a], null, 'tiff'],
  [[0x49, 0x49, 0x2a, 0x00], null, 'tiff'],
  [[...'DDS '].map((c) => c.charCodeAt(0)), null, 'other-image'],
  [[0x42, 0x4d], null, 'bmp'],
  [[0x00, 0x00, 0x01, 0x00], null, 'ico'],
  [[...'#?RADIANCE'].map((c) => c.charCodeAt(0)), null, 'other-image'],
  [[...'\0\0\0\0ftypavif'].map((c) => c.charCodeAt(0)), [0xff, 0xff, 0, 0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], 'other-image'],
  [[0x76, 0x2f, 0x31, 0x01], null, 'other-image'],
  [[...'qoif'].map((c) => c.charCodeAt(0)), null, 'other-image'],
  ...[1, 2, 3, 4, 5, 6, 7].map((d): [number[], null, PayloadKind] => [[0x50, 0x30 + d], null, 'pnm']),
  [[...'farbfeld'].map((c) => c.charCodeAt(0)), null, 'other-image'],
]

export function sniffMagic(bytes: Uint8Array): PayloadKind | undefined {
  for (const [prefix, mask, kind] of MAGIC) {
    if (bytes.length < prefix.length) continue
    if (prefix.every((b, i) => (bytes[i] & (mask?.[i] ?? 0xff)) === (b & (mask?.[i] ?? 0xff)))) return kind
  }
  return undefined
}

export function detectPayload(bytes: Uint8Array, width: number, height: number): PayloadKind {
  const magic = sniffMagic(bytes)
  if (magic) return magic
  if (bytes.length === width * height) return 'gray8'
  if (bytes.length === packedGray4Size(width, height)) return 'gray4'
  return 'invalid'
}

export class HostError extends Error {
  readonly result: 'sendFailed' | 'imageSizeInvalid' | 'imageToGray4Failed'
  constructor(result: HostError['result'], message: string) {
    super(message)
    this.result = result
  }
}

//bt.601, measured in phase 0
export function luma601(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b)
}

//payload -> the levels the glasses will show
export function hostDecode(bytes: Uint8Array, width: number, height: number): Gray4Image {
  const kind = detectPayload(bytes, width, height)
  const levels = new Uint8Array(width * height)
  switch (kind) {
    case 'gray8':
      for (let i = 0; i < levels.length; i++) levels[i] = rawGray8ToLevel(bytes[i])
      return { width, height, levels }
    case 'gray4':
      return unpackGray4(bytes, width, height)
    case 'png': {
      let img: ReturnType<typeof decodePng>
      try {
        img = decodePng(bytes)
      } catch (e) {
        throw new HostError('sendFailed', `PNG decode failed: ${(e as Error).message}`)
      }
      if (img.width !== width || img.height !== height) {
        //host cover-scales + center-crops here, not modelled since we always send exact sizes
        throw new HostError('imageSizeInvalid', `PNG is ${img.width}×${img.height}, container is ${width}×${height}`)
      }
      const c = img.channels
      for (let i = 0; i < levels.length; i++) {
        const v = c >= 3 ? luma601(img.data[i * c], img.data[i * c + 1], img.data[i * c + 2]) : img.data[i * c]
        levels[i] = gray8ToLevel(v)
      }
      return { width, height, levels }
    }
    case 'invalid':
      throw new HostError('sendFailed', `raw length ${bytes.length} matches neither Gray8 (${width * height}) nor Gray4 (${packedGray4Size(width, height)})`)
    default:
      //real jpeg/gif/bmp files decode fine on the host, we only model a raw buffer that looks like one
      throw new HostError('sendFailed', `${kind} decoding is not modelled (a raw buffer with this magic is rejected)`)
  }
}

//what goes over ble: one lz4 block of the packed gray4
export function wireBytes(levels: Gray4Image): number {
  return compressedSize(packGray4(levels))
}
