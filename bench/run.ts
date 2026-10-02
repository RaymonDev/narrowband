//phase 1 bench: every corpus image x method x level count
//the frame gets split in the 4 quadrant containers, each one packed + lz4ed like the host does
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { availableParallelism } from 'node:os'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { DITHER_METHODS, quantize, type DitherMethod } from '../src/dither.ts'
import { crop, gray4ToGray8, packGray4, QUADRANTS, type Gray8Image } from '../src/gray4.ts'
import { compressedSize } from '../src/lz4.ts'
import { msSsim, psnr, ssim } from '../src/metrics.ts'
import { decodePng } from '../sim/png.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
export const LEVELS = [16, 12, 8, 6, 4, 3, 2]
//eye blur for the blurred ssim, in px
export const BLUR_SIGMA = 1

export interface Row {
  type: string
  image: string
  method: DitherMethod
  levels: number
  //lz4 bytes per container, quadrant order
  containerBytes: number[]
  bytes: number
  //same but with the streaming (u32) lz4 table
  bytesU32: number
  levelsUsed: number
  psnr: number
  ssim: number
  msSsim: number
  ssimBlur: number
}

interface Entry {
  type: string
  name: string
  file: string
}

function loadGray(file: string): Gray8Image {
  const img = decodePng(new Uint8Array(readFileSync(join(root, 'corpus', file))))
  if (img.channels !== 1) throw new Error(`${file}: expected 8-bit grey`)
  return { width: img.width, height: img.height, data: img.data }
}

export function measure(src: Gray8Image, e: Entry, method: DitherMethod, levels: number): Row {
  const q = quantize(src, { method, levels })
  const containerBytes: number[] = []
  let bytesU32 = 0
  for (const r of QUADRANTS) {
    const packed = packGray4(crop(q, r.x, r.y, r.width, r.height))
    containerBytes.push(compressedSize(packed))
    bytesU32 += compressedSize(packed, { table: 'u32' })
  }
  const out = gray4ToGray8(q)
  return {
    type: e.type,
    image: e.name,
    method,
    levels,
    containerBytes,
    bytes: containerBytes.reduce((s, b) => s + b, 0),
    bytesU32,
    levelsUsed: new Set(q.levels).size,
    psnr: psnr(src, out),
    ssim: ssim(src, out),
    msSsim: msSsim(src, out),
    ssimBlur: ssim(src, out, { blurSigma: BLUR_SIGMA }),
  }
}

function runImage(e: Entry): Row[] {
  const src = loadGray(e.file)
  const rows: Row[] = []
  for (const method of DITHER_METHODS) for (const levels of LEVELS) rows.push(measure(src, e, method, levels))
  return rows
}

if (!isMainThread) {
  for (const e of workerData as Entry[]) parentPort!.postMessage(runImage(e))
} else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync(join(root, 'corpus/manifest.json'), 'utf8')) as Entry[]
  const t0 = performance.now()
  const threads = Math.max(1, Math.min(manifest.length, availableParallelism() - 1))
  const chunks: Entry[][] = Array.from({ length: threads }, () => [])
  manifest.forEach((e, i) => chunks[i % threads].push(e))
  const rows: Row[] = []
  let done = 0
  await Promise.all(
    chunks.map(
      (chunk) =>
        new Promise<void>((resolve, reject) => {
          const w = new Worker(fileURLToPath(import.meta.url), { workerData: chunk })
          w.on('message', (r: Row[]) => {
            rows.push(...r)
            console.log(`  [${++done}/${manifest.length}] ${r[0].type}/${r[0].image}`)
          })
          w.on('error', reject)
          w.on('exit', () => resolve())
        }),
    ),
  )
  const order = new Map(manifest.map((e, i) => [e.name, i]))
  rows.sort((a, b) => order.get(a.image)! - order.get(b.image)! || DITHER_METHODS.indexOf(a.method) - DITHER_METHODS.indexOf(b.method) || b.levels - a.levels)
  const dir = join(root, 'results/phase1')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'results.json'), JSON.stringify(rows))
  const cols = ['type', 'image', 'method', 'levels', 'bytes', 'bytesU32', 'c0', 'c1', 'c2', 'c3', 'levelsUsed', 'psnr', 'ssim', 'msSsim', 'ssimBlur'] as const
  const csv = [cols.join(',')]
  for (const r of rows) {
    csv.push(
      [r.type, r.image, r.method, r.levels, r.bytes, r.bytesU32, ...r.containerBytes, r.levelsUsed, r.psnr.toFixed(3), r.ssim.toFixed(5), r.msSsim.toFixed(5), r.ssimBlur.toFixed(5)].join(','),
    )
  }
  writeFileSync(join(dir, 'results.csv'), csv.join('\n') + '\n')
  console.log(`${rows.length} variants in ${((performance.now() - t0) / 1000).toFixed(1)} s on ${threads} threads → results/phase1/results.csv`)
}
