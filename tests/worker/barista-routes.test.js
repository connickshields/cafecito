import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { handleBarista } from '../../worker/routes/barista.js'

const ORIGIN = 'https://cafecito.test'

beforeEach(async () => {
  await env.DB.exec('DELETE FROM order_item_customizations')
  await env.DB.exec('DELETE FROM order_items')
  await env.DB.exec('DELETE FROM orders')
})

describe('barista routes without Access', () => {
  it('rejects a missing Access JWT on every route', async () => {
    const routes = [
      ['GET', '/api/barista/orders'],
      ['PATCH', '/api/barista/orders/1'],
      ['PATCH', '/api/barista/items/1'],
      ['PATCH', '/api/barista/milk/1'],
      ['PATCH', '/api/barista/customizations/1'],
    ]

    for (const [method, path] of routes) {
      const response = await SELF.fetch(`${ORIGIN}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'PATCH' ? JSON.stringify({ status: 'completed', available: false }) : undefined,
      })
      expect(response.status, `${method} ${path}`).toBe(403)
    }
  })

  it('rejects a forged Access JWT', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/barista/orders`, {
      headers: { 'Cf-Access-Jwt-Assertion': 'aaa.bbb.ccc' },
    })
    expect(response.status).toBe(403)
  })

  it('does not leak order data in the 403 body', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/barista/orders`)
    const body = await response.json()
    expect(Array.isArray(body)).toBe(false)
    expect(body.error).toBeDefined()
  })
})

// Exercised against handleBarista directly, past the Access gate: the gate
// itself is covered above, and these tests must not mint a real Access
// token. This is the exact code path (PATCH body parsing) where a body that
// parses successfully to a non-object previously threw and fell through to
// the top-level 500 handler instead of a clean 400.
describe('barista PATCH body validation', () => {
  const patch = (path, rawBody) =>
    handleBarista(
      new Request(`${ORIGIN}${path}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: rawBody,
      }),
      env,
      new URL(`${ORIGIN}${path}`)
    )

  it('returns 400, not 500, for a null order-status body', async () => {
    const result = await patch('/api/barista/orders/1', 'null')
    expect(result.status).toBe(400)
  })

  it('returns 400, not 500, for a null availability body', async () => {
    const result = await patch('/api/barista/items/1', 'null')
    expect(result.status).toBe(400)
  })

  it('returns 400, not 500, for an order-status body that parses to a bare number', async () => {
    const result = await patch('/api/barista/orders/1', '5')
    expect(result.status).toBe(400)
  })

  it('returns 400, not 500, for an availability body that parses to a bare string', async () => {
    const result = await patch('/api/barista/milk/1', '"oops"')
    expect(result.status).toBe(400)
  })
})
