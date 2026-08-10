// Menu reads and menu management. Split out of db.js, which keeps orders,
// order details, and queue stats.

// SQLite stores booleans as 0/1; the Svelte components expect real booleans.
// allows_milk_choice / allows_customizations are absent from this list on
// purpose -- they are no longer read from the columns (see migrations/0002).
const BOOLEAN_COLUMNS = ['available', 'archived']

function toBooleans(row) {
  const out = { ...row }
  for (const column of BOOLEAN_COLUMNS) {
    if (column in out) out[column] = out[column] === 1
  }
  return out
}

// Link rows are filtered to unarchived options. Archiving an option therefore
// removes it from every drink's picker WITHOUT unlinking it, so restoring the
// option brings its links back exactly as they were.
const MILK_LINKS_SQL = `
  SELECT l.item_id, l.milk_option_id AS option_id
    FROM item_milk_options l
    JOIN milk_options o ON o.id = l.milk_option_id
   WHERE o.archived = 0
   ORDER BY o.sort_order, o.name`

const CUSTOMIZATION_LINKS_SQL = `
  SELECT l.item_id, l.customization_option_id AS option_id
    FROM item_customization_options l
    JOIN customization_options o ON o.id = l.customization_option_id
   WHERE o.archived = 0
   ORDER BY o.sort_order, o.name`

function linkMap(rows) {
  const map = new Map()
  for (const row of rows) {
    const existing = map.get(row.item_id)
    if (existing) existing.push(row.option_id)
    else map.set(row.item_id, [row.option_id])
  }
  return map
}

export async function getMenu(db) {
  const [items, milkOptions, customizationOptions, milkLinks, customizationLinks] = await db.batch([
    db.prepare(
      `SELECT id, name, description, size, available FROM items
        WHERE archived = 0 ORDER BY sort_order, name`
    ),
    db.prepare(
      `SELECT id, name, available FROM milk_options
        WHERE archived = 0 ORDER BY sort_order, name`
    ),
    db.prepare(
      `SELECT id, name, type, available FROM customization_options
        WHERE archived = 0 ORDER BY sort_order, name`
    ),
    db.prepare(MILK_LINKS_SQL),
    db.prepare(CUSTOMIZATION_LINKS_SQL),
  ])

  const milkByItem = linkMap(milkLinks.results)
  const customizationsByItem = linkMap(customizationLinks.results)

  return {
    items: items.results.map((row) => {
      const milkOptionIds = milkByItem.get(row.id) ?? []
      const customizationOptionIds = customizationsByItem.get(row.id) ?? []
      return {
        ...toBooleans(row),
        milkOptionIds,
        customizationOptionIds,
        // Derived, not stored. Menu.svelte keeps using these two names, so the
        // customer payload shape is unchanged.
        allows_milk_choice: milkOptionIds.length > 0,
        allows_customizations: customizationOptionIds.length > 0,
      }
    }),
    milkOptions: milkOptions.results.map(toBooleans),
    customizationOptions: customizationOptions.results.map(toBooleans),
  }
}
