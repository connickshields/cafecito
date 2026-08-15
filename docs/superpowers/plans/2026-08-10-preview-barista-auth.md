# Preview Barista Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let preview deployments and `wrangler dev` reach the barista view, without weakening the production authorization boundary.

**Architecture:** A pure hostname classifier decides whether a request is `local`, `preview`, or `production`, defaulting to `production`. `requireBarista` — still the single choke point — gains a branch per kind: Access JWT on production (unchanged), a signed cookie on preview, nothing on localhost. The preview cookie is minted by a one-time `?preview_key=` exchange against a secret held only on the preview Worker, reusing the HMAC helpers already in `worker/auth.js`.

**Tech Stack:** Cloudflare Workers, D1, Vitest (node project + `@cloudflare/vitest-pool-workers`), Web Crypto (`crypto.subtle`).

**Spec:** `docs/superpowers/specs/2026-08-10-preview-barista-auth-design.md`

## Global Constraints

- **`worker/**/*.js` and `src/lib/*.js` use no semicolons.** `.svelte` files use them. Two-space indent everywhere.
- **Node tests live at `tests/*.test.js`** — `vite.config.js` sets `include: ['tests/*.test.js']`, which is **not recursive**. A node test in a subdirectory is silently never run.
- **Worker tests live at `tests/worker/**/*.test.js`**, run by `vitest.worker.config.js`.
- **Never modify `tests/analytics.test.js` or `tests/worker/authorization.test.js`.**
- **Production must keep `workers_dev = false`** in `wrangler.toml`. It is one of the four independent conditions preventing a production bypass.
- **No frontend file changes.** `src/lib/api.js` already sends `credentials: 'same-origin'`.
- **No `wrangler.toml` changes.** The secret is set out of band with `wrangler secret put --env preview`.
- Run `wrangler` directly, never `npx wrangler`.
- Baseline: **62 node tests, 114 worker tests**, all passing.

## File Structure

**Create**

| File | Responsibility |
|---|---|
| `worker/deployment.js` | `deploymentKind` and `previewCookieDomain` — pure hostname logic |
| `tests/deployment.test.js` | Node test for both |
| `tests/worker/preview-auth.test.js` | Worker tests for the branches and the exchange |

**Modify**

| File | Change |
|---|---|
| `worker/auth.js` | Preview cookie constants, sign/verify grant, verify key, cookie header |
| `tests/auth.test.js` | Node tests for the new helpers |
| `worker/routes/barista.js` | `requireBarista` gains the local and preview branches |
| `worker/index.js` | The `?preview_key=` exchange, before routing |
| `vitest.worker.config.js` | Bind `PREVIEW_BARISTA_KEY` for the worker test env |
| `README.md` | How to get into a preview barista view |

---

### Task 1: The deployment classifier

**Files:**
- Create: `worker/deployment.js`
- Test: `tests/deployment.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `deploymentKind(hostname)` → `'local' | 'preview' | 'production'`; `previewCookieDomain(hostname)` → `string | null`.

- [ ] **Step 1: Write the failing test**

Create `tests/deployment.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { deploymentKind, previewCookieDomain } from '../worker/deployment.js'

describe('deploymentKind', () => {
  it('classifies local hostnames', () => {
    expect(deploymentKind('localhost')).toBe('local')
    expect(deploymentKind('127.0.0.1')).toBe('local')
    expect(deploymentKind('[::1]')).toBe('local')
  })

  it('classifies preview hostnames', () => {
    expect(deploymentKind('pr-22-cafecito-preview.connickshields.workers.dev')).toBe('preview')
    expect(deploymentKind('cafecito-preview.connickshields.workers.dev')).toBe('preview')
  })

  it('classifies the production hostname', () => {
    expect(deploymentKind('cafecito.connick.me')).toBe('production')
  })

  it('treats an unrecognised hostname as production', () => {
    expect(deploymentKind('example.com')).toBe('production')
    expect(deploymentKind('')).toBe('production')
  })

  it('does not mistake a domain that merely contains workers.dev', () => {
    // These are attacker-registrable domains. The check must be endsWith on
    // '.workers.dev', never includes, or an attacker picks their own branch.
    expect(deploymentKind('workers.dev.evil.com')).toBe('production')
    expect(deploymentKind('notworkers.dev')).toBe('production')
    expect(deploymentKind('workers.dev')).toBe('production')
  })
})

describe('previewCookieDomain', () => {
  it('returns one registrable domain shared by every PR alias', () => {
    // The point of the shared scope: one key paste covers all previews.
    expect(previewCookieDomain('pr-22-cafecito-preview.connickshields.workers.dev')).toBe(
      'connickshields.workers.dev'
    )
    expect(previewCookieDomain('pr-9-cafecito-preview.connickshields.workers.dev')).toBe(
      'connickshields.workers.dev'
    )
  })

  it('returns null for anything that is not a preview host', () => {
    expect(previewCookieDomain('cafecito.connick.me')).toBeNull()
    expect(previewCookieDomain('localhost')).toBeNull()
    expect(previewCookieDomain('workers.dev.evil.com')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm run test:unit -- tests/deployment.test.js`
Expected: FAIL — cannot resolve `../worker/deployment.js`.

- [ ] **Step 3: Write the implementation**

Create `worker/deployment.js`:

```js
// Which deployment is serving this request, decided from the hostname alone.
//
// Production is the DEFAULT, never a case of its own: an unrecognised hostname
// gets the strictest rule, so a hostname nobody anticipated cannot fall into a
// weaker branch. A deployed production Worker never sees a localhost or
// *.workers.dev hostname -- production sets workers_dev = false and serves
// only its custom domain -- which is what makes the other two branches safe.

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

// endsWith, never includes: `workers.dev.evil.com` is a domain an attacker can
// register, and it must classify as production.
const PREVIEW_SUFFIX = '.workers.dev'

export function deploymentKind(hostname) {
  if (LOCAL_HOSTNAMES.has(hostname)) return 'local'
  if (hostname.endsWith(PREVIEW_SUFFIX)) return 'preview'
  return 'production'
}

// The registrable domain of a preview host, so one cookie covers every per-PR
// alias instead of needing a fresh key paste per pull request. workers.dev is
// on the public suffix list, which makes <account>.workers.dev the registrable
// domain and a legal cookie scope.
export function previewCookieDomain(hostname) {
  if (deploymentKind(hostname) !== 'preview') return null
  const labels = hostname.split('.')
  if (labels.length < 3) return null
  return labels.slice(-3).join('.')
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npm test`
Expected: PASS — 71 node (62 + 9 new), 114 worker.

- [ ] **Step 5: Commit**

```bash
git add worker/deployment.js tests/deployment.test.js
git commit -m "feat: classify deployments by hostname, defaulting to production"
```

---

### Task 2: Preview grant helpers in `worker/auth.js`

**Files:**
- Modify: `worker/auth.js` (append after `customerCookieHeader`)
- Test: `tests/auth.test.js` (append)

**Interfaces:**
- Consumes: the existing module-private `signCustomerId` / `verifyCustomerCookie` in the same file.
- Produces, from `worker/auth.js`:
  - `PREVIEW_COOKIE` — the string `'cafecito_preview'`
  - `signPreviewGrant(secret)` → `Promise<string>`
  - `verifyPreviewGrant(value, secret)` → `Promise<boolean>`
  - `verifyPreviewKey(presented, secret)` → `Promise<boolean>`
  - `previewCookieHeader(signed, domain)` → `string`
  - `PREVIEW_TOKEN` stays **private** to the module.

- [ ] **Step 1: Write the failing tests**

Append to `tests/auth.test.js`. Merge the new names into the existing `worker/auth.js` import at the top of the file rather than adding a second import statement:

```js
describe('preview grant', () => {
  const SECRET = 'preview-secret-value'

  it('round-trips a grant it signed', async () => {
    const signed = await signPreviewGrant(SECRET)
    expect(await verifyPreviewGrant(signed, SECRET)).toBe(true)
  })

  it('rejects a grant signed with a different key', async () => {
    const signed = await signPreviewGrant('some-other-secret')
    expect(await verifyPreviewGrant(signed, SECRET)).toBe(false)
  })

  it('rejects a tampered, empty, or missing grant', async () => {
    const signed = await signPreviewGrant(SECRET)
    expect(await verifyPreviewGrant(`${signed}x`, SECRET)).toBe(false)
    expect(await verifyPreviewGrant('barista.', SECRET)).toBe(false)
    expect(await verifyPreviewGrant('', SECRET)).toBe(false)
    expect(await verifyPreviewGrant(null, SECRET)).toBe(false)
  })

  it('rejects a grant when the Worker has no key configured', async () => {
    const signed = await signPreviewGrant(SECRET)
    expect(await verifyPreviewGrant(signed, undefined)).toBe(false)
    expect(await verifyPreviewGrant(signed, '')).toBe(false)
  })

  it('refuses a customer cookie presented as a preview grant', async () => {
    // Both are signed by the same HMAC helper with the same secret; only the
    // signed token differs. Without the token check this would pass.
    const customer = await signCustomerId('some-customer-id', SECRET)
    expect(await verifyPreviewGrant(customer, SECRET)).toBe(false)
  })
})

describe('verifyPreviewKey', () => {
  const SECRET = 'preview-secret-value'

  it('accepts the correct key', async () => {
    expect(await verifyPreviewKey(SECRET, SECRET)).toBe(true)
  })

  it('rejects a wrong key', async () => {
    expect(await verifyPreviewKey('wrong', SECRET)).toBe(false)
    expect(await verifyPreviewKey(`${SECRET}x`, SECRET)).toBe(false)
  })

  it('rejects empty or missing input on either side', async () => {
    expect(await verifyPreviewKey('', SECRET)).toBe(false)
    expect(await verifyPreviewKey(null, SECRET)).toBe(false)
    expect(await verifyPreviewKey(SECRET, '')).toBe(false)
    expect(await verifyPreviewKey(SECRET, undefined)).toBe(false)
  })
})

describe('previewCookieHeader', () => {
  it('carries the domain so one cookie spans every PR alias', () => {
    const header = previewCookieHeader('barista.sig', 'connickshields.workers.dev')
    expect(header).toContain('cafecito_preview=barista.sig')
    expect(header).toContain('Domain=connickshields.workers.dev')
    expect(header).toContain('HttpOnly')
    expect(header).toContain('Secure')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Path=/')
  })

  it('omits Domain when there is none to set', () => {
    expect(previewCookieHeader('barista.sig', null)).not.toContain('Domain=')
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run test:unit -- tests/auth.test.js`
Expected: FAIL — `signPreviewGrant is not a function` and friends.

- [ ] **Step 3: Write the implementation**

Append to `worker/auth.js`, after `customerCookieHeader`:

```js
export const PREVIEW_COOKIE = 'cafecito_preview'
const PREVIEW_TOKEN = 'barista'
const PREVIEW_COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

export async function signPreviewGrant(secret) {
  return signCustomerId(PREVIEW_TOKEN, secret)
}

// A cookie is a grant only when it carries PREVIEW_TOKEN under this secret --
// a customer cookie is signed by the same helper and would otherwise verify.
export async function verifyPreviewGrant(value, secret) {
  if (!value || !secret) return false
  return (await verifyCustomerCookie(value, secret)) === PREVIEW_TOKEN
}

// Validates a presented key without ever comparing the secret as a string:
// sign a fixed token with the PRESENTED key, then verify that signature with
// the REAL key. They agree only when the keys match, and crypto.subtle.verify
// is constant-time (see verifyCustomerCookie).
export async function verifyPreviewKey(presented, secret) {
  if (!presented || !secret) return false
  const candidate = await signCustomerId(PREVIEW_TOKEN, presented)
  return (await verifyCustomerCookie(candidate, secret)) === PREVIEW_TOKEN
}

export function previewCookieHeader(signed, domain) {
  const parts = [
    `${PREVIEW_COOKIE}=${signed}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${PREVIEW_COOKIE_MAX_AGE}`,
  ]
  if (domain) parts.push(`Domain=${domain}`)
  return parts.join('; ')
}
```

- [ ] **Step 4: Run and watch pass**

Run: `npm test`
Expected: PASS — 81 node (71 + 10 new), 114 worker.

- [ ] **Step 5: Commit**

```bash
git add worker/auth.js tests/auth.test.js
git commit -m "feat: add preview grant signing and key validation"
```

---

### Task 3: The `requireBarista` branches

**Files:**
- Modify: `worker/routes/barista.js` (the `requireBarista` function and its imports)
- Test: `tests/worker/preview-auth.test.js` (create)

**Interfaces:**
- Consumes: `deploymentKind` (Task 1); `PREVIEW_COOKIE`, `signPreviewGrant`, `verifyPreviewGrant` (Task 2); the existing `readCookie` in `worker/auth.js`.
- Produces: no signature change. `requireBarista(request, env)` still returns `Promise<boolean>`.

- [ ] **Step 1: Write the failing tests**

Create `tests/worker/preview-auth.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { requireBarista } from '../../worker/routes/barista.js'
import { signPreviewGrant } from '../../worker/auth.js'

const PREVIEW = 'https://pr-1-cafecito-preview.connickshields.workers.dev'
const PRODUCTION = 'https://cafecito.connick.me'
const LOCAL = 'http://localhost:8787'

const KEY = 'test-preview-key'
const previewEnv = { PREVIEW_BARISTA_KEY: KEY }

function request(origin, cookie) {
  return new Request(`${origin}/api/barista/orders`, {
    headers: cookie ? { Cookie: cookie } : {},
  })
}

const grantCookie = async (secret) => `cafecito_preview=${await signPreviewGrant(secret)}`

describe('requireBarista on local and preview deployments', () => {
  it('allows localhost with no credential at all', async () => {
    expect(await requireBarista(request(LOCAL, null), {})).toBe(true)
    expect(await requireBarista(request('http://127.0.0.1:8787', null), {})).toBe(true)
  })

  it('allows a preview host carrying a valid grant', async () => {
    expect(await requireBarista(request(PREVIEW, await grantCookie(KEY)), previewEnv)).toBe(true)
  })

  it('refuses a preview host with no cookie', async () => {
    expect(await requireBarista(request(PREVIEW, null), previewEnv)).toBe(false)
  })

  it('refuses a preview host with a grant signed by the wrong key', async () => {
    const forged = await grantCookie('not-the-key')
    expect(await requireBarista(request(PREVIEW, forged), previewEnv)).toBe(false)
  })

  it('refuses a preview host when the Worker has no key configured', async () => {
    expect(await requireBarista(request(PREVIEW, await grantCookie(KEY)), {})).toBe(false)
  })
})

// The cases that actually protect production. Each asserts that a credential
// which genuinely works on preview is worthless anywhere else.
describe('a preview grant is refused off preview', () => {
  it('refuses a VALID preview grant on the production hostname', async () => {
    expect(await requireBarista(request(PRODUCTION, await grantCookie(KEY)), previewEnv)).toBe(false)
  })

  it('refuses a valid preview grant on a domain that merely contains workers.dev', async () => {
    const cookie = await grantCookie(KEY)
    expect(await requireBarista(request('https://workers.dev.evil.com', cookie), previewEnv)).toBe(
      false
    )
  })

  it('still refuses production requests that carry no Access token', async () => {
    expect(await requireBarista(request(PRODUCTION, null), previewEnv)).toBe(false)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npm run test:worker -- tests/worker/preview-auth.test.js`
Expected: FAIL — the localhost and preview cases return `false`, because `requireBarista` currently only accepts an Access JWT.

- [ ] **Step 3: Write the implementation**

In `worker/routes/barista.js`, extend the `../auth.js` import and add the `../deployment.js` import:

```js
import {
  fetchAccessJwks,
  PREVIEW_COOKIE,
  readCookie,
  verifyAccessJwt,
  verifyPreviewGrant,
} from '../auth.js'
import { deploymentKind } from '../deployment.js'
```

Then replace `requireBarista` with:

```js
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
```

- [ ] **Step 4: Run and watch pass**

Run: `npm test`
Expected: PASS — 81 node, 122 worker (114 + 8 new). `tests/worker/authorization.test.js` and `tests/worker/barista-routes.test.js` must both still pass: they exercise `https://cafecito.test`, which classifies as production, so the Access path is unchanged for them.

- [ ] **Step 5: Commit**

```bash
git add worker/routes/barista.js tests/worker/preview-auth.test.js
git commit -m "feat: accept a preview grant on preview hosts and nothing on localhost"
```

---

### Task 4: The `?preview_key=` exchange

**Files:**
- Modify: `worker/index.js` (add the exchange and call it from `fetch`)
- Modify: `vitest.worker.config.js` (bind `PREVIEW_BARISTA_KEY`)
- Test: `tests/worker/preview-auth.test.js` (append)

**Interfaces:**
- Consumes: `deploymentKind`, `previewCookieDomain` (Task 1); `previewCookieHeader`, `signPreviewGrant`, `verifyPreviewKey` (Task 2).
- Produces: `handlePreviewKeyExchange(request, env, url)` exported from `worker/index.js`, returning a `Response`. Exported so the unconfigured-secret case can be tested without a second Worker environment.

- [ ] **Step 1: Bind the key in the worker test environment**

In `vitest.worker.config.js`, add `PREVIEW_BARISTA_KEY` alongside the existing `COOKIE_SECRET` binding:

```js
          bindings: {
            TEST_MIGRATIONS: migrations,
            COOKIE_SECRET: 'test-cookie-secret',
            PREVIEW_BARISTA_KEY: 'test-preview-key',
          },
```

- [ ] **Step 2: Write the failing tests**

Append to `tests/worker/preview-auth.test.js`. That file has no `cloudflare:test` import yet, so **add** `import { SELF, env } from 'cloudflare:test'` at the top, plus `handlePreviewKeyExchange` from `../../worker/index.js`. The `KEY`, `PREVIEW`, `PRODUCTION`, and `request` bindings already exist at file scope from Task 3 — reuse them, do not redeclare:

```js
describe('the preview key exchange', () => {
  const url = (origin, query) => `${origin}/barista${query}`

  it('exchanges a correct key for a cookie and strips the key from the URL', async () => {
    const response = await SELF.fetch(url(PREVIEW, `?preview_key=${encodeURIComponent(KEY)}`), {
      redirect: 'manual',
    })

    expect(response.status).toBe(302)
    // The key must not survive into the address bar, history, or a pasted link.
    expect(response.headers.get('Location')).toBe('/barista')

    const setCookie = response.headers.get('Set-Cookie')
    expect(setCookie).toContain('cafecito_preview=')
    expect(setCookie).toContain('Domain=connickshields.workers.dev')
    expect(setCookie).toContain('HttpOnly')
  })

  it('keeps other query parameters when stripping the key', async () => {
    const response = await SELF.fetch(
      url(PREVIEW, `?a=1&preview_key=${encodeURIComponent(KEY)}&b=2`),
      { redirect: 'manual' }
    )
    expect(response.headers.get('Location')).toBe('/barista?a=1&b=2')
  })

  it('mints a cookie that requireBarista then accepts', async () => {
    const response = await SELF.fetch(url(PREVIEW, `?preview_key=${encodeURIComponent(KEY)}`), {
      redirect: 'manual',
    })
    const cookie = response.headers.get('Set-Cookie').split(';')[0]

    expect(await requireBarista(request(PREVIEW, cookie), env)).toBe(true)
  })

  it('refuses a wrong key without minting a cookie', async () => {
    const response = await SELF.fetch(url(PREVIEW, '?preview_key=wrong'), { redirect: 'manual' })
    expect(response.status).toBe(403)
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })

  it('ignores preview_key entirely on the production hostname', async () => {
    const response = await SELF.fetch(
      url(PRODUCTION, `?preview_key=${encodeURIComponent(KEY)}`),
      { redirect: 'manual' }
    )
    expect(response.status).not.toBe(302)
    expect(response.headers.get('Set-Cookie') ?? '').not.toContain('cafecito_preview')
  })

  it('fails loudly when the Worker has no key configured', async () => {
    const target = new URL(url(PREVIEW, `?preview_key=${encodeURIComponent(KEY)}`))
    const response = await handlePreviewKeyExchange(new Request(target), {}, target)

    expect(response.status).toBe(500)
    expect((await response.json()).error).toContain('PREVIEW_BARISTA_KEY')
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })
})
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npm run test:worker -- tests/worker/preview-auth.test.js`
Expected: FAIL — `handlePreviewKeyExchange` is not exported, and the preview request returns the SPA rather than a 302.

- [ ] **Step 4: Write the implementation**

In `worker/index.js`, add these imports:

```js
import { deploymentKind, previewCookieDomain } from './deployment.js'
import {
  previewCookieHeader,
  signPreviewGrant,
  verifyPreviewKey,
} from './auth.js'
```

(merge the three `auth.js` names into the existing `./auth.js` import rather than adding a second statement)

Add the handler above `export default`:

```js
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
```

Then change the `fetch` handler so the exchange runs before any routing — the key arrives on a page URL such as `/barista?preview_key=…`, not on an `/api/` call:

```js
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
```

- [ ] **Step 5: Run and watch pass**

Run: `npm test`
Expected: PASS — 81 node, 128 worker (122 + 6 new).

- [ ] **Step 6: Confirm the deploy config still validates**

Run: `wrangler deploy --env "" --dry-run`
Expected: succeeds. Then `wrangler deploy --env preview --dry-run`, which must also succeed.

- [ ] **Step 7: Commit**

```bash
git add worker/index.js vitest.worker.config.js tests/worker/preview-auth.test.js
git commit -m "feat: exchange a preview key for a signed cookie"
```

---

### Task 5: Documentation

**Files:**
- Modify: `README.md` (inside the existing "PR previews" section)
- Modify: `docs/superpowers/specs/2026-08-10-preview-barista-auth-design.md` (one correction)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Correct the spec's claim about sign-out**

§6 of the spec says sign-out on a preview 404s. That is wrong: `wrangler.toml` sets `not_found_handling = "single-page-application"`, so an unknown path returns `index.html` with a 200 and the app simply reloads. Reword that section to say so, keeping the ruling that clearing the cookie instead is out of scope.

- [ ] **Step 2: Replace the "What they do not cover" paragraph in README.md**

The existing paragraph says barista data is not covered because `/api/barista/*` returns 403 on preview hostnames. Replace it with:

```markdown
**What they do not cover:** anything Access-specific, such as the login
redirect, and custom-domain behavior.

**Reaching the barista view on a preview.** Cloudflare Access covers
`cafecito.connick.me` only, so previews have no Access in front of them and
`/api/barista/*` would otherwise always 403. A preview-only credential fills
that gap.

One-time setup:

    openssl rand -base64 32 | wrangler secret put PREVIEW_BARISTA_KEY --env preview

Then open any preview with the key appended once per browser:

    https://pr-<number>-cafecito-preview.<subdomain>.workers.dev/barista?preview_key=<key>

The Worker verifies the key, sets a signed cookie, and redirects to the same
URL without the key, so it does not linger in the address bar or in history.
The cookie is scoped to `<subdomain>.workers.dev`, so it covers every later PR
preview too. Keep the key in a password manager; rotating it is another
`wrangler secret put`, which invalidates every outstanding cookie.

**This cannot open production.** Four independent things would all have to be
wrong: production would need a `.workers.dev` hostname (it sets
`workers_dev = false`), `PREVIEW_BARISTA_KEY` would have to be set on the
production Worker (it is set with `--env preview`), someone would need the
256-bit key, and `deploymentKind` in `worker/deployment.js` would have to
misclassify — it answers `production` for every hostname it does not
recognise. `tests/worker/preview-auth.test.js` pins the negative cases.

**`wrangler dev` needs no key.** A deployed Worker never sees a `localhost`
hostname, so the barista view is simply open locally, against your local
database.

Sign-out on a preview navigates to `/cdn-cgi/access/logout`, which does not
exist there; the SPA fallback serves the app again rather than erroring.
```

- [ ] **Step 3: Verify**

Run: `npm test`
Expected: PASS — 81 node, 128 worker. No code changed, so both counts are unchanged from Task 4.

Check that the README renders sanely: the new headings sit inside the existing `### PR previews` section, code blocks are indented consistently with their neighbours, and no bold or inline-code span is left unclosed.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-08-10-preview-barista-auth-design.md
git commit -m "docs: document the preview barista credential"
```

---

## Verification Checklist

Run after the final task:

- [ ] `npm test` — zero failures; 81 node and 128 worker tests
- [ ] `npm run build` — succeeds
- [ ] `wrangler deploy --env "" --dry-run` and `wrangler deploy --env preview --dry-run` — both succeed
- [ ] `grep -n "workers_dev" wrangler.toml` shows `false` at the top level and `true` only under `[env.preview]`
- [ ] `grep -rn "PREVIEW_BARISTA_KEY" wrangler.toml .github/` returns nothing — the secret is set out of band and CI never needs it
- [ ] `git diff --stat main -- tests/analytics.test.js tests/worker/authorization.test.js` is empty
- [ ] `git diff --stat main -- src/` is empty — this feature changes no frontend file
