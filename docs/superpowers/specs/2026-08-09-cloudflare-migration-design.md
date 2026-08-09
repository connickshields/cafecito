# Backend Migration: Supabase to Cloudflare

Date: 2026-08-09

Move Cafecito's backend off Supabase and onto Cloudflare entirely: D1 for data,
a Worker for the API, Cloudflare Access for barista auth, and a signed cookie
for customer identity. Add GitOps so a merge to `main` ships schema and code
together.

## Motivation

Two problems with the current setup:

1. **Database changes are manual.** `schema.sql`, `rls.sql`, and `functions.sql`
   are applied by hand in the Supabase dashboard. Nothing verifies them, nothing
   records which have been applied, and nothing ties a schema change to the
   commit that needs it.
2. **The free-tier project pauses after a week of inactivity.** Cafecito runs
   intermittent pop-up events, so the backend is frequently asleep between them.

The frontend already deploys from GitHub to Cloudflare Pages. This migration
finishes the job and puts the backend under the same discipline.

## Scope

**In scope:** the database, the API layer, authentication, authorization, and
the deploy pipeline.

**Explicit non-goals:**

- Realtime. The four 5-second polling loops stay exactly as they are. Replacing
  them with WebSockets over a Durable Object is a worthwhile follow-up project
  with its own spec, not part of this migration.
- Data migration. The new database starts empty (see "Fresh start" below).
- Per-PR preview environments. Production only, with CI on PRs.
- Terraform for Access policies. See "Known gap" under GitOps.

## 1. Architecture

### Topology

One Worker serves both the SPA and the API. The Pages project is retired.

```
GET  /                → static asset (SPA shell) — free, no Worker invocation
GET  /barista         → static asset, behind a Cloudflare Access policy
     /api/*           → Worker, cookie-authenticated
     /api/barista/*   → Worker, Access-JWT-authenticated
```

Chosen over keeping Pages alongside a separate `/api` Worker because a schema
change, an API change, and the client change that depends on both ship as one
atomic artifact. Two deploy units on two triggers would mean version skew
between frontend and API, and a two-step rollback.

Same-origin is a requirement, not a preference: it lets the customer cookie be
`HttpOnly` + `SameSite=Lax` with no CORS and no `SameSite=None`, which preserves
CSRF protection for free.

Static asset requests are free and unlimited on Cloudflare and do not count
against the Workers request quota. Only real API calls consume it.

### Routing change in the client

The app has no routing today. Barista mode is client-side state at `/`, toggled
by a floating button and a login modal (`src/App.svelte:66-70`). Cloudflare
Access protects by path, so a path split is required.

- `src/App.svelte` routes on `location.pathname` instead of
  `isBaristaUser($userSession.user)`, and drops the anonymous sign-in in
  `onMount`.
- `src/lib/BaristaLogin.svelte` is **deleted**. Access owns login.
- The floating person button becomes a link to `/barista`.
- `userSession` and `isBaristaUser` are removed. The cookie is invisible to JS
  by design.
- `src/lib/CustomerView.svelte:105` gates order submission on `!$userSession`.
  That term is dropped from the guard; the cookie is always present because the
  Worker mints it on first request. The `orderItems.length` and `submitting`
  checks stay.

### Client API module

`src/lib/supabase.js` is replaced by `src/lib/api.js`, exporting the **same
function names with the same signatures**: `getMenuItems`, `getMilkOptions`,
`getCustomizationOptions`, `submitOrder`, `getOrderDetails`, `getOrders`,
`getActiveOrder`, `getQueueStats`, `cancelOrder`, `updateOrderStatus`,
`updateItemAvailability`, `updateMilkAvailability`,
`updateCustomizationAvailability`.

`signOut` is also retained. `src/lib/BaristaView.svelte:88` calls it, and under
Access it becomes a redirect to `/cdn-cgi/access/logout`. Keeping the export
means `BaristaView.svelte` needs no changes at all.

`signIn` and `signInAnonymously` are dropped — the only caller of `signIn` is
`BaristaLogin.svelte`, which is deleted.

The components requiring edits are therefore only `App.svelte` (routing) and
`CustomerView.svelte` (one line in the submit guard). `Analytics.svelte`,
`Menu.svelte`, `OrderStatus.svelte`, `Cart.svelte`, and `BaristaView.svelte` are
untouched. `@supabase/supabase-js` is removed from `package.json`.

### Repository layout

```
worker/
  index.js         router + fetch handler
  auth.js          cookie mint/verify (HMAC via WebCrypto), Access JWT verify
  db.js            D1 query helpers, row -> JSON reshaping
  routes/
    menu.js
    orders.js
    barista.js
migrations/
  0001_init.sql
src/lib/api.js     replaces supabase.js
wrangler.toml
.github/workflows/deploy.yml
```

`db.js` is a separate module specifically so the four-level nested reshaping
behind `getOrders()` can be unit-tested against fixture rows with no D1 and no
network, the same way `src/lib/analytics.js` is tested today.

## 2. Data model

### Single baseline migration

`migrations/0001_init.sql` contains schema, indexes, triggers, and the menu
seed in one file. There is no history worth preserving across a backend swap.
Incremental migrations start at `0002`.

### Fresh start

The new database begins empty. `items`, `milk_options`, and
`customization_options` are seeded from the `INSERT` statements already in
`schema.sql:67-89`. Order history is not migrated. This removes user-ID mapping
entirely, since `orders.user_id` currently references `auth.users(id)`.

### Type translation

| Postgres | D1 / SQLite |
|---|---|
| `SERIAL PRIMARY KEY` | `INTEGER PRIMARY KEY AUTOINCREMENT` |
| `order_status` enum | `TEXT NOT NULL CHECK (status IN (...))` |
| `user_id UUID REFERENCES auth.users` | `customer_id TEXT NOT NULL`, no FK |
| `VARCHAR(n)` | `TEXT` |
| `BOOLEAN` | `INTEGER NOT NULL CHECK (x IN (0,1))` |

### Timestamps are explicitly ISO-8601 UTC

Column defaults use `strftime('%Y-%m-%dT%H:%M:%SZ','now')`, not
`datetime('now')`.

`datetime('now')` produces `2026-08-09 14:48:00` — space-separated, no zone.
Safari's `Date` parser handles that inconsistently, and customers are on
iPhones. The `strftime` form reproduces the exact string shape Supabase returns
today, so `analytics.js`, `waitEstimate.js`, and the existing tests need no
changes.

### `updated_at` triggers are kept

Ported to SQLite rather than setting the column in Worker code.
`orders.updated_at` is the completion timestamp that the drain-rate calculation
in `get_queue_stats` depends on (`functions.sql:30-56`). A single forgotten
`SET updated_at` in one code path would silently skew every wait estimate.
Triggers make it unforgettable. With `recursive_triggers` off (SQLite's
default), a plain `AFTER UPDATE` trigger does not re-fire itself.

### Indexes

The current schema has none beyond primary keys. Postgres tolerated this; D1
bills by **rows read**, so an unindexed `order_items` scan on every 5-second
barista poll consumes free-tier quota directly.

- `orders(status, created_at)`
- `orders(customer_id)`
- `order_items(order_id)`
- `order_item_customizations(order_item_id)`

### Atomic order creation without plpgsql

`create_order` is plpgsql today because it needs generated IDs mid-transaction:
insert the order, use its id for items, use each item's id for customizations.

D1's `batch()` is a transaction, but all statements are submitted together, so
no statement can consume a previous statement's result. There is no procedural
fallback.

**Resolution:** the **client** generates a `submission_id` (UUID) and the Worker
generates the child rows' own ids before the batch. The parent is then addressed
by `submission_id` instead of by its unknown autoincrement id:

```sql
INSERT INTO orders (customer_id, customer_name, status, submission_id)
  VALUES (?, ?, 'pending', ?);

INSERT INTO order_items (id, order_id, item_id, milk_option_id, quantity)
  VALUES (?, (SELECT id FROM orders WHERE submission_id = ?), ?, ?, ?);

INSERT INTO order_item_customizations (order_item_id, customization_option_id)
  VALUES (?, ?);
```

All statements go in one `batch()`, preserving the atomicity gained in #15.

`submission_id` carries a `UNIQUE` constraint, which makes submits
**idempotent**: a retry on bad café wifi violates the constraint, and the
handler returns the existing order rather than creating a duplicate. The current
Supabase implementation does create duplicates in this case.

The client must own this value for that guarantee to hold. If the Worker
generated it, a retried request would carry a fresh id and duplicate anyway.
`CustomerView.svelte` therefore generates the UUID when a submit is first
attempted, holds it across retries, and clears it only once the order is
accepted. `submitOrder(customerName, orderItems, submissionId)` takes it as an
optional third argument and generates one when omitted.

## 3. API surface

Twelve routes replace the PostgREST calls and two RPCs.

| Route | Replaces | Auth |
|---|---|---|
| `GET /api/menu` | `getMenuItems`, `getMilkOptions`, `getCustomizationOptions` | cookie |
| `POST /api/orders` | `create_order` RPC | cookie |
| `GET /api/orders/active` | `getActiveOrder` | cookie |
| `GET /api/orders/:id` | `getOrderDetails` | cookie + ownership |
| `POST /api/orders/:id/cancel` | `cancelOrder` | cookie + ownership |
| `GET /api/queue-stats` | `get_queue_stats` RPC | cookie |
| `GET /api/barista/menu` | `getMenuItems(true)` and siblings | Access |
| `GET /api/barista/orders` | `getOrders` | Access |
| `PATCH /api/barista/orders/:id` | `updateOrderStatus` | Access |
| `PATCH /api/barista/items/:id` | `updateItemAvailability` | Access |
| `PATCH /api/barista/milk/:id` | `updateMilkAvailability` | Access |
| `PATCH /api/barista/customizations/:id` | `updateCustomizationAvailability` | Access |

The barista view needs unavailable rows too (it is where availability gets
toggled). That is a **separate Access-gated route**, `GET /api/barista/menu`,
rather than an `?include_unavailable=1` flag on the customer endpoint. A query
parameter would let any customer widen their own view by editing a URL; a
separate mount point cannot be widened at all. `api.js` selects the route from
the existing `includeUnavailable` argument, so callers are unchanged.

### Collapsing the menu reads

`src/lib/Menu.svelte:31` polls `refreshOptions` every 5 seconds, which today
fans out into three separate PostgREST round-trips. A single `/api/menu`
response cuts customer request volume by roughly two-thirds against the
100k/day Workers quota.

`api.js` still exports all three legacy functions; they share one coalesced
in-flight request, so no component changes.

## 4. Authentication and authorization

### Customer identity

A signed, `HttpOnly`, `Secure`, `SameSite=Lax` cookie carrying a random
`customer_id` (UUID), minted by the Worker on first visit and signed with
HMAC-SHA256 via WebCrypto. This replaces GoTrue anonymous sign-in and the
`auth.users` row it created.

Behavior matches today's: per-browser, survives reloads, does not roam across
devices.

### Barista identity

Cloudflare Access, free for up to 50 users, with email one-time-PIN login. No
passwords are stored or handled by this application.

Two Access policies on the existing custom domain:

- `/barista*` — so an unauthenticated visitor is redirected to Cloudflare's
  login screen. This is UX.
- `/api/barista/*` — this is the security boundary.

The Worker independently verifies the `Cf-Access-Jwt-Assertion` header against
the team's JWKS rather than trusting the path, so a misconfigured Access rule
cannot silently expose the API.

**Prerequisite:** Access self-hosted applications require an active Cloudflare
zone. `workers.dev` cannot be protected this way. The project's existing custom
domain satisfies this.

### RLS becomes explicit checks

The policies in `rls.sql` disappear. Two structural rules replace them, chosen
because a per-handler check is a thing you can forget:

**Authorization by route mount, not per handler.** Everything under
`/api/barista/*` passes through one `requireBarista` middleware that verifies
the Access JWT. Everything under `/api/*` passes through `withCustomer`, which
mints-or-verifies the cookie and attaches `customerId`. Adding a route cannot
accidentally ship unprotected, because the mount point already decided.

**Ownership lives in SQL, not JavaScript.** Customer order queries always carry
`AND customer_id = ?` in the `WHERE` clause rather than fetching a row and
branching on it. Zero rows is a 404. Fetch-then-check has a failure mode RLS did
not: you can read the row and forget the branch. Putting the predicate in the
query removes that shape.

Two rules carried over verbatim from the current implementation:

- `customer_id` always comes from the cookie, never from the request body —
  mirroring `auth.uid()` in `functions.sql:84`.
- `/api/queue-stats` returns only bare aggregates, never order rows —
  preserving what `SECURITY DEFINER` was buying.

### Availability validation (new)

`create_order` does not validate availability today. Foreign keys prove an item
exists, but nothing stops a client from ordering an item a barista just marked
unavailable. Since the insert is being rewritten, `POST /api/orders` validates
`available = 1` for every referenced item, milk option, and customization, and
returns 409 on violation.

This is a deliberate, small scope addition that closes a real hole.

## 5. GitOps

### Pipeline

`.github/workflows/deploy.yml`:

- **On pull request:** `npm test`, `npm run build`, and
  `wrangler deploy --dry-run` to validate `wrangler.toml` without deploying.
- **On push to `main`**, in order:
  1. `npm test` — a red build deploys nothing
  2. `wrangler d1 migrations apply cafecito --remote`
  3. `wrangler deploy`

A `concurrency: { group: deploy, cancel-in-progress: false }` block prevents two
deploys racing migrations.

### Migration discipline

Migrations run before code, and `wrangler rollback` reverts the Worker but
nothing reverts a migration. Therefore **every migration must be
backward-compatible with the previous deploy**: add columns, never rename or
drop them; drop only in a later migration once no running code references them.
Expand, then contract.

This rule is what keeps "merges to main deploy" from becoming "a bad merge takes
down the café mid-event."

### Secrets

Only `CLOUDFLARE_API_TOKEN` lives in GitHub Actions secrets. `COOKIE_SECRET` is
set once via `wrangler secret put` and persists across deploys, so it never
touches the repository or CI.

### Known gap

Cloudflare Access policies are dashboard configuration and will not be under
GitOps. Terraform would close this, but for two policies on one application it
is more machinery than it is worth. The policies are documented in the README
instead. This is the one part of the system a merge to `main` does not
reproduce.

## 6. Testing

`tests/analytics.test.js` must stay green **without modification**. That is the
acceptance check on the ISO-8601 timestamp decision — if it passes untouched,
the format is correct.

Three new layers:

**Pure units.** `db.js` row-reshaping against fixture rows (no D1, no network).
`auth.js` cookie sign/verify round-trip and tamper rejection. Same style as the
existing analytics tests.

**Worker integration** via `@cloudflare/vitest-pool-workers`, running the real
Worker against a real local D1. It applies `0001_init.sql` to a fresh database,
so the migration itself is exercised on every PR — the thing that has been
manual and unverified until now.

**Authorization regression tests**, one per replaced RLS policy. These are the
net under the riskiest part of the migration:

- Customer A requesting customer B's order id receives 404
- Customer A cannot cancel customer B's order
- A customer can only cancel an order in `pending` status
- `/api/queue-stats` never returns order rows
- `/api/barista/*` rejects a missing, expired, or forged Access JWT
- `POST /api/orders` ignores any `customer_id` supplied in the request body

## 7. Cutover

No data migration, so the sequence is short:

1. Deploy the Worker to a staging hostname.
2. Run a full fake event end to end: place orders, advance them through
   statuses, cancel one, confirm the wait estimate behaves.
3. Point the production route at the Worker.
4. Retire the Pages project.

**Cut over between events, not before one.** With a fresh database there is no
rollback that preserves real orders once customers start ordering.

Keep the Supabase project for a few weeks afterward. A paused free project costs
nothing and is the escape hatch if something structural surfaces.
