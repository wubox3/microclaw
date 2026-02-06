import { expect, type Page } from '@playwright/test'

/** Wait until the WebSocket connection indicator turns green. */
export async function waitForConnection(page: Page) {
  await expect(
    page.locator('#connection-status.connected'),
  ).toBeVisible({ timeout: 10_000 })
}

/** Wait for the history API response to complete and messages to render. */
export async function waitForHistoryLoad(page: Page) {
  // Wait for the history API response
  const historyPromise = page.waitForResponse(
    (res) => res.url().includes('/api/chat/history'),
    { timeout: 10_000 },
  ).catch(() => null) // History may have already loaded

  await historyPromise

  // Wait for messages to render if any exist
  const messageCount = await page.locator('#messages .message').count()
  if (messageCount > 0) {
    await expect(
      page.locator('#messages .message').first(),
    ).toBeVisible({ timeout: 5_000 })
  }
}

/** Send a message and wait for a new assistant response. */
export async function sendMessageAndWaitForResponse(
  page: Page,
  message: string,
) {
  const assistantMessages = page.locator(
    '#messages .message.assistant .message-bubble',
  )
  const countBefore = await assistantMessages.count()

  const input = page.locator('#message-input')
  await input.fill(message)
  await page.locator('#send-btn').click()

  // Verify user message appeared
  const userMsg = page.locator('#messages .message.user .message-bubble')
  await expect(userMsg.last()).toHaveText(message, { timeout: 5_000 })

  // Wait for a new assistant response beyond what we had before
  await expect(async () => {
    const countNow = await assistantMessages.count()
    expect(countNow).toBeGreaterThan(countBefore)
  }).toPass({ timeout: 30_000 })
}
