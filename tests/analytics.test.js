import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  fulfillmentDurations,
  fulfillmentHistogram,
  percentile,
} from '../src/lib/analytics.js'

const order = (status, createdAt, updatedAt) => ({
  status,
  created_at: createdAt,
  updated_at: updatedAt,
  items: [],
})

describe('fulfillmentDurations', () => {
  it('returns ascending millisecond spans for completed orders only', () => {
    const orders = [
      order('completed', '2026-08-09T10:00:00Z', '2026-08-09T10:05:00Z'),
      order('completed', '2026-08-09T10:00:00Z', '2026-08-09T10:02:00Z'),
      order('pending', '2026-08-09T10:00:00Z', '2026-08-09T10:00:00Z'),
      order('cancelled', '2026-08-09T10:00:00Z', '2026-08-09T10:09:00Z'),
    ]
    expect(fulfillmentDurations(orders)).toEqual([120000, 300000])
  })

  it('drops non-positive spans from clock skew or backfilled rows', () => {
    const orders = [
      order('completed', '2026-08-09T10:05:00Z', '2026-08-09T10:00:00Z'),
      order('completed', '2026-08-09T10:00:00Z', '2026-08-09T10:00:00Z'),
      order('completed', '2026-08-09T10:00:00Z', '2026-08-09T10:03:00Z'),
    ]
    expect(fulfillmentDurations(orders)).toEqual([180000])
  })

  it('drops rows with an unparseable timestamp', () => {
    expect(fulfillmentDurations([order('completed', 'not-a-date', '2026-08-09T10:03:00Z')])).toEqual([])
  })

  it('drops rows with a null created_at', () => {
    expect(fulfillmentDurations([order('completed', null, '2026-08-09T10:03:00Z')])).toEqual([])
  })

  it('drops rows with a null updated_at', () => {
    expect(fulfillmentDurations([order('completed', '2026-08-09T10:00:00Z', null)])).toEqual([])
  })

  it('returns an empty array for no orders', () => {
    expect(fulfillmentDurations([])).toEqual([])
  })
})

describe('percentile', () => {
  it('returns null for an empty set', () => {
    expect(percentile([], 50)).toBeNull()
  })

  it('returns the only value for a single-element set', () => {
    expect(percentile([42], 90)).toBe(42)
  })

  it('returns the middle value of an odd-sized set', () => {
    expect(percentile([1, 2, 3], 50)).toBe(2)
  })

  it('interpolates the median of an even-sized set', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5)
  })

  it('interpolates p90 between the closest ranks', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBeCloseTo(9.1)
  })
})

describe('fulfillmentHistogram', () => {
  it('always returns seven buckets, zeroed for empty input', () => {
    const result = fulfillmentHistogram([])
    expect(result).toHaveLength(7)
    expect(result.every((bucket) => bucket.value === 0)).toBe(true)
  })

  it('puts a value landing exactly on a boundary in the higher bucket', () => {
    const result = fulfillmentHistogram([2 * 60000, 4 * 60000, 15 * 60000])
    expect(result.find((b) => b.label === '2–4m').value).toBe(1)
    expect(result.find((b) => b.label === '4–6m').value).toBe(1)
    expect(result.find((b) => b.label === '15m+').value).toBe(1)
  })

  it('counts anything past the last boundary in the open bucket', () => {
    const result = fulfillmentHistogram([60 * 60000])
    expect(result.find((b) => b.label === '15m+').value).toBe(1)
  })

  it('counts a sub-boundary value in the first bucket', () => {
    const result = fulfillmentHistogram([90 * 1000])
    expect(result.find((b) => b.label === '0–2m').value).toBe(1)
  })
})

describe('formatDuration', () => {
  it('renders an em dash when there is no value', () => {
    expect(formatDuration(null)).toBe('—')
  })

  it('renders minutes and seconds', () => {
    expect(formatDuration(185000)).toBe('3m 5s')
  })

  it('renders zero minutes for a sub-minute span', () => {
    expect(formatDuration(45000)).toBe('0m 45s')
  })
})

import {
  computeAnalytics,
  customizationCounts,
  drinkCounts,
  milkCounts,
  ordersByDayOfWeek,
  ordersByHour,
} from '../src/lib/analytics.js'

// Local time, so the expected hour and weekday match getHours()/getDay().
const at = (localIso) => new Date(localIso).toISOString()

const fullOrder = (status, createdAt, updatedAt, items) => ({
  status,
  created_at: createdAt,
  updated_at: updatedAt,
  items,
})

const item = (name, quantity, milkOption = null, customizations = []) => ({
  name,
  quantity,
  milkOption,
  customizations,
})

describe('ordersByHour', () => {
  it('returns all 24 hours, zeroed, for no orders', () => {
    const result = ordersByHour([])
    expect(result).toHaveLength(24)
    expect(result[0]).toEqual({ label: '0', value: 0 })
    expect(result[23]).toEqual({ label: '23', value: 0 })
  })

  it('counts every order regardless of status', () => {
    const orders = [
      fullOrder('completed', at('2026-08-09T09:15:00'), at('2026-08-09T09:20:00'), []),
      fullOrder('cancelled', at('2026-08-09T09:45:00'), at('2026-08-09T09:50:00'), []),
      fullOrder('pending', at('2026-08-09T14:05:00'), at('2026-08-09T14:05:00'), []),
    ]
    const result = ordersByHour(orders)
    expect(result[9].value).toBe(2)
    expect(result[14].value).toBe(1)
  })

  it('ignores an unparseable timestamp instead of throwing', () => {
    const result = ordersByHour([fullOrder('pending', 'not-a-date', 'not-a-date', [])])
    expect(result.reduce((sum, bucket) => sum + bucket.value, 0)).toBe(0)
  })
})

describe('ordersByDayOfWeek', () => {
  it('returns all seven days in Sun-first order', () => {
    expect(ordersByDayOfWeek([]).map((d) => d.label)).toEqual([
      'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat',
    ])
  })

  it('buckets by local weekday', () => {
    // 2026-08-09 is a Sunday, 2026-08-10 a Monday.
    const orders = [
      fullOrder('completed', at('2026-08-09T09:00:00'), at('2026-08-09T09:05:00'), []),
      fullOrder('completed', at('2026-08-10T09:00:00'), at('2026-08-10T09:05:00'), []),
      fullOrder('completed', at('2026-08-10T11:00:00'), at('2026-08-10T11:05:00'), []),
    ]
    const result = ordersByDayOfWeek(orders)
    expect(result[0].value).toBe(1)
    expect(result[1].value).toBe(2)
  })
})

describe('drinkCounts', () => {
  it('sums quantity across completed orders and sorts descending', () => {
    const orders = [
      fullOrder('completed', at('2026-08-09T09:00:00'), at('2026-08-09T09:05:00'), [
        item('Latte', 2),
        item('Espresso', 1),
      ]),
      fullOrder('completed', at('2026-08-09T10:00:00'), at('2026-08-09T10:05:00'), [
        item('Latte', 1),
      ]),
    ]
    expect(drinkCounts(orders)).toEqual([
      { label: 'Latte', value: 3 },
      { label: 'Espresso', value: 1 },
    ])
  })

  it('excludes cancelled and pending orders', () => {
    const orders = [
      fullOrder('cancelled', at('2026-08-09T09:00:00'), at('2026-08-09T09:05:00'), [item('Latte', 5)]),
      fullOrder('pending', at('2026-08-09T09:00:00'), at('2026-08-09T09:00:00'), [item('Latte', 5)]),
    ]
    expect(drinkCounts(orders)).toEqual([])
  })

  it('breaks ties alphabetically so the order is stable', () => {
    const orders = [
      fullOrder('completed', at('2026-08-09T09:00:00'), at('2026-08-09T09:05:00'), [
        item('Mocha', 1),
        item('Americano', 1),
      ]),
    ]
    expect(drinkCounts(orders).map((d) => d.label)).toEqual(['Americano', 'Mocha'])
  })
})

describe('milkCounts', () => {
  it('skips items with no milk option', () => {
    const orders = [
      fullOrder('completed', at('2026-08-09T09:00:00'), at('2026-08-09T09:05:00'), [
        item('Latte', 2, 'Oat'),
        item('Espresso', 1, null),
      ]),
    ]
    expect(milkCounts(orders)).toEqual([{ label: 'Oat', value: 2 }])
  })
})

describe('customizationCounts', () => {
  it('multiplies each customization by the item quantity', () => {
    const orders = [
      fullOrder('completed', at('2026-08-09T09:00:00'), at('2026-08-09T09:05:00'), [
        item('Latte', 3, 'Oat', ['Vanilla Syrup']),
      ]),
    ]
    expect(customizationCounts(orders)).toEqual([{ label: 'Vanilla Syrup', value: 3 }])
  })

  it('counts each customization on a multi-customization item', () => {
    const orders = [
      fullOrder('completed', at('2026-08-09T09:00:00'), at('2026-08-09T09:05:00'), [
        item('Latte', 1, 'Oat', ['Vanilla Syrup', 'Extra Shot']),
      ]),
    ]
    expect(customizationCounts(orders).map((c) => c.label).sort()).toEqual([
      'Extra Shot',
      'Vanilla Syrup',
    ])
  })
})

describe('computeAnalytics', () => {
  it('returns zeroed totals and null timings for no orders', () => {
    const result = computeAnalytics([])
    expect(result.totals).toEqual({
      orders: 0,
      completed: 0,
      cancelled: 0,
      cancelRate: 0,
      drinks: 0,
    })
    expect(result.fulfillment).toEqual({ count: 0, medianMs: null, p90Ms: null })
    expect(result.drinks).toEqual([])
    expect(result.ordersByHour).toHaveLength(24)
  })

  it('summarises a mixed set of orders', () => {
    const orders = [
      fullOrder('completed', at('2026-08-09T09:00:00'), at('2026-08-09T09:04:00'), [
        item('Latte', 2, 'Oat', ['Vanilla Syrup']),
      ]),
      fullOrder('completed', at('2026-08-09T09:10:00'), at('2026-08-09T09:16:00'), [
        item('Espresso', 1),
      ]),
      fullOrder('cancelled', at('2026-08-09T09:20:00'), at('2026-08-09T09:21:00'), [
        item('Latte', 1, 'Oat'),
      ]),
      fullOrder('pending', at('2026-08-09T09:30:00'), at('2026-08-09T09:30:00'), [
        item('Mocha', 1, 'Soy'),
      ]),
    ]
    const result = computeAnalytics(orders)
    expect(result.totals.orders).toBe(4)
    expect(result.totals.completed).toBe(2)
    expect(result.totals.cancelled).toBe(1)
    expect(result.totals.cancelRate).toBe(0.25)
    expect(result.totals.drinks).toBe(3)
    expect(result.fulfillment.count).toBe(2)
    expect(result.fulfillment.medianMs).toBe(300000)
    expect(result.drinks).toEqual([
      { label: 'Latte', value: 2 },
      { label: 'Espresso', value: 1 },
    ])
    expect(result.milk).toEqual([{ label: 'Oat', value: 2 }])
    expect(result.customizations).toEqual([{ label: 'Vanilla Syrup', value: 2 }])
  })
})
