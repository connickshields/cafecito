import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { getQueueStats } from '../../worker/db.js'

// Explicit timestamps so drain-rate arithmetic is deterministic.
async function seedOrder({ customerId = 'c', status = 'pending', drinks = 1, createdAt, updatedAt }) {
  const submissionId = crypto.randomUUID()
  await env.DB.prepare(
    `INSERT INTO orders (customer_id, customer_name, submission_id, status, created_at, updated_at)
     VALUES (?, 'X', ?, ?, ?, ?)`
  ).bind(customerId, submissionId, status, createdAt, updatedAt ?? createdAt).run()

  const order = await env.DB.prepare('SELECT id FROM orders WHERE submission_id = ?')
    .bind(submissionId).first()
  const item = await env.DB.prepare('SELECT id FROM items LIMIT 1').first()
  await env.DB.prepare(
    'INSERT INTO order_items (id, order_id, item_id, quantity) VALUES (?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), order.id, item.id, drinks).run()
  return order.id
}

const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z')

beforeEach(async () => {
  await env.DB.exec('DELETE FROM order_item_customizations')
  await env.DB.exec('DELETE FROM order_items')
  await env.DB.exec('DELETE FROM orders')
})

describe('getQueueStats', () => {
  it('counts the whole active queue when orderId is null', async () => {
    await seedOrder({ drinks: 2, createdAt: minutesAgo(10) })
    await seedOrder({ drinks: 3, status: 'in_progress', createdAt: minutesAgo(5) })
    await seedOrder({ drinks: 9, status: 'completed', createdAt: minutesAgo(30) })

    const stats = await getQueueStats(env.DB, null)
    expect(stats.drinksAhead).toBe(5)
    expect(stats.activeOrders).toBe(2)
  })

  it('counts only drinks ahead of the given order', async () => {
    await seedOrder({ drinks: 2, createdAt: minutesAgo(10) })
    const mine = await seedOrder({ drinks: 4, createdAt: minutesAgo(5) })

    const stats = await getQueueStats(env.DB, mine)
    expect(stats.drinksAhead).toBe(2)
    expect(stats.activeOrders).toBe(1)
  })

  it('returns zeros for an empty queue', async () => {
    const stats = await getQueueStats(env.DB, null)
    expect(stats).toEqual({ drinksAhead: 0, activeOrders: 0, estMinsPerDrink: null })
  })

  it('returns a null rate with fewer than three recent completions', async () => {
    await seedOrder({ status: 'completed', createdAt: minutesAgo(20), updatedAt: minutesAgo(10) })
    await seedOrder({ status: 'completed', createdAt: minutesAgo(20), updatedAt: minutesAgo(5) })
    expect((await getQueueStats(env.DB, null)).estMinsPerDrink).toBeNull()
  })

  it('computes minutes per drink from completions after the earliest', async () => {
    // Completions at T-30, T-20, T-10. Span 20 minutes, 4 drinks after the
    // first completion, so 20 / 4 = 5 minutes per drink.
    await seedOrder({ status: 'completed', drinks: 5, createdAt: minutesAgo(40), updatedAt: minutesAgo(30) })
    await seedOrder({ status: 'completed', drinks: 2, createdAt: minutesAgo(40), updatedAt: minutesAgo(20) })
    await seedOrder({ status: 'completed', drinks: 2, createdAt: minutesAgo(40), updatedAt: minutesAgo(10) })

    expect((await getQueueStats(env.DB, null)).estMinsPerDrink).toBeCloseTo(5, 5)
  })

  it('ignores completions older than 90 minutes', async () => {
    await seedOrder({ status: 'completed', drinks: 1, createdAt: minutesAgo(200), updatedAt: minutesAgo(190) })
    await seedOrder({ status: 'completed', drinks: 1, createdAt: minutesAgo(200), updatedAt: minutesAgo(180) })
    await seedOrder({ status: 'completed', drinks: 1, createdAt: minutesAgo(200), updatedAt: minutesAgo(170) })
    expect((await getQueueStats(env.DB, null)).estMinsPerDrink).toBeNull()
  })
})
