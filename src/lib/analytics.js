// Pure aggregation for the barista analytics view. Input is the array returned
// by getOrders() in supabase.js. No DOM, no Svelte — this module is unit-tested.

const MINUTE_MS = 60_000

// Upper bound in minutes for each bucket; the last one is open-ended.
const FULFILLMENT_BUCKETS = [
  { label: '0–2m', maxMinutes: 2 },
  { label: '2–4m', maxMinutes: 4 },
  { label: '4–6m', maxMinutes: 6 },
  { label: '6–8m', maxMinutes: 8 },
  { label: '8–10m', maxMinutes: 10 },
  { label: '10–15m', maxMinutes: 15 },
  { label: '15m+', maxMinutes: Infinity },
]

// A trigger overwrites updated_at on every status change, so for a completed
// order it is the completion time. Orders still in the queue have no usable
// span, and a non-positive one means clock skew or a backfilled row.
export function fulfillmentDurations(orders) {
  return orders
    .filter((order) => order.status === 'completed')
    .filter((order) => order.created_at && order.updated_at)
    .map(
      (order) =>
        new Date(order.updated_at).getTime() - new Date(order.created_at).getTime()
    )
    .filter((ms) => Number.isFinite(ms) && ms > 0)
    .sort((a, b) => a - b)
}

// Linear interpolation between closest ranks (the R-7 method).
export function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null
  const rank = (p / 100) * (sortedValues.length - 1)
  const lower = Math.floor(rank)
  const upper = Math.ceil(rank)
  if (lower === upper) return sortedValues[lower]
  return (
    sortedValues[lower] + (rank - lower) * (sortedValues[upper] - sortedValues[lower])
  )
}

// A value landing exactly on a boundary falls into the higher bucket.
export function fulfillmentHistogram(durationsMs) {
  const counts = FULFILLMENT_BUCKETS.map((bucket) => ({ label: bucket.label, value: 0 }))
  durationsMs.forEach((ms) => {
    const minutes = ms / MINUTE_MS
    const index = FULFILLMENT_BUCKETS.findIndex((bucket) => minutes < bucket.maxMinutes)
    counts[index].value += 1
  })
  return counts
}

export function formatDuration(ms) {
  if (ms == null) return '—'
  const minutes = Math.floor(ms / MINUTE_MS)
  const seconds = Math.floor((ms % MINUTE_MS) / 1000)
  return `${minutes}m ${seconds}s`
}
