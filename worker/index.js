import {
  CUSTOMER_COOKIE,
  customerCookieHeader,
  previewCookieHeader,
  readCookie,
  signCustomerId,
  signPreviewGrant,
  verifyCustomerCookie,
  verifyPreviewKey,
} from './auth.js'
import { deploymentKind, previewCookieDomain } from './deployment.js'
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
  // encoder.encode(undefined) silently coerces to the 9-byte string
  // "undefined" -- a publicly guessable HMAC key that would sign and verify
  // every customer cookie without ever failing a request. Fail loud instead:
  // the top-level fetch handler turns this into a 500.
  if (!env.COOKIE_SECRET) {
    throw new Error('COOKIE_SECRET is not configured')
  }

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

// Trades ?preview_key=<secret> for a signed cookie, then redirects to the same
// URL without the key so it cannot linger in the address bar, the browser's
// history, or a link someone pastes into an issue.
//
// Exported for the unconfigured-secret case, which cannot be reached through
// SELF.fetch: the test Worker always has the binding.
export async function handlePreviewKeyExchange(request, env, url) {
  if (!env.PREVIEW_BARISTA_KEY) {
    // Loud, like the missing-COOKIE_SECRET path: a silent no-op here would
    // surface much later as an inexplicable 403.
    return json({ error: 'PREVIEW_BARISTA_KEY is not configured' }, { status: 500 })
  }

  const presented = url.searchParams.get('preview_key')
  if (!(await verifyPreviewKey(presented, env.PREVIEW_BARISTA_KEY))) {
    return json({ error: 'Forbidden' }, { status: 403 })
  }

  const target = new URL(url)
  target.searchParams.delete('preview_key')
  const signed = await signPreviewGrant(env.PREVIEW_BARISTA_KEY)

  return new Response(null, {
    status: 302,
    headers: {
      Location: `${target.pathname}${target.search}${target.hash}`,
      'Set-Cookie': previewCookieHeader(signed, previewCookieDomain(url.hostname)),
    },
  })
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)

    // Preview only. On production deploymentKind never returns 'preview', so
    // the parameter is ignored there and falls through to normal routing.
    if (deploymentKind(url.hostname) === 'preview' && url.searchParams.has('preview_key')) {
      return handlePreviewKeyExchange(request, env, url)
    }

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
