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
