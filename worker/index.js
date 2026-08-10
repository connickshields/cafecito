import { CUSTOMER_COOKIE, customerCookieHeader, readCookie, signCustomerId, verifyCustomerCookie } from './auth.js'
import { handleBarista, requireBarista } from './routes/barista.js'
import { handleMenu } from './routes/menu.js'
import { getActive, getDetails, getStats, postCancel, postOrder } from './routes/orders.js'

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  })
}

// Resolves the caller's customer id from the signed cookie, minting a new one
// on first contact. Returns the id plus the Set-Cookie header to echo back.
export async function withCustomer(request, env) {
  const existing = await verifyCustomerCookie(readCookie(request, CUSTOMER_COOKIE), env.COOKIE_SECRET)
  if (existing) return { customerId: existing, setCookie: null }

  const customerId = crypto.randomUUID()
  const signed = await signCustomerId(customerId, env.COOKIE_SECRET)
  return { customerId, setCookie: customerCookieHeader(signed) }
}

function respond({ status, body }, setCookie) {
  const headers = setCookie ? { 'Set-Cookie': setCookie } : {}
  return json(body ?? null, { status, headers })
}

async function handleApi(request, env, url) {
  // Mount-point authorization: everything under /api/barista/* is gated here,
  // so no individual handler can forget its own check.
  if (url.pathname.startsWith('/api/barista/')) {
    if (!(await requireBarista(request, env))) {
      return json({ error: 'Forbidden' }, { status: 403 })
    }
    return respond(await handleBarista(request, env, url), null)
  }

  const { customerId, setCookie } = await withCustomer(request, env)
  const path = url.pathname
  const method = request.method

  if (path === '/api/menu' && method === 'GET') {
    return respond({ status: 200, body: await handleMenu(request, env) }, setCookie)
  }
  if (path === '/api/queue-stats' && method === 'GET') {
    return respond(await getStats(request, env), setCookie)
  }
  if (path === '/api/orders' && method === 'POST') {
    return respond(await postOrder(request, env, customerId), setCookie)
  }
  if (path === '/api/orders/active' && method === 'GET') {
    return respond(await getActive(request, env, customerId), setCookie)
  }

  const cancelMatch = path.match(/^\/api\/orders\/(\d+)\/cancel$/)
  if (cancelMatch && method === 'POST') {
    return respond(await postCancel(request, env, customerId, Number(cancelMatch[1])), setCookie)
  }

  const detailMatch = path.match(/^\/api\/orders\/(\d+)$/)
  if (detailMatch && method === 'GET') {
    return respond(await getDetails(request, env, customerId, Number(detailMatch[1])), setCookie)
  }

  return respond({ status: 404, body: { error: 'Not found' } }, setCookie)
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url)
      } catch (error) {
        console.error('API error', error)
        return json({ error: 'Internal error' }, { status: 500 })
      }
    }

    return env.ASSETS.fetch(request)
  },
}
