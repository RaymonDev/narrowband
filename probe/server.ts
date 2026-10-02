//vite plugin, control channel between the driver (node) and the probe page
//routes: GET /__probe/next, POST /__probe/ready, POST /__probe/log
import type { IncomingMessage } from 'node:http'
import type { Plugin } from 'vite'
import type { ProbeCase } from './cases.ts'

export interface PageReport {
  index: number
  layout: string
  results: { containerID: number; result: string; ms: number }[]
}

export class ProbeControl {
  private pending: { index: number; c: ProbeCase } | undefined
  private waiter: ((r: PageReport) => void) | undefined
  private helloWaiter: (() => void) | undefined
  done = false
  pageSeen = false

  //resolves with the page's report
  show(index: number, c: ProbeCase): Promise<PageReport> {
    this.pending = { index, c }
    return new Promise((resolve) => (this.waiter = resolve))
  }

  waitForPage(): Promise<void> {
    if (this.pageSeen) return Promise.resolve()
    return new Promise((resolve) => (this.helloWaiter = resolve))
  }

  next(): unknown {
    if (!this.pageSeen) {
      this.pageSeen = true
      this.helloWaiter?.()
    }
    if (this.done) return { done: true }
    if (!this.pending) return { wait: true }
    const { index, c } = this.pending
    this.pending = undefined
    const names = new Map(c.containers.map((k) => [k.id, k.name]))
    return {
      index,
      id: c.id,
      containers: c.containers,
      images: c.images.map((img) => ({
        containerID: img.containerID,
        containerName: names.get(img.containerID),
        data: Buffer.from(img.data).toString('base64'),
      })),
    }
  }

  ready(r: PageReport): void {
    const w = this.waiter
    this.waiter = undefined
    w?.(r)
  }
}

async function body(req: IncomingMessage): Promise<string> {
  let s = ''
  for await (const chunk of req) s += chunk
  return s
}

export function probeControl(control = new ProbeControl(), onLog: (msg: string) => void = (m) => console.log(`[page] ${m}`)): Plugin {
  return {
    name: 'narrowband-probe-control',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__probe/')) return next()
        const path = req.url.split('?')[0]
        res.setHeader('content-type', 'application/json')
        res.setHeader('cache-control', 'no-store')
        if (path === '/__probe/next') return res.end(JSON.stringify(control.next()))
        if (path === '/__probe/ready') {
          control.ready(JSON.parse(await body(req)) as PageReport)
          return res.end('{}')
        }
        if (path === '/__probe/log') {
          onLog((JSON.parse(await body(req)) as { msg: string }).msg)
          return res.end('{}')
        }
        res.statusCode = 404
        res.end('{}')
      })
    },
  }
}
