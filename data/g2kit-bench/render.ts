//re-renders g2-kit's hub-bench tiles (commit 02f22707) and measures them with our host model
//run it from a built g2-kit checkout: NARROWBAND=<this repo> node nb-render.ts
import { writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { encodeTile } from 'g2-kit/core'
import { BenchFrame } from './examples/hub-bench/frame.ts'

const nb = (p: string) => pathToFileURL(`${process.env.NARROWBAND}/${p}`).href
const { compressedSize } = await import(nb('src/lz4.ts'))
const { packGray4 } = await import(nb('src/gray4.ts'))
const { encodePngGray4 } = await import(nb('sim/png.ts'))

//medians + p95 in ms from g2-kit STATUS.md (H1b, H1c), measured on g2 + iphone
const CASES = [
  { sweep: 'content', content: 'blank', w: 288, h: 144, median: 203, p95: 260, name: 'blank' },
  { sweep: 'content', content: 'simple', w: 288, h: 144, median: 345, p95: 431, name: 'simple' },
  { sweep: 'content', content: 'busy', w: 288, h: 144, median: 543, p95: 689, name: 'busy' },
  { sweep: 'content', content: 'chart', w: 288, h: 144, median: 518, p95: 601, name: 'chart' },
  { sweep: 'content', content: 'chart-outline', w: 288, h: 144, median: 569, p95: 718, name: 'chart-outline' },
  { sweep: 'size', content: 'simple', w: 288, h: 144, median: 345, p95: 430, name: '288×144' },
  { sweep: 'size', content: 'simple', w: 288, h: 72, median: 260, p95: 288, name: '288×72' },
  { sweep: 'size', content: 'simple', w: 144, h: 144, median: 287, p95: 346, name: '144×144' },
  { sweep: 'size', content: 'simple', w: 144, h: 72, median: 260, p95: 318, name: '144×72' },
  { sweep: 'size', content: 'simple', w: 72, h: 72, median: 203, p95: 289, name: '72×72' },
  { sweep: 'surface', content: 'chart', w: 288, h: 144, median: 517, p95: 718, name: 'chart' },
  { sweep: 'surface', content: 'chart-outline', w: 288, h: 144, median: 570, p95: 662, name: 'chart-outline' },
  { sweep: 'surface', content: 'chart-outline-plain', w: 288, h: 144, median: 570, p95: 723, name: 'chart-outline-plain' },
  { sweep: 'surface', content: 'progress', w: 288, h: 144, median: 259, p95: 321, name: 'progress' },
  { sweep: 'surface', content: 'progress-outline', w: 288, h: 144, median: 286, p95: 344, name: 'progress-outline' },
  { sweep: 'surface', content: 'progress-outline-plain', w: 288, h: 144, median: 260, p95: 317, name: 'progress-outline-plain' },
] as const
const n = 30
const out = []
mkdirSync('nb-tiles', { recursive: true })
for (const c of CASES) {
  const frames = []
  for (let i = 1; i <= n; i++) {
    const fb = BenchFrame.renderToTile({ i, n, name: c.name, content: c.content }, { w: c.w, h: c.h })
    const levels = fb.data
    const img = { width: c.w, height: c.h, levels }
    const g4 = packGray4(img)
    const g8 = levels.map((l: number) => l * 17)
    frames.push({
      i,
      gray4Lz4: compressedSize(g4),
      gray4Lz4u32: compressedSize(g4, { table: 'u32' }),
      gray8Lz4: compressedSize(g8),
      sdkPngBytes: encodeTile(fb, 'png').length,
      litPixels: levels.reduce((s: number, l: number) => s + (l > 0 ? 1 : 0), 0),
    })
    if (i === 15) writeFileSync(`nb-tiles/${c.sweep}-${c.content}-${c.w}x${c.h}.png`, encodePngGray4(c.w, c.h, levels))
  }
  out.push({ ...c, frames })
  const med = (k: string) => { const s = frames.map((f: any) => f[k]).sort((a: number, b: number) => a - b); return s[Math.floor(s.length / 2)] }
  console.log(c.sweep.padEnd(8), c.name.padEnd(24), String(c.median).padStart(4), 'ms  gray4 LZ4', String(med('gray4Lz4')).padStart(6), ' gray8 LZ4', String(med('gray8Lz4')).padStart(6), ' png', med('sdkPngBytes'))
}
writeFileSync('nb-g2kit-bench.json', JSON.stringify({ source: 'g2-kit (github.com/RAZKOM/g2-kit, MIT) commit 02f22707, examples/hub-bench/frame.ts; timings from STATUS.md H1b/H1c', frames: n, cases: out }))
