import { describe, expect, it } from 'vitest'
import { groupByType } from '../src/lib/menuGrouping.js'

const option = (id, name, type) => ({ id, name, type })

describe('groupByType', () => {
  it('groups options under their type', () => {
    const groups = groupByType([
      option(1, 'Vanilla Syrup', 'Syrups'),
      option(2, 'Caramel Syrup', 'Syrups'),
      option(3, 'Cinnamon', 'Toppings'),
    ])

    expect(groups).toEqual([
      { type: 'Syrups', options: [option(1, 'Vanilla Syrup', 'Syrups'), option(2, 'Caramel Syrup', 'Syrups')] },
      { type: 'Toppings', options: [option(3, 'Cinnamon', 'Toppings')] },
    ])
  })

  it('orders groups by where their first member appears', () => {
    const groups = groupByType([
      option(3, 'Cinnamon', 'Toppings'),
      option(1, 'Vanilla Syrup', 'Syrups'),
    ])
    expect(groups.map((g) => g.type)).toEqual(['Toppings', 'Syrups'])
  })

  it('keeps a group together even when its members are not adjacent', () => {
    const groups = groupByType([
      option(1, 'Vanilla Syrup', 'Syrups'),
      option(3, 'Cinnamon', 'Toppings'),
      option(2, 'Caramel Syrup', 'Syrups'),
    ])

    expect(groups.map((g) => g.type)).toEqual(['Syrups', 'Toppings'])
    expect(groups[0].options.map((o) => o.id)).toEqual([1, 2])
  })

  it('handles a type it has never seen before', () => {
    const groups = groupByType([option(9, 'Sea Salt', 'Finishing Touches')])
    expect(groups).toEqual([{ type: 'Finishing Touches', options: [option(9, 'Sea Salt', 'Finishing Touches')] }])
  })

  it('returns an empty array for no options', () => {
    expect(groupByType([])).toEqual([])
  })
})
