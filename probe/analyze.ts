//phase 0 analysis: reads the probe screenshots back into the host model
//screenshots are rgba (0,255,0,a) with a = sim display curve. levels 9-15 all hit 255 so we only see >=9
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng, type RawImage } from '../sim/png.ts'
import { probeCases, type BlockGrid, type ProbeCase } from './cases.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'results', 'phase0')
const run = JSON.parse(readFileSync(join(outDir, 'run.json'), 'utf8')) as {
  simulator: string
  sdk: string
  date: string
  cases: { id: string; layout: string; screenshot: string; results: { containerID: number; result: string }[] }[]
}
const cases = new Map(probeCases().map((c) => [c.id, c]))
const shot = (id: string): RawImage => decodePng(readFileSync(join(outDir, 'screens', `${id}.png`)))
const alphaAt = (img: RawImage, x: number, y: number) => img.data[(y * img.width + x) * 4 + 3]

//exact for 0-8, 9 means 9 or brighter
type Obs = number

//calibration from packed gray4 with equal nibbles
const cal = (() => {
  const c = cases.get('levels-four-ways')!
  const img = shot(c.id)
  const perQuadrant = c.containers.map((k) =>
    Array.from({ length: 16 }, (_, L) => alphaAt(img, k.x + (L % 4) * 72 + 36, k.y + Math.floor(L / 4) * 36 + 18)),
  )
  const reference = perQuadrant[1] //the gray4 one
  const alphaToObs = new Map<number, Obs>()
  reference.forEach((a, L) => {
    if (!alphaToObs.has(a)) alphaToObs.set(a, Math.min(L, 9))
  })
  return {
    alphaPerLevel: reference,
    alphaToObs,
    fourWaysAgree: perQuadrant.every((q) => q.every((a, L) => a === reference[L])),
    distinctLevels: new Set(reference).size,
  }
})()
const obs = (alpha: number): Obs => {
  const o = cal.alphaToObs.get(alpha)
  if (o === undefined) throw new Error(`alpha ${alpha} not in calibration`)
  return o
}

//levels seen inside each block, 2px margin
function readGrid(img: RawImage, c: ProbeCase, g: BlockGrid): { value: number; levels: Obs[]; even: Obs[]; odd: Obs[] }[] {
  const k = c.containers.find((x) => x.id === g.containerID)!
  const bw = k.width / g.cols
  const bh = k.height / g.rows
  return g.values.map((value, i) => {
    const x0 = k.x + (i % g.cols) * bw
    const y0 = k.y + Math.floor(i / g.cols) * bh
    const all = new Set<Obs>()
    const even = new Set<Obs>()
    const odd = new Set<Obs>()
    for (let y = y0 + 2; y < y0 + bh - 2; y++) {
      for (let x = x0 + 2; x < x0 + bw - 2; x++) {
        const o = obs(alphaAt(img, x, y))
        all.add(o)
        ;((x - k.x) % 2 === 0 ? even : odd).add(o)
      }
    }
    return { value, levels: [...all].sort(), even: [...even].sort(), odd: [...odd].sort() }
  })
}

const single = (s: Obs[]) => (s.length === 1 ? s[0] : undefined)
const round17 = (v: number) => Math.min(9, Math.round(v / 17))

//raw gray8 and png -> level
function mapping(id: string) {
  const c = cases.get(id)!
  const img = shot(id)
  const table: (Obs | null)[] = new Array(256).fill(null)
  let uniform = true
  for (const g of c.grids) {
    for (const b of readGrid(img, c, g)) {
      const s = single(b.levels)
      if (s === undefined) uniform = false
      table[b.value] = s ?? null
    }
  }
  const mismatches = table.flatMap((o, v) => (o === round17(v) ? [] : [{ v, observed: o, round17: round17(v) }]))
  return { table, uniformBlocks: uniform, mismatchesVsRound17: mismatches }
}
const gray8 = mapping('gray8-all-values')
const png8 = mapping('png8-all-values')

//nibble order
const nibbles = (() => {
  const c = cases.get('gray4-all-bytes')!
  const img = shot(c.id)
  let highFirst = 0
  let lowFirst = 0
  let ambiguous = 0
  for (const g of c.grids) {
    for (const b of readGrid(img, c, g)) {
      const hi = Math.min(9, b.value >> 4)
      const lo = Math.min(9, b.value & 15)
      const e = single(b.even)
      const o = single(b.odd)
      if (hi === lo) ambiguous++
      else if (e === hi && o === lo) highFirst++
      else if (e === lo && o === hi) lowFirst++
    }
  }
  return { highFirst, lowFirst, ambiguous, verdict: highFirst > 0 && lowFirst === 0 ? 'high-first' : lowFirst > 0 && highFirst === 0 ? 'low-first' : 'unclear' }
})()

//dithering: every ramp column should be one level
const dither = (() => {
  const c = cases.get('dither-check')!
  const img = shot(c.id)
  const columnVariation = (k: (typeof c.containers)[number]) => {
    let varying = 0
    const levelByColumn: Obs[] = []
    for (let x = k.x; x < k.x + k.width; x++) {
      const s = new Set<Obs>()
      for (let y = k.y; y < k.y + k.height; y++) s.add(obs(alphaAt(img, x, y)))
      if (s.size > 1) varying++
      levelByColumn.push([...s][0])
    }
    return { columnsWithMoreThanOneLevel: varying, levelByColumn }
  }
  const rampGray8 = columnVariation(c.containers[0])
  const rampPng = columnVariation(c.containers[1])
  const flats = c.grids.map((g) => ({
    containerID: g.containerID,
    format: c.images.find((i) => i.containerID === g.containerID)!.format,
    blocks: readGrid(img, c, g).map((b) => ({ value: b.value, levels: b.levels })),
  }))
  return { rampGray8, rampPng, flats }
})()

//rgb -> grey weights
const luma = (() => {
  const c = cases.get('png-rgb-channels')!
  const img = shot(c.id)
  const names = ['red', 'green', 'blue', 'neutral']
  const out: Record<string, { lo: number; hi: number; samples: { v: number; level: Obs }[] }> = {}
  c.grids.forEach((g, q) => {
    const samples = readGrid(img, c, g).map((b) => ({ v: b.value, level: single(b.levels) ?? -1 }))
    //level L (<9) means w*v in [17L-8.5, 17L+8.5), level 9 means w*v >= 144.5
    let lo = 0
    let hi = Infinity
    for (const { v, level } of samples) {
      if (v === 0 || level < 0) continue
      if (level < 9) {
        lo = Math.max(lo, (17 * level - 8.5) / v)
        hi = Math.min(hi, (17 * level + 8.5) / v)
      } else lo = Math.max(lo, 144.5 / v)
    }
    out[names[q]] = { lo, hi, samples }
  })
  return out
})()

//alpha
const alpha = (() => {
  const c = cases.get('png-rgba-alpha')!
  const img = shot(c.id)
  return c.grids.map((g) => ({
    note: c.images.find((i) => i.containerID === g.containerID)!.note,
    levels: readGrid(img, c, g).map((b) => ({ alpha: b.value, level: single(b.levels) ?? -1 })),
  }))
})()

//odd widths: which packing gets accepted
const oddWidth = (() => {
  const c = cases.get('odd-width')!
  const img = shot(c.id)
  const report = run.cases.find((r) => r.id === c.id)!
  return c.containers.map((k) => {
    let diagonal = 0
    let off = 0
    for (let y = 0; y < k.height; y++) {
      for (let x = 0; x < k.width; x++) {
        const lit = alphaAt(img, k.x + x, k.y + y) > 0
        if (lit && x === y) diagonal++
        else if (lit) off++
      }
    }
    return {
      container: k.name,
      note: c.images.find((i) => i.containerID === k.id)!.note,
      bytes: c.images.find((i) => i.containerID === k.id)!.data.length,
      result: report.results.find((r) => r.containerID === k.id)?.result,
      diagonalPixelsLit: diagonal,
      offDiagonalPixelsLit: off,
    }
  })
})()

//bug 1: raw gray8 1-15
const bug1 = (() => {
  const c = cases.get('bug1-raw-gray8-low-values')
  if (!c || !run.cases.some((r) => r.id === c.id)) return undefined
  const img = shot(c.id)
  const ramp = (k: (typeof c.containers)[number]) => Array.from({ length: 32 }, (_, v) => obs(alphaAt(img, k.x + v * 9 + 4, k.y + 70)))
  const raw = ramp(c.containers[0])
  const png = ramp(c.containers[1])
  const photo = c.images[2].data
  let brighter = 0
  let sumRaw = 0
  let sumPng = 0
  for (let y = 0; y < 144; y++) {
    for (let x = 0; x < 288; x++) {
      const r = obs(alphaAt(img, c.containers[2].x + x, c.containers[2].y + y))
      const p = obs(alphaAt(img, c.containers[3].x + x, c.containers[3].y + y))
      if (r > p) brighter++
      sumRaw += r
      sumPng += p
    }
  }
  return {
    rampValues: Array.from({ length: 32 }, (_, v) => v),
    rawLevels: raw,
    pngLevels: png,
    nonMonotonic: raw.flatMap((l, v) => (v < 31 && l > raw[v + 1] ? [{ v, level: l, next: raw[v + 1] }] : [])),
    photo: {
      valueRange: [Math.min(...photo), Math.max(...photo)],
      shareIn1to15: photo.filter((v) => v >= 1 && v <= 15).length / photo.length,
      shareBrighterRaw: brighter / photo.length,
      meanLevelRaw: sumRaw / photo.length,
      meanLevelPng: sumPng / photo.length,
    },
  }
})()

//bug 2: magic numbers
const bug2 = run.cases
  .filter((r) => r.id.startsWith('bug2-'))
  .flatMap((r) => r.results.map((x) => ({ case: r.id, note: cases.get(r.id)!.images.find((i) => i.containerID === x.containerID)!.note, result: x.result })))

const analysis = {
  simulator: run.simulator,
  sdk: run.sdk,
  probedAt: run.date,
  calibration: { alphaPerLevel: cal.alphaPerLevel, distinctObservableLevels: cal.distinctLevels, fourEncodingsAgree: cal.fourWaysAgree },
  gray8,
  png8,
  nibbles,
  dither: {
    rampGray8ColumnsVarying: dither.rampGray8.columnsWithMoreThanOneLevel,
    rampPngColumnsVarying: dither.rampPng.columnsWithMoreThanOneLevel,
    flats: dither.flats,
  },
  luma: Object.fromEntries(Object.entries(luma).map(([k, v]) => [k, { lo: v.lo, hi: v.hi }])),
  alpha,
  oddWidth,
  bug1,
  bug2,
  resultCodes: run.cases.map((r) => ({ id: r.id, layout: r.layout, results: r.results.map((x) => `${x.containerID}:${x.result}`).join(' ') })),
}
writeFileSync(join(outDir, 'analysis.json'), JSON.stringify(analysis, null, 1))

//summary
const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(4) : '∞')
console.log(`simulator ${run.simulator}, SDK ${run.sdk}`)
console.log(`calibration: alpha per level ${cal.alphaPerLevel.join(' ')}; ${cal.distinctLevels} distinguishable; 4 encodings agree: ${cal.fourWaysAgree}`)
console.log(`8-bit PNG vs round(v/17): ${png8.mismatchesVsRound17.length} mismatches; blocks uniform: ${png8.uniformBlocks}`)
console.log(`raw Gray8 vs round(v/17): ${gray8.mismatchesVsRound17.length} mismatches: ${gray8.mismatchesVsRound17.map((m) => `${m.v}→${m.observed}`).join(' ')}`)
console.log(`nibble order: ${nibbles.verdict} (${nibbles.highFirst} high-first, ${nibbles.lowFirst} low-first, ${nibbles.ambiguous} equal-nibble)`)
console.log(`dither: ramp columns with >1 level: Gray8 ${dither.rampGray8.columnsWithMoreThanOneLevel}, PNG ${dither.rampPng.columnsWithMoreThanOneLevel}`)
for (const f of dither.flats) console.log(`  flats (${f.format}): ${f.blocks.map((b) => `${b.value}→{${b.levels.join(',')}}`).join(' ')}`)
for (const [k, v] of Object.entries(luma)) console.log(`luma weight ${k}: [${fmt(v.lo)}, ${fmt(v.hi)})`)
for (const a of alpha) console.log(`alpha ${a.note}: ${a.levels.filter((_, i) => i % 7 === 0).map((l) => `${l.alpha}→${l.level}`).join(' ')}`)
for (const o of oddWidth) console.log(`odd width ${o.container} (${o.bytes} B, ${o.note}): ${o.result}, diagonal ${o.diagonalPixelsLit}/21, stray ${o.offDiagonalPixelsLit}`)
if (bug1) {
  console.log(`bug 1, raw Gray8 0–31 → levels: ${bug1.rawLevels.join(' ')}`)
  console.log(`         same as PNG → levels: ${bug1.pngLevels.join(' ')}   (9 = "9 or brighter")`)
  console.log(`         non-monotonic: ${bug1.nonMonotonic.map((d) => `${d.v} → ${d.level}, ${d.v + 1} → ${d.next}`).join('; ')}`)
  const ph = bug1.photo
  console.log(`         dark photo (values ${ph.valueRange.join('–')}): brighter than PNG on ${(ph.shareBrighterRaw * 100).toFixed(1)} % of pixels; mean level ${ph.meanLevelRaw.toFixed(2)} vs ${ph.meanLevelPng.toFixed(2)}`)
}
for (const b of bug2) console.log(`bug 2, ${b.note}: ${b.result}`)
