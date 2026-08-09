// ±25% around drinks × recent minutes-per-drink, whole minutes, floor 1–2
export function waitRange(drinks, rate) {
  if (rate === null || drinks <= 0) return null
  const mins = drinks * rate
  return {
    low: Math.max(1, Math.round(mins * 0.75)),
    high: Math.max(2, Math.round(mins * 1.25)),
  }
}
