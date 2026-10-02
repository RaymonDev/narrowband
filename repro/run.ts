//runs repro/main.ts in the simulator, prints the sdk results and saves the framebuffer
//npm run repro -- 1 (or 2)
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { packageVersion, simulatorBinary, sleep, waitFor } from '../probe/simulator.ts'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = join(here, '..', 'results', 'repro')
const bug = process.argv[2] === '2' ? '2' : '1'
const api = 'http://127.0.0.1:9899/api'

const server = await createServer({ root: here, configFile: false, logLevel: 'warn', server: { port: 5174, strictPort: true, host: '127.0.0.1' } })
await server.listen()
const sim = spawn(simulatorBinary(), [`http://127.0.0.1:5174/?bug=${bug}`, '--automation-port', '9899', '--no-glow'], { stdio: 'ignore' })
try {
  await waitFor('simulator', 30_000, async () => ((await fetch(`${api}/ping`)).ok ? true : undefined))
  const line = await waitFor('the page to report', 30_000, async () => {
    const log = (await (await fetch(`${api}/console`)).json()) as { entries: { message: string }[] }
    return log.entries.find((e) => e.message.startsWith('RESULT '))?.message.slice(7)
  })
  await sleep(500)
  mkdirSync(outDir, { recursive: true })
  const file = join(outDir, `bug${bug}.png`)
  writeFileSync(file, new Uint8Array(await (await fetch(`${api}/screenshot/glasses`)).arrayBuffer()))
  console.log(`simulator ${packageVersion('@evenrealities/evenhub-simulator')}, SDK ${packageVersion('@evenrealities/even_hub_sdk')}`)
  console.log(line)
  console.log(`framebuffer: ${file}`)
} finally {
  sim.kill()
  await server.close()
}
process.exit(0)
