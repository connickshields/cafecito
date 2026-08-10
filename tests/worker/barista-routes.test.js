import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { handleBarista } from '../../worker/routes/barista.js'

const ORIGIN = 'https://cafecito.test'

// Mirrors the helper in authorization.test.js: inserts an order directly,
// bypassing the create path.
async function seedOrder(customerId, name, status = 'pending', itemName = 'Latte') {
  const submissionId = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO orders (customer_id, customer_name, submission_id, status) VALUES (?, ?, ?, ?)'
  ).bind(customerId, name, submissionId, status).run()

  const order = await env.DB.prepare('SELECT id FROM orders WHERE submission_id = ?')
    .bind(submissionId).first()
  const item = await env.DB.prepare('SELECT id FROM items WHERE name = ?').bind(itemName).first()

  await env.DB.prepare(
    'INSERT INTO order_items (id, order_id, item_id, quantity) VALUES (?, ?, ?, 1)'
  ).bind(crypto.randomUUID(), order.id, item.id).run()

  return order.id
}

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
      ['GET', '/api/barista/menu'],
      ['POST', '/api/barista/menu/items'],
      ['PATCH', '/api/barista/menu/items/1'],
      ['PATCH', '/api/barista/menu/milk/order'],
    ]

    for (const [method, path] of routes) {
      const response = await SELF.fetch(`${ORIGIN}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify({ status: 'completed', name: 'x' }),
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

  it('returns 400, not 500, for an order-status body that parses to a bare number', async () => {
    const result = await patch('/api/barista/orders/1', '5')
    expect(result.status).toBe(400)
  })
})

// If the /api/barista/* mount were ever wired to the wrong handler, every
// test above (which only proves *rejection*) would still pass. This proves
// an authorized request actually traverses the mount and returns data --
// and pins the list shape src/lib/analytics.js and BaristaView.svelte
// depend on (customerName, created_at, completedInstances).
describe('an authorized barista request reaches its handler', () => {
  it('GET /api/barista/orders returns the seeded order with the list shape', async () => {
    const orderId = await seedOrder('cust-a', 'Ada')

    const result = await handleBarista(
      new Request(`${ORIGIN}/api/barista/orders`),
      env,
      new URL(`${ORIGIN}/api/barista/orders`)
    )

    expect(result.status).toBe(200)
    const order = result.body.find((o) => o.id === orderId)
    expect(order).toBeDefined()
    expect(order.customerName).toBe('Ada')
    expect(order.created_at).toEqual(expect.any(String))
    expect(order.items[0].completedInstances).toEqual([false])
  })
})
