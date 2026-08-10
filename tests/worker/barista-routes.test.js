import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

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
      ['GET', '/api/barista/menu'],
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
