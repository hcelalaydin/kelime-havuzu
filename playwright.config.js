const { defineConfig, devices } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './test/browser',
  timeout: 60000,
  expect: { timeout: 8000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:43189',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
    { name: 'safari', use: { ...devices['iPhone 13'] } },
  ],
  webServer: {
    command: 'node test/browser-server.js',
    url: 'http://127.0.0.1:43189/healthz',
    reuseExistingServer: false,
  },
});
