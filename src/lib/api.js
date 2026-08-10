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

// Menu.svelte polls three getters every 5s. Coalescing them onto one in-flight
// request turns three round-trips into one.
let menuInFlight = null

function fetchMenu(includeUnavailable) {
  const path = includeUnavailable ? '/api/barista/menu' : '/api/menu'
  if (!includeUnavailable && menuInFlight) return menuInFlight

  const promise = request(path).finally(() => {
    if (menuInFlight === promise) menuInFlight = null
  })

  if (!includeUnavailable) menuInFlight = promise
  return promise
}

export async function getMenuItems(includeUnavailable = false) {
  return (await fetchMenu(includeUnavailable)).items
}

export async function getMilkOptions(includeUnavailable = false) {
  return (await fetchMenu(includeUnavailable)).milkOptions
}

export async function getCustomizationOptions(includeUnavailable = false) {
  return (await fetchMenu(includeUnavailable)).customizationOptions
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
