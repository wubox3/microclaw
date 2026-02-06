import { test, expect } from '@playwright/test'
import { waitForConnection } from './helpers.js'

// ---------------------------------------------------------------------------
// Desktop Layout
// ---------------------------------------------------------------------------

test.describe('Desktop Layout', () => {
  test.use({ viewport: { width: 1280, height: 720 } })

  test('sidebar is visible on desktop', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#sidebar')).toBeVisible()
  })

  test('sidebar and chat area are side by side', async ({ page }) => {
    await page.goto('/')

    const sidebar = page.locator('#sidebar')
    const chatArea = page.locator('#chat-area')

    await expect(sidebar).toBeVisible()
    await expect(chatArea).toBeVisible()

    // Sidebar should be on the left, chat area on the right
    const sidebarBox = await sidebar.boundingBox()
    const chatBox = await chatArea.boundingBox()

    expect(sidebarBox).not.toBeNull()
    expect(chatBox).not.toBeNull()

    // Sidebar left edge is at 0
    expect(sidebarBox!.x).toBe(0)
    // Chat area starts after sidebar
    expect(chatBox!.x).toBeGreaterThanOrEqual(sidebarBox!.width - 1)
  })

  test('sidebar width is approximately 260px', async ({ page }) => {
    await page.goto('/')

    const sidebar = page.locator('#sidebar')
    const box = await sidebar.boundingBox()

    expect(box).not.toBeNull()
    // CSS sets sidebar width to 260px; verify within 10px tolerance
    expect(box!.width).toBeGreaterThanOrEqual(250)
    expect(box!.width).toBeLessThanOrEqual(270)
  })

  test('captures desktop layout screenshot', async ({ page }) => {
    await page.goto('/')
    await waitForConnection(page)

    await page.screenshot({
      path: 'tests/e2e/artifacts/desktop-layout.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// Mobile Layout (max-width: 768px)
// ---------------------------------------------------------------------------

test.describe('Mobile Layout', () => {
  test.use({ viewport: { width: 375, height: 812 } }) // iPhone X

  test('sidebar is hidden on mobile', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#sidebar')).toBeHidden()
  })

  test('chat area fills full width on mobile', async ({ page }) => {
    await page.goto('/')

    const chatArea = page.locator('#chat-area')
    await expect(chatArea).toBeVisible()

    const box = await chatArea.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBe(0)
    // Chat area should span close to full viewport width
    expect(box!.width).toBeGreaterThanOrEqual(370)
  })

  test('message input is usable on mobile', async ({ page }) => {
    await page.goto('/')
    await waitForConnection(page)

    const input = page.locator('#message-input')
    await expect(input).toBeVisible()

    // Can type in the input
    await input.fill('Mobile test')
    await expect(input).toHaveValue('Mobile test')

    // Send button is visible
    await expect(page.locator('#send-btn')).toBeVisible()
  })

  test('messages render correctly on mobile', async ({ page }) => {
    await page.goto('/')
    await waitForConnection(page)

    // Send a message
    const input = page.locator('#message-input')
    await input.fill('Mobile message test')
    await page.locator('#send-btn').click()

    // User message should be visible (use last() since history may have prior messages)
    const userMsg = page.locator('#messages .message.user .message-bubble')
    await expect(userMsg.last()).toBeVisible()
    await expect(userMsg.last()).toHaveText('Mobile message test')
  })

  test('captures mobile layout screenshot', async ({ page }) => {
    await page.goto('/')
    await waitForConnection(page)

    await page.screenshot({
      path: 'tests/e2e/artifacts/mobile-layout.png',
      fullPage: true,
    })
  })
})

// ---------------------------------------------------------------------------
// Tablet Layout
// ---------------------------------------------------------------------------

test.describe('Tablet Layout', () => {
  test.use({ viewport: { width: 1024, height: 768 } }) // iPad

  test('sidebar is visible on tablet', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#sidebar')).toBeVisible()
  })

  test('chat area is usable on tablet', async ({ page }) => {
    await page.goto('/')
    await waitForConnection(page)

    const input = page.locator('#message-input')
    await expect(input).toBeVisible()

    await input.fill('Tablet test')
    await expect(input).toHaveValue('Tablet test')
  })
})

// ---------------------------------------------------------------------------
// Responsive Breakpoint Boundary
// ---------------------------------------------------------------------------

test.describe('Breakpoint Boundary (768px)', () => {
  test('sidebar visible at 769px', async ({ page }) => {
    await page.setViewportSize({ width: 769, height: 600 })
    await page.goto('/')
    await expect(page.locator('#sidebar')).toBeVisible()
  })

  test('sidebar hidden at 768px', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 600 })
    await page.goto('/')
    await expect(page.locator('#sidebar')).toBeHidden()
  })
})
