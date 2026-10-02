//blue noise thresholds via void-and-cluster (ulichney 93), generated once from a fixed seed

export const BLUE_NOISE_SIZE = 64

let cached: Float32Array | undefined

//thresholds in (0,1), 64x64, tiles seamlessly
export function blueNoiseThresholds(): Float32Array {
  if (!cached) {
    const ranks = voidAndCluster(BLUE_NOISE_SIZE, 1.5, 0x9e3779b9)
    const n = ranks.length
    cached = Float32Array.from(ranks, (r) => (r + 0.5) / n)
  }
  return cached
}

//rank 0..size²-1 for every cell
export function voidAndCluster(size: number, sigma: number, seed: number): Uint32Array {
  const n = size * size
  //toroidal gaussian kernel
  const kernel = new Float64Array(n)
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) {
      const ddx = Math.min(dx, size - dx)
      const ddy = Math.min(dy, size - dy)
      kernel[dy * size + dx] = Math.exp(-(ddx * ddx + ddy * ddy) / (2 * sigma * sigma))
    }
  }
  let bits = new Uint8Array(n)
  let energy = new Float64Array(n)
  const toggle = (i: number, sign: 1 | -1) => {
    bits[i] = sign > 0 ? 1 : 0
    const ix = i % size
    const iy = (i / size) | 0
    for (let y = 0; y < size; y++) {
      const krow = ((y - iy + size) % size) * size
      const erow = y * size
      for (let x = 0; x < size; x++) energy[erow + x] += sign * kernel[krow + ((x - ix + size) % size)]
    }
  }
  const tightestCluster = () => {
    let best = -1
    for (let i = 0; i < n; i++) if (bits[i] && (best < 0 || energy[i] > energy[best])) best = i
    return best
  }
  const largestVoid = () => {
    let best = -1
    for (let i = 0; i < n; i++) if (!bits[i] && (best < 0 || energy[i] < energy[best])) best = i
    return best
  }

  //start with 10% random minority pixels and relax
  let s = seed >>> 0
  const rnd = () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
  const ones = Math.max(1, Math.floor(n / 10))
  for (let placed = 0; placed < ones; ) {
    const i = Math.floor(rnd() * n)
    if (!bits[i]) {
      toggle(i, 1)
      placed++
    }
  }
  for (let iter = 0; iter < 10 * n; iter++) {
    const c = tightestCluster()
    toggle(c, -1)
    const v = largestVoid()
    toggle(v, 1)
    if (v === c) break
  }

  const rank = new Uint32Array(n)
  const protoBits = bits.slice()
  const protoEnergy = energy.slice()
  //phase 1: pull minority pixels out of the tightest clusters, ranks going down
  for (let r = ones - 1; r >= 0; r--) {
    const c = tightestCluster()
    toggle(c, -1)
    rank[c] = r
  }
  //phase 2 + 3: fill the largest voids from the prototype, ranks going up
  //phase 3's tightest cluster of zeros is the same pick, so one loop does both
  bits = protoBits
  energy = protoEnergy
  for (let r = ones; r < n; r++) {
    const v = largestVoid()
    toggle(v, 1)
    rank[v] = r
  }
  return rank
}
