// Client API for the Cafecito Worker. Same function names and shapes the
// Supabase module exported, so components did not have to change.

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  })

  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    const error = new Error(body.error ?? `Request failed: ${response.status}`)
    error.status = response.status
    error.unavailable = body.unavailable
    throw error
  }

  return response.json()
}

// Menu.svelte polls three getters every 5s, and the barista view polls the
// same three. /api/menu returns every row (available and not) for both
// audiences alike — there is no confidentiality boundary on the menu, only
// a display one — so all callers share a single in-flight request instead of
// firing three (or six) round-trips per poll.
let menuInFlight = null

function fetchMenu() {
  if (menuInFlight) return menuInFlight

  const promise = request('/api/menu').finally(() => {
    if (menuInFlight === promise) menuInFlight = null
  })

  menuInFlight = promise
  return promise
}

function onlyAvailable(rows, includeUnavailable) {
  return includeUnavailable ? rows : rows.filter((row) => row.available)
}

export async function getMenuItems(includeUnavailable = false) {
  return onlyAvailable((await fetchMenu()).items, includeUnavailable)
}

export async function getMilkOptions(includeUnavailable = false) {
  return onlyAvailable((await fetchMenu()).milkOptions, includeUnavailable)
}

export async function getCustomizationOptions(includeUnavailable = false) {
  return onlyAvailable((await fetchMenu()).customizationOptions, includeUnavailable)
}

export async function submitOrder(customerName, orderItems, submissionId = crypto.randomUUID()) {
  const items = orderItems.map((item) => ({
    item_id: item.itemId,
    milk_option_id: item.milkOption?.id ?? null,
    quantity: item.quantity,
    customization_option_ids: (item.customizations ?? []).map((c) => c.id),
  }))

  const { orderId } = await request('/api/orders', {
    method: 'POST',
    body: JSON.stringify({ customerName, submissionId, items }),
  })
  return { orderId }
}

export async function cancelOrder(orderId) {
  return request(`/api/orders/${orderId}/cancel`, { method: 'POST' })
}

export async function getOrderDetails(orderId) {
  return request(`/api/orders/${orderId}`)
}

export async function getActiveOrder() {
  return request('/api/orders/active')
}

export async function getQueueStats(orderId = null) {
  const query = orderId == null ? '' : `?order_id=${encodeURIComponent(orderId)}`
  return request(`/api/queue-stats${query}`)
}

export async function getOrders() {
  return request('/api/barista/orders')
}

export async function updateOrderStatus(orderId, newStatus) {
  return request(`/api/barista/orders/${orderId}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: newStatus }),
  })
}

export async function updateItemAvailability(itemId, available) {
  return request(`/api/barista/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify({ available }),
  })
}

export async function updateMilkAvailability(milkId, available) {
  return request(`/api/barista/milk/${milkId}`, {
    method: 'PATCH',
    body: JSON.stringify({ available }),
  })
}

export async function updateCustomizationAvailability(customizationId, available) {
  return request(`/api/barista/customizations/${customizationId}`, {
    method: 'PATCH',
    body: JSON.stringify({ available }),
  })
}

// Cloudflare Access owns the session; logging out is a redirect it handles.
export function signOut() {
  window.location.href = '/cdn-cgi/access/logout'
}
