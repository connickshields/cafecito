# Cafecito
## Overview

Cafecito is a web application that was created to help me track orders when running neighborhood pop-up coffee events. It's a Svelte SPA built with Vite, served by a Cloudflare Worker that also provides the API, backed by D1, with barista access gated by Cloudflare Access.

## Getting Started

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
5. For `npx wrangler dev` (local development), Worker secrets are not read
   from the Cloudflare account — create a `.dev.vars` file (already
   git-ignored) in the project root instead:
   ```
   COOKIE_SECRET=some-local-only-value
   ```
   Without it, `withCustomer` throws on every request and `wrangler dev`
   answers with a 500, by design — see the note below.

**Setting or rotating `COOKIE_SECRET` invalidates every live customer
cookie.** The Worker fails closed if the secret is missing (a missing secret
used to mean every cookie was signed with the literal string `"undefined"`,
which is silently guessable — now it's a loud 500 instead). But that same
fail-closed check means rotating the secret mid-event immediately
un-verifies every cookie already handed out: every customer loses their
order-status screen and gets a fresh identity on their next request. Only
rotate between events, never during one.

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

### GitHub Actions secrets

The `deploy` job in `.github/workflows/deploy.yml` needs two **repository**
secrets — set them under the repo's Settings → Secrets and variables →
Actions:

| Secret | Where it comes from |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create Token. See the permissions below — it needs zone-scoped ones as well as account-scoped |
| `CLOUDFLARE_ACCOUNT_ID` | The account id shown in the sidebar of any zone's overview page in the Cloudflare dashboard |

The token needs all five of these:

| Scope | Permission | Why |
|---|---|---|
| Account | Workers Scripts → Edit | Upload the Worker |
| Account | D1 → Edit | Apply migrations |
| Account | Account Settings → Read | Resolve the account |
| Zone | Workers Routes → Edit | Attach `cafecito.connick.me` to the Worker |
| Zone | Zone → Read | Resolve the zone the route belongs to |

Set **Zone Resources** to include the `connick.me` zone. The two zone-scoped
rows are easy to miss: without them the Worker still uploads successfully and
the deploy fails only at the very end, on the route, with a bare
`Authentication error [code: 10000]`.

These are distinct from `COOKIE_SECRET`: `COOKIE_SECRET` is a Worker secret
set via `wrangler secret put` (see Setup, above) and lives only in
Cloudflare — it never touches CI. Without the two repo secrets above, the
`deploy` job will fail on merge to `main` (the `verify` job's `wrangler
deploy --dry-run` check does not need them, which is why it also runs safely
on pull requests from forks).

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