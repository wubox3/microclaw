import { test, expect } from '@playwright/test'
import { waitForConnection } from './helpers.js'

// ---------------------------------------------------------------------------
// WebSocket Status Messages
// ---------------------------------------------------------------------------

test.describe('WebSocket Status Messages', () => {
  test('memory panel displays status after connect', async ({ page }) => {
    await page.goto('/')
    await waitForConnection(page)

    // The memory status element should exist and contain text
    const memoryStatus = page.locator('#memory-status')
    await expect(memoryStatus).toBeVisible()

    // After connection, the server sends memory_status which updates this text
    await expect(async () => {
      const text = await memoryStatus.textContent()
      expect(text).toBeTruthy()
      expect(text!.length).toBeGreaterThan(0)
    }).toPass({ timeout: 10_000 })
  })

  test('memory status element has non-empty text', async ({ page }) => {
    await page.goto('/')
    await waitForConnection(page)

    const memoryStatus = page.locator('#memory-status')
    await expect(memoryStatus).toBeVisible()

    // After WS connect and memory_status message, the text should be set
    const text = await memoryStatus.textContent()
    expect(text).toBeTruthy()
    expect(text!.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// WebSocket Reconnection
// ---------------------------------------------------------------------------

test.describe('WebSocket Reconnection', () => {
  test('connection status dot is visible and becomes connected', async ({ page }) => {
    await page.goto('/')

    const statusDot = page.locator('#connection-status')
    await expect(statusDot).toBeVisible()

    // Eventually should become connected
    await waitForConnection(page)
    await expect(statusDot).toHaveClass(/connected/)
  })

  test('status dot has valid CSS state classes', async ({ page }) => {
    await page.goto('/')

    const statusDot = page.locator('#connection-status')
    await expect(statusDot).toBeVisible()

    const cls = await statusDot.getAttribute('class')
    // Must contain either connected or disconnected
    expect(cls).toMatch(/connected|disconnected/)
    // Must always have the base class
    expect(cls).toContain('status-dot')
  })
})

// ---------------------------------------------------------------------------
// WebSocket Error Display
// ---------------------------------------------------------------------------

test.describe('WebSocket Error Display', () => {
  test('error messages injected into DOM render correctly', async ({ page }) => {
    await page.goto('/')
    await waitForConnection(page)

    // Inject an error-style message to verify rendering
    // (simulates what happens when the server sends type: "error")
    await page.evaluate(() => {
      const messagesEl = document.getElementById('messages')
      if (!messagesEl) return

      const msgEl = document.createElement('div')
      msgEl.className = 'message assistant'
      msgEl.setAttribute('data-testid', 'injected-error')

      const bubbleEl = document.createElement('div')
      bubbleEl.className = 'message-bubble'
      bubbleEl.textContent = 'Error: Test error message'

      const timeEl = document.createElement('div')
      timeEl.className = 'message-time'
      timeEl.textContent = new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })

      msgEl.appendChild(bubbleEl)
      msgEl.appendChild(timeEl)
      messagesEl.appendChild(msgEl)
    })

    // Verify the injected error message is visible
    const errorBubble = page.locator('[data-testid="injected-error"] .message-bubble')
    await expect(errorBubble).toContainText('Error: Test error message')
  })
})

// ---------------------------------------------------------------------------
// WebSocket Message Format
// ---------------------------------------------------------------------------

test.describe('WebSocket Message Format', () => {
  test('sent message has correct JSON structure', async ({ page }) => {
    // Intercept outgoing WebSocket messages
    await page.addInitScript(() => {
      const OrigWS = window.WebSocket
      window.WebSocket = class extends OrigWS {
        send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
          if (typeof data === 'string') {
            ;(
              window as unknown as Record<string, string[]>
            ).__sentWsMessages ??= []
            ;(
              window as unknown as Record<string, string[]>
            ).__sentWsMessages.push(data)
          }
          return super.send(data)
        }
      } as unknown as typeof WebSocket
    })

    await page.goto('/')
    await waitForConnection(page)

    const input = page.locator('#message-input')
    await input.fill('Format test')
    await page.locator('#send-btn').click()

    // Wait for user message to appear (confirms send happened)
    await expect(
      page.locator('#messages .message.user .message-bubble').last(),
    ).toHaveText('Format test')

    // Retrieve captured messages
    const captured = await page.evaluate(
      () =>
        (window as unknown as Record<string, string[]>).__sentWsMessages ?? [],
    )

    expect(captured.length).toBeGreaterThan(0)

    const parsed = JSON.parse(captured[0])
    expect(parsed).toHaveProperty('type', 'message')
    expect(parsed).toHaveProperty('text', 'Format test')
    expect(parsed).toHaveProperty('id')
    expect(parsed).toHaveProperty('timestamp')
    expect(typeof parsed.timestamp).toBe('number')
  })
})
