//fits g2-kit's on-glasses send times against a few size measures of the same tiles
//if the host lz4s packed gray4 that one should fit best (it does, R² 0.94)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

interface Frame {
  gray4Lz4: number
  gray4Lz4u32: number
  gray8Lz4: number
  sdkPngBytes: number
  litPixels: number
}
interface Case {
  sweep: string
  name: string
  w: number
  h: number
  median: number
  p95: number
  frames: Frame[]
}

const bench = JSON.parse(readFileSync(join(root, 'data/g2kit-bench/bench.json'), 'utf8')) as { cases: Case[] }

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const PROXIES: { key: string; label: string; f: (c: Case) => number }[] = [
  { key: 'gray4Lz4', label: 'LZ4 of packed Gray4 (narrowband model)', f: (c) => median(c.frames.map((x) => x.gray4Lz4)) },
  { key: 'gray4Lz4u32', label: 'LZ4 of packed Gray4, u32 table', f: (c) => median(c.frames.map((x) => x.gray4Lz4u32)) },
  { key: 'gray8Lz4', label: 'LZ4 of Gray8 (L×17)', f: (c) => median(c.frames.map((x) => x.gray8Lz4)) },
  { key: 'sdkPngBytes', label: 'bytes handed to the SDK (PNG)', f: (c) => median(c.frames.map((x) => x.sdkPngBytes)) },
  { key: 'pixels', label: 'pixel count', f: (c) => c.w * c.h },
  { key: 'litPixels', label: 'lit (non-zero) pixels', f: (c) => median(c.frames.map((x) => x.litPixels)) },
]

export interface LinearFit {
  intercept: number
  slope: number
  r2: number
  rmse: number
  //leave-one-out rmse
  looRmse: number
}

export function fitLine(x: number[], y: number[]): LinearFit {
  const ols = (xs: number[], ys: number[]) => {
    const n = xs.length
    const mx = xs.reduce((s, v) => s + v, 0) / n
    const my = ys.reduce((s, v) => s + v, 0) / n
    let sxy = 0
    let sxx = 0
    for (let i = 0; i < n; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my)
      sxx += (xs[i] - mx) ** 2
    }
    const slope = sxx === 0 ? 0 : sxy / sxx
    return { slope, intercept: my - slope * mx }
  }
  const { slope, intercept } = ols(x, y)
  const my = y.reduce((s, v) => s + v, 0) / y.length
  let ssr = 0
  let sst = 0
  for (let i = 0; i < x.length; i++) {
    ssr += (y[i] - (intercept + slope * x[i])) ** 2
    sst += (y[i] - my) ** 2
  }
  let loo = 0
  for (let i = 0; i < x.length; i++) {
    const f = ols(x.filter((_, j) => j !== i), y.filter((_, j) => j !== i))
    loo += (y[i] - (f.intercept + f.slope * x[i])) ** 2
  }
  return { intercept, slope, r2: sst === 0 ? 0 : 1 - ssr / sst, rmse: Math.sqrt(ssr / x.length), looRmse: Math.sqrt(loo / x.length) }
}

const y = bench.cases.map((c) => c.median)
const fits = PROXIES.map((p) => {
  const x = bench.cases.map(p.f)
  return { ...p, x, fit: fitLine(x, y) }
}).sort((a, b) => b.fit.r2 - a.fit.r2)

console.log(`send time (median ms, ${bench.cases.length} cases, G2 hardware via g2-kit) vs candidate size measures:\n`)
console.log('measure'.padEnd(42), 'R²'.padStart(6), 'RMSE'.padStart(7), 'LOO'.padStart(7), 'fixed ms'.padStart(9), 'ms/KB'.padStart(7))
for (const { label, fit } of fits) {
  console.log(
    label.padEnd(42),
    fit.r2.toFixed(3).padStart(6),
    fit.rmse.toFixed(1).padStart(7),
    fit.looRmse.toFixed(1).padStart(7),
    fit.intercept.toFixed(0).padStart(9),
    (fit.slope * 1000).toFixed(1).padStart(7),
  )
}
const best = fits.find((f) => f.key === 'gray4Lz4')!
console.log(`\nper case, LZ4 Gray4 model: predicted = ${best.fit.intercept.toFixed(0)} ms + bytes × ${(best.fit.slope * 1000).toFixed(1)} ms/KB`)
for (const [i, c] of bench.cases.entries()) {
  const pred = best.fit.intercept + best.fit.slope * best.x[i]
  console.log(`  ${(c.sweep + ' ' + c.name).padEnd(32)} ${String(best.x[i]).padStart(6)} B  measured ${String(c.median).padStart(4)}  predicted ${pred.toFixed(0).padStart(4)}`)
}

mkdirSync(join(root, 'results/phase0'), { recursive: true })
writeFileSync(
  join(root, 'results/phase0/transport-fit.json'),
  JSON.stringify(
    {
      source: 'data/g2kit-bench/bench.json',
      fits: fits.map(({ key, label, fit, x }) => ({ key, label, ...fit, x })),
      measuredMedianMs: y,
      cases: bench.cases.map((c) => `${c.sweep}/${c.name}`),
    },
    null,
    1,
  ),
)
