import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { getMenu } from '../../worker/menu-db.js'

describe('getMenu', () => {
  it('returns every unarchived row in sort order', async () => {
    const menu = await getMenu(env.DB)
    expect(menu.items.map((i) => i.name)).toEqual([
      'Americano', 'Cappuccino', 'Cortado', 'Espresso', 'Flat White', 'Latte', 'Matcha Latte', 'Mocha',
    ])
    expect(menu.milkOptions.map((m) => m.name)).toEqual(['Almond', 'Oat', 'Soy', 'Whole'])
    expect(menu.customizationOptions.map((c) => c.name)).toEqual([
      'Caramel Syrup', 'Cinnamon', 'Extra Shot', 'Hazelnut Syrup', 'Vanilla Syrup', 'Whipped Cream',
    ])
  })

  it('converts integer flags to booleans', async () => {
    const menu = await getMenu(env.DB)
    expect(menu.items.find((i) => i.name === 'Mocha').available).toBe(false)
    expect(menu.items.find((i) => i.name === 'Espresso').available).toBe(true)
    expect(menu.milkOptions.find((m) => m.name === 'Soy').available).toBe(false)
  })

  it('derives allows_* from the link tables rather than the columns', async () => {
    const menu = await getMenu(env.DB)
    const espresso = menu.items.find((i) => i.name === 'Espresso')
    const matcha = menu.items.find((i) => i.name === 'Matcha Latte')

    expect(espresso.allows_milk_choice).toBe(false)
    expect(espresso.allows_customizations).toBe(false)
    expect(espresso.milkOptionIds).toEqual([])
    expect(espresso.customizationOptionIds).toEqual([])

    // The case the old booleans could not express: milk yes, add-ons no.
    expect(matcha.allows_milk_choice).toBe(true)
    expect(matcha.allows_customizations).toBe(false)
    expect(matcha.milkOptionIds).toHaveLength(4)
    expect(matcha.customizationOptionIds).toEqual([])
  })

  it('derives allows_milk_choice from links, not from the stale column', async () => {
    // Prove the column is genuinely unread: leave it at 1 and remove the links.
    await env.DB.prepare(
      `DELETE FROM item_milk_options
        WHERE item_id = (SELECT id FROM items WHERE name = 'Latte')`
    ).run()

    const latte = (await getMenu(env.DB)).items.find((i) => i.name === 'Latte')
    expect(latte.allows_milk_choice).toBe(false)
  })

  it('excludes archived rows, and links that point at archived options', async () => {
    await env.DB.prepare("UPDATE items SET archived = 1 WHERE name = 'Mocha'").run()
    await env.DB.prepare("UPDATE milk_options SET archived = 1 WHERE name = 'Soy'").run()

    const menu = await getMenu(env.DB)
    expect(menu.items.map((i) => i.name)).not.toContain('Mocha')
    expect(menu.milkOptions.map((m) => m.name)).not.toContain('Soy')
    expect(menu.items.find((i) => i.name === 'Latte').milkOptionIds).toHaveLength(3)
  })

  it('orders by sort_order, not by name', async () => {
    await env.DB.prepare("UPDATE items SET sort_order = -1 WHERE name = 'Mocha'").run()
    expect((await getMenu(env.DB)).items[0].name).toBe('Mocha')
  })
})
