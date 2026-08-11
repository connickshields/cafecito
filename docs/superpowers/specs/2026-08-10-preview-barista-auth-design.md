# Preview Barista Access Design

**Date:** 2026-08-10
**Status:** Approved

## Problem

Cloudflare Access covers `cafecito.connick.me` only. Every preview deployment
lives on a `*.workers.dev` hostname no Access application fronts, so
`requireBarista` finds no `Cf-Access-Jwt-Assertion` header and returns false:
every `/api/barista/*` call on a preview returns 403.

The visible symptom is the barista view rendering its "Can't reach the server"
banner. The real cost is that **the barista half of the app cannot be exercised
before it reaches production** — the menu manager shipped having been verified
only by compilation and code review, because no preview could load it.

`wrangler dev` has the same problem for the same reason, so the barista view
has never been runnable locally either.

## Goals

- Reach the barista view on preview deployments and on `wrangler dev`
- Leave the production authorization boundary exactly as strong as it is now
- Make a production bypass impossible by construction, not by convention

## Non-goals

Multi-user preview accounts, audit logging, rate limiting, and preview sign-out.
The preview Worker is bound to a throwaway database (`cafecito-preview`) holding
fake orders and a test menu — the credential protects against nuisance and quota
burn, not against disclosure of anything sensitive.

---

## 1. Authorization model

`worker/index.js` keeps its mount-point gate, and `requireBarista` keeps being
the single function that answers "is this request allowed". It gains two
branches, selected by deployment kind:

| Deployment | Requirement |
|---|---|
| `production` | A valid Cloudflare Access JWT — unchanged, and the only accepted path |
| `preview` | A valid signed preview cookie |
| `local` | Nothing |

No caller gains an exception and no route implements its own check. The
signature stays `requireBarista(request, env)`; the hostname comes from
`new URL(request.url)`.

## 2. Deployment classification

**`worker/deployment.js`**, a new module exporting one pure function:

```js
export function deploymentKind(hostname) // 'local' | 'preview' | 'production'
```

- `localhost`, `127.0.0.1`, `[::1]` → `local`
- ends with `.workers.dev` → `preview`
- anything else → `production`

**Production is the default, not a case.** An unrecognised hostname gets the
strictest rule, so a hostname nobody anticipated can never fall into a weaker
branch. Being pure, it gets a fast node test rather than an integration test.

A second export derives the cookie domain:

```js
export function previewCookieDomain(hostname) // 'connickshields.workers.dev'
```

It returns the last three labels of a `*.workers.dev` hostname, and `null` for
anything else.

## 3. The preview credential

One-time setup, out of band:

```
openssl rand -base64 32 | wrangler secret put PREVIEW_BARISTA_KEY --env preview
```

The secret exists only on the preview Worker. It is absent from the repository,
from `wrangler.toml`, and from CI — the preview job never needs it.

### 3.1 Exchange

Handled at the top of the `fetch` handler, before any routing, and only when
`deploymentKind` is `preview`:

1. If the request has no `preview_key` query parameter, continue normally.
2. If `env.PREVIEW_BARISTA_KEY` is unset, respond `500` with
   `{ "error": "PREVIEW_BARISTA_KEY is not configured" }`. Failing loudly
   matches how `withCustomer` already treats a missing `COOKIE_SECRET`; a
   silent no-op would present as an inexplicable 403 later.
3. Validate the presented key (§3.2). On failure respond `403`.
4. On success respond `302` to the same URL with `preview_key` removed,
   carrying the `Set-Cookie`.

Stripping the parameter keeps the key out of the address bar, browser history,
and any URL later pasted into an issue or chat.

### 3.2 Validating the key without comparing secrets

`worker/auth.js` already signs and verifies HMAC-SHA256 cookie values, and
`verifyCustomerCookie` notes that `crypto.subtle.verify` is constant-time.
That yields a validation with no string comparison of the secret at all —
sign a fixed token with the *presented* key, then verify it with the *real*
key:

```js
export async function verifyPreviewKey(presented, secret) {
  if (!presented || !secret) return false
  const candidate = await signCustomerId(PREVIEW_TOKEN, presented)
  return (await verifyCustomerCookie(candidate, secret)) === PREVIEW_TOKEN
}
```

The two agree only when the keys match, the comparison is constant-time, and
no new cryptographic code is introduced. Keeping this inside `auth.js` lets
`PREVIEW_TOKEN` stay private to that module — `worker/index.js` calls
`verifyPreviewKey` and never handles the token itself.

### 3.3 The cookie

`worker/auth.js` gains five exports beside the existing customer helpers, with
`PREVIEW_TOKEN` staying private:

```js
export const PREVIEW_COOKIE = 'cafecito_preview'
const PREVIEW_TOKEN = 'barista'                          // not exported
export async function signPreviewGrant(secret)           // -> 'barista.<sig>'
export async function verifyPreviewGrant(value, secret)  // -> boolean
export async function verifyPreviewKey(presented, secret)// -> boolean (§3.2)
export function previewCookieHeader(signed, domain)
```

All three async helpers delegate to `signCustomerId` and
`verifyCustomerCookie` rather than reimplementing HMAC.

Attributes: `Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000` (30 days),
plus `Domain=<previewCookieDomain(hostname)>`.

**The domain scope is deliberate.** Each PR preview gets its own hostname, so a
host-scoped cookie would demand a fresh key paste per PR. `workers.dev` is on
the public suffix list, making `<account>.workers.dev` the registrable domain
and a legal cookie scope. The cost: the cookie is also sent to any other Worker
on that account's `workers.dev` subdomain, where nothing verifies that
signature and it is ignored.

## 4. What cannot happen on production

Four independent conditions would all have to fail together:

1. Production would need a `.workers.dev` hostname. It sets `workers_dev = false`
   and serves only the `cafecito.connick.me` custom domain.
2. `PREVIEW_BARISTA_KEY` would have to be set on the production Worker. Secrets
   are per-Worker and it is set only with `--env preview`.
3. An attacker would need the 256-bit key.
4. `deploymentKind` would have to misclassify a production hostname, which its
   production-by-default rule prevents.

## 5. Testing

`tests/worker/authorization.test.js` and `tests/analytics.test.js` are not
modified. New coverage lives in two new files.

**`tests/deployment.test.js`** (node) — `deploymentKind` for localhost,
`127.0.0.1`, `[::1]`, a preview host, the production host, a bare unknown host,
and a hostname merely *containing* `workers.dev` without ending in it
(`workers.dev.evil.com` must classify as production). `previewCookieDomain` for
a preview host and its `null` for everything else.

**`tests/worker/preview-auth.test.js`** (workers pool) — the negative cases
carry the weight:

- production hostname + a *valid* preview cookie → 403
- production hostname + a *correct* `?preview_key=` → no cookie minted, 403
- preview hostname + no cookie → 403
- preview hostname + a forged or truncated cookie → 403
- preview hostname + `PREVIEW_BARISTA_KEY` unset → 500, and no cookie mintable
- a hostname ending in `workers.dev.evil.com` → treated as production → 403

and the positive ones: preview + valid cookie → allowed; localhost + nothing →
allowed; a correct key → 302 whose `Location` no longer carries `preview_key`
and whose `Set-Cookie` carries the expected `Domain`.

The workers pool serves `SELF.fetch` from a production-shaped origin, so
preview and localhost cases call `requireBarista` and the exchange directly
with a constructed `Request`, as `barista-routes.test.js` already does for
`handleBarista`.

## 6. Out of scope, accepted

Sign-out on a preview navigates to `/cdn-cgi/access/logout`, which does not
exist there, so it 404s. Clearing the preview cookie instead is scope creep for
a button nobody presses while testing.

## 7. Unchanged

`src/lib/api.js` already sends `credentials: 'same-origin'`, so **no frontend
file changes**. CI is untouched. `wrangler.toml` is untouched — the secret is
set out of band and `.dev.vars` is unnecessary because localhost needs no key.
