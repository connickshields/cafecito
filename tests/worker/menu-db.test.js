import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { getMenu } from '../../worker/db.js'

describe('getMenu', () => {
  it('returns all rows, including unavailable ones, name-sorted', async () => {
    const menu = await getMenu(env.DB)
    expect(menu.items.map((i) => i.name)).toEqual([
      'Americano', 'Cappuccino', 'Cortado', 'Espresso', 'Flat White', 'Latte', 'Matcha Latte', 'Mocha',
    ])
    expect(menu.milkOptions.map((m) => m.name)).toEqual(['Almond', 'Oat', 'Soy', 'Whole'])
    expect(menu.customizationOptions.map((c) => c.name)).toEqual([
      'Caramel Syrup', 'Cinnamon', 'Extra Shot', 'Hazelnut Syrup', 'Vanilla Syrup', 'Whipped Cream',
    ])

    const mocha = menu.items.find((i) => i.name === 'Mocha')
    const soy = menu.milkOptions.find((m) => m.name === 'Soy')
    const unavailableCustomizations = menu.customizationOptions.filter((c) => !c.available).map((c) => c.name)
    expect(mocha.available).toBe(false)
    expect(soy.available).toBe(false)
    expect(unavailableCustomizations.sort()).toEqual(
      ['Cinnamon', 'Extra Shot', 'Hazelnut Syrup', 'Whipped Cream'].sort()
    )
  })

  it('converts integer flags to booleans', async () => {
    const menu = await getMenu(env.DB)
    const mocha = menu.items.find((i) => i.name === 'Mocha')
    const espresso = menu.items.find((i) => i.name === 'Espresso')
    expect(mocha.available).toBe(false)
    expect(espresso.available).toBe(true)
    expect(espresso.allows_milk_choice).toBe(false)
    expect(espresso.allows_customizations).toBe(false)
  })
})
