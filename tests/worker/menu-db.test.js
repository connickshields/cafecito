import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  activeMenuIds,
  createMenuEntry,
  getMenu,
  getMenuForManagement,
  nameTaken,
  optionIdsExist,
  reorderMenuEntries,
  updateMenuEntry,
} from '../../worker/menu-db.js'

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

const noFields = { columns: {}, links: {} }

describe('getMenuForManagement', () => {
  it('includes archived rows, sortOrder, and per-item links', async () => {
    await env.DB.prepare("UPDATE items SET archived = 1 WHERE name = 'Mocha'").run()

    const menu = await getMenuForManagement(env.DB)
    const mocha = menu.items.find((i) => i.name === 'Mocha')
    const cappuccino = menu.items.find((i) => i.name === 'Cappuccino')

    expect(mocha.archived).toBe(true)
    expect(cappuccino.archived).toBe(false)
    expect(cappuccino.sortOrder).toBe(1)
    expect(cappuccino.milkOptionIds).toHaveLength(4)
    expect(menu.customizationOptions[0].type).toBe('Syrups')
  })
})

describe('createMenuEntry', () => {
  it('creates a milk option at the end of the order', async () => {
    const id = await createMenuEntry(env.DB, 'milk', {
      columns: { name: 'Macadamia', available: 1 },
      links: {},
    })
    expect(typeof id).toBe('number')

    const menu = await getMenuForManagement(env.DB)
    const created = menu.milkOptions.find((m) => m.id === id)
    expect(created.name).toBe('Macadamia')
    expect(created.available).toBe(true)
    expect(created.archived).toBe(false)
    expect(created.sortOrder).toBe(4)
    expect(menu.milkOptions[menu.milkOptions.length - 1].id).toBe(id)
  })

  it('creates a drink with its links', async () => {
    const menu = await getMenuForManagement(env.DB)
    const oat = menu.milkOptions.find((m) => m.name === 'Oat')

    const id = await createMenuEntry(env.DB, 'items', {
      columns: { name: 'Cold Brew', description: 'Steeped 18 hours', size: 12, available: 1 },
      links: { milk: [oat.id], customizations: [] },
    })

    const created = (await getMenuForManagement(env.DB)).items.find((i) => i.id === id)
    expect(created.milkOptionIds).toEqual([oat.id])
    expect(created.customizationOptionIds).toEqual([])
    expect(created.size).toBe(12)
  })
})

describe('updateMenuEntry', () => {
  it('updates only the supplied columns', async () => {
    const before = (await getMenuForManagement(env.DB)).items.find((i) => i.name === 'Latte')
    await updateMenuEntry(env.DB, 'items', before.id, {
      columns: { name: 'Café Latte' },
      links: {},
    })

    const after = (await getMenuForManagement(env.DB)).items.find((i) => i.id === before.id)
    expect(after.name).toBe('Café Latte')
    expect(after.description).toBe(before.description)
    expect(after.milkOptionIds).toEqual(before.milkOptionIds)
  })

  it('replaces a link set wholesale', async () => {
    const menu = await getMenuForManagement(env.DB)
    const latte = menu.items.find((i) => i.name === 'Latte')
    const oat = menu.milkOptions.find((m) => m.name === 'Oat')

    await updateMenuEntry(env.DB, 'items', latte.id, {
      columns: {},
      links: { milk: [oat.id] },
    })

    const after = (await getMenuForManagement(env.DB)).items.find((i) => i.id === latte.id)
    expect(after.milkOptionIds).toEqual([oat.id])
  })

  it('preserves links to archived options when replacing a link set', async () => {
    // The editor only ever shows unarchived options, so the id list it sends
    // back cannot mention an archived one. Deleting unscoped would silently
    // destroy those links and break the promise that restoring an option
    // brings its links back exactly as they were.
    const menu = await getMenuForManagement(env.DB)
    const latte = menu.items.find((i) => i.name === 'Latte')
    const oat = menu.milkOptions.find((m) => m.name === 'Oat')
    const soy = menu.milkOptions.find((m) => m.name === 'Soy')

    await env.DB.prepare('UPDATE milk_options SET archived = 1 WHERE id = ?').bind(soy.id).run()
    await updateMenuEntry(env.DB, 'items', latte.id, { columns: {}, links: { milk: [oat.id] } })
    await env.DB.prepare('UPDATE milk_options SET archived = 0 WHERE id = ?').bind(soy.id).run()

    const after = (await getMenuForManagement(env.DB)).items.find((i) => i.id === latte.id)
    expect(after.milkOptionIds.sort()).toEqual([oat.id, soy.id].sort())
  })

  it('returns false for an unknown id', async () => {
    expect(await updateMenuEntry(env.DB, 'items', 99999, noFields)).toBe(false)
  })

  it('returns true for a link-only update of a real row', async () => {
    const latte = (await getMenuForManagement(env.DB)).items.find((i) => i.name === 'Latte')
    expect(await updateMenuEntry(env.DB, 'items', latte.id, { columns: {}, links: {} })).toBe(true)
  })
})

describe('reorderMenuEntries', () => {
  it('assigns sort_order by position', async () => {
    const ids = (await getMenuForManagement(env.DB)).milkOptions.map((m) => m.id)
    await reorderMenuEntries(env.DB, 'milk', [...ids].reverse())

    const after = await getMenuForManagement(env.DB)
    expect(after.milkOptions.map((m) => m.id)).toEqual([...ids].reverse())
    expect(after.milkOptions.map((m) => m.sortOrder)).toEqual([0, 1, 2, 3])
  })
})

describe('validation helpers', () => {
  it('activeMenuIds omits archived rows', async () => {
    await env.DB.prepare("UPDATE items SET archived = 1 WHERE name = 'Mocha'").run()
    expect(await activeMenuIds(env.DB, 'items')).toHaveLength(7)
  })

  it('nameTaken is case-insensitive and ignores archived rows', async () => {
    expect(await nameTaken(env.DB, 'items', 'latte')).toBe(true)
    expect(await nameTaken(env.DB, 'items', 'Cold Brew')).toBe(false)

    await env.DB.prepare("UPDATE items SET archived = 1 WHERE name = 'Latte'").run()
    expect(await nameTaken(env.DB, 'items', 'latte')).toBe(false)
  })

  it('nameTaken excludes the row being updated', async () => {
    const latte = (await getMenuForManagement(env.DB)).items.find((i) => i.name === 'Latte')
    expect(await nameTaken(env.DB, 'items', 'Latte', latte.id)).toBe(false)
  })

  it('optionIdsExist rejects unknown and archived ids', async () => {
    const menu = await getMenuForManagement(env.DB)
    const soy = menu.milkOptions.find((m) => m.name === 'Soy')

    expect(await optionIdsExist(env.DB, 'milk', [])).toBe(true)
    expect(await optionIdsExist(env.DB, 'milk', [soy.id])).toBe(true)
    expect(await optionIdsExist(env.DB, 'milk', [99999])).toBe(false)

    await env.DB.prepare('UPDATE milk_options SET archived = 1 WHERE id = ?').bind(soy.id).run()
    expect(await optionIdsExist(env.DB, 'milk', [soy.id])).toBe(false)
  })
})
