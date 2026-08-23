import { defineConfig, devices } from '@playwright/test'

const apiOrigin = 'https://127.0.0.1:7246'
const databaseConnection =
  'Host=127.0.0.1;Port=55432;Database=duovie_e2e;Username=duovie_e2e;Password=duovie_e2e_local_only'

export default defineConfig({
  testDir: './e2e/specs',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command:
        'dotnet run --no-build --no-launch-profile --project ../backend/src/Duovie.Api -- --urls https://127.0.0.1:7246',
      url: `${apiOrigin}/health/live`,
      ignoreHTTPSErrors: true,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ASPNETCORE_ENVIRONMENT: 'Development',
        ConnectionStrings__DefaultConnection: databaseConnection,
        ParticipantSessions__Lifetime: '00:30:00',
        Rooms__Lifetime: '02:00:00',
      },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5174',
      url: 'http://127.0.0.1:5174/dev/peer',
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DUOVIE_API_ORIGIN: apiOrigin,
      },
    },
  ],
})
