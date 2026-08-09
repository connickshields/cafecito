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
