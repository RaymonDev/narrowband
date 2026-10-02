//shared helpers for the probe and repro drivers
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

//same lookup the simulator package's own launcher does
export function simulatorBinary(): string {
  const require = createRequire(import.meta.url)
  const exe = process.platform === 'win32' ? 'evenhub-simulator.exe' : 'evenhub-simulator'
  return require.resolve(`@evenrealities/sim-${process.platform}-${process.arch}/bin/${exe}`)
}

export function packageVersion(name: string): string {
  return (JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8')) as { version: string }).version
}

//polls f until it returns something, errors count as not yet
export async function waitFor<T>(what: string, ms: number, f: () => Promise<T | undefined>): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    try {
      const v = await f()
      if (v !== undefined) return v
    } catch {
      //not up yet
    }
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`)
    await sleep(200)
  }
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, sleep(ms).then(() => Promise.reject(new Error(`timed out: ${what}`)))])
}
