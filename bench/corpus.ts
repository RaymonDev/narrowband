//builds the phase 1 corpus: 7 types x 5 images, 576x288 8-bit grey
//synthetic ones are drawn hud style (dark bg is see-through on the glasses), photos are kodak, maps are osm tiles inverted
//downloads get cached in .cache/ and the output is committed, so bench never needs the network
import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePng } from '../sim/png.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'corpus')
const cacheDir = join(root, '.cache', 'corpus')
const W = 576
const H = 288

type Ctx = SKRSContext2D
interface Entry {
  type: string
  name: string
  file: string
  source: string
  license: string
}
const manifest: Entry[] = []

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const grey = (v: number) => `rgb(${v},${v},${v})`

function canvas() {
  const c = createCanvas(W, H)
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  return { c, ctx }
}

//bt.601 luma, same weights as the host
function toGray(ctx: Ctx, invert = false): Uint8Array {
  const rgba = ctx.getImageData(0, 0, W, H).data
  const out = new Uint8Array(W * H)
  for (let i = 0; i < out.length; i++) {
    const v = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2])
    out[i] = invert ? 255 - v : v
  }
  return out
}

function save(type: string, name: string, data: Uint8Array, source: string, license: string) {
  mkdirSync(join(outDir, type), { recursive: true })
  const file = `${type}/${name}.png`
  writeFileSync(join(outDir, file), encodePng({ width: W, height: H, channels: 1, data }))
  manifest.push({ type, name, file, source, license })
  console.log(`  ${file}`)
}

const SYNTH = 'synthetic, bench/corpus.ts'
const OWN = 'MIT (this repository)'

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

//ui screens

function uiScreens() {
  //dashboard
  {
    const { ctx } = canvas()
    ctx.font = '600 15px "Segoe UI"'
    ctx.fillStyle = grey(150)
    ctx.fillText('FRI 2 OCT', 20, 30)
    ctx.textAlign = 'right'
    ctx.fillText('87%', W - 20, 30)
    ctx.textAlign = 'left'
    const cards = [
      { x: 16, y: 48, w: 176, h: 108, title: 'TIME', value: '14:32', sub: 'Barcelona' },
      { x: 200, y: 48, w: 176, h: 108, title: 'WEATHER', value: '23°', sub: 'Partly cloudy' },
      { x: 384, y: 48, w: 176, h: 108, title: 'STEPS', value: '8 412', sub: 'Goal 10 000' },
    ]
    for (const c of cards) {
      roundRect(ctx, c.x, c.y, c.w, c.h, 12)
      ctx.strokeStyle = grey(90)
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = grey(140)
      ctx.font = '600 13px "Segoe UI"'
      ctx.fillText(c.title, c.x + 14, c.y + 24)
      ctx.fillStyle = grey(255)
      ctx.font = '300 40px "Segoe UI"'
      ctx.fillText(c.value, c.x + 14, c.y + 70)
      ctx.fillStyle = grey(170)
      ctx.font = '14px "Segoe UI"'
      ctx.fillText(c.sub, c.x + 14, c.y + 94)
    }
    ctx.lineWidth = 8
    ctx.strokeStyle = grey(60)
    ctx.beginPath()
    ctx.arc(70, 222, 40, 0, Math.PI * 2)
    ctx.stroke()
    ctx.strokeStyle = grey(230)
    ctx.beginPath()
    ctx.arc(70, 222, 40, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * 0.84)
    ctx.stroke()
    ctx.fillStyle = grey(255)
    ctx.font = '600 18px "Segoe UI"'
    ctx.textAlign = 'center'
    ctx.fillText('84%', 70, 229)
    ctx.textAlign = 'left'
    ctx.font = '15px "Segoe UI"'
    ctx.fillStyle = grey(200)
    ctx.fillText('Next: Design review, 15:00', 140, 205)
    roundRect(ctx, 140, 220, 410, 12, 6)
    ctx.fillStyle = grey(50)
    ctx.fill()
    roundRect(ctx, 140, 220, 260, 12, 6)
    ctx.fillStyle = grey(200)
    ctx.fill()
    ctx.fillStyle = grey(130)
    ctx.font = '13px "Segoe UI"'
    ctx.fillText('28 min to go', 140, 254)
    save('ui', 'dashboard', toGray(ctx), SYNTH, OWN)
  }
  //notification list
  {
    const { ctx } = canvas()
    const rows = [
      ['Messages', 'Anna: are we still on for lunch?', '2m'],
      ['Calendar', 'Design review moved to 15:00', '12m'],
      ['Mail', 'Your order has shipped', '1h'],
      ['Weather', 'Rain expected after 18:00', '2h'],
      ['Fitness', 'You reached 8 000 steps', '3h'],
    ]
    rows.forEach(([app, text, t], i) => {
      const y = 14 + i * 54
      if (i === 1) {
        roundRect(ctx, 8, y - 4, W - 16, 50, 10)
        ctx.fillStyle = grey(45)
        ctx.fill()
        ctx.strokeStyle = grey(200)
        ctx.lineWidth = 2
        ctx.stroke()
      }
      ctx.beginPath()
      ctx.arc(36, y + 21, 15, 0, Math.PI * 2)
      ctx.fillStyle = grey(120 + i * 20)
      ctx.fill()
      ctx.fillStyle = grey(0)
      ctx.font = '700 15px "Segoe UI"'
      ctx.textAlign = 'center'
      ctx.fillText(app[0], 36, y + 27)
      ctx.textAlign = 'left'
      ctx.fillStyle = grey(255)
      ctx.font = '600 16px "Segoe UI"'
      ctx.fillText(app, 64, y + 16)
      ctx.fillStyle = grey(175)
      ctx.font = '15px "Segoe UI"'
      ctx.fillText(text, 64, y + 37)
      ctx.fillStyle = grey(120)
      ctx.textAlign = 'right'
      ctx.fillText(t, W - 20, y + 16)
      ctx.textAlign = 'left'
      if (i < rows.length - 1 && i !== 0 && i !== 1) {
        ctx.fillStyle = grey(40)
        ctx.fillRect(64, y + 48, W - 84, 1)
      }
    })
    save('ui', 'notifications', toGray(ctx), SYNTH, OWN)
  }
  //settings
  {
    const { ctx } = canvas()
    ctx.fillStyle = grey(255)
    ctx.font = '600 22px "Segoe UI"'
    ctx.fillText('Settings', 20, 34)
    ctx.fillStyle = grey(70)
    ctx.fillRect(20, 46, W - 40, 2)
    const items: [string, 'toggle' | 'slider', number][] = [
      ['Brightness', 'slider', 0.65],
      ['Auto brightness', 'toggle', 1],
      ['Head-up wake', 'toggle', 0],
      ['Text size', 'slider', 0.3],
      ['Notifications', 'toggle', 1],
    ]
    items.forEach(([label, kind, v], i) => {
      const y = 78 + i * 42
      ctx.fillStyle = grey(225)
      ctx.font = '17px "Segoe UI"'
      ctx.fillText(label, 24, y + 6)
      if (kind === 'toggle') {
        roundRect(ctx, W - 84, y - 12, 56, 26, 13)
        ctx.fillStyle = v ? grey(210) : grey(55)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(v ? W - 41 : W - 71, y + 1, 10, 0, Math.PI * 2)
        ctx.fillStyle = v ? grey(20) : grey(160)
        ctx.fill()
      } else {
        const x0 = 260
        const x1 = W - 32
        ctx.fillStyle = grey(60)
        ctx.fillRect(x0, y - 1, x1 - x0, 4)
        ctx.fillStyle = grey(220)
        ctx.fillRect(x0, y - 1, (x1 - x0) * v, 4)
        ctx.beginPath()
        ctx.arc(x0 + (x1 - x0) * v, y + 1, 9, 0, Math.PI * 2)
        ctx.fill()
      }
    })
    save('ui', 'settings', toGray(ctx), SYNTH, OWN)
  }
  //music player
  {
    const { ctx } = canvas()
    const g = ctx.createRadialGradient(110, 120, 10, 130, 140, 140)
    g.addColorStop(0, grey(235))
    g.addColorStop(0.5, grey(110))
    g.addColorStop(1, grey(25))
    roundRect(ctx, 24, 24, 200, 200, 16)
    ctx.fillStyle = g
    ctx.fill()
    ctx.fillStyle = grey(255)
    ctx.font = '600 24px "Segoe UI"'
    ctx.fillText('Clair de Lune', 250, 70)
    ctx.fillStyle = grey(170)
    ctx.font = '18px "Segoe UI"'
    ctx.fillText('Claude Debussy', 250, 100)
    ctx.fillText('Suite bergamasque', 250, 126)
    ctx.fillStyle = grey(60)
    ctx.fillRect(250, 168, 300, 4)
    ctx.fillStyle = grey(230)
    ctx.fillRect(250, 168, 128, 4)
    ctx.font = '13px "Segoe UI"'
    ctx.fillStyle = grey(150)
    ctx.fillText('2:07', 250, 192)
    ctx.textAlign = 'right'
    ctx.fillText('5:01', 550, 192)
    ctx.textAlign = 'left'
    const tri = (x: number, y: number, s: number, dir: 1 | -1) => {
      ctx.beginPath()
      ctx.moveTo(x, y - s)
      ctx.lineTo(x + dir * s * 1.4, y)
      ctx.lineTo(x, y + s)
      ctx.closePath()
      ctx.fill()
    }
    ctx.fillStyle = grey(220)
    tri(320, 240, 12, -1)
    tri(305, 240, 12, -1)
    ctx.fillRect(380, 226, 8, 28)
    ctx.fillRect(396, 226, 8, 28)
    tri(462, 240, 12, 1)
    tri(477, 240, 12, 1)
    save('ui', 'music', toGray(ctx), SYNTH, OWN)
  }
  //navigation
  {
    const { ctx } = canvas()
    ctx.fillStyle = grey(255)
    ctx.beginPath()
    ctx.moveTo(90, 210)
    ctx.lineTo(90, 120)
    ctx.quadraticCurveTo(90, 90, 120, 90)
    ctx.lineTo(150, 90)
    ctx.lineTo(150, 60)
    ctx.lineTo(200, 108)
    ctx.lineTo(150, 156)
    ctx.lineTo(150, 126)
    ctx.lineTo(126, 126)
    ctx.lineTo(126, 210)
    ctx.closePath()
    ctx.fill()
    ctx.font = '300 64px "Segoe UI"'
    ctx.fillText('350 m', 240, 120)
    ctx.fillStyle = grey(190)
    ctx.font = '22px "Segoe UI"'
    ctx.fillText('Turn right onto Carrer de Mallorca', 240, 160)
    ctx.fillStyle = grey(70)
    ctx.fillRect(0, 238, W, 1)
    ctx.fillStyle = grey(160)
    ctx.font = '17px "Segoe UI"'
    ctx.fillText('ETA 14:51', 24, 270)
    ctx.fillText('4.2 km', 250, 270)
    ctx.fillText('12 min', 460, 270)
    save('ui', 'navigation', toGray(ctx), SYNTH, OWN)
  }
}

//charts

function axes(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, rows: number, cols: number, labels = true) {
  ctx.strokeStyle = grey(45)
  ctx.lineWidth = 1
  for (let i = 0; i <= rows; i++) {
    const y = Math.round(y0 + ((y1 - y0) * i) / rows) + 0.5
    ctx.beginPath()
    ctx.moveTo(x0, y)
    ctx.lineTo(x1, y)
    ctx.stroke()
  }
  ctx.strokeStyle = grey(140)
  ctx.beginPath()
  ctx.moveTo(x0 + 0.5, y0)
  ctx.lineTo(x0 + 0.5, y1 + 0.5)
  ctx.lineTo(x1, y1 + 0.5)
  ctx.stroke()
  if (!labels) return
  ctx.fillStyle = grey(150)
  ctx.font = '12px "Segoe UI"'
  for (let i = 0; i <= cols; i++) ctx.fillText(String(i * 4).padStart(2, '0') + 'h', x0 + ((x1 - x0) * i) / cols - 8, y1 + 18)
  ctx.textAlign = 'right'
  for (let i = 0; i <= rows; i++) ctx.fillText(String((rows - i) * 25), x0 - 6, y0 + ((y1 - y0) * i) / rows + 4)
  ctx.textAlign = 'left'
}

function series(rnd: () => number, n: number, start: number, vol: number): number[] {
  const out = [start]
  for (let i = 1; i < n; i++) out.push(Math.max(5, Math.min(95, out[i - 1] + (rnd() - 0.5) * vol)))
  return out
}

function chartScreens() {
  const rnd = mulberry32(42)
  const X0 = 50
  const X1 = W - 20
  const Y0 = 40
  const Y1 = H - 36
  const px = (i: number, n: number) => X0 + ((X1 - X0) * i) / (n - 1)
  const py = (v: number) => Y1 - ((Y1 - Y0) * v) / 100
  const title = (ctx: Ctx, t: string) => {
    ctx.fillStyle = grey(240)
    ctx.font = '600 16px "Segoe UI"'
    ctx.fillText(t, X0, 24)
  }
  //line chart, two series
  {
    const { ctx } = canvas()
    title(ctx, 'Heart rate vs. pace')
    axes(ctx, X0, Y0, X1, Y1, 4, 6)
    for (const [k, s] of [series(rnd, 60, 40, 14), series(rnd, 60, 65, 10)].entries()) {
      ctx.strokeStyle = grey(k ? 150 : 255)
      ctx.lineWidth = k ? 1.5 : 2.5
      ctx.setLineDash(k ? [6, 4] : [])
      ctx.beginPath()
      s.forEach((v, i) => (i ? ctx.lineTo(px(i, s.length), py(v)) : ctx.moveTo(px(i, s.length), py(v))))
      ctx.stroke()
    }
    ctx.setLineDash([])
    save('chart', 'line-two-series', toGray(ctx), SYNTH, OWN)
  }
  //area chart with a gradient
  {
    const { ctx } = canvas()
    title(ctx, 'Power output (kW)')
    axes(ctx, X0, Y0, X1, Y1, 4, 6)
    const s = series(rnd, 120, 30, 9)
    const g = ctx.createLinearGradient(0, Y0, 0, Y1)
    g.addColorStop(0, grey(170))
    g.addColorStop(1, grey(0))
    ctx.beginPath()
    ctx.moveTo(px(0, s.length), Y1)
    s.forEach((v, i) => ctx.lineTo(px(i, s.length), py(v)))
    ctx.lineTo(X1, Y1)
    ctx.closePath()
    ctx.fillStyle = g
    ctx.fill()
    ctx.strokeStyle = grey(255)
    ctx.lineWidth = 2
    ctx.beginPath()
    s.forEach((v, i) => (i ? ctx.lineTo(px(i, s.length), py(v)) : ctx.moveTo(px(i, s.length), py(v))))
    ctx.stroke()
    save('chart', 'area-gradient', toGray(ctx), SYNTH, OWN)
  }
  //bars
  {
    const { ctx } = canvas()
    title(ctx, 'Sleep per night (h)')
    axes(ctx, X0, Y0, X1, Y1, 4, 0, false)
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    days.forEach((d, i) => {
      const v = 40 + rnd() * 50
      const bw = 44
      const x = X0 + 20 + i * ((X1 - X0 - 40) / 6) - bw / 2 + 10
      roundRect(ctx, x, py(v), bw, Y1 - py(v), [6, 6, 0, 0] as unknown as number)
      ctx.fillStyle = i === 5 ? grey(255) : grey(140)
      ctx.fill()
      ctx.fillStyle = grey(220)
      ctx.font = '600 13px "Segoe UI"'
      ctx.textAlign = 'center'
      ctx.fillText((v / 10).toFixed(1), x + bw / 2, py(v) - 6)
      ctx.fillStyle = grey(150)
      ctx.font = '12px "Segoe UI"'
      ctx.fillText(d, x + bw / 2, Y1 + 18)
      ctx.textAlign = 'left'
    })
    save('chart', 'bars', toGray(ctx), SYNTH, OWN)
  }
  //sparklines
  {
    const { ctx } = canvas()
    const names = ['CPU', 'Memory', 'Network', 'Battery']
    names.forEach((name, k) => {
      const x = (k % 2) * 288 + 14
      const y = (k >> 1) * 144 + 10
      roundRect(ctx, x, y, 260, 124, 8)
      ctx.strokeStyle = grey(70)
      ctx.lineWidth = 1.5
      ctx.stroke()
      ctx.fillStyle = grey(160)
      ctx.font = '13px "Segoe UI"'
      ctx.fillText(name, x + 12, y + 22)
      const s = series(rnd, 50, 50, 20)
      ctx.fillStyle = grey(255)
      ctx.font = '600 22px "Segoe UI"'
      ctx.textAlign = 'right'
      ctx.fillText(`${Math.round(s[s.length - 1])}%`, x + 248, y + 26)
      ctx.textAlign = 'left'
      ctx.strokeStyle = grey(210)
      ctx.lineWidth = 1.5
      ctx.beginPath()
      s.forEach((v, i) => {
        const xx = x + 12 + (236 * i) / (s.length - 1)
        const yy = y + 112 - (70 * v) / 100
        if (i) ctx.lineTo(xx, yy)
        else ctx.moveTo(xx, yy)
      })
      ctx.stroke()
    })
    save('chart', 'sparklines', toGray(ctx), SYNTH, OWN)
  }
  //candlesticks
  {
    const { ctx } = canvas()
    title(ctx, 'EUR / USD, 1h')
    axes(ctx, X0, Y0, X1, Y1, 5, 6)
    let price = 50
    for (let i = 0; i < 40; i++) {
      const open = price
      const close = Math.max(10, Math.min(90, open + (rnd() - 0.5) * 12))
      const hi = Math.max(open, close) + rnd() * 5
      const lo = Math.min(open, close) - rnd() * 5
      const x = X0 + 10 + i * ((X1 - X0 - 20) / 40)
      ctx.strokeStyle = grey(170)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(Math.round(x + 4) + 0.5, py(hi))
      ctx.lineTo(Math.round(x + 4) + 0.5, py(lo))
      ctx.stroke()
      const up = close >= open
      ctx.fillStyle = up ? grey(240) : grey(0)
      ctx.strokeStyle = grey(240)
      ctx.fillRect(Math.round(x), py(Math.max(open, close)), 9, Math.max(1, Math.abs(py(open) - py(close))))
      ctx.strokeRect(Math.round(x) + 0.5, py(Math.max(open, close)) + 0.5, 8, Math.max(1, Math.abs(py(open) - py(close))))
      price = close
    }
    save('chart', 'candles', toGray(ctx), SYNTH, OWN)
  }
}

//text

const PROSE =
  'Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, "and what is the use of a book," thought Alice, "without pictures or conversations?" So she was considering in her own mind (as well as she could, for the hot day made her feel very sleepy and stupid), whether the pleasure of making a daisy-chain would be worth the trouble of getting up and picking the daisies, when suddenly a White Rabbit with pink eyes ran close by her.'

function wrap(ctx: Ctx, text: string, x: number, y: number, maxW: number, lh: number, maxY = H - 8): number {
  let line = ''
  for (const word of text.split(' ')) {
    const t = line ? `${line} ${word}` : word
    if (ctx.measureText(t).width > maxW && line) {
      if (y > maxY) return y
      ctx.fillText(line, x, y)
      line = word
      y += lh
    } else line = t
  }
  if (line && y <= maxY) ctx.fillText(line, x, y)
  return y + lh
}

function textScreens() {
  //reader, sans 18px
  {
    const { ctx } = canvas()
    ctx.fillStyle = grey(235)
    ctx.font = '18px "Segoe UI"'
    wrap(ctx, PROSE, 20, 30, W - 40, 25)
    save('text', 'reader-sans-18', toGray(ctx), `${SYNTH}; text: Lewis Carroll, Alice's Adventures in Wonderland (public domain)`, OWN)
  }
  //serif 22px
  {
    const { ctx } = canvas()
    ctx.fillStyle = grey(255)
    ctx.font = '22px Georgia'
    wrap(ctx, PROSE.slice(300), 24, 36, W - 48, 31)
    save('text', 'reader-serif-22', toGray(ctx), `${SYNTH}; text: Lewis Carroll (public domain)`, OWN)
  }
  //code listing
  {
    const { ctx } = canvas()
    const code = [
      'export function packGray4(img: Gray4Image): Uint8Array {',
      '  const { width: w, height: h, levels } = img',
      '  const stride = Math.ceil(w / 2)',
      '  const out = new Uint8Array(stride * h)',
      '  for (let y = 0; y < h; y++) {',
      '    for (let x = 0; x < w; x += 2) {',
      '      const a = levels[y * w + x] & 15',
      '      const b = x + 1 < w ? levels[y * w + x + 1] & 15 : 0',
      '      out[y * stride + (x >> 1)] = (a << 4) | b',
      '    }',
      '  }',
      '  return out',
      '}',
    ]
    ctx.fillStyle = grey(40)
    ctx.fillRect(0, 12 + 7 * 20 + 5, W, 20)
    ctx.font = '14px Consolas'
    code.forEach((l, i) => {
      ctx.fillStyle = grey(100)
      ctx.textAlign = 'right'
      ctx.fillText(String(i + 1), 30, 30 + i * 20)
      ctx.textAlign = 'left'
      ctx.fillStyle = l.trim().startsWith('//') ? grey(130) : grey(225)
      ctx.fillText(l, 42, 30 + i * 20)
    })
    save('text', 'code-mono-14', toGray(ctx), SYNTH, OWN)
  }
  //notes with bullets
  {
    const { ctx } = canvas()
    ctx.fillStyle = grey(255)
    ctx.font = '600 26px "Segoe UI"'
    ctx.fillText('Meeting notes', 20, 40)
    ctx.fillStyle = grey(150)
    ctx.font = '14px "Segoe UI"'
    ctx.fillText('Thursday 1 October · 4 attendees', 20, 64)
    const bullets = [
      'Ship the probe harness and publish the Phase 0 pipeline model.',
      'Benchmark ordered vs. error-diffusion dithering on seven content types.',
      'Decide go / no-go on the encoder before writing the library API.',
      'Ask the community for G2 hardware time to validate the LZ4 path.',
    ]
    ctx.font = '17px "Segoe UI"'
    let y = 100
    for (const b of bullets) {
      ctx.fillStyle = grey(200)
      ctx.beginPath()
      ctx.arc(30, y - 6, 3.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = grey(225)
      y = wrap(ctx, b, 44, y, W - 70, 23) + 8
    }
    save('text', 'notes-bullets', toGray(ctx), SYNTH, OWN)
  }
  //teleprompter
  {
    const { ctx } = canvas()
    ctx.fillStyle = grey(255)
    ctx.font = '600 34px "Segoe UI"'
    ctx.textAlign = 'center'
    const lines = ['Thank you all for coming.', 'Today I want to show you', 'how a few bytes saved', 'make the glasses feel fast.']
    lines.forEach((l, i) => {
      ctx.fillStyle = grey(i === 1 ? 255 : 140)
      ctx.fillText(l, W / 2, 62 + i * 64)
    })
    save('text', 'teleprompter-34', toGray(ctx), SYNTH, OWN)
  }
}

//line art

function lineArtScreens() {
  //flowchart
  {
    const { ctx } = canvas()
    ctx.strokeStyle = grey(230)
    ctx.fillStyle = grey(230)
    ctx.lineWidth = 2
    ctx.font = '15px "Segoe UI"'
    ctx.textAlign = 'center'
    const box = (x: number, y: number, t: string) => {
      roundRect(ctx, x - 70, y - 22, 140, 44, 8)
      ctx.stroke()
      ctx.fillText(t, x, y + 5)
    }
    const arrow = (x0: number, y0: number, x1: number, y1: number) => {
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
      const a = Math.atan2(y1 - y0, x1 - x0)
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x1 - 10 * Math.cos(a - 0.4), y1 - 10 * Math.sin(a - 0.4))
      ctx.lineTo(x1 - 10 * Math.cos(a + 0.4), y1 - 10 * Math.sin(a + 0.4))
      ctx.closePath()
      ctx.fill()
    }
    box(100, 60, 'Plugin pixels')
    box(288, 60, 'Quantize')
    box(476, 60, 'Pack Gray4')
    box(476, 160, 'LZ4')
    box(288, 160, 'BLE')
    box(100, 160, 'Glasses')
    arrow(170, 60, 216, 60)
    arrow(358, 60, 404, 60)
    arrow(476, 82, 476, 136)
    arrow(406, 160, 360, 160)
    arrow(218, 160, 172, 160)
    ctx.beginPath()
    ctx.moveTo(288, 182)
    ctx.lineTo(288, 240)
    ctx.lineTo(420, 240)
    ctx.setLineDash([5, 5])
    ctx.stroke()
    ctx.setLineDash([])
    ctx.textAlign = 'left'
    ctx.fillStyle = grey(150)
    ctx.fillText('~6 KB/s effective', 300, 230)
    save('line-art', 'flowchart', toGray(ctx), SYNTH, OWN)
  }
  //spirograph
  {
    const { ctx } = canvas()
    ctx.strokeStyle = grey(220)
    ctx.lineWidth = 1.2
    for (const [cx, R, r, d] of [[150, 110, 37, 60], [430, 110, 41, 70]] as const) {
      ctx.beginPath()
      for (let t = 0; t <= Math.PI * 2 * 41; t += 0.02) {
        const x = cx + (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t)
        const y = 144 + (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t)
        if (t === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
    save('line-art', 'spirograph', toGray(ctx), SYNTH, OWN)
  }
  //gear drawing
  {
    const { ctx } = canvas()
    ctx.strokeStyle = grey(240)
    ctx.lineWidth = 2
    const cx = 180
    const cy = 144
    ctx.beginPath()
    const teeth = 18
    for (let i = 0; i <= teeth * 4; i++) {
      const a = (i / (teeth * 4)) * Math.PI * 2
      const r = i % 4 < 2 ? 110 : 92
      const x = cx + r * Math.cos(a)
      const y = cy + r * Math.sin(a)
      if (i) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
    }
    ctx.stroke()
    for (const r of [60, 24]) {
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.strokeStyle = grey(140)
    ctx.lineWidth = 1
    ctx.setLineDash([8, 3, 2, 3])
    ctx.beginPath()
    ctx.moveTo(cx - 130, cy)
    ctx.lineTo(cx + 130, cy)
    ctx.moveTo(cx, cy - 130)
    ctx.lineTo(cx, cy + 130)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(320, cy - 110)
    ctx.lineTo(320, cy + 110)
    ctx.moveTo(310, cy - 110)
    ctx.lineTo(330, cy - 110)
    ctx.moveTo(310, cy + 110)
    ctx.lineTo(330, cy + 110)
    ctx.stroke()
    ctx.fillStyle = grey(200)
    ctx.font = '15px Consolas'
    ctx.fillText('Ø 220', 334, cy + 5)
    ctx.fillText('18 teeth, module 6', 380, 60)
    ctx.fillText('bore Ø 48 H7', 380, 84)
    ctx.fillText('hub Ø 120', 380, 108)
    save('line-art', 'gear-drawing', toGray(ctx), SYNTH, OWN)
  }
  //icons
  {
    const { ctx } = canvas()
    ctx.strokeStyle = grey(230)
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    const icons: ((x: number, y: number) => void)[] = [
      (x, y) => { ctx.beginPath(); ctx.arc(x, y, 30, 0, Math.PI * 2); ctx.moveTo(x, y); ctx.lineTo(x, y - 20); ctx.moveTo(x, y); ctx.lineTo(x + 14, y + 8); ctx.stroke() },
      (x, y) => { ctx.beginPath(); ctx.moveTo(x - 30, y + 24); ctx.lineTo(x, y - 28); ctx.lineTo(x + 30, y + 24); ctx.closePath(); ctx.moveTo(x, y - 6); ctx.lineTo(x, y + 8); ctx.stroke() },
      (x, y) => { ctx.beginPath(); ctx.roundRect(x - 30, y - 20, 60, 40, 6); ctx.moveTo(x - 30, y - 18); ctx.lineTo(x, y + 4); ctx.lineTo(x + 30, y - 18); ctx.stroke() },
      (x, y) => { ctx.beginPath(); ctx.arc(x, y - 8, 14, 0, Math.PI * 2); ctx.moveTo(x - 26, y + 30); ctx.quadraticCurveTo(x, y + 4, x + 26, y + 30); ctx.stroke() },
      (x, y) => { ctx.beginPath(); ctx.moveTo(x - 28, y); ctx.lineTo(x - 8, y + 20); ctx.lineTo(x + 28, y - 20); ctx.stroke() },
      (x, y) => { ctx.beginPath(); for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5; ctx.lineTo(x + 30 * Math.cos(a), y + 30 * Math.sin(a)) } ctx.closePath(); ctx.stroke() },
      (x, y) => { ctx.beginPath(); ctx.arc(x - 10, y - 10, 18, 0, Math.PI * 2); ctx.moveTo(x + 3, y + 3); ctx.lineTo(x + 28, y + 28); ctx.stroke() },
      (x, y) => { ctx.beginPath(); ctx.moveTo(x - 26, y + 26); ctx.lineTo(x - 26, y - 6); ctx.lineTo(x, y - 28); ctx.lineTo(x + 26, y - 6); ctx.lineTo(x + 26, y + 26); ctx.closePath(); ctx.rect(x - 8, y + 6, 16, 20); ctx.stroke() },
    ]
    icons.forEach((f, i) => f(72 + (i % 4) * 144, 76 + Math.floor(i / 4) * 136))
    save('line-art', 'icon-grid', toGray(ctx), SYNTH, OWN)
  }
  //floor plan
  {
    const { ctx } = canvas()
    ctx.strokeStyle = grey(240)
    ctx.lineWidth = 5
    ctx.strokeRect(30, 20, 516, 248)
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.moveTo(250, 20)
    ctx.lineTo(250, 120)
    ctx.moveTo(250, 170)
    ctx.lineTo(250, 268)
    ctx.moveTo(250, 150)
    ctx.lineTo(400, 150)
    ctx.moveTo(440, 150)
    ctx.lineTo(546, 150)
    ctx.stroke()
    ctx.strokeStyle = grey(140)
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(250, 120, 50, Math.PI * 0.0, Math.PI * 0.5)
    ctx.moveTo(400, 150)
    ctx.arc(400, 150, 40, Math.PI * 1.5, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = grey(190)
    ctx.font = '16px "Segoe UI"'
    ctx.fillText('Living room', 80, 140)
    ctx.fillText('Kitchen', 360, 90)
    ctx.fillText('Bedroom', 360, 220)
    ctx.font = '12px "Segoe UI"'
    ctx.fillStyle = grey(130)
    ctx.fillText('5.2 × 6.1 m', 90, 160)
    ctx.fillText('3.0 × 2.9 m', 360, 108)
    ctx.fillText('3.0 × 2.9 m', 360, 238)
    save('line-art', 'floor-plan', toGray(ctx), SYNTH, OWN)
  }
}

//games

function gameScreens() {
  const rnd = mulberry32(7)
  //platformer, drawn at half size then upscaled nearest neighbour
  {
    const small = createCanvas(W / 2, H / 2)
    const s = small.getContext('2d')
    s.fillStyle = '#000'
    s.fillRect(0, 0, W / 2, H / 2)
    for (let y = 112; y < 144; y += 8) {
      for (let x = ((y / 8) % 2) * 8; x < W / 2; x += 16) {
        s.fillStyle = grey(140)
        s.fillRect(x, y, 15, 7)
        s.fillStyle = grey(190)
        s.fillRect(x, y, 15, 1)
      }
    }
    for (const [x, y, w] of [[40, 80, 48], [130, 60, 32], [200, 88, 56]]) {
      for (let k = 0; k < w; k += 8) {
        s.fillStyle = grey(170)
        s.fillRect(x + k, y, 7, 7)
        s.fillStyle = grey(90)
        s.fillRect(x + k + 1, y + 5, 6, 2)
      }
    }
    s.fillStyle = grey(255)
    for (const [x, y] of [[50, 68], [62, 68], [74, 68], [140, 48], [212, 76], [226, 76]]) s.fillRect(x, y, 4, 6)
    s.fillStyle = grey(230)
    s.fillRect(20, 96, 10, 16)
    s.fillStyle = grey(110)
    s.fillRect(22, 99, 2, 2)
    s.fillRect(26, 99, 2, 2)
    s.fillStyle = grey(180)
    s.fillRect(170, 104, 12, 8)
    s.fillRect(240, 104, 12, 8)
    s.fillStyle = grey(255)
    s.font = '8px Consolas'
    s.fillText('SCORE 004200   x03   WORLD 1-2', 6, 10)
    const { ctx } = canvas()
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(small, 0, 0, W, H)
    save('game', 'platformer', toGray(ctx), SYNTH, OWN)
  }
  //raycaster
  {
    const { ctx } = canvas()
    const map = ['1111111111', '1000000001', '1011100101', '1000100001', '1000001101', '1011000001', '1000000101', '1111111111']
    const px0 = 1.5
    const py0 = 1.5
    const dir = 0.6
    const fg = ctx.createLinearGradient(0, H / 2, 0, H)
    fg.addColorStop(0, grey(10))
    fg.addColorStop(1, grey(80))
    ctx.fillStyle = fg
    ctx.fillRect(0, H / 2, W, H / 2)
    for (let x = 0; x < W; x++) {
      const a = dir + Math.atan((x - W / 2) / (W / 2)) * 0.9
      let d = 0
      let side = 0
      for (; d < 20; d += 0.01) {
        const mx = Math.floor(px0 + Math.cos(a) * d)
        const my = Math.floor(py0 + Math.sin(a) * d)
        if (map[my]?.[mx] === '1') {
          side = Math.abs((px0 + Math.cos(a) * d) - Math.round(px0 + Math.cos(a) * d)) < 0.02 ? 1 : 0
          break
        }
      }
      const dist = d * Math.cos(a - dir)
      const h = Math.min(H, H / dist)
      const shade = Math.max(20, Math.min(240, 255 / (1 + dist * 0.35))) * (side ? 0.7 : 1)
      ctx.fillStyle = grey(Math.round(shade))
      ctx.fillRect(x, H / 2 - h / 2, 1, h)
    }
    ctx.fillStyle = grey(255)
    ctx.fillRect(W / 2 - 1, H / 2 - 8, 2, 16)
    ctx.fillRect(W / 2 - 8, H / 2 - 1, 16, 2)
    save('game', 'raycaster', toGray(ctx), SYNTH, OWN)
  }
  //space shooter
  {
    const { ctx } = canvas()
    for (let i = 0; i < 220; i++) {
      const v = 60 + Math.floor(rnd() * 195)
      ctx.fillStyle = grey(v)
      const sz = rnd() < 0.1 ? 2 : 1
      ctx.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * H), sz, sz)
    }
    const ship = (x: number, y: number, s: number, v: number, flip = false) => {
      ctx.fillStyle = grey(v)
      ctx.beginPath()
      const f = flip ? -1 : 1
      ctx.moveTo(x, y - f * 14 * s)
      ctx.lineTo(x + 12 * s, y + f * 10 * s)
      ctx.lineTo(x, y + f * 4 * s)
      ctx.lineTo(x - 12 * s, y + f * 10 * s)
      ctx.closePath()
      ctx.fill()
    }
    ship(288, 250, 1.4, 240)
    for (let i = 0; i < 6; i++) ship(80 + i * 84, 60 + (i % 2) * 30, 1, 160, true)
    ctx.fillStyle = grey(255)
    for (let i = 0; i < 5; i++) ctx.fillRect(286, 200 - i * 26, 3, 12)
    ctx.font = '600 14px Consolas'
    ctx.fillText('HI 120400', 12, 20)
    ctx.textAlign = 'right'
    ctx.fillText('LIVES ▲▲▲', W - 12, 20)
    save('game', 'space-shooter', toGray(ctx), SYNTH, OWN)
  }
  //falling blocks
  {
    const { ctx } = canvas()
    const cell = 13
    const bx = 190
    const by = 10
    ctx.strokeStyle = grey(120)
    ctx.lineWidth = 2
    ctx.strokeRect(bx - 2, by - 2, cell * 10 + 4, cell * 20 + 4)
    const block = (x: number, y: number, v: number) => {
      ctx.fillStyle = grey(v)
      ctx.fillRect(x, y, cell - 1, cell - 1)
      ctx.fillStyle = grey(Math.min(255, v + 60))
      ctx.fillRect(x, y, cell - 1, 2)
      ctx.fillRect(x, y, 2, cell - 1)
      ctx.fillStyle = grey(Math.max(0, v - 60))
      ctx.fillRect(x, y + cell - 3, cell - 1, 2)
    }
    for (let r = 12; r < 20; r++) for (let c = 0; c < 10; c++) if (rnd() < 0.75) block(bx + c * cell, by + r * cell, [100, 140, 180, 220][Math.floor(rnd() * 4)])
    for (const [c, r] of [[4, 3], [5, 3], [6, 3], [5, 4]]) block(bx + c * cell, by + r * cell, 240)
    ctx.fillStyle = grey(200)
    ctx.font = '600 16px "Segoe UI"'
    ctx.fillText('NEXT', 380, 40)
    for (const [c, r] of [[0, 0], [1, 0], [1, 1], [2, 1]]) block(380 + c * cell, 56 + r * cell, 200)
    ctx.fillText('SCORE', 380, 150)
    ctx.fillStyle = grey(255)
    ctx.font = '300 28px "Segoe UI"'
    ctx.fillText('12 840', 380, 182)
    ctx.fillStyle = grey(200)
    ctx.font = '600 16px "Segoe UI"'
    ctx.fillText('LEVEL 7', 380, 230)
    save('game', 'falling-blocks', toGray(ctx), SYNTH, OWN)
  }
  //top-down rpg
  {
    const { ctx } = canvas()
    const img = ctx.getImageData(0, 0, W, H)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const path = Math.abs(y - 150 - 40 * Math.sin(x / 90)) < 18
        const v = path ? 120 + rnd() * 25 : 40 + rnd() * 40 + ((x * 7 + y * 13) % 11 === 0 ? 40 : 0)
        img.data.set([v, v, v, 255], (y * W + x) * 4)
      }
    }
    ctx.putImageData(img, 0, 0)
    for (let i = 0; i < 14; i++) {
      const x = rnd() * W
      const y = rnd() * 180
      if (Math.abs(y - 150 - 40 * Math.sin(x / 90)) < 40) continue
      const g = ctx.createRadialGradient(x - 6, y - 6, 2, x, y, 24)
      g.addColorStop(0, grey(190))
      g.addColorStop(1, grey(30))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, 22, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = grey(240)
    ctx.fillRect(280, 140, 14, 20)
    roundRect(ctx, 16, 206, W - 32, 70, 8)
    ctx.fillStyle = grey(0)
    ctx.fill()
    ctx.strokeStyle = grey(220)
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = grey(240)
    ctx.font = '16px "Segoe UI"'
    ctx.fillText('Old man: It is dangerous to go alone.', 32, 234)
    ctx.fillText('Take this map of the northern woods.', 32, 258)
    save('game', 'rpg-overworld', toGray(ctx), SYNTH, OWN)
  }
}

//downloads

async function fetchCached(url: string, name: string, headers: Record<string, string> = {}): Promise<Uint8Array> {
  mkdirSync(cacheDir, { recursive: true })
  const file = join(cacheDir, name)
  if (existsSync(file)) return new Uint8Array(readFileSync(file))
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  writeFileSync(file, buf)
  return buf
}

//scale to cover W x H and center crop
async function cover(bytes: Uint8Array) {
  const img = await loadImage(Buffer.from(bytes))
  const { ctx } = canvas()
  const s = Math.max(W / img.width, H / img.height)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s)
  return ctx
}

async function photos() {
  //kodak suite, landscape ones only
  const picks: [number, string][] = [[1, 'stone-wall'], [3, 'hats'], [5, 'motorbikes'], [14, 'rafting'], [23, 'parrots']]
  for (const [n, name] of picks) {
    const bytes = await fetchCached(`https://raw.githubusercontent.com/MohamedBakrAli/Kodak-Lossless-True-Color-Image-Suite/master/PhotoCD_PCD0992/${String(n).padStart(2, '0')}.png`, `kodim${n}.png`)
    save('photo', `kodim${String(n).padStart(2, '0')}-${name}`, toGray(await cover(bytes)), `Kodak Lossless True Color Image Suite, kodim${String(n).padStart(2, '0')}`, 'released by Eastman Kodak for unrestricted use')
  }
}

async function maps() {
  const UA = { 'User-Agent': 'narrowband-corpus/0.1 (one-off research benchmark, 30 tiles; https://github.com/)' }
  const z = 16
  const places: [string, number, number][] = [
    ['barcelona-eixample', 41.3917, 2.1649],
    ['paris-centre', 48.8566, 2.3522],
    ['tokyo-shibuya', 35.6595, 139.7005],
    ['new-york-midtown', 40.758, -73.9855],
    ['amsterdam-canals', 52.3676, 4.9041],
  ]
  for (const [name, lat, lon] of places) {
    const n = 2 ** z
    const fx = ((lon + 180) / 360) * n
    const fy = ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n
    const big = createCanvas(768, 512)
    const b = big.getContext('2d')
    const tx0 = Math.floor(fx) - 1
    const ty0 = Math.floor(fy) - 1
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 3; dx++) {
        const bytes = await fetchCached(`https://tile.openstreetmap.org/${z}/${tx0 + dx}/${ty0 + dy}.png`, `osm-${z}-${tx0 + dx}-${ty0 + dy}.png`, UA)
        b.drawImage(await loadImage(Buffer.from(bytes)), dx * 256, dy * 256)
      }
    }
    const { ctx } = canvas()
    ctx.drawImage(big, (768 - W) / 2, (512 - H) / 2, W, H, 0, 0, W, H)
    save('map', name, toGray(ctx, true), `OpenStreetMap standard tiles, z${z} around ${lat}, ${lon}; greyscale, inverted`, '© OpenStreetMap contributors (ODbL data, CC BY-SA 2.0 tiles)')
  }
}

console.log('building corpus →', outDir)
uiScreens()
chartScreens()
textScreens()
lineArtScreens()
gameScreens()
await photos()
await maps()
writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1))
console.log(`${manifest.length} images`)
