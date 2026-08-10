import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { ORIGIN, makeClient } from './helpers.js'

beforeEach(async () => {
  await env.DB.exec('DELETE FROM order_item_customizations')
  await env.DB.exec('DELETE FROM order_items')
  await env.DB.exec('DELETE FROM orders')
  await env.DB.exec('UPDATE items SET available = 1')
})

describe('GET /api/menu', () => {
  it('returns the three collections and mints a cookie', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/menu`)
    expect(response.status).toBe(200)

    const setCookie = response.headers.get('Set-Cookie')
    expect(setCookie).toContain('cafecito_cid=')
    expect(setCookie).toContain('HttpOnly')

    const body = await response.json()
    expect(body.items.length).toBeGreaterThan(0)
    expect(body.milkOptions.length).toBeGreaterThan(0)
    expect(body.customizationOptions.length).toBeGreaterThan(0)
  })

  // There is no confidentiality boundary on the menu, only a display one:
  // Menu.svelte (a customer-facing component) needs unavailable milk and
  // customization rows to render them greyed out, so a plain customer
  // session -- no Cf-Access-Jwt-Assertion header at all -- must be able to
  // see them too.
  it('returns unavailable rows, with correct flags, to a plain customer session', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/menu`)
    const body = await response.json()

    const soy = body.milkOptions.find((m) => m.name === 'Soy')
    expect(soy).toBeDefined()
    expect(soy.available).toBe(false)

    const unavailableCustomizations = body.customizationOptions.filter((c) => c.available === false)
    expect(unavailableCustomizations.length).toBeGreaterThan(0)
  })
})

describe('POST /api/orders', () => {
  it('creates an order and returns its id', async () => {
    const client = makeClient()
    const menu = await (await client('/api/menu')).json()

    const response = await client('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Ada',
        submissionId: crypto.randomUUID(),
        items: [{ item_id: menu.items[0].id, milk_option_id: null, quantity: 1, customization_option_ids: [] }],
      }),
    })

    expect(response.status).toBe(201)
    expect((await response.json()).orderId).toEqual(expect.any(Number))
  })

  it('returns 409 for an unavailable item', async () => {
    const client = makeClient()
    const menu = await (await client('/api/menu')).json()
    const itemId = menu.items[0].id
    await env.DB.prepare('UPDATE items SET available = 0 WHERE id = ?').bind(itemId).run()

    const response = await client('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Ada',
        submissionId: crypto.randomUUID(),
        items: [{ item_id: itemId, milk_option_id: null, quantity: 1, customization_option_ids: [] }],
      }),
    })

    expect(response.status).toBe(409)
  })

  it('returns 400 for an empty item list', async () => {
    const client = makeClient()
    await client('/api/menu')
    const response = await client('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerName: 'Ada', submissionId: crypto.randomUUID(), items: [] }),
    })
    expect(response.status).toBe(400)
  })
})

describe('order lifecycle', () => {
  it('restores the active order and cancels it', async () => {
    const client = makeClient()
    const menu = await (await client('/api/menu')).json()
    const created = await (
      await client('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Ada',
          submissionId: crypto.randomUUID(),
          items: [{ item_id: menu.items[0].id, milk_option_id: null, quantity: 1, customization_option_ids: [] }],
        }),
      })
    ).json()

    const active = await (await client('/api/orders/active')).json()
    expect(active.id).toBe(created.orderId)
    expect(active.customer_name).toBe('Ada')

    const details = await (await client(`/api/orders/${created.orderId}`)).json()
    expect(details.customerName).toBe('Ada')
    expect(details.items).toHaveLength(1)

    const cancelled = await client(`/api/orders/${created.orderId}/cancel`, { method: 'POST' })
    expect(cancelled.status).toBe(200)

    const afterCancel = await (await client('/api/orders/active')).json()
    expect(afterCancel).toBeNull()
  })
})

describe('GET /api/queue-stats', () => {
  it('returns aggregates only, never order rows', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/queue-stats`)
    const body = await response.json()
    expect(Object.keys(body).sort()).toEqual(['activeOrders', 'drinksAhead', 'estMinsPerDrink'])
  })
})

describe('unknown API routes', () => {
  it('404s', async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/nope`)).status).toBe(404)
  })
})
