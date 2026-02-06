import { test, expect } from '@playwright/test'
import {
  waitForConnection,
  waitForHistoryLoad,
  sendMessageAndWaitForResponse,
} from './helpers.js'

// ---------------------------------------------------------------------------
// Chat History Loading
// ---------------------------------------------------------------------------

test.describe('Chat History Loading', () => {
  test('loads history from API on WebSocket connect', async ({ page }) => {
    // Intercept the history API call to verify it happens
    const historyRequest = page.waitForRequest(
      (req) => req.url().includes('/api/chat/history'),
    )

    await page.goto('/')
    await waitForConnection(page)

    const req = await historyRequest
    expect(req.url()).toContain('/api/chat/history')
    expect(req.url()).toContain('channelId=web')
    expect(req.url()).toContain('limit=50')
  })

  test('displays loaded history messages in chat after reload', async ({ page }) => {
    await page.goto('/')
    await waitForConnection(page)
    await waitForHistoryLoad(page)

    // Count messages on first load
    const allMessages = page.locator('#messages .message')
    const countOnFirstLoad = await allMessages.count()

    // Set up response listener BEFORE triggering reload
    const historyResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/chat/history') && res.ok(),
    )

    // Reload the page
    await page.reload()
    await waitForConnection(page)

    // Wait for history API response
    await historyResponsePromise
    await waitForHistoryLoad(page)

    // After reload, verify messages loaded again
    const countAfterReload = await allMessages.count()

    // If we had messages before, they should still be present
    if (countOnFirstLoad > 0) {
      expect(countAfterReload).toBeGreaterThan(0)
    }
  })

  test('history messages have correct role classes', async ({ page }) => {
    await page.goto('/')
    await waitForConnection(page)
    await waitForHistoryLoad(page)

    // Count existing messages
    const userMsgs = page.locator('#messages .message.user')
    const assistantMsgs = page.locator('#messages .message.assistant')
    const userCountBefore = await userMsgs.count()
    const assistantCountBefore = await assistantMsgs.count()

    // Send a message to create a new exchange
    await sendMessageAndWaitForResponse(page, 'Role class test')

    // Verify new user message appeared
    await expect(async () => {
      const count = await userMsgs.count()
      expect(count).toBeGreaterThan(userCountBefore)
    }).toPass({ timeout: 5_000 })

    // Verify new assistant response appeared
    await expect(async () => {
      const count = await assistantMsgs.count()
      expect(count).toBeGreaterThan(assistantCountBefore)
    }).toPass({ timeout: 5_000 })

    // Verify the new messages are visible
    await expect(userMsgs.last()).toBeVisible()
    await expect(assistantMsgs.last()).toBeVisible()
  })

  test('history messages include timestamps', async ({ page }) => {
    await page.goto('/')
    await waitForConnection(page)
    await waitForHistoryLoad(page)

    const userTimestamps = page.locator('#messages .message.user .message-time')
    const countBefore = await userTimestamps.count()

    // Send a message to ensure a new one exists
    const input = page.locator('#message-input')
    await input.fill('Timestamp history test')
    await page.locator('#send-btn').click()

    // Wait for new user message timestamp to appear
    await expect(async () => {
      const count = await userTimestamps.count()
      expect(count).toBeGreaterThan(countBefore)
    }).toPass({ timeout: 5_000 })

    const timeText = await userTimestamps.last().textContent()
    expect(timeText?.trim()).toMatch(/\d{1,2}:\d{2}/)
  })
})
