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

// Collapses the flat order x item x customization join into nested objects.
// Shared by both order shapes; `detail` selects the field naming.
function groupRows(rows, { detail }) {
  const orders = new Map()

  for (const row of rows) {
    let order = orders.get(row.order_id)
    if (!order) {
      order = detail
        ? { id: row.order_id, status: row.status, createdAt: row.created_at, customerName: row.customer_name, items: [] }
        : {
            id: row.order_id,
            status: row.status,
            customerName: row.customer_name,
            created_at: row.created_at,
            updated_at: row.updated_at,
            items: [],
          }
      order._itemsById = new Map()
      orders.set(row.order_id, order)
    }

    // A LEFT JOIN against an order with no items yields a null order_item_id.
    if (row.order_item_id === null || row.order_item_id === undefined) continue

    let item = order._itemsById.get(row.order_item_id)
    if (!item) {
      item = {
        name: row.item_name,
        quantity: row.quantity,
        milkOption: row.milk_name ?? null,
        customizations: [],
      }
      if (!detail) item.completedInstances = new Array(row.quantity).fill(false)
      order._itemsById.set(row.order_item_id, item)
      order.items.push(item)
    }

    if (row.customization_name) item.customizations.push(row.customization_name)
  }

  return [...orders.values()].map(({ _itemsById, ...order }) => order)
}

export function groupOrderRows(rows) {
  return groupRows(rows, { detail: false })
}

export function groupOrderDetailRows(rows) {
  const [order] = groupRows(rows, { detail: true })
  return order ?? null
}

const ORDER_JOIN = `
  SELECT o.id            AS order_id,
         o.status        AS status,
         o.customer_name AS customer_name,
         o.created_at    AS created_at,
         o.updated_at    AS updated_at,
         oi.id           AS order_item_id,
         oi.quantity     AS quantity,
         i.name          AS item_name,
         m.name          AS milk_name,
         co.name         AS customization_name
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN items i ON i.id = oi.item_id
    LEFT JOIN milk_options m ON m.id = oi.milk_option_id
    LEFT JOIN order_item_customizations oic ON oic.order_item_id = oi.id
    LEFT JOIN customization_options co ON co.id = oic.customization_option_id
`

export async function getOrders(db) {
  const { results } = await db
    .prepare(`${ORDER_JOIN} ORDER BY o.created_at ASC, o.id ASC, oi.rowid ASC, co.name ASC`)
    .all()
  return groupOrderRows(results)
}

// customer_id is in the WHERE clause, not a post-fetch check: a query that
// cannot see the row is safer than a branch someone can forget.
export async function getOrderDetails(db, orderId, customerId) {
  const { results } = await db
    .prepare(`${ORDER_JOIN} WHERE o.id = ? AND o.customer_id = ? ORDER BY oi.rowid ASC, co.name ASC`)
    .bind(orderId, customerId)
    .all()
  return groupOrderDetailRows(results)
}

export async function getActiveOrder(db, customerId) {
  return db
    .prepare(
      `SELECT id, customer_name, status
         FROM orders
        WHERE customer_id = ? AND status IN ('pending','in_progress')
        ORDER BY created_at DESC
        LIMIT 1`
    )
    .bind(customerId)
    .first()
}

export async function cancelOrder(db, orderId, customerId) {
  const result = await db
    .prepare(
      `UPDATE orders SET status = 'cancelled'
        WHERE id = ? AND customer_id = ? AND status = 'pending'`
    )
    .bind(orderId, customerId)
    .run()
  return result.meta.changes > 0
}

export async function updateOrderStatus(db, orderId, status) {
  const result = await db
    .prepare('UPDATE orders SET status = ? WHERE id = ?')
    .bind(status, orderId)
    .run()
  return result.meta.changes > 0
}

const AVAILABILITY_TABLES = new Set(['items', 'milk_options', 'customization_options'])

export async function updateAvailability(db, table, id, available) {
  // Table names cannot be bound as parameters, so allowlist them.
  if (!AVAILABILITY_TABLES.has(table)) throw new Error(`Unknown table: ${table}`)
  const result = await db
    .prepare(`UPDATE ${table} SET available = ? WHERE id = ?`)
    .bind(available ? 1 : 0, id)
    .run()
  return result.meta.changes > 0
}

// Port of the get_queue_stats plpgsql function.
// Drain rate: over the last 5 completions within 90 minutes, drinks completed
// after the earliest completion divided by the minutes between first and last.
// NULL when fewer than 3 completions or the span is under 60 seconds.
const QUEUE_STATS_SQL = `
  WITH ahead AS (
    SELECT COALESCE(SUM(oi.quantity), 0) AS drinks_ahead,
           COUNT(DISTINCT o.id)          AS active_orders
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
     WHERE o.status IN ('pending','in_progress')
       AND (? IS NULL OR o.created_at < (SELECT created_at FROM orders WHERE id = ?))
  ),
  recent AS (
    SELECT o.id,
           o.updated_at,
           (SELECT COALESCE(SUM(quantity), 0) FROM order_items oi WHERE oi.order_id = o.id) AS drinks
      FROM orders o
     WHERE o.status = 'completed'
       AND o.updated_at > strftime('%Y-%m-%dT%H:%M:%SZ','now','-90 minutes')
     ORDER BY o.updated_at DESC
     LIMIT 5
  ),
  ordered AS (
    SELECT drinks,
           ROW_NUMBER() OVER (ORDER BY updated_at ASC) AS rn,
           COUNT(*)        OVER () AS n,
           MIN(updated_at) OVER () AS first_t,
           MAX(updated_at) OVER () AS last_t
      FROM recent
  )
  SELECT (SELECT drinks_ahead FROM ahead)  AS drinks_ahead,
         (SELECT active_orders FROM ahead) AS active_orders,
         (SELECT CASE
                   WHEN MAX(n) IS NULL OR MAX(n) < 3 THEN NULL
                   WHEN (CAST(strftime('%s', MAX(last_t)) AS INTEGER)
                         - CAST(strftime('%s', MAX(first_t)) AS INTEGER)) < 60 THEN NULL
                   ELSE ((CAST(strftime('%s', MAX(last_t)) AS INTEGER)
                          - CAST(strftime('%s', MAX(first_t)) AS INTEGER)) / 60.0)
                        / NULLIF(SUM(CASE WHEN rn > 1 THEN drinks ELSE 0 END), 0)
                 END
            FROM ordered)                  AS est_mins_per_drink
`

export async function getQueueStats(db, orderId) {
  const row = await db.prepare(QUEUE_STATS_SQL).bind(orderId ?? null, orderId ?? null).first()
  return {
    drinksAhead: row?.drinks_ahead ?? 0,
    activeOrders: row?.active_orders ?? 0,
    estMinsPerDrink: row?.est_mins_per_drink == null ? null : Number(row.est_mins_per_drink),
  }
}
