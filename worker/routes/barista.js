import { fetchAccessJwks, verifyAccessJwt } from '../auth.js'
import { getMenu, getOrders, updateAvailability, updateOrderStatus } from '../db.js'

const VALID_STATUSES = new Set(['pending', 'in_progress', 'completed', 'cancelled'])

const AVAILABILITY_ROUTES = {
  items: 'items',
  milk: 'milk_options',
  customizations: 'customization_options',
}

// A parse failure (invalid JSON) and a valid parse of a non-object (null, a
// bare number, a bare string, ...) must both be treated as "no usable body"
// so the field checks below (body.status, body.available) can never throw.
async function readJsonBody(request) {
  const body = await request.json().catch(() => null)
  return typeof body === 'object' && body !== null ? body : {}
}

// The security boundary. Every /api/barista/* request passes through here
// before any handler runs, so a new route cannot ship unprotected.
export async function requireBarista(request, env) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion')
  if (!token) return false
  try {
    const jwks = await fetchAccessJwks(env.ACCESS_TEAM_DOMAIN)
    return (await verifyAccessJwt(token, jwks, env.ACCESS_AUD)) !== null
  } catch (error) {
    console.error('Access verification failed', error)
    return false
  }
}

export async function handleBarista(request, env, url) {
  const path = url.pathname
  const method = request.method

  if (path === '/api/barista/orders' && method === 'GET') {
    return { status: 200, body: await getOrders(env.DB) }
  }

  if (path === '/api/barista/menu' && method === 'GET') {
    return { status: 200, body: await getMenu(env.DB, true) }
  }

  const statusMatch = path.match(/^\/api\/barista\/orders\/(\d+)$/)
  if (statusMatch && method === 'PATCH') {
    const body = await readJsonBody(request)
    if (!VALID_STATUSES.has(body.status)) {
      return { status: 400, body: { error: 'Invalid status' } }
    }
    const updated = await updateOrderStatus(env.DB, Number(statusMatch[1]), body.status)
    return updated ? { status: 200, body: { ok: true } } : { status: 404, body: { error: 'Not found' } }
  }

  const availabilityMatch = path.match(/^\/api\/barista\/(items|milk|customizations)\/(\d+)$/)
  if (availabilityMatch && method === 'PATCH') {
    const body = await readJsonBody(request)
    if (typeof body.available !== 'boolean') {
      return { status: 400, body: { error: 'available must be a boolean' } }
    }
    const table = AVAILABILITY_ROUTES[availabilityMatch[1]]
    const updated = await updateAvailability(env.DB, table, Number(availabilityMatch[2]), body.available)
    return updated ? { status: 200, body: { ok: true } } : { status: 404, body: { error: 'Not found' } }
  }

  return { status: 404, body: { error: 'Not found' } }
}
