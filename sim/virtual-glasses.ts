//fake glasses: the image part of the bridge (create/rebuild page, updateImageRawData) on top of host.ts
//keeps a 576x288 level framebuffer, a virtual clock and a log of every send
import { type Gray4Image, MAX_CONTAINER_HEIGHT, MAX_CONTAINER_WIDTH, SCREEN_HEIGHT, SCREEN_WIDTH } from '../src/gray4.ts'
import { HostError, detectPayload, hostDecode, wireBytes, type PayloadKind } from './host.ts'
import { G2_FIT, sendMs, type TransportModel } from './transport.ts'
import type { RawImage } from './png.ts'

export interface ImageContainer {
  xPosition: number
  yPosition: number
  width: number
  height: number
  containerID: number
  containerName: string
}

export interface PageLike {
  containerTotalNum?: number
  imageObject?: ImageContainer[]
  textObject?: unknown[]
  listObject?: unknown[]
}

export type ImageResult = 'success' | 'imageException' | 'imageSizeInvalid' | 'imageToGray4Failed' | 'sendFailed'

export interface SendRecord {
  containerID: number
  kind: PayloadKind
  inputBytes: number
  wireBytes: number
  startMs: number
  ms: number
  result: ImageResult
}

//simulator display curve, alpha per level. 9+ all look the same
export const SIMULATOR_ALPHA = [0, 96, 131, 157, 179, 197, 214, 230, 244, 255, 255, 255, 255, 255, 255, 255]

export class VirtualGlasses {
  readonly framebuffer = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT)
  readonly sends: SendRecord[] = []
  //virtual ms, goes up by the modelled time of each send
  clockMs = 0
  private containers = new Map<number, ImageContainer>()
  readonly transport: TransportModel

  constructor(transport: TransportModel = G2_FIT) {
    this.transport = transport
  }

  async createStartUpPageContainer(page: PageLike): Promise<number> {
    return this.layout(page) ? 0 : 1
  }

  async rebuildPageContainer(page: PageLike): Promise<boolean> {
    return this.layout(page)
  }

  private layout(page: PageLike): boolean {
    const images = page.imageObject ?? []
    const others = (page.textObject?.length ?? 0) + (page.listObject?.length ?? 0)
    if (images.length > 4 || others > 8 || images.length + others < 1) return false
    if (page.containerTotalNum !== undefined && page.containerTotalNum !== images.length + others) return false
    for (const c of images) {
      if (c.width < 20 || c.width > MAX_CONTAINER_WIDTH || c.height < 20 || c.height > MAX_CONTAINER_HEIGHT) return false
    }
    this.containers = new Map(images.map((c) => [c.containerID, c]))
    this.framebuffer.fill(0)
    return true
  }

  async updateImageRawData(data: { containerID?: number; containerName?: string; imageData?: Uint8Array | ArrayBuffer | number[] }): Promise<ImageResult> {
    const c = this.containers.get(data.containerID ?? -1)
    const bytes = data.imageData instanceof Uint8Array ? data.imageData : new Uint8Array(data.imageData ?? [])
    const record: SendRecord = { containerID: data.containerID ?? -1, kind: 'invalid', inputBytes: bytes.length, wireBytes: 0, startMs: this.clockMs, ms: 0, result: 'success' }
    this.sends.push(record)
    if (!c) return (record.result = 'imageException')
    record.kind = detectPayload(bytes, c.width, c.height)
    let levels: Gray4Image
    try {
      levels = hostDecode(bytes, c.width, c.height)
    } catch (e) {
      return (record.result = e instanceof HostError ? e.result : 'imageException')
    }
    record.wireBytes = wireBytes(levels)
    record.ms = sendMs(record.wireBytes, this.transport)
    this.clockMs += record.ms
    this.blit(c, levels)
    return 'success'
  }

  private blit(c: ImageContainer, img: Gray4Image): void {
    for (let y = 0; y < img.height; y++) {
      const sy = c.yPosition + y
      if (sy < 0 || sy >= SCREEN_HEIGHT) continue
      for (let x = 0; x < img.width; x++) {
        const sx = c.xPosition + x
        if (sx >= 0 && sx < SCREEN_WIDTH) this.framebuffer[sy * SCREEN_WIDTH + sx] = img.levels[y * img.width + x]
      }
    }
  }

  //simulator = looks like the official screenshot, linear = level/15 on black
  render(curve: 'simulator' | 'linear' = 'linear'): RawImage {
    const data = new Uint8Array(this.framebuffer.length * 4)
    for (let i = 0; i < this.framebuffer.length; i++) {
      const l = this.framebuffer[i]
      if (curve === 'simulator') {
        data.set([0, 255, 0, SIMULATOR_ALPHA[l]], i * 4)
      } else {
        data.set([0, Math.round((l * 255) / 15), 0, 255], i * 4)
      }
    }
    return { width: SCREEN_WIDTH, height: SCREEN_HEIGHT, channels: 4, data }
  }
}
