// SQLite stores booleans as 0/1; the Svelte components expect real booleans.
const BOOLEAN_COLUMNS = ['available', 'allows_milk_choice', 'allows_customizations']

function toBooleans(row) {
  const out = { ...row }
  for (const column of BOOLEAN_COLUMNS) {
    if (column in out) out[column] = out[column] === 1
  }
  return out
}

export async function getMenu(db, includeUnavailable) {
  const filter = includeUnavailable ? '' : 'WHERE available = 1'
  const [items, milkOptions, customizationOptions] = await db.batch([
    db.prepare(`SELECT * FROM items ${filter} ORDER BY name`),
    db.prepare(`SELECT * FROM milk_options ${filter} ORDER BY name`),
    db.prepare(`SELECT * FROM customization_options ${filter} ORDER BY name`),
  ])

  return {
    items: items.results.map(toBooleans),
    milkOptions: milkOptions.results.map(toBooleans),
    customizationOptions: customizationOptions.results.map(toBooleans),
  }
}
