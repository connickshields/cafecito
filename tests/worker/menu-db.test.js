import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { getMenu } from '../../worker/db.js'

describe('getMenu', () => {
  it('returns only available rows by default, name-sorted', async () => {
    const menu = await getMenu(env.DB, false)
    expect(menu.items.map((i) => i.name)).toEqual([
      'Americano', 'Cappuccino', 'Cortado', 'Espresso', 'Flat White', 'Latte', 'Matcha Latte',
    ])
    expect(menu.milkOptions.map((m) => m.name)).toEqual(['Almond', 'Oat', 'Whole'])
    expect(menu.customizationOptions.map((c) => c.name)).toEqual(['Caramel Syrup', 'Vanilla Syrup'])
  })

  it('includes unavailable rows when asked', async () => {
    const menu = await getMenu(env.DB, true)
    expect(menu.items.map((i) => i.name)).toContain('Mocha')
    expect(menu.milkOptions.map((m) => m.name)).toContain('Soy')
    expect(menu.customizationOptions).toHaveLength(6)
  })

  it('converts integer flags to booleans', async () => {
    const menu = await getMenu(env.DB, true)
    const mocha = menu.items.find((i) => i.name === 'Mocha')
    const espresso = menu.items.find((i) => i.name === 'Espresso')
    expect(mocha.available).toBe(false)
    expect(espresso.available).toBe(true)
    expect(espresso.allows_milk_choice).toBe(false)
    expect(espresso.allows_customizations).toBe(false)
  })
})
