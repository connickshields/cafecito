import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { handleMenuAdmin } from '../../worker/routes/menu.js'
import { getMenu } from '../../worker/menu-db.js'

const ORIGIN = 'https://cafecito.test'

// Exercised against handleMenuAdmin directly, past the Access gate. The gate
// itself is covered by barista-routes.test.js, and these tests must not mint a
// real Access token.
function call(method, path, body) {
  const url = new URL(`${ORIGIN}${path}`)
  return handleMenuAdmin(
    new Request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : body,
    }),
    env,
    url
  )
}

const send = (method, path, payload) => call(method, path, JSON.stringify(payload))

async function itemNamed(name) {
  const menu = await call('GET', '/api/barista/menu')
  return menu.body.items.find((i) => i.name === name)
}

describe('GET /api/barista/menu', () => {
  it('returns all three collections including archived rows', async () => {
    await env.DB.prepare("UPDATE items SET archived = 1 WHERE name = 'Mocha'").run()
    const result = await call('GET', '/api/barista/menu')

    expect(result.status).toBe(200)
    expect(result.body.items).toHaveLength(8)
    expect(result.body.items.find((i) => i.name === 'Mocha').archived).toBe(true)
    expect(result.body.milkOptions).toHaveLength(4)
    expect(result.body.customizationOptions).toHaveLength(6)
  })
})

describe('POST /api/barista/menu/:kind', () => {
  it('creates a drink and returns 201 with its id', async () => {
    const result = await send('POST', '/api/barista/menu/items', {
      name: 'Cold Brew',
      description: 'Steeped 18 hours',
      size: 12,
    })

    expect(result.status).toBe(201)
    expect(typeof result.body.id).toBe('number')

    const created = await itemNamed('Cold Brew')
    expect(created.available).toBe(true)
    expect(created.archived).toBe(false)
  })

  it('creates a customization with its display heading', async () => {
    const result = await send('POST', '/api/barista/menu/customizations', {
      name: 'Lavender Syrup',
      type: 'Syrups',
    })
    expect(result.status).toBe(201)
  })

  it('rejects a duplicate name with 409', async () => {
    const result = await send('POST', '/api/barista/menu/items', { name: 'latte' })
    expect(result.status).toBe(409)
  })

  it('rejects a missing name, a blank name, and an over-long name', async () => {
    expect((await send('POST', '/api/barista/menu/items', {})).status).toBe(400)
    expect((await send('POST', '/api/barista/menu/items', { name: '   ' })).status).toBe(400)
    expect((await send('POST', '/api/barista/menu/items', { name: 'x'.repeat(61) })).status).toBe(400)
  })

  it('rejects a customization with no type', async () => {
    expect((await send('POST', '/api/barista/menu/customizations', { name: 'Nutmeg' })).status).toBe(400)
  })

  it('rejects an invalid size', async () => {
    for (const size of [0, 65, 8.5, 'eight']) {
      const result = await send('POST', '/api/barista/menu/items', { name: `Drink ${size}`, size })
      expect(result.status, `size=${size}`).toBe(400)
    }
  })

  it('rejects an over-long description', async () => {
    const result = await send('POST', '/api/barista/menu/items', {
      name: 'Wordy',
      description: 'x'.repeat(201),
    })
    expect(result.status).toBe(400)
  })

  it('rejects links to an unknown option', async () => {
    const result = await send('POST', '/api/barista/menu/items', {
      name: 'Ghost Latte',
      milkOptionIds: [99999],
    })
    expect(result.status).toBe(400)
  })

  it('returns 400, not 500, for a body that parses to a non-object', async () => {
    expect((await call('POST', '/api/barista/menu/items', 'null')).status).toBe(400)
    expect((await call('POST', '/api/barista/menu/items', '"oops"')).status).toBe(400)
    expect((await call('POST', '/api/barista/menu/items', 'not json')).status).toBe(400)
  })

  it('404s an unknown kind', async () => {
    expect((await send('POST', '/api/barista/menu/pastries', { name: 'Croissant' })).status).toBe(404)
  })
})

describe('PATCH /api/barista/menu/:kind/:id', () => {
  it('renames a drink without disturbing its other fields', async () => {
    const latte = await itemNamed('Latte')
    const result = await send('PATCH', `/api/barista/menu/items/${latte.id}`, { name: 'Café Latte' })

    expect(result.status).toBe(200)
    const after = await itemNamed('Café Latte')
    expect(after.description).toBe(latte.description)
    expect(after.milkOptionIds).toEqual(latte.milkOptionIds)
  })

  it('allows a row to keep its own name', async () => {
    const latte = await itemNamed('Latte')
    const result = await send('PATCH', `/api/barista/menu/items/${latte.id}`, { name: 'Latte' })
    expect(result.status).toBe(200)
  })

  it("rejects taking another row's name with 409", async () => {
    const latte = await itemNamed('Latte')
    const result = await send('PATCH', `/api/barista/menu/items/${latte.id}`, { name: 'Cortado' })
    expect(result.status).toBe(409)
  })

  it('archives a drink, removing it from the customer menu', async () => {
    const latte = await itemNamed('Latte')
    expect((await send('PATCH', `/api/barista/menu/items/${latte.id}`, { archived: true })).status).toBe(200)

    const customerMenu = await getMenu(env.DB)
    expect(customerMenu.items.map((i) => i.name)).not.toContain('Latte')

    // ...and restores it.
    await send('PATCH', `/api/barista/menu/items/${latte.id}`, { archived: false })
    expect((await getMenu(env.DB)).items.map((i) => i.name)).toContain('Latte')
  })

  it('archiving a drink leaves order history readable', async () => {
    const latte = await itemNamed('Latte')
    await env.DB.prepare(
      "INSERT INTO orders (customer_id, customer_name, submission_id) VALUES ('c','Ada','sub-archive')"
    ).run()
    const order = await env.DB.prepare("SELECT id FROM orders WHERE submission_id = 'sub-archive'").first()
    await env.DB.prepare(
      'INSERT INTO order_items (id, order_id, item_id, quantity) VALUES (?, ?, ?, 1)'
    ).bind(crypto.randomUUID(), order.id, latte.id).run()

    await send('PATCH', `/api/barista/menu/items/${latte.id}`, { archived: true })

    const row = await env.DB.prepare(
      `SELECT i.name FROM order_items oi JOIN items i ON i.id = oi.item_id WHERE oi.order_id = ?`
    ).bind(order.id).first()
    expect(row.name).toBe('Latte')
  })

  it('toggles availability', async () => {
    const latte = await itemNamed('Latte')
    await send('PATCH', `/api/barista/menu/items/${latte.id}`, { available: false })
    expect((await itemNamed('Latte')).available).toBe(false)
  })

  it('rejects a non-boolean available', async () => {
    const latte = await itemNamed('Latte')
    const result = await send('PATCH', `/api/barista/menu/items/${latte.id}`, { available: 'yes' })
    expect(result.status).toBe(400)
  })

  it('404s an unknown id', async () => {
    expect((await send('PATCH', '/api/barista/menu/items/99999', { available: true })).status).toBe(404)
  })
})

describe('PATCH /api/barista/menu/:kind/order', () => {
  it('reorders a kind', async () => {
    const menu = await call('GET', '/api/barista/menu')
    const ids = menu.body.milkOptions.map((m) => m.id)

    const result = await send('PATCH', '/api/barista/menu/milk/order', { ids: [...ids].reverse() })
    expect(result.status).toBe(200)

    const after = await call('GET', '/api/barista/menu')
    expect(after.body.milkOptions.map((m) => m.id)).toEqual([...ids].reverse())
  })

  it('rejects an incomplete id set', async () => {
    const menu = await call('GET', '/api/barista/menu')
    const ids = menu.body.milkOptions.map((m) => m.id)
    expect((await send('PATCH', '/api/barista/menu/milk/order', { ids: ids.slice(1) })).status).toBe(400)
  })

  it('rejects an id set containing something unknown', async () => {
    const menu = await call('GET', '/api/barista/menu')
    const ids = menu.body.milkOptions.map((m) => m.id)
    const result = await send('PATCH', '/api/barista/menu/milk/order', {
      ids: [...ids.slice(1), 99999],
    })
    expect(result.status).toBe(400)
  })

  it('rejects a non-array ids', async () => {
    expect((await send('PATCH', '/api/barista/menu/milk/order', { ids: 'nope' })).status).toBe(400)
  })
})
