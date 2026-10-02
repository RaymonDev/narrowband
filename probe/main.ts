//probe page, runs inside the simulator. asks the dev server for the next case,
//sends it with updateImageRawData and reports the result codes back
import {
  CreateStartUpPageContainer,
  ImageContainerProperty,
  ImageRawDataUpdate,
  RebuildPageContainer,
  TextContainerProperty,
  waitForEvenAppBridge,
} from '@evenrealities/even_hub_sdk'

interface Job {
  index: number
  id: string
  containers: { id: number; name: string; x: number; y: number; width: number; height: number }[]
  images: { containerID: number; containerName: string; data: string }[]
}

const logEl = document.getElementById('log')!
function log(msg: string) {
  logEl.textContent += msg + '\n'
  void fetch('/__probe/log', { method: 'POST', body: JSON.stringify({ msg }) })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

const bridge = await waitForEvenAppBridge()
log('bridge ready')
let started = false

for (;;) {
  const job = (await (await fetch('/__probe/next')).json()) as Job | { wait: true } | { done: true }
  if ('done' in job) break
  if ('wait' in job) {
    await sleep(150)
    continue
  }
  const imageObject = job.containers.map(
    (c) =>
      new ImageContainerProperty({
        xPosition: c.x,
        yPosition: c.y,
        width: c.width,
        height: c.height,
        containerID: c.id,
        containerName: c.name,
      }),
  )
  //exactly one container has to capture input and images can't, so a blank text box behind everything
  const textObject = [
    new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 288,
      borderWidth: 0,
      containerID: 99,
      containerName: 'capture',
      content: ' ',
      isEventCapture: 1,
    }),
  ]
  const page = { containerTotalNum: imageObject.length + 1, imageObject, textObject }
  let layout: unknown
  try {
    layout = started
      ? await bridge.rebuildPageContainer(new RebuildPageContainer(page))
      : await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(page))
    started = true
  } catch (e) {
    layout = `threw: ${e}`
  }
  const results: { containerID: number; result: string; ms: number }[] = []
  for (const img of job.images) {
    const t0 = performance.now()
    let result: string
    try {
      result = String(
        await bridge.updateImageRawData(
          new ImageRawDataUpdate({ containerID: img.containerID, containerName: img.containerName, imageData: fromBase64(img.data) }),
        ),
      )
    } catch (e) {
      result = `threw: ${e}`
    }
    results.push({ containerID: img.containerID, result, ms: Math.round(performance.now() - t0) })
  }
  log(`${job.id}: layout=${String(layout)} ${results.map((r) => `${r.containerID}:${r.result}`).join(' ')}`)
  await fetch('/__probe/ready', { method: 'POST', body: JSON.stringify({ index: job.index, layout: String(layout), results }) })
}
log('done')
