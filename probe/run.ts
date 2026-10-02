//phase 0 driver: serves the probe page, opens the official simulator with the automation api,
//runs every case and saves a framebuffer screenshot. npm run probe:run -- <filter> for a subset
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { probeCases } from './cases.ts'
import { ProbeControl, probeControl, type PageReport } from './server.ts'
import { packageVersion, simulatorBinary, sleep, waitFor, withTimeout } from './simulator.ts'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const outDir = join(root, 'results', 'phase0')
const PAGE_PORT = 5173
const AUTOMATION_PORT = 9898
const api = `http://127.0.0.1:${AUTOMATION_PORT}/api`

const filter = process.argv[2]
const cases = probeCases().filter((c) => !filter || c.id.includes(filter))
mkdirSync(join(outDir, 'screens'), { recursive: true })

const control = new ProbeControl()
const server = await createServer({
  root: here,
  configFile: false,
  logLevel: 'warn',
  plugins: [probeControl(control)],
  server: { port: PAGE_PORT, strictPort: true, host: '127.0.0.1' },
})
await server.listen()
const pageUrl = `http://127.0.0.1:${PAGE_PORT}/`
console.log(`probe page at ${pageUrl}`)

const sim = spawn(simulatorBinary(), [pageUrl, '--automation-port', String(AUTOMATION_PORT), '--no-glow'], { stdio: ['ignore', 'pipe', 'pipe'] })
let simLog = ''
sim.stdout.on('data', (d) => (simLog += d))
sim.stderr.on('data', (d) => (simLog += d))

const reports: (PageReport & { id: string; screenshot: string })[] = []
try {
  await waitFor('simulator automation API', 30_000, async () => ((await fetch(`${api}/ping`)).ok ? true : undefined))
  await withTimeout(control.waitForPage(), 30_000, 'probe page to load in the simulator')
  console.log(`simulator up, running ${cases.length} cases`)
  for (const [i, c] of cases.entries()) {
    const report = await withTimeout(control.show(i, c), 30_000, `case ${c.id}`)
    await sleep(500) //let it settle
    const png = new Uint8Array(await (await fetch(`${api}/screenshot/glasses`)).arrayBuffer())
    const file = `screens/${c.id}.png`
    writeFileSync(join(outDir, file), png)
    reports.push({ ...report, id: c.id, screenshot: file })
    console.log(`${c.id}: ${report.layout} ${report.results.map((r) => `${r.containerID}:${r.result}`).join(' ')}`)
  }
  control.done = true
  const consoleLog = await (await fetch(`${api}/console`)).text()
  writeFileSync(join(outDir, 'console.json'), consoleLog)
} finally {
  sim.kill()
  await server.close()
  writeFileSync(join(outDir, 'simulator.log'), simLog)
}

const run = {
  date: new Date().toISOString(),
  simulator: packageVersion('@evenrealities/evenhub-simulator'),
  sdk: packageVersion('@evenrealities/even_hub_sdk'),
  platform: `${process.platform}-${process.arch}`,
  cases: reports,
}
const runFile = join(outDir, 'run.json')
let previous: typeof run | undefined
try {
  previous = JSON.parse(readFileSync(runFile, 'utf8')) as typeof run
} catch {
  //first run, nothing to merge
}
if (previous && filter) {
  //partial run, merge with the previous results
  const ids = new Set(reports.map((r) => r.id))
  run.cases = [...previous.cases.filter((r) => !ids.has(r.id)), ...reports]
}
writeFileSync(runFile, JSON.stringify(run, null, 2))
console.log(`wrote ${runFile}`)
process.exit(0)
