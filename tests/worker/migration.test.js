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
