//static svg figures for the docs (light + dark via prefers-color-scheme)
//run it after bench and calibrate
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DitherMethod } from '../src/dither.ts'
import type { Row } from './run.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'docs/img')
mkdirSync(outDir, { recursive: true })

const STYLE = `
  <style>
    svg { --surface:#fcfcfb; --ink:#0b0b0b; --ink2:#52514e; --muted:#898781; --grid:#e1e0d9; --axis:#c3c2b7;
          --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    @media (prefers-color-scheme: dark) {
      svg { --surface:#1a1a19; --ink:#ffffff; --ink2:#c3c2b7; --muted:#898781; --grid:#2c2c2a; --axis:#383835;
            --s1:#3987e5; --s2:#d95926; --s3:#199e70; }
    }
    .bg { fill: var(--surface); }
    .title { fill: var(--ink); font-size: 15px; font-weight: 600; }
    .sub { fill: var(--ink2); font-size: 12px; }
    .panel { fill: var(--ink); font-size: 13px; font-weight: 600; }
    .tick { fill: var(--muted); font-size: 10.5px; font-variant-numeric: tabular-nums; }
    .label { fill: var(--ink2); font-size: 11px; }
    .grid { stroke: var(--grid); stroke-width: 1; }
    .axis { stroke: var(--axis); stroke-width: 1; }
    .line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    .dot { stroke: var(--surface); stroke-width: 2; }
  </style>`

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const niceTicks = (lo: number, hi: number, n: number) => {
  const step0 = (hi - lo) / n
  const mag = 10 ** Math.floor(Math.log10(step0))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0)!
  const out: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(10))
  return out
}

//figure 1: rd curves
{
  const rows = JSON.parse(readFileSync(join(root, 'results/phase1/results.json'), 'utf8')) as Row[]
  const types = [...new Set(rows.map((r) => r.type))]
  const LEVELS = [16, 12, 8, 6, 4]
  const SERIES: { method: DitherMethod; name: string; color: string }[] = [
    { method: 'none', name: 'Plain quantization (today)', color: 'var(--s1)' },
    { method: 'bayer2', name: 'Bayer 2×2 ordered', color: 'var(--s2)' },
    { method: 'floyd-steinberg', name: 'Floyd–Steinberg', color: 'var(--s3)' },
  ]
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length
  const curve = (t: string, m: DitherMethod) =>
    LEVELS.map((l) => {
      const rs = rows.filter((r) => r.type === t && r.method === m && r.levels === l)
      const base = (img: string) => rows.find((r) => r.image === img && r.method === 'none' && r.levels === 16)!
      return { l, x: mean(rs.map((r) => r.bytes / base(r.image).bytes)) * 100, y: mean(rs.map((r) => r.msSsim)) }
    })

  const cols = 4
  const pw = 200
  const ph = 160
  const gapX = 62
  const gapY = 70
  const left = 56
  const top = 108
  const W = left + cols * pw + (cols - 1) * gapX + 24
  const H = top + 2 * ph + gapY + 56
  const svg: string[] = []
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">`)
  svg.push(`<title id="t">Bytes versus quality per content type</title>`)
  svg.push(`<desc id="d">For each of seven content types, mean LZ4 bytes per frame relative to today's plain quantization (x) against MS-SSIM (y), at 16, 12, 8, 6 and 4 levels, for plain quantization, Bayer 2×2 and Floyd–Steinberg. Floyd–Steinberg sits to the right (more bytes); Bayer 2×2 runs close to plain quantization. Data: results/phase1/report.md.</desc>`)
  svg.push(STYLE)
  svg.push(`<rect class="bg" width="${W}" height="${H}"/>`)
  svg.push(`<text class="title" x="${left - 40}" y="26">Dithering buys quality with bytes; it does not beat plain quantization at equal quality</text>`)
  svg.push(`<text class="sub" x="${left - 40}" y="46">Mean over 5 images per type. x: LZ4 bytes per frame vs. today (plain, 16 levels = 100 %). y: MS-SSIM vs. the 8-bit source. Points: 16 → 4 levels, right to left.</text>`)
  let lx = left - 40
  for (const s of SERIES) {
    svg.push(`<line x1="${lx}" y1="68" x2="${lx + 18}" y2="68" stroke="${s.color}" class="line"/><circle cx="${lx + 9}" cy="68" r="4" fill="${s.color}" class="dot"/>`)
    svg.push(`<text class="label" x="${lx + 24}" y="72">${esc(s.name)}</text>`)
    lx += 24 + s.name.length * 6.3 + 22
  }
  types.forEach((t, i) => {
    const px = left + (i % cols) * (pw + gapX)
    const py = top + Math.floor(i / cols) * (ph + gapY)
    const curves = SERIES.map((s) => ({ ...s, pts: curve(t, s.method) }))
    const xs = curves.flatMap((c) => c.pts.map((p) => p.x))
    const ys = curves.flatMap((c) => c.pts.map((p) => p.y))
    const xt = niceTicks(Math.min(40, ...xs), Math.max(...xs), 4)
    const x0 = xt[0]
    const x1 = Math.max(xt[xt.length - 1], Math.max(...xs))
    const yt = niceTicks(Math.min(...ys), Math.max(...ys, 1), 4)
    const y0 = Math.min(yt[0], ...ys)
    const y1 = Math.max(yt[yt.length - 1], ...ys)
    const sx = (v: number) => px + ((v - x0) / (x1 - x0)) * pw
    const sy = (v: number) => py + ph - ((v - y0) / (y1 - y0)) * ph
    svg.push(`<text class="panel" x="${px}" y="${py - 16}">${esc(t)}</text>`)
    for (const v of yt) {
      svg.push(`<line class="grid" x1="${px}" x2="${px + pw}" y1="${sy(v)}" y2="${sy(v)}"/>`)
      svg.push(`<text class="tick" x="${px - 6}" y="${sy(v) + 3.5}" text-anchor="end">${v.toFixed(yt[1] - yt[0] < 0.01 ? 3 : 2)}</text>`)
    }
    svg.push(`<line class="axis" x1="${px}" x2="${px + pw}" y1="${py + ph}" y2="${py + ph}"/>`)
    for (const v of xt) svg.push(`<text class="tick" x="${sx(v)}" y="${py + ph + 15}" text-anchor="middle">${v} %</text>`)
    //today's point
    svg.push(`<line class="axis" x1="${sx(100)}" x2="${sx(100)}" y1="${py}" y2="${py + ph}" stroke-dasharray="0"/>`)
    for (const c of curves) {
      svg.push(`<polyline class="line" stroke="${c.color}" points="${c.pts.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ')}"/>`)
      for (const p of c.pts) {
        svg.push(`<circle class="dot" cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="4" fill="${c.color}"><title>${esc(c.name)}, ${p.l} levels: ${p.x.toFixed(0)} % bytes, MS-SSIM ${p.y.toFixed(4)}</title></circle>`)
      }
    }
    if (i === 0) {
      const b = curves[0].pts[0]
      svg.push(`<text class="label" x="${sx(b.x) + 6}" y="${sy(b.y) + 16}">today</text>`)
    }
  })
  //empty 8th slot, put the how-to-read note there
  {
    const px = left + 3 * (pw + gapX)
    const py = top + ph + gapY - 8
    const lines = [
      'How to read: up is better, left is cheaper.',
      'A strategy beats today only if its curve',
      'passes above-left of the "today" point.',
      'No curve does by more than ~1 %.',
      'At 16 levels Floyd–Steinberg costs',
      '+14 to +336 % bytes; Bayer 2×2 +5 to +28 %.',
    ]
    lines.forEach((l, k) => svg.push(`<text class="label" x="${px}" y="${py + 14 + k * 17}">${esc(l)}</text>`))
  }
  svg.push(`<text class="tick" x="${left - 40}" y="${H - 14}">narrowband Phase 1 · 35 images · LZ4_compress_default over packed Gray4, 4 containers per frame</text>`)
  svg.push('</svg>')
  writeFileSync(join(outDir, 'rd-curves.svg'), svg.join('\n'))
}

//figure 2: transport fit
{
  const fit = JSON.parse(readFileSync(join(root, 'results/phase0/transport-fit.json'), 'utf8')) as {
    fits: { key: string; intercept: number; slope: number; r2: number; looRmse: number; x: number[] }[]
    measuredMedianMs: number[]
    cases: string[]
  }
  const f = fit.fits.find((x) => x.key === 'gray4Lz4')!
  const W = 640
  const H = 400
  const left = 64
  const top = 78
  const pw = W - left - 30
  const ph = H - top - 56
  const xMax = 3000
  const yMax = 700
  const sx = (v: number) => left + (v / xMax) * pw
  const sy = (v: number) => top + ph - (v / yMax) * ph
  const svg: string[] = []
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="t d">`)
  svg.push(`<title id="t">G2 send time versus LZ4 bytes</title>`)
  svg.push(`<desc id="d">Median updateImageRawData time on G2 glasses for 16 tile variants measured by g2-kit, against the LZ4 size of the same tiles packed as Gray4. A line of ${f.intercept.toFixed(0)} ms plus ${(f.slope * 1000).toFixed(0)} ms per KB fits with R² ${f.r2.toFixed(2)}.</desc>`)
  svg.push(STYLE)
  svg.push(`<rect class="bg" width="${W}" height="${H}"/>`)
  svg.push(`<text class="title" x="16" y="26">On G2 hardware, send time follows the LZ4 size of packed Gray4</text>`)
  svg.push(`<text class="sub" x="16" y="46">16 tile variants timed by g2-kit (median of 30 sends each) vs. our LZ4 size of the same tiles.</text>`)
  svg.push(`<text class="sub" x="16" y="62">Fit: ${f.intercept.toFixed(0)} ms + ${(f.slope * 1000).toFixed(0)} ms/KB (≈ ${(1 / f.slope).toFixed(1)} KB/s effective), R² ${f.r2.toFixed(2)}, leave-one-out error ${f.looRmse.toFixed(0)} ms.</text>`)
  for (const v of [0, 100, 200, 300, 400, 500, 600, 700]) {
    svg.push(`<line class="grid" x1="${left}" x2="${left + pw}" y1="${sy(v)}" y2="${sy(v)}"/>`)
    svg.push(`<text class="tick" x="${left - 8}" y="${sy(v) + 3.5}" text-anchor="end">${v} ms</text>`)
  }
  svg.push(`<line class="axis" x1="${left}" x2="${left + pw}" y1="${sy(0)}" y2="${sy(0)}"/>`)
  for (const v of [0, 500, 1000, 1500, 2000, 2500, 3000]) svg.push(`<text class="tick" x="${sx(v)}" y="${sy(0) + 16}" text-anchor="middle">${v.toLocaleString('en')}</text>`)
  svg.push(`<text class="label" x="${left + pw}" y="${sy(0) + 34}" text-anchor="end">LZ4 bytes per send (packed Gray4, LZ4_compress_default)</text>`)
  svg.push(`<line x1="${sx(0)}" y1="${sy(f.intercept)}" x2="${sx(xMax)}" y2="${sy(f.intercept + f.slope * xMax)}" stroke="var(--s1)" stroke-width="2" stroke-opacity="0.45"/>`)
  const labelled = new Map([
    ['content/blank', 'blank tile'],
    ['content/busy', 'dense cross-hatch'],
    ['content/chart-outline', 'outline bar chart'],
    ['size/72×72', '72×72 tile'],
    ['content/simple', 'counter'],
  ])
  fit.cases.forEach((c, i) => {
    svg.push(`<circle class="dot" cx="${sx(f.x[i]).toFixed(1)}" cy="${sy(fit.measuredMedianMs[i]).toFixed(1)}" r="5" fill="var(--s1)"><title>${esc(c)}: ${Math.round(f.x[i])} B, ${fit.measuredMedianMs[i]} ms</title></circle>`)
  })
  //labels go after the dots so no dot paints over them
  const offsets: Record<string, [number, number, 'start' | 'end']> = {
    'content/blank': [-9, -10, 'end'],
    'size/72×72': [9, 18, 'start'],
    'content/simple': [-10, -10, 'end'],
    'content/busy': [9, 4, 'start'],
    'content/chart-outline': [4, -12, 'end'],
  }
  fit.cases.forEach((c, i) => {
    const l = labelled.get(c)
    if (!l) return
    const [dx, dy, anchor] = offsets[c]
    svg.push(`<text class="label" x="${sx(f.x[i]) + dx}" y="${sy(fit.measuredMedianMs[i]) + dy}" text-anchor="${anchor}">${esc(l)}</text>`)
  })
  svg.push(`<text class="tick" x="16" y="${H - 10}">Timings: github.com/RAZKOM/g2-kit STATUS.md (H1b, H1c). Tiles re-rendered from its hub-bench code; data/g2kit-bench.</text>`)
  svg.push('</svg>')
  writeFileSync(join(outDir, 'transport-fit.svg'), svg.join('\n'))
}
console.log('wrote docs/img/rd-curves.svg, docs/img/transport-fit.svg')
