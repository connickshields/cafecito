import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { UnavailableError, createOrder } from '../../worker/db.js'

let latte
let oat
let vanilla

beforeEach(async () => {
  await env.DB.exec('DELETE FROM order_item_customizations')
  await env.DB.exec('DELETE FROM order_items')
  await env.DB.exec('DELETE FROM orders')
  await env.DB.exec('UPDATE items SET available = 1')
  await env.DB.exec('UPDATE milk_options SET available = 1')
  await env.DB.exec('UPDATE customization_options SET available = 1')

  latte = (await env.DB.prepare('SELECT id FROM items WHERE name = ?').bind('Latte').first()).id
  oat = (await env.DB.prepare('SELECT id FROM milk_options WHERE name = ?').bind('Oat').first()).id
  vanilla = (
    await env.DB.prepare('SELECT id FROM customization_options WHERE name = ?').bind('Vanilla Syrup').first()
  ).id
})

const baseOrder = (over = {}) => ({
  customerId: 'cust-a',
  customerName: 'Ada',
  submissionId: crypto.randomUUID(),
  items: [{ item_id: latte, milk_option_id: oat, quantity: 2, customization_option_ids: [vanilla] }],
  ...over,
})

describe('createOrder', () => {
  it('writes the order, its items, and its customizations', async () => {
    const { orderId, duplicate } = await createOrder(env.DB, baseOrder())
    expect(duplicate).toBe(false)

    const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first()
    expect(order.customer_name).toBe('Ada')
    expect(order.customer_id).toBe('cust-a')
    expect(order.status).toBe('pending')

    const items = await env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(orderId).all()
    expect(items.results).toHaveLength(1)
    expect(items.results[0].quantity).toBe(2)

    const customizations = await env.DB.prepare(
      'SELECT * FROM order_item_customizations WHERE order_item_id = ?'
    ).bind(items.results[0].id).all()
    expect(customizations.results).toHaveLength(1)
  })

  it('is idempotent for a repeated submission_id', async () => {
    const payload = baseOrder()
    const first = await createOrder(env.DB, payload)
    const second = await createOrder(env.DB, payload)

    expect(second.orderId).toBe(first.orderId)
    expect(second.duplicate).toBe(true)

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first()
    expect(count.n).toBe(1)

    // A retry that only checks orders.count would miss a batch simulator that
    // fails to fully abort: the retry's child inserts could still land against
    // the first call's already-committed order, silently doubling the drinks.
    const items = await env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(first.orderId).all()
    expect(items.results).toHaveLength(1)

    const customizations = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM order_item_customizations WHERE order_item_id = ?'
    ).bind(items.results[0].id).first()
    expect(customizations.n).toBe(1)
  })

  it('rejects an empty item list', async () => {
    await expect(createOrder(env.DB, baseOrder({ items: [] }))).rejects.toThrow(/at least one item/i)
  })

  it('rejects an unavailable item and writes nothing', async () => {
    await env.DB.prepare('UPDATE items SET available = 0 WHERE id = ?').bind(latte).run()
    await expect(createOrder(env.DB, baseOrder())).rejects.toThrow(UnavailableError)

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first()
    expect(count.n).toBe(0)
  })

  it('rejects an archived item and writes nothing', async () => {
    await env.DB.prepare('UPDATE items SET archived = 1 WHERE id = ?').bind(latte).run()
    await expect(createOrder(env.DB, baseOrder())).rejects.toThrow(UnavailableError)

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first()
    expect(count.n).toBe(0)
  })

  it('rejects an unavailable milk option', async () => {
    await env.DB.prepare('UPDATE milk_options SET available = 0 WHERE id = ?').bind(oat).run()
    await expect(createOrder(env.DB, baseOrder())).rejects.toThrow(UnavailableError)
  })

  it('rejects an unavailable customization', async () => {
    await env.DB.prepare('UPDATE customization_options SET available = 0 WHERE id = ?').bind(vanilla).run()
    await expect(createOrder(env.DB, baseOrder())).rejects.toThrow(UnavailableError)
  })

  it('rejects an item id that does not exist', async () => {
    await expect(
      createOrder(env.DB, baseOrder({ items: [{ item_id: 99999, milk_option_id: null, quantity: 1, customization_option_ids: [] }] }))
    ).rejects.toThrow(UnavailableError)
  })

  it('accepts an order with no milk and no customizations', async () => {
    const { orderId } = await createOrder(
      env.DB,
      baseOrder({ items: [{ item_id: latte, milk_option_id: null, quantity: 1, customization_option_ids: [] }] })
    )
    const item = await env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(orderId).first()
    expect(item.milk_option_id).toBeNull()
  })

  it('floors quantity at 1', async () => {
    const { orderId } = await createOrder(
      env.DB,
      baseOrder({ items: [{ item_id: latte, milk_option_id: null, quantity: 0, customization_option_ids: [] }] })
    )
    const item = await env.DB.prepare('SELECT quantity FROM order_items WHERE order_id = ?').bind(orderId).first()
    expect(item.quantity).toBe(1)
  })
})
