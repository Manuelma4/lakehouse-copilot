// Each suite owns its immutable snapshot copy and mutable traces. Never use the
// developer's API process, private provider archive, or local model for E2E.
import { spawn } from 'node:child_process'
import { cp, mkdtemp } from 'node:fs/promises'
import { existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repo = resolve(web, '..')
const fixture = join(repo, 'src', 'arena_copilot', 'showcase')
const state = await mkdtemp(join(tmpdir(), 'arena-e2e-'))
const temporaryRoot = resolve(tmpdir()) + sep
if (!resolve(state).startsWith(temporaryRoot) || !basename(state).startsWith('arena-e2e-')) {
  throw new Error('Test state directory escaped the temporary root')
}
const snapshot = join(state, 'snapshot')
await cp(fixture, snapshot, { recursive: true })
const research = join(state, 'open-football')
await cp(join(repo, 'src', 'arena_copilot', 'research_fixture'), research, { recursive: true })
const sharedPython = resolve(
  repo,
  '..',
  '.arena-venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
)
const python = process.env.ARENA_TEST_PYTHON || (existsSync(sharedPython) ? sharedPython : 'python')
const child = spawn(
  python,
  ['-m', 'uvicorn', 'arena_copilot.api:app', '--host', '127.0.0.1', '--port', '8765'],
  {
    cwd: repo,
    stdio: 'inherit',
    env: {
      ...process.env,
      ARENA_SNAPSHOT: snapshot,
      ARENA_OPEN_FOOTBALL: research,
      ARENA_LIVE_WORKSPACE: join(state, 'current-not-configured'),
      ARENA_STATE: join(state, 'state'),
      PYTHONPATH: join(repo, 'src'),
      OLLAMA_URL: 'http://127.0.0.1:9',
      MLFLOW_TRACKING_URI: '',
    },
  },
)
child.on('error', (error) => {
  console.error(error)
  process.exit(1)
})
child.on('exit', (code) => {
  // Only the verified, explicitly owned temporary directory is removed.
  rmSync(state, { recursive: true, force: true })
  process.exit(code ?? 1)
})
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
