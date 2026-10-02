//psnr, ssim (wang 2004: 11x11 gaussian, σ 1.5) and ms-ssim (wang 2003, 5 scales)
//blurSigma blurs both images first, dither patterns hurt ssim even when they look smooth from afar
import type { Gray8Image } from './gray4.ts'

export function psnr(a: Gray8Image, b: Gray8Image): number {
  assertSameSize(a, b)
  let se = 0
  for (let i = 0; i < a.data.length; i++) {
    const d = a.data[i] - b.data[i]
    se += d * d
  }
  const mse = se / a.data.length
  return mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse)
}

export interface SsimOptions {
  //gaussian blur before comparing, in px. 0 = off
  blurSigma?: number
}

export function ssim(a: Gray8Image, b: Gray8Image, opts: SsimOptions = {}): number {
  assertSameSize(a, b)
  const { x, y } = prepare(a, b, opts)
  return ssimParts(x, y, a.width, a.height).ssim
}

const MS_SSIM_WEIGHTS = [0.0448, 0.2856, 0.3001, 0.2363, 0.1333]

//uses as many scales as fit the 11x11 window and renormalizes the weights
export function msSsim(a: Gray8Image, b: Gray8Image, opts: SsimOptions = {}): number {
  assertSameSize(a, b)
  let { x, y } = prepare(a, b, opts)
  let w = a.width
  let h = a.height
  let scales = 0
  for (let ww = w, hh = h; scales < 5 && Math.min(ww, hh) >= WIN; scales++, ww >>= 1, hh >>= 1);
  if (scales === 0) throw new RangeError('image too small for MS-SSIM')
  const weights = MS_SSIM_WEIGHTS.slice(0, scales)
  const total = weights.reduce((s, v) => s + v, 0)
  let result = 1
  for (let j = 0; j < scales; j++) {
    const p = ssimParts(x, y, w, h)
    const wt = weights[j] / total
    //negative means can happen on weird inputs, clamp like everyone does
    result *= Math.pow(Math.max(0, j === scales - 1 ? p.ssim : p.cs), wt)
    if (j < scales - 1) {
      x = downsample2(x, w, h)
      y = downsample2(y, w, h)
      w >>= 1
      h >>= 1
    }
  }
  return result
}

const WIN = 11
const SIGMA = 1.5
const C1 = (0.01 * 255) ** 2
const C2 = (0.03 * 255) ** 2
const WINDOW = gaussian1d(SIGMA, WIN)

function gaussian1d(sigma: number, size: number): Float64Array {
  const k = new Float64Array(size)
  const c = (size - 1) / 2
  let sum = 0
  for (let i = 0; i < size; i++) sum += k[i] = Math.exp(-((i - c) ** 2) / (2 * sigma * sigma))
  for (let i = 0; i < size; i++) k[i] /= sum
  return k
}

function prepare(a: Gray8Image, b: Gray8Image, opts: SsimOptions): { x: Float64Array; y: Float64Array } {
  let x: Float64Array = Float64Array.from(a.data)
  let y: Float64Array = Float64Array.from(b.data)
  const s = opts.blurSigma ?? 0
  if (s > 0) {
    x = blurSame(x, a.width, a.height, s)
    y = blurSame(y, a.width, a.height, s)
  }
  return { x, y }
}

//mean ssim + mean contrast-structure term
function ssimParts(x: Float64Array, y: Float64Array, w: number, h: number): { ssim: number; cs: number } {
  const n = w * h
  const xx = new Float64Array(n)
  const yy = new Float64Array(n)
  const xy = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    xx[i] = x[i] * x[i]
    yy[i] = y[i] * y[i]
    xy[i] = x[i] * y[i]
  }
  const mx = filterValid(x, w, h)
  const my = filterValid(y, w, h)
  const sxx = filterValid(xx, w, h)
  const syy = filterValid(yy, w, h)
  const sxy = filterValid(xy, w, h)
  let ssimSum = 0
  let csSum = 0
  const m = mx.length
  for (let i = 0; i < m; i++) {
    const ux = mx[i]
    const uy = my[i]
    const vx = sxx[i] - ux * ux
    const vy = syy[i] - uy * uy
    const cxy = sxy[i] - ux * uy
    const cs = (2 * cxy + C2) / (vx + vy + C2)
    csSum += cs
    ssimSum += ((2 * ux * uy + C1) / (ux * ux + uy * uy + C1)) * cs
  }
  return { ssim: ssimSum / m, cs: csSum / m }
}

//separable 11x11 gaussian, valid output (w-10)x(h-10)
function filterValid(src: Float64Array, w: number, h: number): Float64Array {
  const ow = w - WIN + 1
  const oh = h - WIN + 1
  const tmp = new Float64Array(ow * h)
  for (let y = 0; y < h; y++) {
    const r = y * w
    for (let x = 0; x < ow; x++) {
      let s = 0
      for (let k = 0; k < WIN; k++) s += src[r + x + k] * WINDOW[k]
      tmp[y * ow + x] = s
    }
  }
  const out = new Float64Array(ow * oh)
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      let s = 0
      for (let k = 0; k < WIN; k++) s += tmp[(y + k) * ow + x] * WINDOW[k]
      out[y * ow + x] = s
    }
  }
  return out
}

//average 2x2 blocks + subsample
function downsample2(src: Float64Array, w: number, h: number): Float64Array {
  const ow = w >> 1
  const oh = h >> 1
  const out = new Float64Array(ow * oh)
  for (let y = 0; y < oh; y++) {
    for (let x = 0; x < ow; x++) {
      const i = 2 * y * w + 2 * x
      out[y * ow + x] = (src[i] + src[i + 1] + src[i + w] + src[i + w + 1]) / 4
    }
  }
  return out
}

//edges clamped
export function blurSame(src: Float64Array, w: number, h: number, sigma: number): Float64Array {
  const r = Math.max(1, Math.ceil(3 * sigma))
  const k = gaussian1d(sigma, 2 * r + 1)
  const tmp = new Float64Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let j = -r; j <= r; j++) s += src[y * w + Math.min(w - 1, Math.max(0, x + j))] * k[j + r]
      tmp[y * w + x] = s
    }
  }
  const out = new Float64Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let j = -r; j <= r; j++) s += tmp[Math.min(h - 1, Math.max(0, y + j)) * w + x] * k[j + r]
      out[y * w + x] = s
    }
  }
  return out
}

function assertSameSize(a: Gray8Image, b: Gray8Image): void {
  if (a.width !== b.width || a.height !== b.height) throw new RangeError('images differ in size')
}
