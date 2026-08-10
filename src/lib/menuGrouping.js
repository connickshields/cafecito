// Groups customization options under their `type`, which migration 0002 stores
// as the literal heading to display -- no title-casing, no pluralization.
//
// Groups appear in the order their first member does, and members keep their
// incoming order. Callers pass a list already ordered by sort_order, so that
// reproduces "groups ordered by their lowest member" without this module ever
// needing to know sort_order exists.
export function groupByType(options) {
  const groups = []
  const byType = new Map()

  for (const option of options) {
    let group = byType.get(option.type)
    if (!group) {
      group = { type: option.type, options: [] }
      byType.set(option.type, group)
      groups.push(group)
    }
    group.options.push(option)
  }

  return groups
}
