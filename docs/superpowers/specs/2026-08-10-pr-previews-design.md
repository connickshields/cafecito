# Per-PR Preview Deployments

Date: 2026-08-10

Give every pull request its own working preview URL, replacing what Cloudflare
Pages provided before the backend migration.

## Motivation

Pages built a preview for each PR. The migration retired Pages, and the
preview capability went with it. It cannot simply be kept: Pages serves static
assets only, and since the migration the frontend gets its menu, queue, and
order status from `/api/*`. A Pages preview would render the shell and nothing
else — the exact failure that took production down on 2026-08-10 when Pages
deployed the new frontend with no Worker behind it.

This revisits an explicit non-goal of the migration spec
(`2026-08-09-cloudflare-migration-design.md`, "Per-PR preview environments.
Production only, with CI on PRs"). That call was right for the migration and is
being changed deliberately now.

## Purpose and scope

**What previews are for:** eyeballing frontend changes — layout, copy, styling
— rendered against a real backend.

**In scope:** the customer-facing ordering flow, running against a throwaway
database, on a per-PR URL posted to the pull request.

**Explicit non-goals:**

- A working barista dashboard in preview. It renders and shows its error
  banner; see "What previews cannot show".
- Per-PR isolated databases. One shared throwaway database serves all previews.
- Automated tests against preview URLs. Verification is a one-time manual
  acceptance check.
- Previews for fork or Dependabot pull requests. They cannot receive the
  secrets a deploy needs.

## 1. Architecture

### A separate preview Worker

A wrangler environment deploys as its own Worker with its own bindings:

```toml
[env.preview]
name = "cafecito-preview"
workers_dev = true
```

Wrangler environments do **not** inherit `vars`, `assets`, or `d1_databases` —
each is redeclared under `[env.preview.*]`. That non-inheritance is the safety
property this design rests on: the preview Worker has no binding to the
production database, so it cannot reach production data even by mistake.

Production configuration is untouched. `cafecito.connick.me` and
`workers_dev = false` stay exactly as they are; `workers_dev = true` applies
only to the preview environment.

The preview environment redeclares:

- `[env.preview.assets]` — same `./dist` directory, same
  `not_found_handling = "single-page-application"`
- `[[env.preview.d1_databases]]` — binding `DB`, database `cafecito-preview`,
  same `migrations_dir`
- `[env.preview.vars]` — the same `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`

### Per-PR URLs come from versions

`wrangler versions upload --env preview` uploads a version that receives no
traffic and carries its own hostname.

Crucially, it accepts `--preview-alias`, which names the version. Aliasing each
upload to the pull request number makes the preview URL **deterministic**:

```
https://pr-<number>-cafecito-preview.<subdomain>.workers.dev
```

This is better than reading a per-version URL out of the upload output in two
ways. There is nothing to parse — `versions upload` has no `--json` mode, so
extracting a URL would mean scraping human-readable stdout and breaking on any
wording change. And the alias reassigns to the newest version on each push, so
the URL is stable for the life of the PR: the comment is posted once and never
needs updating.

`<subdomain>` is the account's workers.dev subdomain. It is fixed per account
and printed the first time the preview Worker is deployed with
`workers_dev = true`. Capture it then and store it as a repository variable
(`vars.WORKERS_SUBDOMAIN`) so the workflow composes the URL without a lookup.

This is chosen over `wrangler deploy --env preview`, which overwrites a single
shared hostname. With a single hostname, two open PRs — routine here, since
Dependabot opens its own — resolve to whichever pushed last, and the preview
silently shows the wrong branch.

### The preview Worker needs its own `COOKIE_SECRET`

Secrets do not cross Workers. `cafecito-preview` is a distinct Worker and
therefore needs its own:

```bash
openssl rand -base64 32 | wrangler secret put COOKIE_SECRET --env preview
```

Without it, the fail-closed guard in `withCustomer` throws and every `/api/*`
request returns 500 — a preview that looks like a broken build. This is a
one-time setup step, and it fails silently in the sense that nothing warns you
until a preview is already up, so it belongs in the README beside the other
secrets.

## 2. Workflow

A third job in `.github/workflows/deploy.yml`, gated on `verify` so a PR that
fails its tests never gets a URL.

```yaml
  preview:
    needs: verify
    if: >
      github.event_name == 'pull_request' &&
      github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
```

The `if` condition skips fork and Dependabot pull requests. GitHub withholds
repository secrets from both, so `wrangler` cannot authenticate and the job
would fail every time. A permanently red check on every Dependabot PR teaches
you to ignore red checks, which is worse than having no preview. Those PRs
still run `verify`.

`pull-requests: write` is scoped to this job alone, not the workflow, so the
deploy job cannot write to pull requests.

### Steps

1. `npm ci`
2. `npm run build` — jobs do not share a filesystem, so this rebuilds rather
   than reusing `verify`'s output. It costs about a second.
3. `npx --no-install wrangler d1 migrations apply cafecito-preview --remote --env preview`
4. `npx --no-install wrangler versions upload --env preview --preview-alias pr-${{ github.event.pull_request.number }}`
5. Post a PR comment with the composed URL, if one is not already there

Step 3 is worth more than it looks. A PR that adds a migration applies it to
the preview database and then runs the app against it, so a broken migration
surfaces in its own pull request rather than on merge to `main`. The migration
project had no such rehearsal.

Local commands in this document invoke `wrangler` directly. The CI steps keep
`npx --no-install`, matching the existing workflow: a runner has no global
wrangler, and `--no-install` resolves the version pinned in `devDependencies`
rather than fetching whatever is latest.

### One detail to verify during implementation

Whether preview URLs require an explicit `preview_urls = true` alongside
`workers_dev = true` on the preview environment. This cannot be settled from
the CLI without deploying; the first preview deploy answers it. If aliased URLs
do not resolve, add the flag.

An alias also has to be valid as a hostname label. `pr-<number>` always is.

### Concurrency is left alone

The existing workflow-level `concurrency` block stays as it is. Preview builds
are cheap, and altering the shared lane risks reintroducing the deploy-eviction
problem it was recently fixed to avoid.

## 3. The preview database

### Creation

One-time and manual, exactly like production:

```bash
wrangler d1 create cafecito-preview
```

Its id goes into `[[env.preview.d1_databases]]`. Applying `0001_init.sql` gives
it the full menu, because the seed lives inside the migration — a fresh preview
database is immediately usable with no separate seeding step.

### Drift is accepted, not prevented

One shared database across all pull requests accumulates two kinds of junk:

- **Test orders** from clicking through previews. Harmless, and mildly useful:
  the queue banner and wait estimate need orders before they show anything.
- **Migrations from abandoned PRs.** Wrangler tracks applied migrations by
  filename, so an abandoned `0002_foo.sql` stays applied to the preview
  database permanently, and a later real `0002_bar.sql` applies alongside it.
  The preview schema can become a superset of production's.

The remedy is that the database is disposable: delete it, recreate it, update
the id, commit. This is rare enough not to automate but must be documented in
the README — an unexplained preview-only schema difference six months from now
would otherwise cost an afternoon.

## 4. What previews cannot show

- **Barista data.** `/api/barista/*` returns 403 because no Access application
  covers the preview hostname and the Worker still requires a valid Access JWT.
  The dashboard renders and displays its error banner. This is accepted: the
  banner state is itself worth being able to look at.
- **Anything Access-specific** — the login redirect, session expiry behavior.
- **Custom-domain behavior.**

Everything else carries over. workers.dev is HTTPS, so the `Secure` cookie and
`crypto.randomUUID()` both work, and `SameSite=Lax` is unaffected because a
preview is same-origin with its own API.

## 5. Verification

A single manual acceptance check, performed once when the feature lands:

1. Open a throwaway PR changing a visible string.
2. Confirm a comment appears on the PR with a preview URL.
3. Open the URL and confirm the changed string renders.
4. Place an order.

If the order submits, the whole chain is proven: assets, cookie minting,
D1 binding, and migrations. No automated test of the pipeline itself is worth
its maintenance at this scale.

## 6. Documentation

The README gains, alongside the existing secrets section:

- Creating `cafecito-preview` and where its id goes
- Setting `COOKIE_SECRET` for the preview environment
- What previews do and do not cover
- How to reset the preview database when it drifts
