//minimal repro of the two bugs (see readme), public sdk only. open with ?bug=1 or ?bug=2
import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'

const W = 288
const H = 144
const bug = new URLSearchParams(location.search).get('bug') ?? '1'
const bridge = await waitForEvenAppBridge()

//two 288x144 images side by side + the text container that has to capture input
await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: 3,
    imageObject: [
      new ImageContainerProperty({ xPosition: 0, yPosition: 0, width: W, height: H, containerID: 1, containerName: 'left' }),
      new ImageContainerProperty({ xPosition: W, yPosition: 0, width: W, height: H, containerID: 2, containerName: 'right' }),
    ],
    textObject: [
      new TextContainerProperty({ xPosition: 0, yPosition: H, width: 2 * W, height: H, containerID: 3, containerName: 'log', content: ' ', isEventCapture: 1 }),
    ],
  }),
)

const send = (containerID: number, containerName: string, imageData: Uint8Array) =>
  bridge.updateImageRawData(new ImageRawDataUpdate({ containerID, containerName, imageData }))

//same pixels as a png, the host turns grey rgb back into the same grey
async function png(gray: Uint8Array): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(W, H)
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(W, H)
  gray.forEach((v, i) => img.data.set([v, v, v, 255], i * 4))
  ctx.putImageData(img, 0, 0)
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
}

let result: string
if (bug === '1') {
  //bug 1: ramp 0..31 in 9px bands. left raw gray8, right same pixels as png
  //expected: identical. actual: left lights up 1-15 and drops back to level 1 at 16
  const ramp = new Uint8Array(W * H).map((_, i) => Math.floor((i % W) / 9))
  result = `bug 1: raw Gray8 ${await send(1, 'left', ramp)}, PNG ${await send(2, 'right', await png(ramp))}`
} else {
  //bug 2: flat grey, left one starts with pixels 66,77 = "BM"
  //expected: both show up. actual: left gets parsed as a bmp and fails with sendFailed
  const bm = new Uint8Array(W * H).fill(128)
  bm.set([66, 77])
  const control = new Uint8Array(W * H).fill(128)
  control.set([66, 78])
  result = `bug 2: first pixels 66,77 → ${await send(1, 'left', bm)}; first pixels 66,78 → ${await send(2, 'right', control)}`
}
console.log(`RESULT ${result}`)
await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: 3, containerName: 'log', contentOffset: 0, contentLength: 999, content: result }))
