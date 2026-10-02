//replays every probe case through VirtualGlasses and compares with the real simulator screenshot, pixel by pixel
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { probeCases } from '../probe/cases.ts'
import { decodePng } from '../sim/png.ts'
import { VirtualGlasses } from '../sim/virtual-glasses.ts'
import { detectPayload } from '../sim/host.ts'

const screens = new URL('../results/phase0/screens/', import.meta.url)
const run = JSON.parse(readFileSync(new URL('../results/phase0/run.json', import.meta.url), 'utf8')) as {
  cases: { id: string; results: { containerID: number; result: string }[] }[]
}

for (const c of probeCases()) {
  const file = new URL(`${c.id}.png`, screens)
  test(`host model matches simulator screenshot: ${c.id}`, { skip: !existsSync(file) && 'no screenshot (run npm run probe:run)' }, async () => {
    const vg = new VirtualGlasses()
    const page = {
      containerTotalNum: c.containers.length + 1,
      imageObject: c.containers.map((k) => ({ xPosition: k.x, yPosition: k.y, width: k.width, height: k.height, containerID: k.id, containerName: k.name })),
      textObject: [{}],
    }
    assert.equal(await vg.createStartUpPageContainer(page), 0)
    const results = []
    for (const img of c.images) results.push({ containerID: img.containerID, result: await vg.updateImageRawData({ containerID: img.containerID, imageData: img.data }) })

    const expectedResults = run.cases.find((r) => r.id === c.id)!.results
    assert.deepEqual(results, expectedResults.map(({ containerID, result }) => ({ containerID, result })), 'result codes')

    const shot = decodePng(readFileSync(file))
    const ours = vg.render('simulator')
    let diff = 0
    for (let i = 0; i < 576 * 288; i++) if (shot.data[i * 4 + 3] !== ours.data[i * 4 + 3]) diff++
    assert.equal(diff, 0, `${diff} pixels differ`)
  })
}

test('payload detection follows the host rules', () => {
  assert.equal(detectPayload(new Uint8Array(288 * 144), 288, 144), 'gray8')
  assert.equal(detectPayload(new Uint8Array(144 * 144), 288, 144), 'gray4')
  assert.equal(detectPayload(new Uint8Array(11 * 21), 21, 21), 'gray4')
  assert.equal(detectPayload(new Uint8Array(221), 21, 21), 'invalid')
  assert.equal(detectPayload(Uint8Array.of(0xff, 0xd8, 0xff, 0), 288, 144), 'jpeg')
  //two pixels are enough to look like an image file
  const gray8 = (...prefix: number[]) => {
    const d = new Uint8Array(288 * 144)
    d.set(prefix)
    return d
  }
  assert.equal(detectPayload(gray8(66, 77), 288, 144), 'bmp')
  assert.equal(detectPayload(gray8(66, 78), 288, 144), 'gray8')
  assert.equal(detectPayload(gray8(80, 53), 288, 144), 'pnm')
  assert.equal(detectPayload(gray8(80, 56), 288, 144), 'gray8')
  assert.equal(detectPayload(gray8(0, 0, 1, 0), 288, 144), 'ico')
})
