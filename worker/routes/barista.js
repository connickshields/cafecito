import {
  fetchAccessJwks,
  PREVIEW_COOKIE,
  readCookie,
  verifyAccessJwt,
  verifyPreviewGrant,
} from '../auth.js'
import { deploymentKind } from '../deployment.js'
import { getOrders, updateOrderStatus } from '../db.js'
import { readJsonBody } from './body.js'
import { handleMenuAdmin } from './menu.js'

const VALID_STATUSES = new Set(['pending', 'in_progress', 'completed', 'cancelled'])

// The security boundary. Every /api/barista/* request passes through here
// before any handler runs, so a new route cannot ship unprotected.
//
// The local and preview branches are unreachable from production: a deployed
// production Worker never sees a localhost or *.workers.dev hostname, because
// production sets workers_dev = false and serves only its custom domain. On
// anything else -- including a hostname nobody anticipated -- deploymentKind
// answers 'production' and only a valid Access JWT gets through.
export async function requireBarista(request, env) {
  const deployment = deploymentKind(new URL(request.url).hostname)

  // wrangler dev has no Access in front of it, and the database is local.
  if (deployment === 'local') return true

  // Previews run against a throwaway database. The grant is minted by the
  // ?preview_key= exchange in index.js.
  if (deployment === 'preview') {
    return verifyPreviewGrant(readCookie(request, PREVIEW_COOKIE), env.PREVIEW_BARISTA_KEY)
  }

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

  // Everything under /api/barista/menu is menu management. It stays inside
  // this handler so it inherits the mount-point Access gate in index.js.
  if (path === '/api/barista/menu' || path.startsWith('/api/barista/menu/')) {
    return handleMenuAdmin(request, env, url)
  }

  if (path === '/api/barista/orders' && method === 'GET') {
    return { status: 200, body: await getOrders(env.DB) }
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

  return { status: 404, body: { error: 'Not found' } }
}
