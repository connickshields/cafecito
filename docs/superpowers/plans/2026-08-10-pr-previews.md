# PR Preview Deployments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every pull request its own working preview URL, running the real app against a throwaway database.

**Architecture:** A `[env.preview]` wrangler environment deploys a second Worker, `cafecito-preview`, with its own D1 binding — so a preview cannot reach production data, because the binding is not there. Per-PR URLs come from `wrangler versions upload --preview-alias pr-<number>`, which makes the URL deterministic and stable for the life of the PR. A new CI job uploads the version and comments the URL.

**Tech Stack:** Cloudflare Workers (wrangler environments, Versions), D1, GitHub Actions, `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-08-10-pr-previews-design.md`

## Global Constraints

- **`routes = []` MUST appear in `[env.preview]`.** Verified against wrangler 4.72.0: a named environment INHERITS the top-level `routes`, and wrangler warns *"Deploying this environment will reassign these custom domains away from the top-level Worker."* It is a warning, not an error, so a CI deploy would proceed and **take `cafecito.connick.me` off production**. This single line is the difference between a preview and an outage.
- **Never run `wrangler deploy --env preview`.** Previews use `wrangler versions upload`, which takes no traffic. A plain deploy would promote preview code to the preview Worker's live URL and is not what any step here wants.
- **Nothing in `[env.preview]` may point at the production database.** The production `database_id` is `473bbbb3-e4b5-4d02-ae58-4851cf35b4a7`; it must not appear anywhere under `[env.preview]`.
- **Production configuration is not modified.** The top-level `name`, `routes`, `workers_dev = false`, `[assets]`, `[[d1_databases]]`, and `[vars]` stay exactly as they are.
- Run `wrangler` directly in the shell, never `npx wrangler`. CI is the exception: runners have no global install, so workflow steps keep `npx --no-install wrangler`, matching the existing steps and pinning the version from `devDependencies`.
- `tests/analytics.test.js` must stay green without modification, as must the whole suite: `npm run test:unit` (57) and `npm run test:worker` (62), plus `npm run build`.
- GitHub Actions: `actions/checkout@v7`, `actions/setup-node@v7`, `node-version: 22` — matching the existing jobs.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `wrangler.toml` | Modify | Add `[env.preview]` with its own name, empty routes, assets, D1 binding, and vars |
| `.github/workflows/deploy.yml` | Modify | Add the `preview` job |
| `README.md` | Modify | Preview setup, what previews cover, how to reset the preview database |

No application code changes. `worker/`, `src/`, and every test file are untouched by this plan.

## Manual prerequisites (account actions — the human runs these)

These cannot be done by an implementer; they need the Cloudflare account and the GitHub repo settings. The controller relays the values.

1. `wrangler d1 create cafecito-preview` — yields the preview `database_id`
2. `openssl rand -base64 32 | wrangler secret put COOKIE_SECRET --env preview` — **after** Task 1 adds `[env.preview]`, since the env must exist first
3. A repository **variable** (not secret) `WORKERS_SUBDOMAIN`, set to the account's workers.dev subdomain, under Settings → Secrets and variables → Actions → Variables

---

### Task 1: Preview environment in wrangler.toml

**Files:**
- Modify: `wrangler.toml`
- Modify: `README.md`

**Interfaces:**
- Consumes: the preview `database_id` from `wrangler d1 create cafecito-preview` (supplied by the controller)
- Produces: a deployable `cafecito-preview` Worker whose preview URLs are `https://pr-<number>-cafecito-preview.<subdomain>.workers.dev`; Task 2's CI job invokes `--env preview` against it

- [ ] **Step 1: Confirm the production config is currently valid**

Establish the baseline before changing anything.

Run: `wrangler deploy --dry-run`
Expected: exits 0. Note that it does **not** print route or custom-domain
information — `--dry-run` makes no API calls. This step only confirms the
config parses today, so a later failure is attributable to your change.

- [ ] **Step 2: Add the preview environment**

Append to `wrangler.toml`, replacing `<PREVIEW_DATABASE_ID>` with the id supplied by the controller:

```toml
# Previews run as a separate Worker with its own bindings. Wrangler does not
# inherit `d1_databases` into an environment, so cafecito-preview physically
# cannot reach the production database -- the binding does not exist here.
[env.preview]
name = "cafecito-preview"

# REQUIRED. Named environments DO inherit top-level `routes`. Without this,
# wrangler warns that deploying preview "will reassign these custom domains
# away from the top-level Worker" -- i.e. it would take cafecito.connick.me
# off production. A warning does not fail CI, so this line is the guardrail.
routes = []

# Production stays off workers.dev; previews need it for their URLs.
workers_dev = true

[env.preview.assets]
directory = "./dist"
binding = "ASSETS"
not_found_handling = "single-page-application"

[[env.preview.d1_databases]]
binding = "DB"
database_name = "cafecito-preview"
database_id = "<PREVIEW_DATABASE_ID>"
migrations_dir = "migrations"

[env.preview.vars]
ACCESS_TEAM_DOMAIN = "blue-band-0b37.cloudflareaccess.com"
ACCESS_AUD = "7ba1daa2e0e4b0bd9024e83df23c27d45d40d3e92daffeee2a56bbdf0851bd22"
```

- [ ] **Step 3: Verify the preview environment does NOT claim the production domain**

This is the acceptance check for the whole task, and it must be done by
**reading the file**, not by running wrangler.

Run: `grep -n -A3 '^\[env.preview\]' wrangler.toml`

Expected: `routes = []` appears in those lines — after the `[env.preview]`
header and **before** `[env.preview.assets]`. TOML scoping is the trap: a key
written after a subtable header belongs to that subtable, so `routes = []`
placed lower in the block is silently inert while looking present.

**Do not substitute a `--dry-run` check here.** Verified during execution: with
`routes = []` deliberately removed, `wrangler deploy --env preview --dry-run`
produces output identical to the correct case on both wrangler 4.72.0 and
4.120.0 — no warning, no route text. `--dry-run` makes no API calls, so it
cannot know which Worker currently owns a route. A dry-run check here would
pass while production was one deploy away from losing its domain.

- [ ] **Step 4: Verify production is still intact**

Wrangler cannot show you this — verify it from the diff instead.

Run: `git diff wrangler.toml | grep '^-'`

Expected: **no output** apart from the `--- a/wrangler.toml` header line. This
change must be purely additive; a single removed line means the top-level
production config was disturbed.

- [ ] **Step 5: Verify the preview binds the preview database**

Run: `wrangler deploy --env preview --dry-run 2>&1 | grep -iE "env.DB|D1"`
Expected: shows a D1 binding for `cafecito-preview`. Confirm the production id `473bbbb3-e4b5-4d02-ae58-4851cf35b4a7` does NOT appear anywhere in the output.

- [ ] **Step 6: Apply migrations to the preview database**

Run: `wrangler d1 migrations apply cafecito-preview --remote --env preview`
Expected: `0001_init.sql` applies successfully.

- [ ] **Step 7: Confirm the preview database is seeded**

Run:

```bash
wrangler d1 execute cafecito-preview --remote --env preview \
  --command "SELECT (SELECT COUNT(*) FROM items) AS items, (SELECT COUNT(*) FROM orders) AS orders" --json
```

Expected: `items` is 8 and `orders` is 0 — the menu seed from the migration, and no order history.

- [ ] **Step 8: Upload a test version and confirm the aliased URL resolves**

This settles the one open question in the spec: whether preview URLs need `preview_urls = true` in addition to `workers_dev = true`.

Run: `wrangler versions upload --env preview --preview-alias pr-0`

Then confirm the URL answers, substituting the account subdomain:

```bash
curl -s -o /dev/null -w "status=%{http_code}\n" https://pr-0-cafecito-preview.<subdomain>.workers.dev/
curl -s https://pr-0-cafecito-preview.<subdomain>.workers.dev/api/menu | head -c 120
```

Expected: root returns 200, and `/api/menu` returns JSON beginning with `{"items":[`.

If the hostname does not resolve, add `preview_urls = true` to `[env.preview]`, re-run the upload, and record the change in your report. If `/api/menu` returns 500, `COOKIE_SECRET` was not set for the preview environment — report that rather than working around it.

- [ ] **Step 9: Confirm the existing suites are unaffected**

Run: `npm run build && npm test`
Expected: build succeeds, unit 57 pass, worker 62 pass.

- [ ] **Step 10: Document the setup in the README**

Add after the existing "GitHub Actions secrets" section:

```markdown
### PR previews

Every pull request from a branch in this repository gets its own preview
deployment at:

    https://pr-<number>-cafecito-preview.<subdomain>.workers.dev

Previews are a separate Worker (`cafecito-preview`) bound to a separate
database (`cafecito-preview`), so nothing a preview does can touch production
data.

One-time setup:

1. `wrangler d1 create cafecito-preview`, and put the id in the
   `[[env.preview.d1_databases]]` block of `wrangler.toml`.
2. `openssl rand -base64 32 | wrangler secret put COOKIE_SECRET --env preview`
   — secrets do not cross Workers, so the preview Worker needs its own. Without
   it every `/api/*` request returns 500, because the Worker fails closed on a
   missing secret.
3. Set a repository **variable** `WORKERS_SUBDOMAIN` to the account's
   workers.dev subdomain (Settings → Secrets and variables → Actions →
   Variables). The workflow composes the preview URL from it.

**`routes = []` in `[env.preview]` is load-bearing.** Named environments
inherit the top-level `routes`, so without it a preview deploy reassigns
`cafecito.connick.me` away from production. Wrangler only warns about this, so
nothing fails the build — it just takes the site down.
```

- [ ] **Step 11: Commit**

```bash
git add wrangler.toml README.md
git commit -m "feat: add preview wrangler environment"
```

---

### Task 2: The preview CI job

**Files:**
- Modify: `.github/workflows/deploy.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: the `[env.preview]` environment from Task 1; the repository variable `WORKERS_SUBDOMAIN`; the existing `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets
- Produces: a `preview` job that comments a preview URL on qualifying pull requests

- [ ] **Step 1: Add the preview job**

Append to `.github/workflows/deploy.yml`, after the `deploy` job. Do not modify the existing `verify` or `deploy` jobs, and do not touch the workflow-level `concurrency` block.

**Corrected during implementation: the `if` block below is wrong, and its
comment is wrong with it.** The two conditions skip fork pull requests only.
Dependabot opens its pull requests from a branch **in this repository**, so
`head.repo.full_name == github.repository` is true for them and they were not
skipped — every Dependabot PR would have failed on missing secrets, the exact
permanently-red check the comment says it is avoiding. The shipped workflow
carries a third condition, `github.actor != 'dependabot[bot]'`, and a comment
that spells out why the repo-name check alone is not enough.

```yaml
  preview:
    needs: verify
    # Fork and Dependabot PRs do not receive repository secrets, so wrangler
    # cannot authenticate. Skipping them keeps their checks green rather than
    # training us to ignore a permanently red X. They still run `verify`.
    if: >
      github.event_name == 'pull_request' &&
      github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    permissions:
      contents: read
      # Scoped to this job only, so the deploy job cannot write to PRs.
      pull-requests: write
    env:
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run build
      # A PR that adds a migration applies it here and then runs the app
      # against it, so a broken migration surfaces in its own PR rather than
      # on merge to main.
      - name: Apply migrations to the preview database
        run: npx --no-install wrangler d1 migrations apply cafecito-preview --remote --env preview
      # `versions upload` takes no traffic. The alias makes the URL
      # deterministic and reassigns to the newest version on each push, so the
      # link stays valid for the life of the PR.
      - name: Upload preview version
        run: npx --no-install wrangler versions upload --env preview --preview-alias pr-${{ github.event.pull_request.number }}
      - name: Comment the preview URL
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PR: ${{ github.event.pull_request.number }}
          SUBDOMAIN: ${{ vars.WORKERS_SUBDOMAIN }}
        run: |
          marker="<!-- cafecito-preview-url -->"
          url="https://pr-${PR}-cafecito-preview.${SUBDOMAIN}.workers.dev"
          # The alias URL is stable across pushes, so comment once rather than
          # editing or stacking a new comment on every commit.
          if gh pr view "$PR" --json comments --jq '.comments[].body' | grep -qF "$marker"; then
            echo "Preview comment already present: $url"
            exit 0
          fi
          # printf with a single-quoted format string: the body contains
          # backticks, which bash would run as command substitution inside a
          # double-quoted string.
          body=$(printf '%s\n**Preview:** %s\n\nRuns against the throwaway `cafecito-preview` database, not production. The barista view renders but its API returns 403 — Cloudflare Access does not cover this hostname.\n' "$marker" "$url")
          gh pr comment "$PR" --body "$body"
```

- [ ] **Step 2: Silence the new "multiple environments" warning on the existing jobs**

Adding `[env.preview]` in Task 1 made the production commands ambiguous.
`wrangler deploy --dry-run` in `verify` and `wrangler deploy` in `deploy` now
print, on every run:

```
▲ [WARNING] Multiple environments are defined in the Wrangler configuration
file, but no target environment was specified for the deploy command.
```

It is harmless — exit code 0, and both still resolve to the top-level
production bindings — but it is permanent noise on exactly the commands whose
clean output people are supposed to keep scrutinising, and noise there erodes
the habit the `routes = []` design depends on.

Add `--env ""` to both existing commands, making the production target
explicit. Change nothing else about those two jobs:

```yaml
        run: npx --no-install wrangler deploy --env "" --dry-run
```

```yaml
        run: npx --no-install wrangler deploy --env ""
```

Then confirm the warning is gone locally:

Run: `npx wrangler deploy --env "" --dry-run 2>&1 | grep -i "multiple environments"`
Expected: **no output**.

Note this uses `npx wrangler` deliberately, not the global install — it pins
the check to 4.72.0, the version CI actually runs. The globally installed
wrangler is a different version.

- [ ] **Step 3: Validate the workflow parses**

Run: `actionlint .github/workflows/deploy.yml`
Expected: no output. If `actionlint` is unavailable, run `python3 -c "import yaml;yaml.safe_load(open('.github/workflows/deploy.yml'));print('ok')"` instead.

- [ ] **Step 4: Confirm the existing jobs are otherwise unchanged**

Run: `git diff .github/workflows/deploy.yml | grep -E "^-" | grep -v "^---"`
Expected: **no output**. This change is purely additive; any removed line means an existing job was disturbed.

- [ ] **Step 5: Confirm the suites and build are unaffected**

Run: `npm run build && npm test`
Expected: build succeeds, unit 57 pass, worker 62 pass.

- [ ] **Step 6: Document preview behavior and the reset procedure**

Append to the README's "PR previews" section from Task 1:

```markdown
**What previews cover:** the customer ordering flow — menu, cart, order
submission, status, and the queue estimate.

**What they do not cover:** barista data (`/api/barista/*` returns 403 because
no Access application covers the preview hostname — the dashboard renders and
shows its error banner), anything Access-specific such as the login redirect,
and custom-domain behavior.

**Resetting the preview database.** All PRs share one preview database, so it
accumulates test orders, and migrations from abandoned PRs stay applied
forever — wrangler tracks applied migrations by filename, so an abandoned
`0002_foo.sql` never goes away and a later real `0002_bar.sql` applies
alongside it. The preview schema can end up a superset of production's. When
that becomes confusing, throw it away:

    wrangler d1 delete cafecito-preview
    wrangler d1 create cafecito-preview

Then update the id in `[[env.preview.d1_databases]]` and commit. Test orders
alone are not a reason to reset — the queue banner and wait estimate need
orders before they show anything interesting.
```

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/deploy.yml README.md
git commit -m "ci: comment a preview URL on pull requests"
```

---

## Verification

There is no automated test for a deploy pipeline worth its maintenance here, so acceptance is one manual pass, performed once after both tasks land:

- [ ] Open a throwaway PR that changes a visible string (for example the "Welcome!" heading in `src/App.svelte`)
- [ ] Confirm the `preview` job runs and succeeds
- [ ] Confirm a comment appears with a `pr-<number>-cafecito-preview` URL
- [ ] Open the URL and confirm the changed string renders
- [ ] Confirm the menu loads — proves assets, cookie minting, and the D1 binding
- [ ] Place an order — proves the write path and migrations
- [ ] Confirm `cafecito.connick.me` still serves production and still shows the *unchanged* string
- [ ] Push a second commit to the PR and confirm the same URL now serves it, with no duplicate comment
- [ ] Close the PR without merging

The seventh check is the important one: it proves the preview did not reassign the production domain.
