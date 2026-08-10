import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { ORIGIN, makeClient } from './helpers.js'

async function placeOrder(client, name) {
  const menu = await (await client('/api/menu')).json()
  const response = await client('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: name,
      submissionId: crypto.randomUUID(),
      items: [{ item_id: menu.items[0].id, milk_option_id: null, quantity: 1, customization_option_ids: [] }],
    }),
  })
  return (await response.json()).orderId
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM order_item_customizations')
  await env.DB.exec('DELETE FROM order_items')
  await env.DB.exec('DELETE FROM orders')
  await env.DB.exec('UPDATE items SET available = 1')
})

describe('replaces: "Allow users to view their own orders"', () => {
  it('customer B cannot read customer A order', async () => {
    const alice = makeClient()
    const bob = makeClient()
    const orderId = await placeOrder(alice, 'Ada')
    await bob('/api/menu')

    expect((await bob(`/api/orders/${orderId}`)).status).toBe(404)
    expect((await alice(`/api/orders/${orderId}`)).status).toBe(200)
  })

  it('customer B active-order lookup never returns customer A order', async () => {
    const alice = makeClient()
    const bob = makeClient()
    await placeOrder(alice, 'Ada')
    await bob('/api/menu')

    expect(await (await bob('/api/orders/active')).json()).toBeNull()
  })
})

describe('replaces: "Allow users to update their pending orders"', () => {
  it('customer B cannot cancel customer A order', async () => {
    const alice = makeClient()
    const bob = makeClient()
    const orderId = await placeOrder(alice, 'Ada')
    await bob('/api/menu')

    expect((await bob(`/api/orders/${orderId}/cancel`, { method: 'POST' })).status).toBe(404)

    const row = await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(orderId).first()
    expect(row.status).toBe('pending')
  })

  it('a customer cannot cancel their own order once it is in progress', async () => {
    const alice = makeClient()
    const orderId = await placeOrder(alice, 'Ada')
    await env.DB.prepare("UPDATE orders SET status = 'in_progress' WHERE id = ?").bind(orderId).run()

    expect((await alice(`/api/orders/${orderId}/cancel`, { method: 'POST' })).status).toBe(404)
  })
})

describe('replaces: SECURITY DEFINER on get_queue_stats', () => {
  it('exposes aggregates without exposing orders', async () => {
    const alice = makeClient()
    await placeOrder(alice, 'Ada')

    const bob = makeClient()
    const stats = await (await bob('/api/queue-stats')).json()

    expect(stats.drinksAhead).toBe(1)
    expect(JSON.stringify(stats)).not.toContain('Ada')
  })
})

describe('identity is never taken from the request body', () => {
  it('ignores a customer_id supplied by the client', async () => {
    const alice = makeClient()
    const bob = makeClient()
    const menu = await (await alice('/api/menu')).json()
    await bob('/api/menu')

    // Bob tries to plant an order under a forged identity.
    const response = await bob('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Mallory',
        customerId: 'definitely-alice',
        customer_id: 'definitely-alice',
        submissionId: crypto.randomUUID(),
        items: [{ item_id: menu.items[0].id, milk_option_id: null, quantity: 1, customization_option_ids: [] }],
      }),
    })
    const { orderId } = await response.json()

    const row = await env.DB.prepare('SELECT customer_id FROM orders WHERE id = ?').bind(orderId).first()
    expect(row.customer_id).not.toBe('definitely-alice')

    // And Alice still cannot see it.
    expect((await alice(`/api/orders/${orderId}`)).status).toBe(404)
  })

  it('rejects a tampered cookie rather than trusting it', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/orders/active`, {
      headers: { Cookie: 'cafecito_cid=forged-id.badsignature' },
    })
    // A bad cookie is replaced with a fresh identity, not honoured.
    expect(response.headers.get('Set-Cookie')).toContain('cafecito_cid=')
    expect(await response.json()).toBeNull()
  })
})
