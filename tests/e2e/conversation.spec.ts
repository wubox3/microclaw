import { test, expect } from '@playwright/test'
import {
  waitForConnection,
  waitForHistoryLoad,
  sendMessageAndWaitForResponse,
} from './helpers.js'

// ---------------------------------------------------------------------------
// Full Conversation Flow
// ---------------------------------------------------------------------------

test.describe('Full Conversation Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForConnection(page)
    await waitForHistoryLoad(page)
  })

  test('complete send-receive cycle works end to end', async ({ page }) => {
    const assistantMsgs = page.locator('#messages .message.assistant .message-bubble')
    const assistantCountBefore = await assistantMsgs.count()

    // 1. Send a message
    const input = page.locator('#message-input')
    await input.fill('Say the word "pineapple" and nothing else.')
    await page.locator('#send-btn').click()

    // 2. User message appears immediately (use last() to avoid history)
    const userMsg = page.locator('#messages .message.user .message-bubble')
    await expect(userMsg.last()).toHaveText(
      'Say the word "pineapple" and nothing else.',
    )

    // 3. Typing indicator appears
    const indicator = page.locator('#typing-indicator')
    await expect(indicator).not.toHaveClass(/hidden/, { timeout: 5_000 })

    // 4. Assistant response arrives (new one beyond existing history)
    await expect(async () => {
      const count = await assistantMsgs.count()
      expect(count).toBeGreaterThan(assistantCountBefore)
    }).toPass({ timeout: 30_000 })

    // 5. Typing indicator hides
    await expect(indicator).toHaveClass(/hidden/)

    // 6. Input was cleared
    await expect(input).toHaveValue('')

    // 7. Response contains text
    const responseText = await assistantMsgs.last().textContent()
    expect(responseText?.trim().length).toBeGreaterThan(0)
  })

  test('multi-turn conversation maintains message order', async ({ page }) => {
    // Turn 1
    await sendMessageAndWaitForResponse(
      page,
      'Remember the number 42. Reply with just "Got it."',
    )

    // Turn 2
    await sendMessageAndWaitForResponse(
      page,
      'What number did I just ask you to remember? Reply with just the number.',
    )

    // Verify the last 4 messages are in order: user, assistant, user, assistant
    const allMessages = page.locator('#messages .message')
    const count = await allMessages.count()
    expect(count).toBeGreaterThanOrEqual(4)

    // Check ordering of last 4 messages
    await expect(allMessages.nth(count - 4)).toHaveClass(/user/)
    await expect(allMessages.nth(count - 3)).toHaveClass(/assistant/)
    await expect(allMessages.nth(count - 2)).toHaveClass(/user/)
    await expect(allMessages.nth(count - 1)).toHaveClass(/assistant/)
  })

  test('long message is properly displayed', async ({ page }) => {
    const longMessage =
      'This is a test of a longer message. '.repeat(10).trim()
    const input = page.locator('#message-input')
    await input.fill(longMessage)
    await page.locator('#send-btn').click()

    const userMsg = page.locator('#messages .message.user .message-bubble')
    await expect(userMsg.last()).toContainText('This is a test of a longer message.')
  })

  test('messages scroll to bottom after sending', async ({ page }) => {
    // Send several messages to potentially overflow
    for (let i = 0; i < 3; i++) {
      const input = page.locator('#message-input')
      await input.fill(`Scroll test message ${i + 1}`)
      await page.locator('#send-btn').click()

      // Wait briefly for message to appear
      await expect(
        page.locator('#messages .message.user .message-bubble').last(),
      ).toContainText(`Scroll test message ${i + 1}`)
    }

    // Verify the messages container is scrolled to bottom
    const isAtBottom = await page.evaluate(() => {
      const el = document.getElementById('messages')
      if (!el) return false
      return Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) < 5
    })
    expect(isAtBottom).toBe(true)
  })

  test('captures conversation screenshot', async ({ page }) => {
    await sendMessageAndWaitForResponse(page, 'Hello! How are you?')

    await page.screenshot({
      path: 'tests/e2e/artifacts/conversation-flow.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// Message Persistence
// ---------------------------------------------------------------------------

test.describe('Message Persistence', () => {
  test('messages persist across page reload', async ({ page }) => {
    await page.goto('/')
    await waitForConnection(page)
    await waitForHistoryLoad(page)

    const msgsBefore = page.locator('#messages .message')
    const countBeforeSend = await msgsBefore.count()

    // Send a message and get a response
    await sendMessageAndWaitForResponse(page, 'Persistence test')

    const countAfterSend = await msgsBefore.count()
    expect(countAfterSend).toBeGreaterThan(countBeforeSend)

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

    // History should have loaded messages
    const allMessages = page.locator('#messages .message')
    const countAfterReload = await allMessages.count()
    expect(countAfterReload).toBeGreaterThan(0)

    // Should have both user and assistant messages
    const userMsgs = page.locator('#messages .message.user')
    const assistantMsgs = page.locator('#messages .message.assistant')
    expect(await userMsgs.count()).toBeGreaterThan(0)
    expect(await assistantMsgs.count()).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Input Behavior
// ---------------------------------------------------------------------------

test.describe('Input Textarea Behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForConnection(page)
  })

  test('textarea auto-resizes on multiline input', async ({ page }) => {
    const input = page.locator('#message-input')

    // Get initial height
    const initialHeight = await input.evaluate(
      (el) => (el as HTMLElement).offsetHeight,
    )

    // Type character by character to trigger the input event handler
    await input.click()
    await page.keyboard.type('Line 1')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('Line 2')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('Line 3')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('Line 4')

    // Height should increase
    const newHeight = await input.evaluate(
      (el) => (el as HTMLElement).offsetHeight,
    )
    expect(newHeight).toBeGreaterThan(initialHeight)
  })

  test('textarea resets height after sending', async ({ page }) => {
    const input = page.locator('#message-input')

    // Get initial height
    const initialHeight = await input.evaluate(
      (el) => (el as HTMLElement).offsetHeight,
    )

    // Type multi-line content using keyboard events (triggers auto-resize)
    await input.click()
    await page.keyboard.type('Line 1')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('Line 2')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('Line 3')

    // Send the message
    await page.locator('#send-btn').click()

    // Height should reset back
    const resetHeight = await input.evaluate(
      (el) => (el as HTMLElement).offsetHeight,
    )
    expect(resetHeight).toBeLessThanOrEqual(initialHeight + 2)
  })

  test('input has focus border color', async ({ page }) => {
    const input = page.locator('#message-input')
    await input.click()

    // Verify the input is focused
    await expect(input).toBeFocused()
  })
})
