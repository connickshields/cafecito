import {
  UnavailableError,
  cancelOrder,
  createOrder,
  getActiveOrder,
  getOrderDetails,
  getQueueStats,
} from '../db.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function postOrder(request, env, customerId) {
  let body
  try {
    body = await request.json()
  } catch {
    return { status: 400, body: { error: 'Invalid JSON' } }
  }

  const customerName = String(body.customerName ?? '').trim()
  if (!customerName) return { status: 400, body: { error: 'customerName is required' } }

  const submissionId = String(body.submissionId ?? '')
  if (!UUID_RE.test(submissionId)) {
    return { status: 400, body: { error: 'submissionId must be a UUID' } }
  }

  if (!Array.isArray(body.items) || body.items.length === 0) {
    return { status: 400, body: { error: 'Order must contain at least one item' } }
  }

  try {
    // customerId comes from the signed cookie. Anything in the body is ignored.
    const { orderId } = await createOrder(env.DB, {
      customerId,
      customerName,
      submissionId,
      items: body.items,
    })
    return { status: 201, body: { orderId } }
  } catch (error) {
    if (error instanceof UnavailableError) {
      return { status: 409, body: { error: error.message, unavailable: error.unavailable } }
    }
    if (/at least one item/i.test(error.message)) {
      return { status: 400, body: { error: error.message } }
    }
    throw error
  }
}

export async function getActive(request, env, customerId) {
  return { status: 200, body: await getActiveOrder(env.DB, customerId) }
}

export async function getDetails(request, env, customerId, orderId) {
  const details = await getOrderDetails(env.DB, orderId, customerId)
  if (!details) return { status: 404, body: { error: 'Not found' } }
  return { status: 200, body: details }
}

export async function postCancel(request, env, customerId, orderId) {
  const cancelled = await cancelOrder(env.DB, orderId, customerId)
  if (!cancelled) return { status: 404, body: { error: 'Not found' } }
  return { status: 200, body: { ok: true } }
}

export async function getStats(request, env) {
  const raw = new URL(request.url).searchParams.get('order_id')
  const orderId = raw === null || raw === '' ? null : Number(raw)
  if (orderId !== null && !Number.isInteger(orderId)) {
    return { status: 400, body: { error: 'order_id must be an integer' } }
  }
  return { status: 200, body: await getQueueStats(env.DB, orderId) }
}
