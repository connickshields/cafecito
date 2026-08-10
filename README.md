# Cafecito
## Overview

Cafecito is a web application that was created to help me track orders when running neighborhood pop-up coffee events. It's built using Svelte for the frontend, Vite as the build tool, and Supabase for backend services.

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