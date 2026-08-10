import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  cancelOrder,
  getActiveOrder,
  getOrderDetails,
  getOrders,
  updateAvailability,
  updateOrderStatus,
} from '../../worker/db.js'

// Inserts an order directly, bypassing the create path, so these tests are
// independent of Task 7.
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

describe('getOrderDetails', () => {
  it('returns the order for its owner', async () => {
    const id = await seedOrder('cust-a', 'Ada')
    const details = await getOrderDetails(env.DB, id, 'cust-a')
    expect(details.customerName).toBe('Ada')
    expect(details.items[0].name).toBe('Latte')
  })

  it('returns null for a different customer', async () => {
    const id = await seedOrder('cust-a', 'Ada')
    expect(await getOrderDetails(env.DB, id, 'cust-b')).toBeNull()
  })

  it('returns null for an unknown id', async () => {
    expect(await getOrderDetails(env.DB, 99999, 'cust-a')).toBeNull()
  })
})

describe('getActiveOrder', () => {
  it('returns the newest pending or in_progress order for the customer', async () => {
    await seedOrder('cust-a', 'Ada', 'completed')
    const active = await seedOrder('cust-a', 'Ada', 'in_progress')
    expect((await getActiveOrder(env.DB, 'cust-a')).id).toBe(active)
  })

  it('ignores completed and cancelled orders', async () => {
    await seedOrder('cust-a', 'Ada', 'completed')
    await seedOrder('cust-a', 'Ada', 'cancelled')
    expect(await getActiveOrder(env.DB, 'cust-a')).toBeNull()
  })

  it('never returns another customer order', async () => {
    await seedOrder('cust-b', 'Grace', 'pending')
    expect(await getActiveOrder(env.DB, 'cust-a')).toBeNull()
  })
})

describe('cancelOrder', () => {
  it('cancels the owner pending order', async () => {
    const id = await seedOrder('cust-a', 'Ada')
    expect(await cancelOrder(env.DB, id, 'cust-a')).toBe(true)
    const row = await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(id).first()
    expect(row.status).toBe('cancelled')
  })

  it('refuses another customer order', async () => {
    const id = await seedOrder('cust-a', 'Ada')
    expect(await cancelOrder(env.DB, id, 'cust-b')).toBe(false)
    const row = await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(id).first()
    expect(row.status).toBe('pending')
  })

  it('refuses an order already in progress', async () => {
    const id = await seedOrder('cust-a', 'Ada', 'in_progress')
    expect(await cancelOrder(env.DB, id, 'cust-a')).toBe(false)
  })
})

describe('getOrders', () => {
  it('returns every order regardless of customer, oldest first', async () => {
    await seedOrder('cust-a', 'Ada')
    await seedOrder('cust-b', 'Grace')
    const orders = await getOrders(env.DB)
    expect(orders.map((o) => o.customerName)).toEqual(['Ada', 'Grace'])
    expect(orders[0].items[0].completedInstances).toEqual([false])
  })
})

describe('updateOrderStatus', () => {
  it('updates status and bumps updated_at', async () => {
    const id = await seedOrder('cust-a', 'Ada')
    const before = await env.DB.prepare('SELECT updated_at FROM orders WHERE id = ?').bind(id).first()
    expect(await updateOrderStatus(env.DB, id, 'completed')).toBe(true)
    const after = await env.DB.prepare('SELECT status, updated_at FROM orders WHERE id = ?').bind(id).first()
    expect(after.status).toBe('completed')
    expect(Date.parse(after.updated_at)).toBeGreaterThanOrEqual(Date.parse(before.updated_at))
  })

  it('returns false for an unknown order', async () => {
    expect(await updateOrderStatus(env.DB, 99999, 'completed')).toBe(false)
  })
})

describe('updateAvailability', () => {
  it('toggles an item', async () => {
    const item = await env.DB.prepare('SELECT id FROM items WHERE name = ?').bind('Espresso').first()
    expect(await updateAvailability(env.DB, 'items', item.id, false)).toBe(true)
    const row = await env.DB.prepare('SELECT available FROM items WHERE id = ?').bind(item.id).first()
    expect(row.available).toBe(0)
  })

  it('rejects a table name that is not allowlisted', async () => {
    await expect(updateAvailability(env.DB, 'orders', 1, false)).rejects.toThrow(/table/i)
  })
})
