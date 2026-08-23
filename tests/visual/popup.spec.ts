import { expect, test } from '@playwright/test'

const cases = [
  { name: 'loading', query: '?preview=loading' },
  { name: 'error', query: '?preview=error' },
  { name: 'low', query: '?preview=low' },
  { name: 'elevated', query: '?preview=elevated' },
  { name: 'high', query: '?preview=high' },
  { name: 'critical', query: '?preview=critical' },
  { name: 'dev-slider', query: '?preview=dev-slider' },
] as const

for (const popupCase of cases) {
  test(`popup visual regression: ${popupCase.name}`, async ({ page }) => {
    await page.goto(`/src/popup/index.html${popupCase.query}`)
    await page.locator('.popup').waitFor()
    await expect(page.locator('.popup')).toHaveScreenshot(`${popupCase.name}.png`)
  })
}

test('transaction review remains keyboard-accessible at 200% zoom', async ({ page }) => {
  await page.goto('/src/popup/index.html?preview=review')
  await page.locator('.popup').waitFor()
  await page.locator('body').evaluate((body) => {
    body.style.zoom = '2'
  })

  await expect(page.getByRole('alert', { name: 'Transaction review findings' })).toContainText(
    'Account authority change',
  )
  const firstOperation = page.getByText(/#1 change account options/i)
  await firstOperation.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.operations details li').filter({ hasText: /^Signer:/ })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).focus()
  await page.keyboard.press('Tab')
  await expect(firstOperation).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByText(/#2 soroban invocation/i)).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByLabel(/i understand this destination/i)).toBeFocused()
  await page.keyboard.press('Space')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Proceed' })).toBeFocused()
})
