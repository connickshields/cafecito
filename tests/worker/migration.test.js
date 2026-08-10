import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

describe('0001_init', () => {
  it('seeds the menu', async () => {
    const { results } = await env.DB.prepare(
      'SELECT name FROM items ORDER BY name'
    ).all()
    expect(results.map((r) => r.name)).toContain('Cortado')
    expect(results).toHaveLength(8)
  })

  it('seeds milk and customization options', async () => {
    const milk = await env.DB.prepare('SELECT COUNT(*) AS n FROM milk_options').first()
    const custom = await env.DB.prepare('SELECT COUNT(*) AS n FROM customization_options').first()
    expect(milk.n).toBe(4)
    expect(custom.n).toBe(6)
  })

  it('defaults timestamps to parseable ISO-8601 UTC', async () => {
    const row = await env.DB.prepare('SELECT created_at FROM items LIMIT 1').first()
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    expect(Number.isNaN(Date.parse(row.created_at))).toBe(false)
  })

  it('rejects an unknown order status', async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO orders (customer_id, customer_name, submission_id, status) VALUES ('c','n','s','bogus')"
      ).run()
    ).rejects.toThrow()
  })

  it('bumps updated_at on update', async () => {
    await env.DB.prepare('UPDATE items SET available = 0 WHERE name = ?').bind('Latte').run()
    const row = await env.DB.prepare('SELECT created_at, updated_at FROM items WHERE name = ?')
      .bind('Latte')
      .first()
    expect(Date.parse(row.updated_at)).toBeGreaterThanOrEqual(Date.parse(row.created_at))
  })
})

describe('0002_menu_management', () => {
  it('backfills sort_order to the previous alphabetical order', async () => {
    const { results } = await env.DB.prepare('SELECT name FROM items ORDER BY sort_order').all()
    expect(results.map((r) => r.name)).toEqual([
      'Americano', 'Cappuccino', 'Cortado', 'Espresso', 'Flat White', 'Latte', 'Matcha Latte', 'Mocha',
    ])
  })

  it('backfills milk links only for drinks that previously allowed milk', async () => {
    const espresso = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM item_milk_options l
         JOIN items i ON i.id = l.item_id WHERE i.name = 'Espresso'`
    ).first()
    const cappuccino = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM item_milk_options l
         JOIN items i ON i.id = l.item_id WHERE i.name = 'Cappuccino'`
    ).first()
    const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM item_milk_options').first()

    expect(espresso.n).toBe(0)
    expect(cappuccino.n).toBe(4)
    // 5 drinks allowed milk x 4 milks
    expect(total.n).toBe(20)
  })

  it('backfills customization links only for drinks that previously allowed them', async () => {
    const matcha = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM item_customization_options l
         JOIN items i ON i.id = l.item_id WHERE i.name = 'Matcha Latte'`
    ).first()
    const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM item_customization_options').first()

    // Matcha Latte took milk but not customizations -- the exact case the old
    // all-or-nothing booleans could not express.
    expect(matcha.n).toBe(0)
    // 4 drinks allowed customizations x 6 options
    expect(total.n).toBe(24)
  })

  it('rewrites customization types into display headings', async () => {
    const { results } = await env.DB.prepare(
      'SELECT DISTINCT type FROM customization_options ORDER BY type'
    ).all()
    expect(results.map((r) => r.type)).toEqual(['Coffee', 'Syrups', 'Toppings'])
  })

  it('defaults archived to 0 and rejects any other value', async () => {
    const row = await env.DB.prepare('SELECT archived FROM items WHERE name = ?').bind('Latte').first()
    expect(row.archived).toBe(0)

    await expect(
      env.DB.prepare('UPDATE items SET archived = 2 WHERE name = ?').bind('Latte').run()
    ).rejects.toThrow()
  })
})
