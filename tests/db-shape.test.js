import { describe, expect, it } from 'vitest'
import { groupOrderDetailRows, groupOrderRows } from '../worker/db.js'

// One flat row per order x order_item x customization, as the join produces.
const row = (over = {}) => ({
  order_id: 1,
  status: 'pending',
  customer_name: 'Ada',
  created_at: '2026-08-09T10:00:00Z',
  updated_at: '2026-08-09T10:01:00Z',
  order_item_id: 'oi-1',
  quantity: 2,
  item_name: 'Latte',
  milk_name: 'Oat',
  customization_name: null,
  ...over,
})

describe('groupOrderRows', () => {
  it('collapses join rows into one order with nested items', () => {
    const result = groupOrderRows([
      row({ customization_name: 'Vanilla Syrup' }),
      row({ customization_name: 'Cinnamon' }),
      row({ order_item_id: 'oi-2', item_name: 'Espresso', quantity: 1, milk_name: null }),
    ])

    expect(result).toEqual([
      {
        id: 1,
        status: 'pending',
        customerName: 'Ada',
        created_at: '2026-08-09T10:00:00Z',
        updated_at: '2026-08-09T10:01:00Z',
        items: [
          {
            name: 'Latte',
            quantity: 2,
            milkOption: 'Oat',
            customizations: ['Vanilla Syrup', 'Cinnamon'],
            completedInstances: [false, false],
          },
          {
            name: 'Espresso',
            quantity: 1,
            milkOption: null,
            customizations: [],
            completedInstances: [false],
          },
        ],
      },
    ])
  })

  it('separates distinct orders and preserves row order', () => {
    const result = groupOrderRows([
      row({ order_id: 1, customer_name: 'Ada' }),
      row({ order_id: 2, customer_name: 'Grace', order_item_id: 'oi-9' }),
    ])
    expect(result.map((o) => o.customerName)).toEqual(['Ada', 'Grace'])
  })

  it('returns an order with no items as an empty items array', () => {
    const result = groupOrderRows([
      row({ order_item_id: null, item_name: null, quantity: null, milk_name: null }),
    ])
    expect(result[0].items).toEqual([])
  })

  it('returns an empty array for no rows', () => {
    expect(groupOrderRows([])).toEqual([])
  })
})

describe('groupOrderDetailRows', () => {
  it('uses createdAt and omits completedInstances', () => {
    const result = groupOrderDetailRows([row({ customization_name: 'Vanilla Syrup' })])
    expect(result).toEqual({
      id: 1,
      status: 'pending',
      createdAt: '2026-08-09T10:00:00Z',
      customerName: 'Ada',
      items: [
        { name: 'Latte', quantity: 2, milkOption: 'Oat', customizations: ['Vanilla Syrup'] },
      ],
    })
  })

  it('returns null for no rows', () => {
    expect(groupOrderDetailRows([])).toBeNull()
  })
})
