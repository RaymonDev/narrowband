import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { compressBlock, compressedSize, decompressBlock } from '../src/lz4.ts'

//inputs for fixtures/lz4-reference.json, don't touch the generator or the hashes won't match
function referenceInputs(): [string, Uint8Array][] {
  let s = 12345
  const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) >>> 16) & 0xff
  const mk = (n: number, f: (i: number) => number) => Uint8Array.from({ length: n }, (_, i) => f(i))
  const cases: [string, Uint8Array][] = []
  for (const n of [0, 1, 5, 12, 13, 14, 20, 64, 255, 300, 1000, 20736, 41472, 65535, 65546, 65547, 70000, 165888]) {
    cases.push([`zero_${n}`, mk(n, () => 0)])
    cases.push([`rand_${n}`, mk(n, () => rnd())])
    cases.push([`rand16_${n}`, mk(n, () => rnd() & 0x11)])
    cases.push([`ramp_${n}`, mk(n, (i) => (i >> 3) & 0xff)])
    cases.push([`period7_${n}`, mk(n, (i) => [1, 2, 3, 4, 5, 6, 7][i % 7])])
    cases.push([`mixed_${n}`, mk(n, (i) => (((i / 97) | 0) % 3 === 0 ? rnd() : i % 144 < 72 ? 0x55 : 0xa0))])
  }
  return cases
}

const ref = JSON.parse(readFileSync(new URL('./fixtures/lz4-reference.json', import.meta.url), 'utf8')) as {
  vectors: Record<string, { auto?: [number, string]; u32: [number, string] }>
}
const digest = (b: Uint8Array) => createHash('sha256').update(b).digest('hex').slice(0, 16)

test('LZ4 output is byte-identical to liblz4 1.9.4', () => {
  let checked = 0
  for (const [name, data] of referenceInputs()) {
    const v = ref.vectors[name]
    if (!v) continue
    if (v.auto) {
      const c = compressBlock(data)
      assert.deepEqual([c.length, digest(c)], v.auto, `${name} (LZ4_compress_default)`)
      checked++
    }
    const c = compressBlock(data, { table: 'u32' })
    assert.deepEqual([c.length, digest(c)], v.u32, `${name} (u32 table)`)
    checked++
  }
  assert.ok(checked > 140, `only ${checked} vectors checked`)
})

test('LZ4 round-trips and compressedSize agrees with compressBlock', () => {
  for (const [name, data] of referenceInputs()) {
    for (const table of ['auto', 'u32'] as const) {
      const c = compressBlock(data, { table })
      assert.equal(compressedSize(data, { table }), c.length, name)
      assert.deepEqual(decompressBlock(c, data.length), data, `${name} ${table}`)
    }
  }
})

test('acceleration trades ratio for speed', () => {
  const data = Uint8Array.from({ length: 20736 }, (_, i) => ((i * 7919) % 251) & (i % 288 < 100 ? 0x0f : 0xff))
  assert.ok(compressedSize(data, { acceleration: 8 }) >= compressedSize(data))
  assert.deepEqual(decompressBlock(compressBlock(data, { acceleration: 8 }), data.length), data)
})
