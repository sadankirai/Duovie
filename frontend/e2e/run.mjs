import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const frontendDirectory = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const repositoryDirectory = path.resolve(frontendDirectory, '..')
const composeFile = path.join(repositoryDirectory, 'docker-compose.e2e.yml')
const databaseConnection =
  'Host=127.0.0.1;Port=55432;Database=duovie_e2e;Username=duovie_e2e;Password=duovie_e2e_local_only'
const composeArguments = ['compose', '-p', 'duovie-e2e', '-f', composeFile]

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryDirectory,
    env: process.env,
    stdio: 'inherit',
    ...options,
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}.`)
  }
}

let testFailed = false
try {
  run('docker', [...composeArguments, 'up', '-d', '--wait'])
  run('dotnet', ['build', 'backend/Duovie.sln'])
  run('dotnet', ['tool', 'restore'])
  run(
    'dotnet',
    [
      'ef',
      'database',
      'update',
      '--no-build',
      '--project',
      'backend/src/Duovie.Infrastructure',
      '--startup-project',
      'backend/src/Duovie.Api',
    ],
    {
      env: {
        ...process.env,
        ConnectionStrings__DefaultConnection: databaseConnection,
      },
    },
  )

  const playwrightExecutable = path.join(
    frontendDirectory,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'playwright.cmd' : 'playwright',
  )
  run(playwrightExecutable, ['test'], { cwd: frontendDirectory })
} catch (error) {
  testFailed = true
  console.error(error instanceof Error ? error.message : 'Browser E2E setup failed.')
} finally {
  try {
    run('docker', [...composeArguments, 'down'])
  } catch (error) {
    testFailed = true
    console.error(error instanceof Error ? error.message : 'E2E database cleanup failed.')
  }
}

if (testFailed) {
  process.exitCode = 1
}
