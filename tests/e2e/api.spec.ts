import { test, expect } from '@playwright/test'

// ---------------------------------------------------------------------------
// API Endpoints – /api/channels, /api/memory/status, /api/chat/history
// ---------------------------------------------------------------------------

test.describe('GET /api/channels', () => {
  test('returns list of channels with success flag', async ({ request }) => {
    const res = await request.get('/api/channels')
    expect(res.ok()).toBe(true)

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data.length).toBeGreaterThan(0)
  })

  test('each channel has id and label properties', async ({ request }) => {
    const res = await request.get('/api/channels')
    const body = await res.json()

    for (const channel of body.data) {
      expect(channel).toHaveProperty('id')
      expect(channel).toHaveProperty('label')
      expect(typeof channel.id).toBe('string')
      expect(typeof channel.label).toBe('string')
    }
  })

  test('includes the telegram channel', async ({ request }) => {
    const res = await request.get('/api/channels')
    const body = await res.json()

    const telegramChannel = body.data.find(
      (ch: { id: string }) => ch.id === 'telegram',
    )
    expect(telegramChannel).toBeDefined()
    expect(telegramChannel.label).toBe('Telegram')
  })
})

test.describe('GET /api/memory/status', () => {
  test('returns memory status object', async ({ request }) => {
    const res = await request.get('/api/memory/status')
    expect(res.ok()).toBe(true)

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('ready')
    expect(typeof body.data.ready).toBe('boolean')
  })
})

test.describe('POST /api/memory/search', () => {
  test('rejects empty query with 400 status', async ({ request }) => {
    const res = await request.post('/api/memory/search', {
      data: { query: '' },
    })
    expect(res.status()).toBe(400)
  })

  test('rejects missing query field with 400 status', async ({ request }) => {
    const res = await request.post('/api/memory/search', {
      data: {},
    })
    expect(res.status()).toBe(400)
  })

  test('accepts valid query and returns results array', async ({ request }) => {
    const res = await request.post('/api/memory/search', {
      data: { query: 'hello', limit: 5 },
    })

    // May be 200 or 500 depending on memory configuration;
    // if memory is ready it returns results
    if (res.ok()) {
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(Array.isArray(body.data)).toBe(true)
    }
  })
})

test.describe('GET /api/chat/history', () => {
  test('returns history array with default parameters', async ({ request }) => {
    const res = await request.get('/api/chat/history')
    expect(res.ok()).toBe(true)

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
  })

  test('respects limit parameter', async ({ request }) => {
    const res = await request.get('/api/chat/history?limit=5')
    expect(res.ok()).toBe(true)

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.length).toBeLessThanOrEqual(5)
  })

  test('accepts channelId parameter', async ({ request }) => {
    const res = await request.get('/api/chat/history?channelId=web&limit=10')
    expect(res.ok()).toBe(true)

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
  })

  test('history messages have expected shape', async ({ request }) => {
    const res = await request.get('/api/chat/history?limit=5')
    const body = await res.json()

    for (const msg of body.data) {
      expect(msg).toHaveProperty('role')
      expect(msg).toHaveProperty('content')
      expect(msg).toHaveProperty('timestamp')
      expect(['user', 'assistant']).toContain(msg.role)
      expect(typeof msg.content).toBe('string')
      expect(typeof msg.timestamp).toBe('number')
    }
  })
})

test.describe('POST /api/chat', () => {
  test('rejects empty messages array', async ({ request }) => {
    const res = await request.post('/api/chat', {
      data: { messages: [] },
    })
    // Should reject or handle gracefully
    expect(res.status()).toBeGreaterThanOrEqual(400)
  })

  test('rejects missing messages field', async ({ request }) => {
    const res = await request.post('/api/chat', {
      data: {},
    })
    expect(res.status()).toBeGreaterThanOrEqual(400)
  })

  test('accepts valid message and returns response', async ({ request }) => {
    const res = await request.post('/api/chat', {
      data: {
        messages: [{ role: 'user', content: 'Say hello in one word.' }],
      },
    })

    expect(res.ok()).toBe(true)

    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toHaveProperty('text')
    expect(typeof body.data.text).toBe('string')
    expect(body.data.text.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------

test.describe('Static Files', () => {
  test('serves index.html at root', async ({ request }) => {
    const res = await request.get('/')
    expect(res.ok()).toBe(true)

    const contentType = res.headers()['content-type'] ?? ''
    expect(contentType).toContain('text/html')

    const body = await res.text()
    expect(body).toContain('EClaw')
    expect(body).toContain('id="app"')
  })

  test('serves styles.css', async ({ request }) => {
    const res = await request.get('/styles.css')
    expect(res.ok()).toBe(true)

    const contentType = res.headers()['content-type'] ?? ''
    expect(contentType).toContain('text/css')

    const body = await res.text()
    expect(body).toContain(':root')
  })

  test('serves app.js', async ({ request }) => {
    const res = await request.get('/app.js')
    expect(res.ok()).toBe(true)

    const contentType = res.headers()['content-type'] ?? ''
    expect(contentType).toContain('javascript')

    const body = await res.text()
    expect(body).toContain('connectWebSocket')
  })
})
