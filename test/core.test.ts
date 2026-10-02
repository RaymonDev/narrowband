import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gray8ToLevel, packGray4, packedGray4Size, rawGray8ToLevel, unpackGray4, type Gray8Image } from '../src/gray4.ts'
import { DITHER_METHODS, levelSet, quantize } from '../src/dither.ts'
import { voidAndCluster } from '../src/bluenoise.ts'
import { msSsim, psnr, ssim } from '../src/metrics.ts'

test('host level mapping', () => {
  for (let l = 0; l < 16; l++) assert.equal(gray8ToLevel(l * 17), l)
  assert.equal(gray8ToLevel(8), 0)
  assert.equal(gray8ToLevel(9), 1)
  assert.equal(rawGray8ToLevel(8), 8)
  assert.equal(rawGray8ToLevel(16), 1)
})

test('Gray4 packing: high nibble first, rows padded', () => {
  assert.equal(packedGray4Size(288, 144), 20736)
  assert.equal(packedGray4Size(21, 21), 231)
  const levels = Uint8Array.from({ length: 21 * 3 }, (_, i) => i % 16)
  const packed = packGray4({ width: 21, height: 3, levels })
  assert.equal(packed.length, 33)
  assert.equal(packed[0], 0x01)
  assert.equal(packed[10], 0x40) //row 0 ends with pixel 20 + a pad nibble
  assert.equal(packed[11], 0x56) //row 1 starts on a new byte
  assert.deepEqual(unpackGray4(packed, 21, 3).levels, levels)
  for (const order of ['high-first', 'low-first'] as const) {
    assert.deepEqual(unpackGray4(packGray4({ width: 21, height: 3, levels }, order), 21, 3, order).levels, levels)
  }
})

test('level sets', () => {
  assert.deepEqual([...levelSet(16)], Array.from({ length: 16 }, (_, i) => i))
  assert.deepEqual([...levelSet(4)], [0, 5, 10, 15])
  assert.deepEqual([...levelSet(2)], [0, 15])
  assert.throws(() => levelSet(1))
})

const ramp: Gray8Image = { width: 64, height: 32, data: Uint8Array.from({ length: 64 * 32 }, (_, i) => (i % 64) * 4) }

test('every method only emits levels from its set, and none + 16 is the host conversion', () => {
  for (const method of DITHER_METHODS) {
    for (const n of [2, 3, 4, 8, 16]) {
      const set = new Set(levelSet(n))
      const out = quantize(ramp, { levels: n, method })
      assert.ok(out.levels.every((l) => set.has(l)), `${method} ${n}`)
    }
  }
  const host = quantize(ramp, { levels: 16, method: 'none' })
  assert.ok(host.levels.every((l, i) => l === gray8ToLevel(ramp.data[i])))
})

test('ordered dithers keep exact levels flat and preserve mean tone', () => {
  const flat: Gray8Image = { width: 64, height: 64, data: new Uint8Array(64 * 64).fill(5 * 17) }
  for (const method of ['bayer4', 'blue-noise'] as const) {
    assert.ok(quantize(flat, { levels: 16, method }).levels.every((l) => l === 5))
    const mid: Gray8Image = { width: 64, height: 64, data: new Uint8Array(64 * 64).fill(128) }
    const out = quantize(mid, { levels: 2, method })
    const mean = (out.levels.reduce((s, l) => s + l, 0) / out.levels.length) * 17
    assert.ok(Math.abs(mean - 128) < 4, `${method} mean ${mean}`)
  }
})

test('void-and-cluster produces a permutation', () => {
  const r = voidAndCluster(16, 1.5, 1)
  assert.deepEqual([...r].sort((a, b) => a - b), Array.from({ length: 256 }, (_, i) => i))
})

test('metrics: identity and ordering', () => {
  const noisy = (amp: number): Gray8Image => ({
    width: ramp.width,
    height: ramp.height,
    data: ramp.data.map((v, i) => Math.max(0, Math.min(255, v + (((i * 7919) % 13) - 6) * amp))),
  })
  assert.equal(ssim(ramp, ramp), 1)
  assert.equal(psnr(ramp, ramp), Infinity)
  assert.ok(ssim(ramp, noisy(1)) > ssim(ramp, noisy(4)))
  const big: Gray8Image = { width: 256, height: 192, data: Uint8Array.from({ length: 256 * 192 }, (_, i) => ((i % 256) ^ (i >> 8)) & 255) }
  assert.ok(Math.abs(msSsim(big, big) - 1) < 1e-12)
})
