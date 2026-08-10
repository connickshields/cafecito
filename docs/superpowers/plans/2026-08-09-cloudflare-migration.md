# Cloudflare Backend Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Cafecito's Supabase backend with a Cloudflare Worker serving both the SPA and a D1-backed API, with Cloudflare Access for baristas and a signed cookie for customers, deployed by GitHub Actions on merge to `main`.

**Architecture:** One Worker (`worker/index.js`) serves static assets from `dist/` and handles `/api/*`. Customer requests carry a signed `HttpOnly` cookie minted by the Worker; barista requests under `/api/barista/*` are gated on a Cloudflare Access JWT. All data lives in D1, created by a single baseline migration. The Svelte client keeps its polling loops and its existing function names — `src/lib/supabase.js` is swapped for `src/lib/api.js`.

**Tech Stack:** Cloudflare Workers, D1 (SQLite), Cloudflare Access, Wrangler, Vitest, `@cloudflare/vitest-pool-workers`, Svelte 4, Vite 5.

**Spec:** `docs/superpowers/specs/2026-08-09-cloudflare-migration-design.md`

> **CORRECTION applied during execution (commit `e334268`).** Tasks 4, 9, 10 and
> 12 as originally written gated unavailable menu rows behind an Access-only
> `/api/barista/menu` route. That was wrong: `Menu.svelte:40` is customer-facing
> and calls `getMilkOptions(true)` to grey out sold-out milks, and `rls.sql`
> granted menu SELECT to every session, so nothing was ever confidential.
> The landed design: `getMenu(db)` takes no filter argument and returns all rows;
> `/api/menu` is the only menu endpoint and needs no Access; `/api/barista/menu`
> does not exist; `api.js` applies `includeUnavailable` as a client-side filter
> over one coalesced response. Follow the landed design, not the code blocks in
> Tasks 4, 9, 10 and 12 below, wherever they disagree.

## Global Constraints

- **Timestamps are always `strftime('%Y-%m-%dT%H:%M:%SZ','now')`**, never `datetime('now')`. Every timestamp column default and every trigger uses this exact expression. Safari misparses the space-separated form.
- **`tests/analytics.test.js` must stay green without any modification.** It is the acceptance check on the timestamp format.
- **Booleans are `INTEGER NOT NULL CHECK (x IN (0,1))`.** The client expects JS booleans, so `db.js` converts on read.
- **`customer_id` is only ever read from the signed cookie**, never from a request body or query string.
- **Migrations are forward-only and must be backward-compatible with the previous deploy.** Add columns; never rename or drop in the same migration that ships code depending on the change.
- **Only one baseline migration exists:** `migrations/0001_init.sql`. Incremental migrations start at `0002`.
- Node 18+ (global `crypto.subtle`, `crypto.randomUUID`).
- Existing test conventions: Vitest, `import { describe, expect, it } from 'vitest'`, files under `tests/`.

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `wrangler.toml` | Worker name, assets binding, D1 binding, vars |
| `migrations/0001_init.sql` | Schema, indexes, triggers, menu seed |
| `worker/index.js` | Router + fetch handler; mounts middleware |
| `worker/auth.js` | Cookie sign/verify (HMAC), Access JWT verify |
| `worker/db.js` | All D1 queries + pure row-reshaping helpers |
| `worker/routes/menu.js` | `GET /api/menu` |
| `worker/routes/orders.js` | Customer order routes |
| `worker/routes/barista.js` | Barista routes |
| `src/lib/api.js` | Client API module replacing `supabase.js` |
| `vitest.worker.config.js` | Workers-pool config for integration tests |
| `tests/worker/setup.js` | Applies migrations to the test D1 |
| `tests/auth.test.js` | Cookie + JWT unit tests |
| `tests/db-shape.test.js` | Pure reshaping unit tests |
| `tests/worker/*.test.js` | Worker integration + authorization tests |
| `.github/workflows/deploy.yml` | CI and deploy |

**Modified:** `vite.config.js` (test include glob), `package.json` (scripts, deps), `src/App.svelte`, `src/lib/CustomerView.svelte`, `README.md`.

**Deleted:** `src/lib/supabase.js`, `src/lib/BaristaLogin.svelte`, `schema.sql`, `rls.sql`, `functions.sql`.

---

### Task 1: Scaffolding — Wrangler, D1, baseline migration

**Files:**
- Create: `wrangler.toml`, `migrations/0001_init.sql`, `vitest.worker.config.js`, `tests/worker/setup.js`, `tests/worker/migration.test.js`
- Modify: `package.json`, `vite.config.js`

**Interfaces:**
- Consumes: nothing
- Produces: D1 binding `env.DB`; tables `items`, `milk_options`, `customization_options`, `orders`, `order_items`, `order_item_customizations`; a `tests/worker/` harness where `env.DB` is migrated and `SELF.fetch()` hits the Worker.

- [ ] **Step 1: Install dependencies**

```bash
npm install --save-dev wrangler @cloudflare/vitest-pool-workers
npm uninstall @supabase/supabase-js
```

- [ ] **Step 2: Create the D1 database**

```bash
npx wrangler d1 create cafecito
```

Copy the printed `database_id` — it goes in `wrangler.toml` in the next step.

- [ ] **Step 3: Write `wrangler.toml`**

Replace `<database_id>` with the value from Step 2, and the two Access values with your own (see Task 3 for where to find them).

```toml
name = "cafecito"
main = "worker/index.js"
compatibility_date = "2026-08-01"

[assets]
directory = "./dist"
binding = "ASSETS"
not_found_handling = "single-page-application"

[[d1_databases]]
binding = "DB"
database_name = "cafecito"
database_id = "<database_id>"
migrations_dir = "migrations"

[vars]
ACCESS_TEAM_DOMAIN = "yourteam.cloudflareaccess.com"
ACCESS_AUD = "<access-application-aud-tag>"
```

`not_found_handling = "single-page-application"` is what makes `/barista` serve `index.html`. Requests that match no asset — everything under `/api/` — invoke the Worker.

`COOKIE_SECRET` is deliberately absent; it is a secret, set in Task 13.

- [ ] **Step 4: Write `migrations/0001_init.sql`**

```sql
-- Cafecito baseline schema for D1 (SQLite).
-- Ported from the Supabase schema.sql / rls.sql / functions.sql trio.
-- Timestamps are explicit ISO-8601 UTC so Safari's Date parser accepts them.

CREATE TABLE items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    size INTEGER DEFAULT NULL,
    available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
    allows_milk_choice INTEGER NOT NULL DEFAULT 1 CHECK (allows_milk_choice IN (0,1)),
    allows_customizations INTEGER NOT NULL DEFAULT 1 CHECK (allows_customizations IN (0,1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE milk_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE customization_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- customer_id is the value carried in the signed cookie. There is no users
-- table: identity is per-browser and disposable, exactly as anonymous
-- Supabase auth was.
-- submission_id is client-generated. It lets the order rows be inserted in a
-- single batch (children address the parent by token, not by unknown
-- autoincrement id) and makes retried submits idempotent.
CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    submission_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending','in_progress','completed','cancelled')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- id is a Worker-generated UUID so customization rows can reference it inside
-- the same batch. It is never exposed to the client.
CREATE TABLE order_items (
    id TEXT PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    item_id INTEGER NOT NULL REFERENCES items(id),
    milk_option_id INTEGER REFERENCES milk_options(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE order_item_customizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_item_id TEXT NOT NULL REFERENCES order_items(id),
    customization_option_id INTEGER NOT NULL REFERENCES customization_options(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

-- D1 bills by rows read; the 5s barista poll would otherwise full-scan.
CREATE INDEX idx_orders_status_created ON orders(status, created_at);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_oic_order_item ON order_item_customizations(order_item_id);

-- orders.updated_at is the completion timestamp the drain-rate calculation
-- depends on. Triggers make it impossible to forget in a code path.
-- SQLite's recursive_triggers defaults to off, so these do not re-fire.
CREATE TRIGGER items_updated_at AFTER UPDATE ON items
BEGIN
    UPDATE items SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER milk_options_updated_at AFTER UPDATE ON milk_options
BEGIN
    UPDATE milk_options SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER customization_options_updated_at AFTER UPDATE ON customization_options
BEGIN
    UPDATE customization_options SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER orders_updated_at AFTER UPDATE ON orders
BEGIN
    UPDATE orders SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = NEW.id;
END;

CREATE TRIGGER order_items_updated_at AFTER UPDATE ON order_items
BEGIN
    UPDATE order_items SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = NEW.id;
END;

-- Menu seed, carried over from schema.sql.
INSERT INTO items (name, description, available, allows_milk_choice, allows_customizations) VALUES
('Espresso', 'Double shot of espresso', 1, 0, 0),
('Americano', '(8oz) Double espresso with hot water', 1, 0, 0),
('Cortado', '(4oz) Double espresso with steamed milk', 1, 0, 0),
('Cappuccino', '(8oz) Double espresso with equal parts steamed milk and foam', 1, 1, 1),
('Flat White', '(8oz) Double espresso with steamed milk', 1, 1, 1),
('Latte', '(12oz) Double espresso with steamed milk', 1, 1, 1),
('Matcha Latte', '(12oz) Hand-whisked Japanese matcha with steamed milk', 1, 1, 0),
('Mocha', '(12oz) Espresso with steamed milk and chocolate', 0, 1, 1);

INSERT INTO milk_options (name, available) VALUES
('Whole', 1), ('Oat', 1), ('Almond', 1), ('Soy', 0);

INSERT INTO customization_options (name, type, available) VALUES
('Vanilla Syrup', 'syrup', 1),
('Caramel Syrup', 'syrup', 1),
('Hazelnut Syrup', 'syrup', 0),
('Whipped Cream', 'topping', 0),
('Cinnamon', 'topping', 0),
('Extra Shot', 'coffee', 0);
```

- [ ] **Step 5: Write `vitest.worker.config.js`**

```js
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config'

const migrations = await readD1Migrations('./migrations')

export default defineWorkersConfig({
  test: {
    include: ['tests/worker/**/*.test.js'],
    setupFiles: ['./tests/worker/setup.js'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.toml' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            COOKIE_SECRET: 'test-cookie-secret',
          },
        },
      },
    },
  },
})
```

- [ ] **Step 6: Write `tests/worker/setup.js`**

```js
import { applyD1Migrations, env } from 'cloudflare:test'

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
```

- [ ] **Step 7: Scope the node test glob so it does not swallow worker tests**

In `vite.config.js`, change the `include` line to match only the top level:

```js
  test: {
    environment: 'node',
    include: ['tests/*.test.js'],
  },
```

`tests/analytics.test.js` still matches. `tests/worker/**` no longer does.

- [ ] **Step 8: Add npm scripts**

In `package.json`, replace the `test` script and add two more:

```json
    "test": "npm run test:unit && npm run test:worker",
    "test:unit": "vitest run",
    "test:worker": "vitest run --config vitest.worker.config.js",
    "test:watch": "vitest"
```

- [ ] **Step 9: Write the failing migration test**

Create `tests/worker/migration.test.js`:

```js
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

describe('0001_init', () => {
  it('seeds the menu', async () => {
    const { results } = await env.DB.prepare(
      'SELECT name FROM items ORDER BY name'
    ).all()
    expect(results.map((r) => r.name)).toContain('Cortado')
    expect(results).toHaveLength(8)
  })

  it('seeds milk and customization options', async () => {
    const milk = await env.DB.prepare('SELECT COUNT(*) AS n FROM milk_options').first()
    const custom = await env.DB.prepare('SELECT COUNT(*) AS n FROM customization_options').first()
    expect(milk.n).toBe(4)
    expect(custom.n).toBe(6)
  })

  it('defaults timestamps to parseable ISO-8601 UTC', async () => {
    const row = await env.DB.prepare('SELECT created_at FROM items LIMIT 1').first()
    expect(row.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    expect(Number.isNaN(Date.parse(row.created_at))).toBe(false)
  })

  it('rejects an unknown order status', async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO orders (customer_id, customer_name, submission_id, status) VALUES ('c','n','s','bogus')"
      ).run()
    ).rejects.toThrow()
  })

  it('bumps updated_at on update', async () => {
    await env.DB.prepare('UPDATE items SET available = 0 WHERE name = ?').bind('Latte').run()
    const row = await env.DB.prepare('SELECT created_at, updated_at FROM items WHERE name = ?')
      .bind('Latte')
      .first()
    expect(Date.parse(row.updated_at)).toBeGreaterThanOrEqual(Date.parse(row.created_at))
  })
})
```

- [ ] **Step 10: Create a placeholder Worker so the pool can boot**

The workers pool needs `main` to resolve. Create `worker/index.js`:

```js
export default {
  async fetch() {
    return new Response('not implemented', { status: 501 })
  },
}
```

- [ ] **Step 11: Run the migration test**

Run: `npm run test:worker`
Expected: PASS — all five tests.

- [ ] **Step 12: Verify the existing suite is untouched**

Run: `npm run test:unit`
Expected: PASS — `tests/analytics.test.js` green with no edits.

- [ ] **Step 13: Commit**

```bash
git add wrangler.toml migrations vitest.worker.config.js tests/worker worker package.json package-lock.json vite.config.js
git commit -m "feat: add D1 baseline migration and worker test harness"
```

---

### Task 2: Signed customer cookie

**Files:**
- Create: `worker/auth.js`, `tests/auth.test.js`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `signCustomerId(customerId: string, secret: string): Promise<string>` → `"<id>.<base64url-sig>"`
  - `verifyCustomerCookie(value: string|null, secret: string): Promise<string|null>` → customer id, or `null` if absent/malformed/tampered
  - `readCookie(request: Request, name: string): string|null`
  - `customerCookieHeader(signed: string): string` → a `Set-Cookie` value
  - `CUSTOMER_COOKIE = 'cafecito_cid'`

- [ ] **Step 1: Write the failing test**

Create `tests/auth.test.js`:

```js
import { describe, expect, it } from 'vitest'
import {
  CUSTOMER_COOKIE,
  customerCookieHeader,
  readCookie,
  signCustomerId,
  verifyCustomerCookie,
} from '../worker/auth.js'

const SECRET = 'test-secret'

describe('customer cookie', () => {
  it('round-trips a signed customer id', async () => {
    const signed = await signCustomerId('abc-123', SECRET)
    expect(await verifyCustomerCookie(signed, SECRET)).toBe('abc-123')
  })

  it('rejects a tampered id', async () => {
    const signed = await signCustomerId('abc-123', SECRET)
    const tampered = signed.replace('abc-123', 'abc-124')
    expect(await verifyCustomerCookie(tampered, SECRET)).toBeNull()
  })

  it('rejects a tampered signature', async () => {
    const signed = await signCustomerId('abc-123', SECRET)
    expect(await verifyCustomerCookie(`${signed}x`, SECRET)).toBeNull()
  })

  it('rejects a signature made with a different secret', async () => {
    const signed = await signCustomerId('abc-123', 'other-secret')
    expect(await verifyCustomerCookie(signed, SECRET)).toBeNull()
  })

  it('rejects null, empty, and unsigned values', async () => {
    expect(await verifyCustomerCookie(null, SECRET)).toBeNull()
    expect(await verifyCustomerCookie('', SECRET)).toBeNull()
    expect(await verifyCustomerCookie('abc-123', SECRET)).toBeNull()
  })

  it('emits a hardened Set-Cookie header', async () => {
    const header = customerCookieHeader(await signCustomerId('abc-123', SECRET))
    expect(header).toContain(`${CUSTOMER_COOKIE}=`)
    expect(header).toContain('HttpOnly')
    expect(header).toContain('Secure')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Path=/')
  })
})

describe('readCookie', () => {
  it('extracts one cookie from a multi-cookie header', () => {
    const request = new Request('https://example.com', {
      headers: { Cookie: 'other=1; cafecito_cid=xyz; third=3' },
    })
    expect(readCookie(request, CUSTOMER_COOKIE)).toBe('xyz')
  })

  it('returns null when the cookie is absent', () => {
    const request = new Request('https://example.com', { headers: { Cookie: 'other=1' } })
    expect(readCookie(request, CUSTOMER_COOKIE)).toBeNull()
  })

  it('returns null when there is no Cookie header at all', () => {
    expect(readCookie(new Request('https://example.com'), CUSTOMER_COOKIE)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot resolve `../worker/auth.js`.

- [ ] **Step 3: Write `worker/auth.js`**

```js
const encoder = new TextEncoder()

export const CUSTOMER_COOKIE = 'cafecito_cid'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 180 // 180 days

function base64url(bytes) {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

export async function signCustomerId(customerId, secret) {
  const key = await hmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(customerId))
  return `${customerId}.${base64url(signature)}`
}

// Returns the customer id, or null for anything we did not sign.
export async function verifyCustomerCookie(value, secret) {
  if (!value) return null
  const separator = value.lastIndexOf('.')
  if (separator <= 0) return null

  const customerId = value.slice(0, separator)
  const signature = value.slice(separator + 1)
  if (!customerId || !signature) return null

  let signatureBytes
  try {
    signatureBytes = fromBase64url(signature)
  } catch {
    return null
  }

  const key = await hmacKey(secret)
  // crypto.subtle.verify is constant-time.
  const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(customerId))
  return valid ? customerId : null
}

export function customerCookieHeader(signed) {
  return [
    `${CUSTOMER_COOKIE}=${signed}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE}`,
  ].join('; ')
}

export function readCookie(request, name) {
  const header = request.headers.get('Cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=') || null
  }
  return null
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/auth.js tests/auth.test.js
git commit -m "feat: add signed customer cookie helpers"
```

---

### Task 3: Cloudflare Access JWT verification

**Files:**
- Modify: `worker/auth.js`, `tests/auth.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `verifyAccessJwt(token: string|null, jwks: {keys: object[]}, aud: string, now?: number): Promise<object|null>` → decoded payload, or `null`
  - `fetchAccessJwks(teamDomain: string): Promise<{keys: object[]}>` (module-level cached)

**Manual prerequisite (do this before Step 1):** in the Cloudflare Zero Trust dashboard, create a self-hosted Access application covering `<your-domain>/barista*` and a second covering `<your-domain>/api/barista/*`, each with a policy allowing your barista emails. Copy the **Application Audience (AUD) tag** into `ACCESS_AUD` in `wrangler.toml`, and your team domain into `ACCESS_TEAM_DOMAIN`.

- [ ] **Step 1: Write the failing test**

Append to `tests/auth.test.js`:

```js
import { verifyAccessJwt } from '../worker/auth.js'

const AUD = 'test-aud-tag'

// Builds a real RS256 JWT plus the JWKS that validates it.
async function makeAccessToken(overrides = {}) {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  const jwk = await crypto.subtle.exportKey('jwk', publicKey)
  const kid = 'test-kid'

  const header = { alg: 'RS256', kid, typ: 'JWT' }
  const payload = {
    aud: [AUD],
    email: 'barista@example.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  }

  const enc = (obj) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const signingInput = `${enc(header)}.${enc(payload)}`
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(signingInput)
  )
  let binary = ''
  for (const b of new Uint8Array(sig)) binary += String.fromCharCode(b)
  const encodedSig = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  return {
    token: `${signingInput}.${encodedSig}`,
    jwks: { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] },
  }
}

describe('verifyAccessJwt', () => {
  it('accepts a correctly signed, unexpired token for the right audience', async () => {
    const { token, jwks } = await makeAccessToken()
    const payload = await verifyAccessJwt(token, jwks, AUD)
    expect(payload.email).toBe('barista@example.com')
  })

  it('rejects a token for a different audience', async () => {
    const { token, jwks } = await makeAccessToken({ aud: ['someone-elses-app'] })
    expect(await verifyAccessJwt(token, jwks, AUD)).toBeNull()
  })

  it('rejects an expired token', async () => {
    const { token, jwks } = await makeAccessToken({ exp: Math.floor(Date.now() / 1000) - 10 })
    expect(await verifyAccessJwt(token, jwks, AUD)).toBeNull()
  })

  it('rejects a token whose signature does not match the JWKS', async () => {
    const { token } = await makeAccessToken()
    const { jwks: otherJwks } = await makeAccessToken()
    expect(await verifyAccessJwt(token, otherJwks, AUD)).toBeNull()
  })

  it('rejects a token whose kid is not in the JWKS', async () => {
    const { token, jwks } = await makeAccessToken()
    const wrongKid = { keys: [{ ...jwks.keys[0], kid: 'different-kid' }] }
    expect(await verifyAccessJwt(token, wrongKid, AUD)).toBeNull()
  })

  // Also required (added in fix round 1, see commit bbb17f5 for the landed
  // version): tokens whose header or payload segment is base64url("null"),
  // each asserting verifyAccessJwt RESOLVES to null rather than rejecting —
  // assert on the resolved value, since merely awaiting passes either way.
  //
  // And a genuine algorithm-confusion test: header alg "HS256" carrying a
  // VALID HMAC signature computed over the signing input using the RSA public
  // key's own modulus bytes as the HMAC secret. The signature must actually be
  // valid under the attacker's chosen algorithm — the test below is NOT that
  // test, because its empty signature would be rejected even with the alg
  // check deleted.
  it('rejects null, garbage, and alg-none tokens', async () => {
    const { jwks } = await makeAccessToken()
    expect(await verifyAccessJwt(null, jwks, AUD)).toBeNull()
    expect(await verifyAccessJwt('not.a.jwt', jwks, AUD)).toBeNull()

    const noneHeader = btoa(JSON.stringify({ alg: 'none', kid: 'test-kid' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const body = btoa(JSON.stringify({ aud: [AUD], exp: Math.floor(Date.now() / 1000) + 60 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(await verifyAccessJwt(`${noneHeader}.${body}.`, jwks, AUD)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `verifyAccessJwt` is not exported.

- [ ] **Step 3: Append the implementation to `worker/auth.js`**

```js
function decodeSegment(segment) {
  const json = new TextDecoder().decode(fromBase64url(segment))
  return JSON.parse(json)
}

// Verifies a Cf-Access-Jwt-Assertion. Returns the payload or null.
// jwks is injected so this is unit-testable without network access.
export async function verifyAccessJwt(token, jwks, aud, now = Date.now()) {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null

  let header
  let payload
  try {
    header = decodeSegment(parts[0])
    payload = decodeSegment(parts[1])
  } catch {
    return null
  }

  // JSON.parse SUCCEEDS on the literal `null`, so a segment of
  // base64url("null") slips past the try/catch and then throws a TypeError on
  // the first property access. Note typeof null === 'object', so the explicit
  // null comparison is required, not redundant.
  if (typeof header !== 'object' || header === null) return null
  if (typeof payload !== 'object' || payload === null) return null

  // Only RS256 is ever accepted — never trust the token's own alg claim to
  // select a weaker algorithm, and never accept "none".
  if (header.alg !== 'RS256' || !header.kid) return null

  const jwk = jwks?.keys?.find((k) => k.kid === header.kid)
  if (!jwk) return null

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!audiences.includes(aud)) return null
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) return null

  let key
  try {
    key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    )
  } catch {
    return null
  }

  let signature
  try {
    signature = fromBase64url(parts[2])
  } catch {
    return null
  }

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    signature,
    encoder.encode(`${parts[0]}.${parts[1]}`)
  )
  return valid ? payload : null
}

let jwksCache = { domain: null, keys: null, fetchedAt: 0 }
const JWKS_TTL_MS = 60 * 60 * 1000

export async function fetchAccessJwks(teamDomain) {
  const fresh = jwksCache.domain === teamDomain && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS
  if (fresh) return jwksCache.keys

  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`)
  if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status}`)
  const keys = await response.json()
  jwksCache = { domain: teamDomain, keys, fetchedAt: Date.now() }
  return keys
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/auth.js tests/auth.test.js
git commit -m "feat: verify Cloudflare Access JWTs"
```

---

### Task 4: Menu reads

**Files:**
- Create: `worker/db.js`
- Create: `tests/worker/menu-db.test.js`

**Interfaces:**
- Consumes: `env.DB`
- Produces: `getMenu(db, includeUnavailable: boolean): Promise<{items, milkOptions, customizationOptions}>`. Each row has JS booleans for `available`, `allows_milk_choice`, `allows_customizations`, and is sorted by `name` ascending — matching the `.order('name')` in the current client.

- [ ] **Step 1: Write the failing test**

Create `tests/worker/menu-db.test.js`:

```js
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { getMenu } from '../../worker/db.js'

describe('getMenu', () => {
  it('returns only available rows by default, name-sorted', async () => {
    const menu = await getMenu(env.DB, false)
    expect(menu.items.map((i) => i.name)).toEqual([
      'Americano', 'Cappuccino', 'Cortado', 'Espresso', 'Flat White', 'Latte', 'Matcha Latte',
    ])
    expect(menu.milkOptions.map((m) => m.name)).toEqual(['Almond', 'Oat', 'Whole'])
    expect(menu.customizationOptions.map((c) => c.name)).toEqual(['Caramel Syrup', 'Vanilla Syrup'])
  })

  it('includes unavailable rows when asked', async () => {
    const menu = await getMenu(env.DB, true)
    expect(menu.items.map((i) => i.name)).toContain('Mocha')
    expect(menu.milkOptions.map((m) => m.name)).toContain('Soy')
    expect(menu.customizationOptions).toHaveLength(6)
  })

  it('converts integer flags to booleans', async () => {
    const menu = await getMenu(env.DB, true)
    const mocha = menu.items.find((i) => i.name === 'Mocha')
    const espresso = menu.items.find((i) => i.name === 'Espresso')
    expect(mocha.available).toBe(false)
    expect(espresso.available).toBe(true)
    expect(espresso.allows_milk_choice).toBe(false)
    expect(espresso.allows_customizations).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:worker`
Expected: FAIL — cannot resolve `worker/db.js`.

- [ ] **Step 3: Write `worker/db.js`**

```js
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
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:worker`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/db.js tests/worker/menu-db.test.js
git commit -m "feat: add menu reads against D1"
```

---

### Task 5: Order reshaping

The nested shapes returned by `getOrders()` and `getOrderDetails()` differ from each other, and both are consumed by existing components and by `analytics.js`. They must be reproduced exactly.

**Files:**
- Modify: `worker/db.js`
- Create: `tests/db-shape.test.js`

**Interfaces:**
- Consumes: nothing
- Produces (pure, no D1):
  - `groupOrderRows(rows): Array<{id, status, customerName, created_at, updated_at, items: Array<{name, quantity, milkOption, customizations, completedInstances}>}>`
  - `groupOrderDetailRows(rows): {id, status, createdAt, customerName, items: Array<{name, quantity, milkOption, customizations}>} | null`

Note the deliberate asymmetry, carried over from `src/lib/supabase.js`: the list form uses `created_at`/`updated_at` (snake, consumed by `analytics.js`) and includes `completedInstances`; the detail form uses `createdAt` (camel) and omits `completedInstances`.

- [ ] **Step 1: Write the failing test**

Create `tests/db-shape.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { groupOrderDetailRows, groupOrderRows } from '../worker/db.js'

// One flat row per order x order_item x customization, as the join produces.
const row = (over = {}) => ({
  order_id: 1,
  status: 'pending',
  customer_name: 'Ada',
  created_at: '2026-08-09T10:00:00Z',
  updated_at: '2026-08-09T10:01:00Z',
  order_item_id: 'oi-1',
  quantity: 2,
  item_name: 'Latte',
  milk_name: 'Oat',
  customization_name: null,
  ...over,
})

describe('groupOrderRows', () => {
  it('collapses join rows into one order with nested items', () => {
    const result = groupOrderRows([
      row({ customization_name: 'Vanilla Syrup' }),
      row({ customization_name: 'Cinnamon' }),
      row({ order_item_id: 'oi-2', item_name: 'Espresso', quantity: 1, milk_name: null }),
    ])

    expect(result).toEqual([
      {
        id: 1,
        status: 'pending',
        customerName: 'Ada',
        created_at: '2026-08-09T10:00:00Z',
        updated_at: '2026-08-09T10:01:00Z',
        items: [
          {
            name: 'Latte',
            quantity: 2,
            milkOption: 'Oat',
            customizations: ['Vanilla Syrup', 'Cinnamon'],
            completedInstances: [false, false],
          },
          {
            name: 'Espresso',
            quantity: 1,
            milkOption: null,
            customizations: [],
            completedInstances: [false],
          },
        ],
      },
    ])
  })

  it('separates distinct orders and preserves row order', () => {
    const result = groupOrderRows([
      row({ order_id: 1, customer_name: 'Ada' }),
      row({ order_id: 2, customer_name: 'Grace', order_item_id: 'oi-9' }),
    ])
    expect(result.map((o) => o.customerName)).toEqual(['Ada', 'Grace'])
  })

  it('returns an order with no items as an empty items array', () => {
    const result = groupOrderRows([
      row({ order_item_id: null, item_name: null, quantity: null, milk_name: null }),
    ])
    expect(result[0].items).toEqual([])
  })

  it('returns an empty array for no rows', () => {
    expect(groupOrderRows([])).toEqual([])
  })
})

describe('groupOrderDetailRows', () => {
  it('uses createdAt and omits completedInstances', () => {
    const result = groupOrderDetailRows([row({ customization_name: 'Vanilla Syrup' })])
    expect(result).toEqual({
      id: 1,
      status: 'pending',
      createdAt: '2026-08-09T10:00:00Z',
      customerName: 'Ada',
      items: [
        { name: 'Latte', quantity: 2, milkOption: 'Oat', customizations: ['Vanilla Syrup'] },
      ],
    })
  })

  it('returns null for no rows', () => {
    expect(groupOrderDetailRows([])).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — `groupOrderRows` is not exported.

- [ ] **Step 3: Append to `worker/db.js`**

```js
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
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/db.js tests/db-shape.test.js
git commit -m "feat: reshape flat order joins into nested order objects"
```

---

### Task 6: Order queries and status updates

**Files:**
- Modify: `worker/db.js`
- Create: `tests/worker/orders-db.test.js`

**Interfaces:**
- Consumes: `groupOrderRows`, `groupOrderDetailRows` (Task 5)
- Produces:
  - `getOrders(db)` → all orders, `created_at` ascending
  - `getOrderDetails(db, orderId, customerId)` → detail shape or `null` when not owned
  - `getActiveOrder(db, customerId)` → `{id, customer_name, status}` or `null`
  - `cancelOrder(db, orderId, customerId)` → `boolean` (false when not owned or not pending)
  - `updateOrderStatus(db, orderId, status)` → `boolean`
  - `updateAvailability(db, table, id, available)` → `boolean`; `table` must be one of `items`, `milk_options`, `customization_options`

- [ ] **Step 1: Write the failing test**

Create `tests/worker/orders-db.test.js`:

```js
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  cancelOrder,
  getActiveOrder,
  getOrderDetails,
  getOrders,
  updateAvailability,
  updateOrderStatus,
} from '../../worker/db.js'

// Inserts an order directly, bypassing the create path, so these tests are
// independent of Task 7.
async function seedOrder(customerId, name, status = 'pending', itemName = 'Latte') {
  const submissionId = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO orders (customer_id, customer_name, submission_id, status) VALUES (?, ?, ?, ?)'
  ).bind(customerId, name, submissionId, status).run()

  const order = await env.DB.prepare('SELECT id FROM orders WHERE submission_id = ?')
    .bind(submissionId).first()
  const item = await env.DB.prepare('SELECT id FROM items WHERE name = ?').bind(itemName).first()

  await env.DB.prepare(
    'INSERT INTO order_items (id, order_id, item_id, quantity) VALUES (?, ?, ?, 1)'
  ).bind(crypto.randomUUID(), order.id, item.id).run()

  return order.id
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM order_item_customizations')
  await env.DB.exec('DELETE FROM order_items')
  await env.DB.exec('DELETE FROM orders')
})

describe('getOrderDetails', () => {
  it('returns the order for its owner', async () => {
    const id = await seedOrder('cust-a', 'Ada')
    const details = await getOrderDetails(env.DB, id, 'cust-a')
    expect(details.customerName).toBe('Ada')
    expect(details.items[0].name).toBe('Latte')
  })

  it('returns null for a different customer', async () => {
    const id = await seedOrder('cust-a', 'Ada')
    expect(await getOrderDetails(env.DB, id, 'cust-b')).toBeNull()
  })

  it('returns null for an unknown id', async () => {
    expect(await getOrderDetails(env.DB, 99999, 'cust-a')).toBeNull()
  })
})

describe('getActiveOrder', () => {
  it('returns the newest pending or in_progress order for the customer', async () => {
    await seedOrder('cust-a', 'Ada', 'completed')
    const active = await seedOrder('cust-a', 'Ada', 'in_progress')
    expect((await getActiveOrder(env.DB, 'cust-a')).id).toBe(active)
  })

  it('ignores completed and cancelled orders', async () => {
    await seedOrder('cust-a', 'Ada', 'completed')
    await seedOrder('cust-a', 'Ada', 'cancelled')
    expect(await getActiveOrder(env.DB, 'cust-a')).toBeNull()
  })

  it('never returns another customer order', async () => {
    await seedOrder('cust-b', 'Grace', 'pending')
    expect(await getActiveOrder(env.DB, 'cust-a')).toBeNull()
  })
})

describe('cancelOrder', () => {
  it('cancels the owner pending order', async () => {
    const id = await seedOrder('cust-a', 'Ada')
    expect(await cancelOrder(env.DB, id, 'cust-a')).toBe(true)
    const row = await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(id).first()
    expect(row.status).toBe('cancelled')
  })

  it('refuses another customer order', async () => {
    const id = await seedOrder('cust-a', 'Ada')
    expect(await cancelOrder(env.DB, id, 'cust-b')).toBe(false)
    const row = await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(id).first()
    expect(row.status).toBe('pending')
  })

  it('refuses an order already in progress', async () => {
    const id = await seedOrder('cust-a', 'Ada', 'in_progress')
    expect(await cancelOrder(env.DB, id, 'cust-a')).toBe(false)
  })
})

describe('getOrders', () => {
  it('returns every order regardless of customer, oldest first', async () => {
    await seedOrder('cust-a', 'Ada')
    await seedOrder('cust-b', 'Grace')
    const orders = await getOrders(env.DB)
    expect(orders.map((o) => o.customerName)).toEqual(['Ada', 'Grace'])
    expect(orders[0].items[0].completedInstances).toEqual([false])
  })
})

describe('updateOrderStatus', () => {
  it('updates status and bumps updated_at', async () => {
    const id = await seedOrder('cust-a', 'Ada')
    const before = await env.DB.prepare('SELECT updated_at FROM orders WHERE id = ?').bind(id).first()
    expect(await updateOrderStatus(env.DB, id, 'completed')).toBe(true)
    const after = await env.DB.prepare('SELECT status, updated_at FROM orders WHERE id = ?').bind(id).first()
    expect(after.status).toBe('completed')
    expect(Date.parse(after.updated_at)).toBeGreaterThanOrEqual(Date.parse(before.updated_at))
  })

  it('returns false for an unknown order', async () => {
    expect(await updateOrderStatus(env.DB, 99999, 'completed')).toBe(false)
  })
})

describe('updateAvailability', () => {
  it('toggles an item', async () => {
    const item = await env.DB.prepare('SELECT id FROM items WHERE name = ?').bind('Espresso').first()
    expect(await updateAvailability(env.DB, 'items', item.id, false)).toBe(true)
    const row = await env.DB.prepare('SELECT available FROM items WHERE id = ?').bind(item.id).first()
    expect(row.available).toBe(0)
  })

  it('rejects a table name that is not allowlisted', async () => {
    await expect(updateAvailability(env.DB, 'orders', 1, false)).rejects.toThrow(/table/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:worker`
Expected: FAIL — `getOrders` is not exported.

- [ ] **Step 3: Append to `worker/db.js`**

```js
const ORDER_JOIN = `
  SELECT o.id            AS order_id,
         o.status        AS status,
         o.customer_name AS customer_name,
         o.created_at    AS created_at,
         o.updated_at    AS updated_at,
         oi.id           AS order_item_id,
         oi.quantity     AS quantity,
         i.name          AS item_name,
         m.name          AS milk_name,
         co.name         AS customization_name
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN items i ON i.id = oi.item_id
    LEFT JOIN milk_options m ON m.id = oi.milk_option_id
    LEFT JOIN order_item_customizations oic ON oic.order_item_id = oi.id
    LEFT JOIN customization_options co ON co.id = oic.customization_option_id
`

export async function getOrders(db) {
  const { results } = await db
    .prepare(`${ORDER_JOIN} ORDER BY o.created_at ASC, o.id ASC, oi.rowid ASC, co.name ASC`)
    .all()
  return groupOrderRows(results)
}

// customer_id is in the WHERE clause, not a post-fetch check: a query that
// cannot see the row is safer than a branch someone can forget.
export async function getOrderDetails(db, orderId, customerId) {
  const { results } = await db
    .prepare(`${ORDER_JOIN} WHERE o.id = ? AND o.customer_id = ? ORDER BY oi.rowid ASC, co.name ASC`)
    .bind(orderId, customerId)
    .all()
  return groupOrderDetailRows(results)
}

export async function getActiveOrder(db, customerId) {
  return db
    .prepare(
      `SELECT id, customer_name, status
         FROM orders
        WHERE customer_id = ? AND status IN ('pending','in_progress')
        ORDER BY created_at DESC
        LIMIT 1`
    )
    .bind(customerId)
    .first()
}

export async function cancelOrder(db, orderId, customerId) {
  const result = await db
    .prepare(
      `UPDATE orders SET status = 'cancelled'
        WHERE id = ? AND customer_id = ? AND status = 'pending'`
    )
    .bind(orderId, customerId)
    .run()
  return result.meta.changes > 0
}

export async function updateOrderStatus(db, orderId, status) {
  const result = await db
    .prepare('UPDATE orders SET status = ? WHERE id = ?')
    .bind(status, orderId)
    .run()
  return result.meta.changes > 0
}

const AVAILABILITY_TABLES = new Set(['items', 'milk_options', 'customization_options'])

export async function updateAvailability(db, table, id, available) {
  // Table names cannot be bound as parameters, so allowlist them.
  if (!AVAILABILITY_TABLES.has(table)) throw new Error(`Unknown table: ${table}`)
  const result = await db
    .prepare(`UPDATE ${table} SET available = ? WHERE id = ?`)
    .bind(available ? 1 : 0, id)
    .run()
  return result.meta.changes > 0
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:worker`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/db.js tests/worker/orders-db.test.js
git commit -m "feat: add order queries and status updates against D1"
```

---

### Task 7: Queue statistics

Ports `get_queue_stats` from plpgsql (`functions.sql:7-60`) to a single SQLite query. `EXTRACT(EPOCH FROM ...)` becomes `CAST(strftime('%s', t) AS INTEGER)`.

**Files:**
- Modify: `worker/db.js`
- Create: `tests/worker/queue-stats.test.js`

**Interfaces:**
- Consumes: `env.DB`
- Produces: `getQueueStats(db, orderId: number|null)` → `{drinksAhead: number, activeOrders: number, estMinsPerDrink: number|null}`

- [ ] **Step 1: Write the failing test**

Create `tests/worker/queue-stats.test.js`:

```js
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { getQueueStats } from '../../worker/db.js'

// Explicit timestamps so drain-rate arithmetic is deterministic.
async function seedOrder({ customerId = 'c', status = 'pending', drinks = 1, createdAt, updatedAt }) {
  const submissionId = crypto.randomUUID()
  await env.DB.prepare(
    `INSERT INTO orders (customer_id, customer_name, submission_id, status, created_at, updated_at)
     VALUES (?, 'X', ?, ?, ?, ?)`
  ).bind(customerId, submissionId, status, createdAt, updatedAt ?? createdAt).run()

  const order = await env.DB.prepare('SELECT id FROM orders WHERE submission_id = ?')
    .bind(submissionId).first()
  const item = await env.DB.prepare('SELECT id FROM items LIMIT 1').first()
  await env.DB.prepare(
    'INSERT INTO order_items (id, order_id, item_id, quantity) VALUES (?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), order.id, item.id, drinks).run()
  return order.id
}

const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z')

beforeEach(async () => {
  await env.DB.exec('DELETE FROM order_item_customizations')
  await env.DB.exec('DELETE FROM order_items')
  await env.DB.exec('DELETE FROM orders')
})

describe('getQueueStats', () => {
  it('counts the whole active queue when orderId is null', async () => {
    await seedOrder({ drinks: 2, createdAt: minutesAgo(10) })
    await seedOrder({ drinks: 3, status: 'in_progress', createdAt: minutesAgo(5) })
    await seedOrder({ drinks: 9, status: 'completed', createdAt: minutesAgo(30) })

    const stats = await getQueueStats(env.DB, null)
    expect(stats.drinksAhead).toBe(5)
    expect(stats.activeOrders).toBe(2)
  })

  it('counts only drinks ahead of the given order', async () => {
    await seedOrder({ drinks: 2, createdAt: minutesAgo(10) })
    const mine = await seedOrder({ drinks: 4, createdAt: minutesAgo(5) })

    const stats = await getQueueStats(env.DB, mine)
    expect(stats.drinksAhead).toBe(2)
    expect(stats.activeOrders).toBe(1)
  })

  it('returns zeros for an empty queue', async () => {
    const stats = await getQueueStats(env.DB, null)
    expect(stats).toEqual({ drinksAhead: 0, activeOrders: 0, estMinsPerDrink: null })
  })

  it('returns a null rate with fewer than three recent completions', async () => {
    await seedOrder({ status: 'completed', createdAt: minutesAgo(20), updatedAt: minutesAgo(10) })
    await seedOrder({ status: 'completed', createdAt: minutesAgo(20), updatedAt: minutesAgo(5) })
    expect((await getQueueStats(env.DB, null)).estMinsPerDrink).toBeNull()
  })

  it('computes minutes per drink from completions after the earliest', async () => {
    // Completions at T-30, T-20, T-10. Span 20 minutes, 4 drinks after the
    // first completion, so 20 / 4 = 5 minutes per drink.
    await seedOrder({ status: 'completed', drinks: 5, createdAt: minutesAgo(40), updatedAt: minutesAgo(30) })
    await seedOrder({ status: 'completed', drinks: 2, createdAt: minutesAgo(40), updatedAt: minutesAgo(20) })
    await seedOrder({ status: 'completed', drinks: 2, createdAt: minutesAgo(40), updatedAt: minutesAgo(10) })

    expect((await getQueueStats(env.DB, null)).estMinsPerDrink).toBeCloseTo(5, 5)
  })

  it('ignores completions older than 90 minutes', async () => {
    await seedOrder({ status: 'completed', drinks: 1, createdAt: minutesAgo(200), updatedAt: minutesAgo(190) })
    await seedOrder({ status: 'completed', drinks: 1, createdAt: minutesAgo(200), updatedAt: minutesAgo(180) })
    await seedOrder({ status: 'completed', drinks: 1, createdAt: minutesAgo(200), updatedAt: minutesAgo(170) })
    expect((await getQueueStats(env.DB, null)).estMinsPerDrink).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:worker`
Expected: FAIL — `getQueueStats` is not exported.

- [ ] **Step 3: Append to `worker/db.js`**

```js
// Port of the get_queue_stats plpgsql function.
// Drain rate: over the last 5 completions within 90 minutes, drinks completed
// after the earliest completion divided by the minutes between first and last.
// NULL when fewer than 3 completions or the span is under 60 seconds.
const QUEUE_STATS_SQL = `
  WITH ahead AS (
    SELECT COALESCE(SUM(oi.quantity), 0) AS drinks_ahead,
           COUNT(DISTINCT o.id)          AS active_orders
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
     WHERE o.status IN ('pending','in_progress')
       AND (? IS NULL OR o.created_at < (SELECT created_at FROM orders WHERE id = ?))
  ),
  recent AS (
    SELECT o.id,
           o.updated_at,
           (SELECT COALESCE(SUM(quantity), 0) FROM order_items oi WHERE oi.order_id = o.id) AS drinks
      FROM orders o
     WHERE o.status = 'completed'
       AND o.updated_at > strftime('%Y-%m-%dT%H:%M:%SZ','now','-90 minutes')
     ORDER BY o.updated_at DESC
     LIMIT 5
  ),
  ordered AS (
    SELECT drinks,
           ROW_NUMBER() OVER (ORDER BY updated_at ASC) AS rn,
           COUNT(*)        OVER () AS n,
           MIN(updated_at) OVER () AS first_t,
           MAX(updated_at) OVER () AS last_t
      FROM recent
  )
  SELECT (SELECT drinks_ahead FROM ahead)  AS drinks_ahead,
         (SELECT active_orders FROM ahead) AS active_orders,
         (SELECT CASE
                   WHEN MAX(n) IS NULL OR MAX(n) < 3 THEN NULL
                   WHEN (CAST(strftime('%s', MAX(last_t)) AS INTEGER)
                         - CAST(strftime('%s', MAX(first_t)) AS INTEGER)) < 60 THEN NULL
                   ELSE ((CAST(strftime('%s', MAX(last_t)) AS INTEGER)
                          - CAST(strftime('%s', MAX(first_t)) AS INTEGER)) / 60.0)
                        / NULLIF(SUM(CASE WHEN rn > 1 THEN drinks ELSE 0 END), 0)
                 END
            FROM ordered)                  AS est_mins_per_drink
`

export async function getQueueStats(db, orderId) {
  // Positional `?` bound twice rather than a reused `?1`: numbered-placeholder
  // reuse works under local miniflare but was never verified against production
  // D1, and this query feeds a customer-facing wait estimate, so a divergence
  // would show wrong numbers silently. Positional binding is unambiguous.
  const row = await db.prepare(QUEUE_STATS_SQL).bind(orderId ?? null, orderId ?? null).first()
  return {
    drinksAhead: row?.drinks_ahead ?? 0,
    activeOrders: row?.active_orders ?? 0,
    estMinsPerDrink: row?.est_mins_per_drink == null ? null : Number(row.est_mins_per_drink),
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:worker`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/db.js tests/worker/queue-stats.test.js
git commit -m "feat: port get_queue_stats to a single D1 query"
```

---

### Task 8: Atomic, idempotent, availability-checked order creation

**Files:**
- Modify: `worker/db.js`
- Create: `tests/worker/create-order.test.js`

**Interfaces:**
- Consumes: `env.DB`
- Produces: `createOrder(db, {customerId, customerName, submissionId, items})` → `{orderId, duplicate: boolean}`.
  `items` is `Array<{item_id: number, milk_option_id: number|null, quantity: number, customization_option_ids: number[]}>`.
  Throws `UnavailableError` (exported, with an `unavailable` array) when any referenced row is missing or `available = 0`.
  Throws `Error('Order must contain at least one item')` for an empty list.

- [ ] **Step 1: Write the failing test**

Create `tests/worker/create-order.test.js`:

```js
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { UnavailableError, createOrder } from '../../worker/db.js'

let latte
let oat
let vanilla

beforeEach(async () => {
  await env.DB.exec('DELETE FROM order_item_customizations')
  await env.DB.exec('DELETE FROM order_items')
  await env.DB.exec('DELETE FROM orders')
  await env.DB.exec('UPDATE items SET available = 1')
  await env.DB.exec('UPDATE milk_options SET available = 1')
  await env.DB.exec('UPDATE customization_options SET available = 1')

  latte = (await env.DB.prepare('SELECT id FROM items WHERE name = ?').bind('Latte').first()).id
  oat = (await env.DB.prepare('SELECT id FROM milk_options WHERE name = ?').bind('Oat').first()).id
  vanilla = (
    await env.DB.prepare('SELECT id FROM customization_options WHERE name = ?').bind('Vanilla Syrup').first()
  ).id
})

const baseOrder = (over = {}) => ({
  customerId: 'cust-a',
  customerName: 'Ada',
  submissionId: crypto.randomUUID(),
  items: [{ item_id: latte, milk_option_id: oat, quantity: 2, customization_option_ids: [vanilla] }],
  ...over,
})

describe('createOrder', () => {
  it('writes the order, its items, and its customizations', async () => {
    const { orderId, duplicate } = await createOrder(env.DB, baseOrder())
    expect(duplicate).toBe(false)

    const order = await env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first()
    expect(order.customer_name).toBe('Ada')
    expect(order.customer_id).toBe('cust-a')
    expect(order.status).toBe('pending')

    const items = await env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(orderId).all()
    expect(items.results).toHaveLength(1)
    expect(items.results[0].quantity).toBe(2)

    const customizations = await env.DB.prepare(
      'SELECT * FROM order_item_customizations WHERE order_item_id = ?'
    ).bind(items.results[0].id).all()
    expect(customizations.results).toHaveLength(1)
  })

  it('is idempotent for a repeated submission_id', async () => {
    const payload = baseOrder()
    const first = await createOrder(env.DB, payload)
    const second = await createOrder(env.DB, payload)

    expect(second.orderId).toBe(first.orderId)
    expect(second.duplicate).toBe(true)

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first()
    expect(count.n).toBe(1)

    // The orders count alone cannot detect this task's worst failure: if a
    // retry's CHILD inserts landed against the first order, the customer's
    // drinks would double while orders stayed at 1. Scope these by id — a
    // global COUNT(*) would pass vacuously under the beforeEach cleanup.
    const items = await env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?')
      .bind(first.orderId).all()
    expect(items.results).toHaveLength(1)

    const customizations = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM order_item_customizations WHERE order_item_id = ?'
    ).bind(items.results[0].id).first()
    expect(customizations.n).toBe(1)
  })

  it('rejects an empty item list', async () => {
    await expect(createOrder(env.DB, baseOrder({ items: [] }))).rejects.toThrow(/at least one item/i)
  })

  it('rejects an unavailable item and writes nothing', async () => {
    await env.DB.prepare('UPDATE items SET available = 0 WHERE id = ?').bind(latte).run()
    await expect(createOrder(env.DB, baseOrder())).rejects.toThrow(UnavailableError)

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM orders').first()
    expect(count.n).toBe(0)
  })

  it('rejects an unavailable milk option', async () => {
    await env.DB.prepare('UPDATE milk_options SET available = 0 WHERE id = ?').bind(oat).run()
    await expect(createOrder(env.DB, baseOrder())).rejects.toThrow(UnavailableError)
  })

  it('rejects an unavailable customization', async () => {
    await env.DB.prepare('UPDATE customization_options SET available = 0 WHERE id = ?').bind(vanilla).run()
    await expect(createOrder(env.DB, baseOrder())).rejects.toThrow(UnavailableError)
  })

  it('rejects an item id that does not exist', async () => {
    await expect(
      createOrder(env.DB, baseOrder({ items: [{ item_id: 99999, milk_option_id: null, quantity: 1, customization_option_ids: [] }] }))
    ).rejects.toThrow(UnavailableError)
  })

  it('accepts an order with no milk and no customizations', async () => {
    const { orderId } = await createOrder(
      env.DB,
      baseOrder({ items: [{ item_id: latte, milk_option_id: null, quantity: 1, customization_option_ids: [] }] })
    )
    const item = await env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(orderId).first()
    expect(item.milk_option_id).toBeNull()
  })

  it('floors quantity at 1', async () => {
    const { orderId } = await createOrder(
      env.DB,
      baseOrder({ items: [{ item_id: latte, milk_option_id: null, quantity: 0, customization_option_ids: [] }] })
    )
    const item = await env.DB.prepare('SELECT quantity FROM order_items WHERE order_id = ?').bind(orderId).first()
    expect(item.quantity).toBe(1)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:worker`
Expected: FAIL — `createOrder` is not exported.

- [ ] **Step 3: Append to `worker/db.js`**

```js
export class UnavailableError extends Error {
  constructor(unavailable) {
    super('One or more selections are unavailable')
    this.name = 'UnavailableError'
    this.unavailable = unavailable
  }
}

async function assertAvailable(db, table, ids) {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(',')
  const { results } = await db
    .prepare(`SELECT id FROM ${table} WHERE id IN (${placeholders}) AND available = 1`)
    .bind(...ids)
    .all()
  const found = new Set(results.map((r) => r.id))
  return ids.filter((id) => !found.has(id)).map((id) => ({ table, id }))
}

// Atomic because every statement goes in one batch(). The children address
// their parent by submission_id rather than by an autoincrement id nobody
// knows yet — D1 batches cannot feed one statement's result into the next.
export async function createOrder(db, { customerId, customerName, submissionId, items }) {
  if (!items || items.length === 0) throw new Error('Order must contain at least one item')

  const itemIds = [...new Set(items.map((i) => i.item_id))]
  const milkIds = [...new Set(items.map((i) => i.milk_option_id).filter((id) => id != null))]
  const customizationIds = [
    ...new Set(items.flatMap((i) => i.customization_option_ids ?? [])),
  ]

  const unavailable = [
    ...(await assertAvailable(db, 'items', itemIds)),
    ...(await assertAvailable(db, 'milk_options', milkIds)),
    ...(await assertAvailable(db, 'customization_options', customizationIds)),
  ]
  if (unavailable.length > 0) throw new UnavailableError(unavailable)

  const statements = [
    db
      .prepare(
        `INSERT INTO orders (customer_id, customer_name, submission_id, status)
         VALUES (?, ?, ?, 'pending')`
      )
      .bind(customerId, customerName, submissionId),
  ]

  for (const item of items) {
    const orderItemId = crypto.randomUUID()
    statements.push(
      db
        .prepare(
          `INSERT INTO order_items (id, order_id, item_id, milk_option_id, quantity)
           VALUES (?, (SELECT id FROM orders WHERE submission_id = ?), ?, ?, ?)`
        )
        .bind(
          orderItemId,
          submissionId,
          item.item_id,
          item.milk_option_id ?? null,
          Math.max(1, Number(item.quantity) || 1)
        )
    )

    for (const customizationId of item.customization_option_ids ?? []) {
      statements.push(
        db
          .prepare(
            `INSERT INTO order_item_customizations (order_item_id, customization_option_id)
             VALUES (?, ?)`
          )
          .bind(orderItemId, customizationId)
      )
    }
  }

  try {
    await db.batch(statements)
  } catch (error) {
    // A repeated submission_id means the client retried a request that already
    // succeeded. Return the original order instead of creating a duplicate.
    // Matched on two independent signals rather than one exact sentence: D1's
    // error wording is not a stable contract, and if it changed, an exact-match
    // check would silently turn every retried submit into a hard failure. Both
    // conditions are required, so an unrelated constraint violation still
    // rethrows — no other column in the schema is named submission_id.
    const message = String(error).toLowerCase()
    const looksLikeUniqueViolation = /unique|constraint/.test(message)
    const mentionsSubmissionId = message.includes('submission_id')
    if (!looksLikeUniqueViolation || !mentionsSubmissionId) throw error
    const existing = await db
      .prepare('SELECT id FROM orders WHERE submission_id = ?')
      .bind(submissionId)
      .first()
    if (existing) return { orderId: existing.id, duplicate: true }
    throw error
  }

  const created = await db
    .prepare('SELECT id FROM orders WHERE submission_id = ?')
    .bind(submissionId)
    .first()
  return { orderId: created.id, duplicate: false }
}
```

- [ ] **Step 4: Run the tests**

Run: `npm run test:worker`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/db.js tests/worker/create-order.test.js
git commit -m "feat: atomic idempotent order creation with availability checks"
```

---

### Task 9: Worker router, middleware, and customer routes

**Files:**
- Modify: `worker/index.js`
- Create: `worker/routes/menu.js`, `worker/routes/orders.js`
- Create: `tests/worker/customer-routes.test.js`

**Interfaces:**
- Consumes: everything from `worker/db.js` and `worker/auth.js`
- Produces: a `fetch` handler serving `/api/menu`, `/api/orders`, `/api/orders/active`, `/api/orders/:id`, `/api/orders/:id/cancel`, `/api/queue-stats`; everything else falls through to `env.ASSETS`.
- Produces `json(data, init)` and `withCustomer(request, env)` for Task 10.

- [ ] **Step 1: Write the failing test**

Create `tests/worker/customer-routes.test.js`:

```js
import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

const ORIGIN = 'https://cafecito.test'

// Threads the Set-Cookie response back into later requests, like a browser.
function makeClient() {
  let cookie = null
  return async (path, init = {}) => {
    const headers = new Headers(init.headers)
    if (cookie) headers.set('Cookie', cookie)
    const response = await SELF.fetch(`${ORIGIN}${path}`, { ...init, headers })
    const setCookie = response.headers.get('Set-Cookie')
    if (setCookie) cookie = setCookie.split(';')[0]
    return response
  }
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM order_item_customizations')
  await env.DB.exec('DELETE FROM order_items')
  await env.DB.exec('DELETE FROM orders')
  await env.DB.exec('UPDATE items SET available = 1')
})

describe('GET /api/menu', () => {
  it('returns the three collections and mints a cookie', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/menu`)
    expect(response.status).toBe(200)

    const setCookie = response.headers.get('Set-Cookie')
    expect(setCookie).toContain('cafecito_cid=')
    expect(setCookie).toContain('HttpOnly')

    const body = await response.json()
    expect(body.items.length).toBeGreaterThan(0)
    expect(body.milkOptions.length).toBeGreaterThan(0)
    expect(body.customizationOptions.length).toBeGreaterThan(0)
    expect(body.items.every((i) => i.available === true)).toBe(true)
  })

  it('ignores include_unavailable for customers', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/menu?include_unavailable=1`)
    const body = await response.json()
    expect(body.items.every((i) => i.available === true)).toBe(true)
  })
})

describe('POST /api/orders', () => {
  it('creates an order and returns its id', async () => {
    const client = makeClient()
    const menu = await (await client('/api/menu')).json()

    const response = await client('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Ada',
        submissionId: crypto.randomUUID(),
        items: [{ item_id: menu.items[0].id, milk_option_id: null, quantity: 1, customization_option_ids: [] }],
      }),
    })

    expect(response.status).toBe(201)
    expect((await response.json()).orderId).toEqual(expect.any(Number))
  })

  it('returns 409 for an unavailable item', async () => {
    const client = makeClient()
    const menu = await (await client('/api/menu')).json()
    const itemId = menu.items[0].id
    await env.DB.prepare('UPDATE items SET available = 0 WHERE id = ?').bind(itemId).run()

    const response = await client('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Ada',
        submissionId: crypto.randomUUID(),
        items: [{ item_id: itemId, milk_option_id: null, quantity: 1, customization_option_ids: [] }],
      }),
    })

    expect(response.status).toBe(409)
  })

  it('returns 400 for an empty item list', async () => {
    const client = makeClient()
    await client('/api/menu')
    const response = await client('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerName: 'Ada', submissionId: crypto.randomUUID(), items: [] }),
    })
    expect(response.status).toBe(400)
  })
})

describe('order lifecycle', () => {
  it('restores the active order and cancels it', async () => {
    const client = makeClient()
    const menu = await (await client('/api/menu')).json()
    const created = await (
      await client('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: 'Ada',
          submissionId: crypto.randomUUID(),
          items: [{ item_id: menu.items[0].id, milk_option_id: null, quantity: 1, customization_option_ids: [] }],
        }),
      })
    ).json()

    const active = await (await client('/api/orders/active')).json()
    expect(active.id).toBe(created.orderId)
    expect(active.customer_name).toBe('Ada')

    const details = await (await client(`/api/orders/${created.orderId}`)).json()
    expect(details.customerName).toBe('Ada')
    expect(details.items).toHaveLength(1)

    const cancelled = await client(`/api/orders/${created.orderId}/cancel`, { method: 'POST' })
    expect(cancelled.status).toBe(200)

    const afterCancel = await (await client('/api/orders/active')).json()
    expect(afterCancel).toBeNull()
  })
})

describe('GET /api/queue-stats', () => {
  it('returns aggregates only, never order rows', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/queue-stats`)
    const body = await response.json()
    expect(Object.keys(body).sort()).toEqual(['activeOrders', 'drinksAhead', 'estMinsPerDrink'])
  })
})

describe('unknown API routes', () => {
  it('404s', async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/nope`)).status).toBe(404)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:worker`
Expected: FAIL — the placeholder Worker returns 501.

- [ ] **Step 3: Write `worker/routes/menu.js`**

```js
import { getMenu } from '../db.js'

// include_unavailable is honoured only for baristas; a customer must never be
// able to widen their own view by tweaking a query string.
export async function handleMenu(request, env, { includeUnavailable = false } = {}) {
  return getMenu(env.DB, includeUnavailable)
}
```

- [ ] **Step 4: Write `worker/routes/orders.js`**

```js
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
```

- [ ] **Step 5: Write `worker/index.js`**

```js
import { CUSTOMER_COOKIE, customerCookieHeader, readCookie, signCustomerId, verifyCustomerCookie } from './auth.js'
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
```

- [ ] **Step 6: Run the tests**

Run: `npm run test:worker`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add worker tests/worker/customer-routes.test.js
git commit -m "feat: add worker router, customer cookie middleware, customer routes"
```

---

### Task 10: Barista routes behind Access

**Files:**
- Create: `worker/routes/barista.js`, `tests/worker/barista-routes.test.js`
- Modify: `worker/index.js`

**Interfaces:**
- Consumes: `verifyAccessJwt`, `fetchAccessJwks` (Task 3); `getOrders`, `updateOrderStatus`, `updateAvailability`, `getMenu`
- Produces: `/api/barista/*` routes, all gated by a single `requireBarista` check at the mount point.

- [ ] **Step 1: Write the failing test**

Create `tests/worker/barista-routes.test.js`:

```js
import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

const ORIGIN = 'https://cafecito.test'

beforeEach(async () => {
  await env.DB.exec('DELETE FROM order_item_customizations')
  await env.DB.exec('DELETE FROM order_items')
  await env.DB.exec('DELETE FROM orders')
})

describe('barista routes without Access', () => {
  it('rejects a missing Access JWT on every route', async () => {
    const routes = [
      ['GET', '/api/barista/orders'],
      ['PATCH', '/api/barista/orders/1'],
      ['PATCH', '/api/barista/items/1'],
      ['PATCH', '/api/barista/milk/1'],
      ['PATCH', '/api/barista/customizations/1'],
      ['GET', '/api/barista/menu'],
    ]

    for (const [method, path] of routes) {
      const response = await SELF.fetch(`${ORIGIN}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'PATCH' ? JSON.stringify({ status: 'completed', available: false }) : undefined,
      })
      expect(response.status, `${method} ${path}`).toBe(403)
    }
  })

  it('rejects a forged Access JWT', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/barista/orders`, {
      headers: { 'Cf-Access-Jwt-Assertion': 'aaa.bbb.ccc' },
    })
    expect(response.status).toBe(403)
  })

  it('does not leak order data in the 403 body', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/barista/orders`)
    const body = await response.json()
    expect(Array.isArray(body)).toBe(false)
    expect(body.error).toBeDefined()
  })
})
```

Signature-valid Access tokens are covered by the unit tests in Task 3. These
integration tests assert the mount point rejects everything else.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:worker`
Expected: FAIL — routes 404 instead of 403.

- [ ] **Step 3: Write `worker/routes/barista.js`**

```js
import { fetchAccessJwks, verifyAccessJwt } from '../auth.js'
import { getMenu, getOrders, updateAvailability, updateOrderStatus } from '../db.js'

const VALID_STATUSES = new Set(['pending', 'in_progress', 'completed', 'cancelled'])

const AVAILABILITY_ROUTES = {
  items: 'items',
  milk: 'milk_options',
  customizations: 'customization_options',
}

// `.catch(() => ({}))` alone is not enough: the literal `null` PARSES
// successfully, so body.status would throw a TypeError and surface as a 500
// instead of the clean 400 these routes promise. Normalize any non-object
// result — null, number, string — to an empty object. An array passes through
// but degrades safely, since its fields read undefined and fail validation.
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
```

- [ ] **Step 4: Mount it in `worker/index.js`**

Add the import at the top:

```js
import { handleBarista, requireBarista } from './routes/barista.js'
```

Then insert this block at the very start of `handleApi`, before `withCustomer` is called:

```js
  // Mount-point authorization: everything under /api/barista/* is gated here,
  // so no individual handler can forget its own check.
  if (url.pathname.startsWith('/api/barista/')) {
    if (!(await requireBarista(request, env))) {
      return json({ error: 'Forbidden' }, { status: 403 })
    }
    return respond(await handleBarista(request, env, url), null)
  }
```

- [ ] **Step 5: Run the tests**

Run: `npm run test:worker`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add worker tests/worker/barista-routes.test.js
git commit -m "feat: add barista routes gated by Cloudflare Access"
```

---

### Task 11: Authorization regression suite

One test per RLS policy that `rls.sql` used to enforce. This is the net under the riskiest part of the migration, so it lives in its own file and is named for what it protects.

**Files:**
- Create: `tests/worker/authorization.test.js`

**Interfaces:**
- Consumes: the full Worker via `SELF.fetch`
- Produces: no exports

- [ ] **Step 1: Write the test**

Create `tests/worker/authorization.test.js`:

```js
import { SELF, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

const ORIGIN = 'https://cafecito.test'

function makeClient() {
  let cookie = null
  return async (path, init = {}) => {
    const headers = new Headers(init.headers)
    if (cookie) headers.set('Cookie', cookie)
    const response = await SELF.fetch(`${ORIGIN}${path}`, { ...init, headers })
    const setCookie = response.headers.get('Set-Cookie')
    if (setCookie) cookie = setCookie.split(';')[0]
    return response
  }
}

async function placeOrder(client, name) {
  const menu = await (await client('/api/menu')).json()
  const response = await client('/api/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: name,
      submissionId: crypto.randomUUID(),
      items: [{ item_id: menu.items[0].id, milk_option_id: null, quantity: 1, customization_option_ids: [] }],
    }),
  })
  return (await response.json()).orderId
}

beforeEach(async () => {
  await env.DB.exec('DELETE FROM order_item_customizations')
  await env.DB.exec('DELETE FROM order_items')
  await env.DB.exec('DELETE FROM orders')
  await env.DB.exec('UPDATE items SET available = 1')
})

describe('replaces: "Allow users to view their own orders"', () => {
  it('customer B cannot read customer A order', async () => {
    const alice = makeClient()
    const bob = makeClient()
    const orderId = await placeOrder(alice, 'Ada')
    await bob('/api/menu')

    expect((await bob(`/api/orders/${orderId}`)).status).toBe(404)
    expect((await alice(`/api/orders/${orderId}`)).status).toBe(200)
  })

  it('customer B active-order lookup never returns customer A order', async () => {
    const alice = makeClient()
    const bob = makeClient()
    await placeOrder(alice, 'Ada')
    await bob('/api/menu')

    expect(await (await bob('/api/orders/active')).json()).toBeNull()
  })
})

describe('replaces: "Allow users to update their pending orders"', () => {
  it('customer B cannot cancel customer A order', async () => {
    const alice = makeClient()
    const bob = makeClient()
    const orderId = await placeOrder(alice, 'Ada')
    await bob('/api/menu')

    expect((await bob(`/api/orders/${orderId}/cancel`, { method: 'POST' })).status).toBe(404)

    const row = await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(orderId).first()
    expect(row.status).toBe('pending')
  })

  it('a customer cannot cancel their own order once it is in progress', async () => {
    const alice = makeClient()
    const orderId = await placeOrder(alice, 'Ada')
    await env.DB.prepare("UPDATE orders SET status = 'in_progress' WHERE id = ?").bind(orderId).run()

    expect((await alice(`/api/orders/${orderId}/cancel`, { method: 'POST' })).status).toBe(404)
  })
})

describe('replaces: SECURITY DEFINER on get_queue_stats', () => {
  it('exposes aggregates without exposing orders', async () => {
    const alice = makeClient()
    await placeOrder(alice, 'Ada')

    const bob = makeClient()
    const stats = await (await bob('/api/queue-stats')).json()

    expect(stats.drinksAhead).toBe(1)
    expect(JSON.stringify(stats)).not.toContain('Ada')
  })
})

describe('identity is never taken from the request body', () => {
  it('ignores a customer_id supplied by the client', async () => {
    const alice = makeClient()
    const bob = makeClient()
    const menu = await (await alice('/api/menu')).json()
    await bob('/api/menu')

    // Bob tries to plant an order under a forged identity.
    const response = await bob('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Mallory',
        customerId: 'definitely-alice',
        customer_id: 'definitely-alice',
        submissionId: crypto.randomUUID(),
        items: [{ item_id: menu.items[0].id, milk_option_id: null, quantity: 1, customization_option_ids: [] }],
      }),
    })
    const { orderId } = await response.json()

    const row = await env.DB.prepare('SELECT customer_id FROM orders WHERE id = ?').bind(orderId).first()
    expect(row.customer_id).not.toBe('definitely-alice')

    // And Alice still cannot see it.
    expect((await alice(`/api/orders/${orderId}`)).status).toBe(404)
  })

  // The forged cookie must reuse a REAL customer's id with a bad signature,
  // and that customer must have a live pending order. Otherwise the null-body
  // assertion is inert: beforeEach empties the orders table, so a server that
  // honoured the forged value would find nothing either, and the test would
  // pass whether or not the signature was ever checked.
  it('rejects a tampered cookie rather than trusting it', async () => {
    const alice = makeClient()
    await alice('/api/menu')
    const menu = await (await alice('/api/menu')).json()
    await alice('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: 'Ada',
        submissionId: crypto.randomUUID(),
        items: [{ item_id: menu.items[0].id, milk_option_id: null, quantity: 1, customization_option_ids: [] }],
      }),
    })

    const aliceId = await alice.customerId()

    const response = await SELF.fetch(`${ORIGIN}/api/orders/active`, {
      headers: { Cookie: `cafecito_cid=${aliceId}.badsignature` },
    })

    const newId = (response.headers.get('Set-Cookie') ?? '')
      .slice('cafecito_cid='.length)
      .split('.')[0]

    // Fails if the server reused the forged id as the new identity...
    expect(newId).not.toBe(aliceId)
    // ...and fails if it serviced THIS request with the forged id, since that
    // would surface Alice's pending order.
    expect(await response.json()).toBeNull()
  })
})
```

- [ ] **Step 2: Run the suite**

Run: `npm run test:worker`
Expected: PASS. If any test fails, the corresponding authorization rule is wrong — fix `worker/` rather than the test.

- [ ] **Step 3: Commit**

```bash
git add tests/worker/authorization.test.js
git commit -m "test: add authorization regression suite for replaced RLS policies"
```

---

### Task 12: Client API module

**Files:**
- Create: `src/lib/api.js`
- Delete: `src/lib/supabase.js`

**Interfaces:**
- Consumes: the Worker API
- Produces the same exports the components already import: `getMenuItems`, `getMilkOptions`, `getCustomizationOptions`, `submitOrder`, `getOrderDetails`, `getOrders`, `getActiveOrder`, `getQueueStats`, `cancelOrder`, `updateOrderStatus`, `updateItemAvailability`, `updateMilkAvailability`, `updateCustomizationAvailability`, `signOut`.

`submitOrder(customerName, orderItems, submissionId)` takes an optional third argument so a caller can retry with the same id; it generates one when omitted.

- [ ] **Step 1: Write `src/lib/api.js`**

```js
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
```

- [ ] **Step 2: Delete the Supabase module**

```bash
git rm src/lib/supabase.js
```

- [ ] **Step 3: Point every import at the new module**

```bash
grep -rl "from \"./supabase\"\|from './supabase'\|from \"./lib/supabase\"\|from './lib/supabase'" src/
```

In each file the command lists, replace `supabase` with `api` in the import path. Files expected: `src/App.svelte`, `src/lib/Analytics.svelte`, `src/lib/BaristaView.svelte`, `src/lib/CustomerView.svelte`, `src/lib/Menu.svelte`, `src/lib/OrderStatus.svelte`, `src/lib/BaristaLogin.svelte` (deleted in Task 13).

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: build fails only on `src/App.svelte` and `src/lib/BaristaLogin.svelte`, which still reference removed auth exports. Task 13 fixes both.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.js src/lib/*.svelte
git rm --cached src/lib/supabase.js 2>/dev/null || true
git commit -m "feat: replace supabase client with worker api module"
```

---

### Task 13: Client routing and component updates

**Files:**
- Modify: `src/App.svelte`, `src/lib/CustomerView.svelte`
- Delete: `src/lib/BaristaLogin.svelte`

**Interfaces:**
- Consumes: `src/lib/api.js` (Task 12)
- Produces: `/barista` renders `BaristaView`; `/` renders the customer flow.

- [ ] **Step 1: Delete the login component**

```bash
git rm src/lib/BaristaLogin.svelte
```

- [ ] **Step 2: Rewrite the script block of `src/App.svelte`**

Replace lines 1-61 (the entire `<script>` block) with:

```svelte
<script>
  import { onMount } from "svelte";
  import CustomerView from "./lib/CustomerView.svelte";
  import BaristaView from "./lib/BaristaView.svelte";
  import Icons from "./lib/Icons.svelte";
  import { getActiveOrder } from "./lib/api";

  // Cloudflare Access gates /barista at the edge; reaching this path at all
  // means the request already carried a valid Access JWT.
  const isBarista = window.location.pathname.startsWith("/barista");

  let customerName = "";
  let submittedCustomerName = "";
  let loading = true;
  let initialOrderId = null;

  onMount(async () => {
    if (!isBarista) {
      try {
        const active = await getActiveOrder();
        if (active) {
          submittedCustomerName = active.customer_name;
          initialOrderId = active.id;
        } else {
          customerName = localStorage.getItem("cafecito-customer-name") ?? "";
        }
      } catch (e) {
        // fall through to the normal name form
      }
    }
    loading = false;
  });

  function handleNameSubmit() {
    if (customerName.trim()) {
      submittedCustomerName = customerName.trim();
      localStorage.setItem("cafecito-customer-name", submittedCustomerName);
      customerName = "";
    }
  }
</script>
```

- [ ] **Step 3: Update the markup block of `src/App.svelte`**

Replace the outer conditional (previously lines 63-122) so it routes on `isBarista` rather than on a session, and so the barista button is a link:

```svelte
<div class="min-h-screen bg-gray-100 flex flex-col">
  {#if loading}
    <p class="text-center mt-8">Loading...</p>
  {:else if isBarista}
    <BaristaView />
  {:else if !submittedCustomerName}
    <div class="flex flex-col min-h-screen">
      <!-- Customer name input form -->
      <header class="bg-white shadow">
        <div class="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 flex justify-center">
          <h1
            class="text-6xl font-bold text-primary font-display yesteryear-regular"
            style="-webkit-text-stroke: 8px #000; paint-order: stroke fill;"
          >
            Cafecito
          </h1>
        </div>
      </header>
      <div class="flex-grow flex items-center justify-center">
        <form
          on:submit|preventDefault={handleNameSubmit}
          class="space-y-4 bg-white shadow-md rounded px-8 pt-6 pb-8 mb-4 max-w-md w-full"
        >
          <h2 class="text-2xl font-bold text-center mb-4">Welcome!</h2>
          <div class="flex justify-center m-4">
            <Icons name="stylized-cup" size={100} color={"#93A8AC"} />
          </div>
          <input
            type="text"
            id="firstName"
            bind:value={customerName}
            placeholder="Enter your name"
            class="w-full px-3 py-2 border border-gray-300 rounded-md"
          />
          <button
            type="submit"
            class="w-full bg-primary text-white px-4 py-2 rounded-md hover:bg-accent"
          >
            Start Order
          </button>
        </form>
      </div>
    </div>
    <a
      href="/barista"
      class="fixed bottom-4 right-4 bg-gray-200 text-gray-700 p-2 rounded-full hover:bg-gray-300"
      aria-label="Barista Login"
    >
      <Icons name="person" size={24} />
    </a>
  {:else}
    <CustomerView customerName={submittedCustomerName} {initialOrderId} />
  {/if}
</div>
```

- [ ] **Step 4: Drop the session guard in `src/lib/CustomerView.svelte`**

Change the import on line 10 from:

```js
  import { userSession, getMenuItems, submitOrder, getQueueStats } from "./api";
```

to:

```js
  import { getMenuItems, submitOrder, getQueueStats } from "./api";
```

Then change the submit guard on line 105 from:

```js
    if (orderItems.length === 0 || !$userSession || submitting) return;
```

to:

```js
    if (orderItems.length === 0 || submitting) return;
```

The cookie is always present because the Worker mints one on the first request.

- [ ] **Step 5: Give retried submits a stable id**

Still in `src/lib/CustomerView.svelte`, add a component-level variable next to the other `let` declarations:

```js
  let submissionId = null;
```

In the submit handler, immediately after the guard from Step 4, add:

```js
    // Reused across retries so a lost response cannot create a second order.
    if (!submissionId) submissionId = crypto.randomUUID();
```

Pass it through the existing `submitOrder` call:

```js
    const { orderId } = await submitOrder(customerName, orderItems, submissionId);
```

And clear it once the order is accepted, next to wherever the cart is reset:

```js
    submissionId = null;
```

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: PASS, no unresolved imports.

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS — both projects.

- [ ] **Step 8: Commit**

```bash
git add src
git commit -m "feat: route baristas by path and drop supabase session handling"
```

---

### Task 14: GitOps pipeline and documentation

**Files:**
- Create: `.github/workflows/deploy.yml`
- Modify: `README.md`
- Delete: `schema.sql`, `rls.sql`, `functions.sql`

**Interfaces:**
- Consumes: everything above
- Produces: CI on PRs; migrate-then-deploy on merge to `main`.

- [ ] **Step 1: Create the Cloudflare API token**

In the Cloudflare dashboard, create an API token with **Workers Scripts: Edit**, **D1: Edit**, and **Account Settings: Read**. Add it to the GitHub repository as the secret `CLOUDFLARE_API_TOKEN`, and add your account id as `CLOUDFLARE_ACCOUNT_ID`.

- [ ] **Step 2: Set the cookie signing secret**

```bash
openssl rand -base64 32 | npx wrangler secret put COOKIE_SECRET
```

This persists across deploys and never enters the repository or CI.

- [ ] **Step 3: Write `.github/workflows/deploy.yml`**

```yaml
name: CI / Deploy

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  # Never let two deploys race the same migration.
  group: deploy
  cancel-in-progress: false

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
      - name: Validate wrangler config
        run: npx wrangler deploy --dry-run
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

  deploy:
    needs: verify
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      # Migrations run before code. Every migration must therefore be
      # backward-compatible with the currently deployed Worker.
      - name: Apply D1 migrations
        run: npx wrangler d1 migrations apply cafecito --remote
      - name: Deploy Worker
        run: npx wrangler deploy
```

- [ ] **Step 4: Remove the Supabase SQL files**

```bash
git rm schema.sql rls.sql functions.sql
```

Their contents now live in `migrations/0001_init.sql` and `worker/db.js`.

- [ ] **Step 5: Rewrite the README backend sections**

Replace the "Prerequisites", "Installation", and "Development" sections of `README.md` with:

```markdown
### Prerequisites

- Node.js 20 or later
- A Cloudflare account with the site's domain as an active zone
- Wrangler (installed as a dev dependency)

### Setup

1. `npm install`
2. Create the database: `npx wrangler d1 create cafecito`, then put the printed
   `database_id` in `wrangler.toml`.
3. Apply migrations locally: `npx wrangler d1 migrations apply cafecito --local`
4. Set the cookie signing secret:
   `openssl rand -base64 32 | npx wrangler secret put COOKIE_SECRET`

### Cloudflare Access (barista login)

Access policies are dashboard configuration and are **not** reproduced by a
deploy. Two self-hosted applications are required:

| Application path | Purpose |
|---|---|
| `<domain>/barista*` | Redirects unauthenticated visitors to the login screen |
| `<domain>/api/barista/*` | The security boundary the Worker verifies |

Each needs a policy allowing the barista email addresses. Copy the Application
Audience (AUD) tag into `ACCESS_AUD` and the team domain into
`ACCESS_TEAM_DOMAIN` in `wrangler.toml`.

### Development

- `npm run dev` — Vite dev server for the SPA
- `npx wrangler dev` — Worker plus local D1
- `npm test` — unit tests and Worker integration tests
- `npm run test:unit` / `npm run test:worker` — one project at a time

### Deployment

Merging to `main` runs the tests, applies pending D1 migrations, and deploys the
Worker. Migrations run **before** the new code, so every migration must be
backward-compatible with the previously deployed Worker: add columns, never
rename or drop them in the same change that ships dependent code.
```

- [ ] **Step 6: Run the full suite one more time**

Run: `npm test && npm run build`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add .github README.md
git rm --cached schema.sql rls.sql functions.sql 2>/dev/null || true
git commit -m "ci: deploy worker and D1 migrations on merge to main"
```

---

### Task 15: Cutover

Not code — the runbook for going live. Do this **between events**, never before one.

- [ ] **Step 1: Deploy to a staging hostname**

```bash
npx wrangler deploy --name cafecito-staging
```

- [ ] **Step 2: Apply migrations to the remote database**

```bash
npx wrangler d1 migrations apply cafecito --remote
```

- [ ] **Step 3: Run a full fake event**

Against the staging hostname, confirm each of these by hand:

- The customer name form appears, and a name persists across a reload
- The menu renders; marking an item unavailable in the barista view removes it from the customer view within ~5 seconds
- An order can be placed with a milk choice and a customization
- The queue banner shows drinks ahead
- The order status view updates when the barista advances the order
- Cancelling a pending order works; cancelling an in-progress order does not
- Completing three orders makes a wait estimate appear
- The analytics view renders with real fulfillment durations
- `/barista` in a private window redirects to the Cloudflare Access login
- Signing out from the barista view returns to the Access login

- [ ] **Step 4: Point production at the Worker**

In the Cloudflare dashboard, remove the Pages custom domain binding and add the
domain as a Custom Domain on the `cafecito` Worker.

- [ ] **Step 5: Verify production**

Load the site, place one real order, complete it, and confirm the analytics view
shows it.

- [ ] **Step 6: Retire the old infrastructure**

- Delete the `cafecito-staging` Worker
- Delete the Cloudflare Pages project
- Leave the Supabase project in place, paused, for a few weeks as an escape
  hatch. Delete it once you have run a real event on Cloudflare.

- [ ] **Step 7: Commit any config drift**

```bash
git status
git commit -am "chore: post-cutover config" || true
```

---

## Verification Checklist

Before calling the migration done:

- [ ] `npm test` passes — both projects
- [ ] `tests/analytics.test.js` was never modified
- [ ] `grep -r supabase src/ worker/` returns nothing
- [ ] `@supabase/supabase-js` is absent from `package.json`
- [ ] `schema.sql`, `rls.sql`, `functions.sql`, `src/lib/supabase.js`, and `src/lib/BaristaLogin.svelte` are deleted
- [ ] A PR runs CI and does not deploy
- [ ] A merge to `main` applies migrations and deploys
- [ ] Every test in `tests/worker/authorization.test.js` passes
