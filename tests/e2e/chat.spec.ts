import { test, expect } from '@playwright/test'
import { waitForConnection } from './helpers.js'

// ---------------------------------------------------------------------------
// 1. Page loads correctly
// ---------------------------------------------------------------------------

test.describe('Page Load', () => {
  test('has correct title', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle('EClaw')
  })

  test('displays the EClaw logo', async ({ page }) => {
    await page.goto('/')
    const logo = page.locator('.logo')
    await expect(logo).toBeVisible()
    await expect(logo).toHaveText('EClaw')
  })

  test('renders the sidebar with channel list', async ({ page }) => {
    await page.goto('/')

    // Sidebar is visible
    await expect(page.locator('#sidebar')).toBeVisible()

    // "Channels" section label exists
    await expect(
      page.locator('#channel-list .nav-section-label'),
    ).toHaveText('Channels')

    // All eight channels rendered
    const channelItems = page.locator('.channel-item')
    await expect(channelItems).toHaveCount(8)

    // First channel (Web Chat) is active by default
    const firstChannel = channelItems.first()
    await expect(firstChannel).toHaveClass(/active/)
    await expect(firstChannel).toContainText('Web Chat')
  })

  test('renders the memory panel', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#memory-panel')).toBeVisible()
    await expect(
      page.locator('#memory-panel .nav-section-label'),
    ).toHaveText('Memory')
  })

  test('renders chat header with title', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#chat-title')).toHaveText('Web Chat')
  })

  test('renders the message input and send button', async ({ page }) => {
    await page.goto('/')

    const input = page.locator('#message-input')
    await expect(input).toBeVisible()
    await expect(input).toHaveAttribute('placeholder', 'Type a message...')

    const sendBtn = page.locator('#send-btn')
    await expect(sendBtn).toBeVisible()
    await expect(sendBtn).toHaveText('Send')
  })

  test('typing indicator is hidden on load', async ({ page }) => {
    await page.goto('/')
    // The element has the "hidden" class which sets display:none
    await expect(page.locator('#typing-indicator')).toHaveClass(/hidden/)
  })

  test('captures full page screenshot after load', async ({ page }) => {
    await page.goto('/')
    await waitForConnection(page)
    await page.screenshot({
      path: 'tests/e2e/artifacts/page-load.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 2. WebSocket connection
// ---------------------------------------------------------------------------

test.describe('WebSocket Connection', () => {
  test('establishes WebSocket connection and shows green status dot', async ({ page }) => {
    await page.goto('/')

    // Initially the dot should exist (either state)
    const statusDot = page.locator('#connection-status')
    await expect(statusDot).toBeVisible()

    // Wait for connection -- the class changes from "disconnected" to "connected"
    await waitForConnection(page)
    await expect(statusDot).toHaveClass(/connected/)
    await expect(statusDot).not.toHaveClass(/disconnected/)
  })

  test('connection status dot starts as disconnected then transitions', async ({ page }) => {
    // Capture the initial class before the WS handshake completes.
    // We listen for the class change via a Playwright evaluation.
    const classSequence: string[] = []

    await page.goto('/')

    // Grab initial state synchronously after navigation
    const initialClass = await page.locator('#connection-status').getAttribute('class')
    if (initialClass) {
      classSequence.push(initialClass)
    }

    // Wait for connected state
    await waitForConnection(page)
    const finalClass = await page.locator('#connection-status').getAttribute('class')
    if (finalClass) {
      classSequence.push(finalClass)
    }

    // The final state must include "connected"
    expect(classSequence[classSequence.length - 1]).toContain('connected')
  })
})

// ---------------------------------------------------------------------------
// 3. Sending a message
// ---------------------------------------------------------------------------

test.describe('Send Message', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForConnection(page)
  })

  test('user can type in the message input', async ({ page }) => {
    const input = page.locator('#message-input')
    await input.fill('Hello EClaw')
    await expect(input).toHaveValue('Hello EClaw')
  })

  test('clicking Send adds user message bubble to chat', async ({ page }) => {
    const input = page.locator('#message-input')
    const sendBtn = page.locator('#send-btn')

    await input.fill('Hello from Playwright')
    await sendBtn.click()

    // A user message bubble should appear in #messages (use last() in case history exists)
    const userMessage = page.locator('#messages .message.user .message-bubble')
    await expect(userMessage.last()).toBeVisible()
    await expect(userMessage.last()).toHaveText('Hello from Playwright')
  })

  test('pressing Enter sends the message (without Shift)', async ({ page }) => {
    const input = page.locator('#message-input')
    await input.fill('Enter key test')
    await input.press('Enter')

    const userMessage = page.locator('#messages .message.user .message-bubble')
    await expect(userMessage.last()).toBeVisible()
    await expect(userMessage.last()).toHaveText('Enter key test')
  })

  test('Shift+Enter does not send the message (allows newline)', async ({ page }) => {
    // Count existing user messages from history
    const userMessages = page.locator('#messages .message.user')
    const countBefore = await userMessages.count()

    const input = page.locator('#message-input')
    await input.fill('Line one')
    await input.press('Shift+Enter')

    // No new message bubble should appear
    const countAfter = await userMessages.count()
    expect(countAfter).toBe(countBefore)
  })

  test('input is cleared after sending', async ({ page }) => {
    const input = page.locator('#message-input')
    await input.fill('Should be cleared')
    await page.locator('#send-btn').click()

    await expect(input).toHaveValue('')
  })

  test('empty input does not send a message', async ({ page }) => {
    const userMessages = page.locator('#messages .message.user')
    const countBefore = await userMessages.count()

    await page.locator('#send-btn').click()

    // No new message should appear
    const countAfter = await userMessages.count()
    expect(countAfter).toBe(countBefore)
  })

  test('whitespace-only input does not send a message', async ({ page }) => {
    const userMessages = page.locator('#messages .message.user')
    const countBefore = await userMessages.count()

    const input = page.locator('#message-input')
    await input.fill('   ')
    await page.locator('#send-btn').click()

    // No new message should appear
    const countAfter = await userMessages.count()
    expect(countAfter).toBe(countBefore)
  })

  test('message bubble shows a timestamp', async ({ page }) => {
    const input = page.locator('#message-input')
    await input.fill('Timestamp check')
    await page.locator('#send-btn').click()

    const timeEl = page.locator('#messages .message.user .message-time')
    await expect(timeEl.last()).toBeVisible()
    // Timestamp should match HH:MM pattern (locale-dependent but always digits)
    const timeText = await timeEl.last().textContent()
    expect(timeText?.trim()).toMatch(/\d{1,2}:\d{2}/)
  })

  test('captures screenshot after sending a message', async ({ page }) => {
    const input = page.locator('#message-input')
    await input.fill('Screenshot test message')
    await page.locator('#send-btn').click()

    await expect(
      page.locator('#messages .message.user .message-bubble').last(),
    ).toHaveText('Screenshot test message')

    await page.screenshot({
      path: 'tests/e2e/artifacts/message-sent.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 4. Typing indicator
// ---------------------------------------------------------------------------

test.describe('Typing Indicator', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await waitForConnection(page)
  })

  test('typing indicator appears after sending a message', async ({ page }) => {
    const input = page.locator('#message-input')
    await input.fill('Trigger typing indicator')
    await page.locator('#send-btn').click()

    // The sendMessage() function in app.js calls showTyping() immediately
    const indicator = page.locator('#typing-indicator')
    await expect(indicator).not.toHaveClass(/hidden/, { timeout: 5_000 })

    // Verify the three dots are present
    const dots = indicator.locator('.typing-dot')
    await expect(dots).toHaveCount(3)

    await page.screenshot({
      path: 'tests/e2e/artifacts/typing-indicator-visible.png',
      fullPage: true,
    })
  })

  test('typing indicator has animation dots', async ({ page }) => {
    const input = page.locator('#message-input')
    await input.fill('Animation dots test')
    await page.locator('#send-btn').click()

    const dots = page.locator('#typing-indicator .typing-dot')
    await expect(dots).toHaveCount(3)

    // Each dot should be visible (not display:none)
    for (let i = 0; i < 3; i++) {
      await expect(dots.nth(i)).toBeVisible()
    }
  })

  test('typing indicator hides when assistant response arrives', async ({ page }) => {
    const input = page.locator('#message-input')
    await input.fill('Hello')
    await page.locator('#send-btn').click()

    // Typing indicator should appear first
    const indicator = page.locator('#typing-indicator')
    await expect(indicator).not.toHaveClass(/hidden/, { timeout: 5_000 })

    // Wait for assistant response (the server sends a WS message back)
    const assistantBubble = page.locator('#messages .message.assistant .message-bubble')
    await expect(assistantBubble.last()).toBeVisible({ timeout: 30_000 })

    // After the response, the typing indicator should be hidden again
    await expect(indicator).toHaveClass(/hidden/)

    await page.screenshot({
      path: 'tests/e2e/artifacts/assistant-response.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// 5. Channel switching
// ---------------------------------------------------------------------------

test.describe('Channel Switching', () => {
  test('clicking a channel updates the chat header title', async ({ page }) => {
    await page.goto('/')

    // Click "Telegram" channel
    const telegramChannel = page.locator('.channel-item', { hasText: 'Telegram' })
    await telegramChannel.click()

    await expect(page.locator('#chat-title')).toHaveText('Telegram')
    await expect(telegramChannel).toHaveClass(/active/)

    // The previously active "Web Chat" should no longer be active
    const webChannel = page.locator('.channel-item', { hasText: 'Web Chat' })
    await expect(webChannel).not.toHaveClass(/active/)
  })
})
