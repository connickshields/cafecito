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

// The URL segment a barista route uses -> the table it manages. Table names
// cannot be bound as query parameters, so this doubles as the allowlist.
export const MENU_KINDS = {
  items: 'items',
  milk: 'milk_options',
  customizations: 'customization_options',
}

const LINK_TABLES = {
  milk: {
    table: 'item_milk_options',
    column: 'milk_option_id',
    optionTable: 'milk_options',
  },
  customizations: {
    table: 'item_customization_options',
    column: 'customization_option_id',
    optionTable: 'customization_options',
  },
}

function tableFor(kind) {
  if (!Object.hasOwn(MENU_KINDS, kind)) throw new Error(`Unknown menu kind: ${kind}`)
  return MENU_KINDS[kind]
}

export async function getMenuForManagement(db) {
  const [items, milkOptions, customizationOptions, milkLinks, customizationLinks] = await db.batch([
    db.prepare(
      `SELECT id, name, description, size, available, archived, sort_order
         FROM items ORDER BY sort_order, name`
    ),
    db.prepare(
      `SELECT id, name, available, archived, sort_order
         FROM milk_options ORDER BY sort_order, name`
    ),
    db.prepare(
      `SELECT id, name, type, available, archived, sort_order
         FROM customization_options ORDER BY sort_order, name`
    ),
    db.prepare(MILK_LINKS_SQL),
    db.prepare(CUSTOMIZATION_LINKS_SQL),
  ])

  const milkByItem = linkMap(milkLinks.results)
  const customizationsByItem = linkMap(customizationLinks.results)

  const shape = (row) => {
    const { sort_order: sortOrder, ...rest } = toBooleans(row)
    return { ...rest, sortOrder }
  }

  return {
    items: items.results.map((row) => ({
      ...shape(row),
      milkOptionIds: milkByItem.get(row.id) ?? [],
      customizationOptionIds: customizationsByItem.get(row.id) ?? [],
    })),
    milkOptions: milkOptions.results.map(shape),
    customizationOptions: customizationOptions.results.map(shape),
  }
}

// Replacement is scoped to links pointing at UNARCHIVED options: the editor
// only ever shows the barista unarchived options, so the id list it sends back
// cannot mention an archived one. An unscoped DELETE would silently destroy
// those links.
function linkStatements(db, itemId, links) {
  const statements = []

  for (const kind of Object.keys(LINK_TABLES)) {
    const ids = links[kind]
    if (!ids) continue

    const { table, column, optionTable } = LINK_TABLES[kind]
    statements.push(
      db
        .prepare(
          `DELETE FROM ${table}
            WHERE item_id = ?
              AND ${column} IN (SELECT id FROM ${optionTable} WHERE archived = 0)`
        )
        .bind(itemId)
    )
    for (const id of ids) {
      statements.push(
        db.prepare(`INSERT INTO ${table} (item_id, ${column}) VALUES (?, ?)`).bind(itemId, id)
      )
    }
  }

  return statements
}

export async function createMenuEntry(db, kind, fields) {
  const table = tableFor(kind)
  const columns = Object.keys(fields.columns)
  const next = await db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS position FROM ${table}`)
    .first()

  const inserted = await db
    .prepare(
      `INSERT INTO ${table} (${[...columns, 'sort_order'].join(', ')})
       VALUES (${[...columns, 'sort_order'].map(() => '?').join(', ')})`
    )
    .bind(...columns.map((column) => fields.columns[column]), next.position)
    .run()

  const id = inserted.meta.last_row_id

  // Links go in a second round trip because a D1 batch cannot feed one
  // statement's generated id into the next. If this half fails the drink
  // exists with no options attached -- visible, and fixed by editing it.
  const statements = kind === 'items' ? linkStatements(db, id, fields.links) : []
  if (statements.length > 0) await db.batch(statements)

  return id
}

export async function updateMenuEntry(db, kind, id, fields) {
  const table = tableFor(kind)

  // A link-only PATCH still has to prove the row exists, and an UPDATE that
  // matches nothing is indistinguishable from one that changed nothing.
  const existing = await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(id).first()
  if (!existing) return false

  const columns = Object.keys(fields.columns)
  const statements = []

  if (columns.length > 0) {
    statements.push(
      db
        .prepare(
          `UPDATE ${table} SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`
        )
        .bind(...columns.map((column) => fields.columns[column]), id)
    )
  }
  if (kind === 'items') statements.push(...linkStatements(db, id, fields.links))

  if (statements.length > 0) await db.batch(statements)
  return true
}

export async function reorderMenuEntries(db, kind, ids) {
  const table = tableFor(kind)
  if (ids.length === 0) return
  await db.batch(
    ids.map((id, index) =>
      db.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`).bind(index, id)
    )
  )
}

export async function activeMenuIds(db, kind) {
  const { results } = await db.prepare(`SELECT id FROM ${tableFor(kind)} WHERE archived = 0`).all()
  return results.map((row) => row.id)
}

// Uniqueness lives here rather than in a UNIQUE index because it has to ignore
// archived rows: reviving a name an archived row still holds is allowed.
export async function nameTaken(db, kind, name, excludeId = null) {
  const row = await db
    .prepare(
      `SELECT id FROM ${tableFor(kind)}
        WHERE archived = 0 AND LOWER(name) = LOWER(?) AND (? IS NULL OR id != ?)`
    )
    .bind(name, excludeId, excludeId)
    .first()
  return row !== null
}

export async function optionIdsExist(db, kind, ids) {
  if (ids.length === 0) return true
  const placeholders = ids.map(() => '?').join(',')
  const { results } = await db
    .prepare(`SELECT id FROM ${tableFor(kind)} WHERE archived = 0 AND id IN (${placeholders})`)
    .bind(...ids)
    .all()
  return results.length === new Set(ids).size
}
