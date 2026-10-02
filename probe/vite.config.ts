import { defineConfig } from 'vite'
import { probeControl } from './server.ts'

//probe:dev serves the page alone, probe:run starts it itself
export default defineConfig({ plugins: [probeControl()], server: { port: 5173, strictPort: true } })
