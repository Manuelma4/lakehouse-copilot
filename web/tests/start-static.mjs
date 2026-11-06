// Build the real GitHub Pages configuration, not a root-path approximation.
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vite = join(web, 'node_modules', 'vite', 'bin', 'vite.js')
const env = {
  ...process.env,
  VITE_STATIC_DEMO: 'true',
  VITE_PUBLISHED_CURRENT_DATA: 'false',
  VITE_BASE_PATH: '/lakehouse-copilot/',
}
const build = spawnSync(
  process.execPath,
  [vite, 'build', '--outDir', 'test-results/static-build'],
  {
    cwd: web,
    stdio: 'inherit',
    env,
  },
)
if (build.status !== 0) process.exit(build.status ?? 1)
const server = spawn(
  process.execPath,
  [
    vite,
    'preview',
    '--host',
    '127.0.0.1',
    '--outDir',
    'test-results/static-build',
    '--port',
    '5179',
  ],
  {
    cwd: web,
    stdio: 'inherit',
    env,
  },
)
server.on('error', (error) => {
  console.error(error)
  process.exit(1)
})
server.on('exit', (code) => process.exit(code ?? 1))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal))
