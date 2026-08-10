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
    // Seed a real order under a genuine customer id, then forge a cookie that
    // reuses that exact id with a garbage signature -- what an attacker who has
    // observed (or guessed) a real customer id, but not the HMAC secret, would
    // send. If the server ever resolved identity from the unverified id in the
    // cookie for *this* request -- even while separately minting a fresh
    // Set-Cookie for future requests -- it would find and return Alice's real
    // order. Only a server that discards the forged id entirely and mints an
    // unrelated fresh identity is safe, so this is the shape that actually
    // discriminates the bug from a correct implementation.
    const menuResponse = await SELF.fetch(`${ORIGIN}/api/menu`)
    const aliceCookie = menuResponse.headers.get('Set-Cookie').split(';')[0]
    const aliceId = aliceCookie.slice('cafecito_cid='.length, aliceCookie.lastIndexOf('.'))
    const menu = await menuResponse.json()

    await SELF.fetch(`${ORIGIN}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: aliceCookie },
      body: JSON.stringify({
        customerName: 'Ada',
        submissionId: crypto.randomUUID(),
        items: [{ item_id: menu.items[0].id, milk_option_id: null, quantity: 1, customization_option_ids: [] }],
      }),
    })

    const forgedCookie = `cafecito_cid=${aliceId}.badsignature`
    const response = await SELF.fetch(`${ORIGIN}/api/orders/active`, {
      headers: { Cookie: forgedCookie },
    })

    // A bad cookie is replaced with a fresh identity, not honoured: the
    // Set-Cookie carries an id different from the one we forged, and the
    // active-order lookup for that fresh identity does not surface Alice's
    // real order.
    const newCookie = response.headers.get('Set-Cookie')
    expect(newCookie).toContain('cafecito_cid=')
    const newCookieValue = newCookie.split(';')[0]
    const newId = newCookieValue.slice('cafecito_cid='.length, newCookieValue.lastIndexOf('.'))
    expect(newId).not.toBe(aliceId)
    expect(await response.json()).toBeNull()
  })
})
