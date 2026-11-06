import { test as base, expect } from '@playwright/test'

// An independent browser context per test is provided by Playwright. Capture
// enough failure evidence to diagnose integration races without a rerun.
export const test = base.extend<{ diagnosticLogs: void }>({
  diagnosticLogs: [async ({ page }, use, testInfo) => {
    const consoleLog: string[] = []
    const networkLog: string[] = []
    const pageErrors: string[] = []
    page.on('console', (message) => consoleLog.push(`${message.type()}: ${message.text()}`))
    page.on('pageerror', (error) => pageErrors.push(error.stack || error.message))
    page.on('response', (response) => networkLog.push(`${response.status()} ${response.request().method()} ${response.url()}`))
    page.on('requestfailed', (request) => networkLog.push(`FAILED ${request.method()} ${request.url()} ${request.failure()?.errorText}`))
    await use()
    if (testInfo.status !== testInfo.expectedStatus || pageErrors.length) {
      await testInfo.attach('browser-console.log', { body: consoleLog.join('\n'), contentType: 'text/plain' })
      await testInfo.attach('browser-network.log', { body: networkLog.join('\n'), contentType: 'text/plain' })
      await testInfo.attach('browser-errors.log', { body: pageErrors.join('\n'), contentType: 'text/plain' })
    }
    expect(pageErrors, 'No uncaught browser errors').toEqual([])
  }, { auto: true }],
})
export { expect }
