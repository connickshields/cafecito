# Menu Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the availability-only slide-over — and the raw SQL editing Supabase used to allow — with a full-page menu manager that can create, edit, reorder, and archive drinks, milks, and customizations.

**Architecture:** One additive D1 migration adds `sort_order`, `archived`, and two item↔option join tables. Menu reads and menu writes move out of the 300-line `worker/db.js` into a focused `worker/menu-db.js`. New CRUD routes mount under the existing `/api/barista/*` authorization boundary, so no new route implements its own auth check. The UI is three Svelte components following the `Analytics.svelte` full-page overlay pattern.

**Tech Stack:** Cloudflare Workers, D1 (SQLite), Svelte 4, Tailwind, Vitest (node project + `@cloudflare/vitest-pool-workers`).

**Spec:** `docs/superpowers/specs/2026-08-10-menu-management-design.md`

## Global Constraints

- **Migrations run BEFORE the new Worker deploys.** Every migration statement must leave the currently-deployed Worker working. Add columns and tables; never rename or drop one in the same change that ships dependent code.
- **Never modify `tests/analytics.test.js` or `tests/worker/authorization.test.js`.**
- **Node tests live at `tests/*.test.js`** — `vite.config.js` sets `include: ['tests/*.test.js']`, which is **not recursive**. A node test in a subdirectory is silently never run.
- **Worker tests live at `tests/worker/**/*.test.js`** and run under a separate config (`vitest.worker.config.js`).
- **The workers pool rolls back D1 writes between tests** (verified empirically). Tests may mutate freely; do not add cleanup `beforeEach` blocks for your own writes.
- **Style:** `worker/**/*.js` and `src/lib/*.js` use **no semicolons**. `.svelte` files **use semicolons**. Two-space indent throughout.
- **Run `wrangler` directly, never `npx wrangler`,** for any local command.
- **Tailwind theme colors:** `primary` = `#FFCF33`, `accent` = `#F5BC00`.
- `npm test` (both projects) must be green before every commit.
- Baseline before any work: **57 node tests, 62 worker tests**.

## File Structure

**Create**

| File | Responsibility |
|---|---|
| `migrations/0002_menu_management.sql` | Schema: ordering, archival, applicability, type labels |
| `worker/menu-db.js` | All menu reads and menu writes |
| `worker/routes/body.js` | `readJsonBody`, shared by two route modules |
| `src/lib/menuGrouping.js` | Pure `groupByType` helper |
| `src/lib/MenuManager.svelte` | Page chrome, data loading, save orchestration |
| `src/lib/MenuSection.svelte` | One kind's card: rows, reorder, add, archived disclosure |
| `src/lib/MenuRowEditor.svelte` | The inline edit form |
| `tests/menu-grouping.test.js` | Node test for `groupByType` |
| `tests/worker/menu-manager.test.js` | HTTP-level tests for the new routes |

**Modify**

| File | Change |
|---|---|
| `worker/db.js` | Lose menu reads (moved out); later lose `updateAvailability` |
| `worker/routes/menu.js` | Grows from 4 lines to hold the admin handlers |
| `worker/routes/barista.js` | Delegate `/api/barista/menu*`; later drop availability routes |
| `src/lib/api.js` | Add four client functions; later drop three |
| `src/lib/BaristaView.svelte` | Delete the slide-over; open the new page |
| `src/lib/Menu.svelte` | Filtered + grouped pickers |
| `src/types.d.ts` | `MenuItem` gains four fields |
| `tests/worker/menu-db.test.js` | Follows the module; gains CRUD tests |
| `tests/worker/migration.test.js` | Gains a `0002` describe block |
| `tests/worker/barista-routes.test.js` | Loses availability-route cases |
| `README.md` | "Managing the menu" section |

---

### Task 1: Migration 0002

**Files:**
- Create: `migrations/0002_menu_management.sql`
- Test: `tests/worker/migration.test.js` (append a describe block)

**Interfaces:**
- Consumes: nothing
- Produces: columns `sort_order` and `archived` on `items`, `milk_options`, `customization_options`; tables `item_milk_options(item_id, milk_option_id)` and `item_customization_options(item_id, customization_option_id)`; `customization_options.type` values rewritten to `Syrups` / `Toppings` / `Coffee`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/worker/migration.test.js`:

```js
describe('0002_menu_management', () => {
  it('backfills sort_order to the previous alphabetical order', async () => {
    const { results } = await env.DB.prepare('SELECT name FROM items ORDER BY sort_order').all()
    expect(results.map((r) => r.name)).toEqual([
      'Americano', 'Cappuccino', 'Cortado', 'Espresso', 'Flat White', 'Latte', 'Matcha Latte', 'Mocha',
    ])
  })

  it('backfills milk links only for drinks that previously allowed milk', async () => {
    const espresso = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM item_milk_options l
         JOIN items i ON i.id = l.item_id WHERE i.name = 'Espresso'`
    ).first()
    const cappuccino = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM item_milk_options l
         JOIN items i ON i.id = l.item_id WHERE i.name = 'Cappuccino'`
    ).first()
    const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM item_milk_options').first()

    expect(espresso.n).toBe(0)
    expect(cappuccino.n).toBe(4)
    // 5 drinks allowed milk x 4 milks
    expect(total.n).toBe(20)
  })

  it('backfills customization links only for drinks that previously allowed them', async () => {
    const matcha = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM item_customization_options l
         JOIN items i ON i.id = l.item_id WHERE i.name = 'Matcha Latte'`
    ).first()
    const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM item_customization_options').first()

    // Matcha Latte took milk but not customizations -- the exact case the old
    // all-or-nothing booleans could not express.
    expect(matcha.n).toBe(0)
    // 4 drinks allowed customizations x 6 options
    expect(total.n).toBe(24)
  })

  it('rewrites customization types into display headings', async () => {
    const { results } = await env.DB.prepare(
      'SELECT DISTINCT type FROM customization_options ORDER BY type'
    ).all()
    expect(results.map((r) => r.type)).toEqual(['Coffee', 'Syrups', 'Toppings'])
  })

  it('defaults archived to 0 and rejects any other value', async () => {
    const row = await env.DB.prepare('SELECT archived FROM items WHERE name = ?').bind('Latte').first()
    expect(row.archived).toBe(0)

    await expect(
      env.DB.prepare('UPDATE items SET archived = 2 WHERE name = ?').bind('Latte').run()
    ).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npm run test:worker -- tests/worker/migration.test.js`
Expected: FAIL — `no such column: sort_order`, `no such table: item_milk_options`.

- [ ] **Step 3: Write the migration**

Create `migrations/0002_menu_management.sql`:

```sql
-- Menu management: display order, archival, per-item applicability, and
-- customization type labels.
--
-- Additive only. D1 migrations run BEFORE the new Worker deploys, so every
-- statement here has to leave the currently-deployed Worker working.

ALTER TABLE items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE milk_options ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customization_options ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- Backfill each row to its current alphabetical position, so the customer
-- menu is unchanged the moment this deploys.
UPDATE items SET sort_order =
  (SELECT COUNT(*) FROM items AS other WHERE other.name < items.name);
UPDATE milk_options SET sort_order =
  (SELECT COUNT(*) FROM milk_options AS other WHERE other.name < milk_options.name);
UPDATE customization_options SET sort_order =
  (SELECT COUNT(*) FROM customization_options AS other
    WHERE other.name < customization_options.name);

-- Nothing is ever hard-deleted: order_items holds a foreign key into items,
-- and analytics reads drink names through that join, so a delete would
-- rewrite history. Archiving hides a row from the menu and keeps it readable.
ALTER TABLE items ADD COLUMN archived INTEGER NOT NULL DEFAULT 0
  CHECK (archived IN (0,1));
ALTER TABLE milk_options ADD COLUMN archived INTEGER NOT NULL DEFAULT 0
  CHECK (archived IN (0,1));
ALTER TABLE customization_options ADD COLUMN archived INTEGER NOT NULL DEFAULT 0
  CHECK (archived IN (0,1));

-- Per-item applicability, replacing items.allows_milk_choice and
-- items.allows_customizations. Those were all-or-nothing: Matcha Latte could
-- not offer milk without also offering Extra Shot.
CREATE TABLE item_milk_options (
    item_id        INTEGER NOT NULL REFERENCES items(id),
    milk_option_id INTEGER NOT NULL REFERENCES milk_options(id),
    PRIMARY KEY (item_id, milk_option_id)
);

CREATE TABLE item_customization_options (
    item_id                 INTEGER NOT NULL REFERENCES items(id),
    customization_option_id INTEGER NOT NULL REFERENCES customization_options(id),
    PRIMARY KEY (item_id, customization_option_id)
);

-- Reproduces today's behaviour exactly: the three drinks that took no milk
-- get no links, the five that did get all four.
INSERT INTO item_milk_options (item_id, milk_option_id)
SELECT i.id, m.id FROM items i CROSS JOIN milk_options m
 WHERE i.allows_milk_choice = 1;

INSERT INTO item_customization_options (item_id, customization_option_id)
SELECT i.id, c.id FROM items i CROSS JOIN customization_options c
 WHERE i.allows_customizations = 1;

-- customization_options.type was written by the seed and read by nothing. It
-- now groups the customization picker, and stores the LITERAL heading to
-- display -- no title-casing, no pluralization, no mapping table. Naive
-- pluralization would render 'coffee' as "Coffees"; a hard-coded enum would
-- break the first time a new type is invented.
UPDATE customization_options SET type = 'Syrups'   WHERE type = 'syrup';
UPDATE customization_options SET type = 'Toppings' WHERE type = 'topping';
UPDATE customization_options SET type = 'Coffee'   WHERE type = 'coffee';

-- items.allows_milk_choice and items.allows_customizations are superseded by
-- the join tables above and are no longer read. They are deliberately NOT
-- dropped here: migrations run before the new Worker, so for the seconds
-- between the two the still-deployed old Worker would SELECT * and find them
-- missing, serving every drink with no milk picker to live customers. Drop
-- them in a later, separate deploy if ever.
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm test`
Expected: PASS — 57 node, 67 worker (62 + 5 new).

- [ ] **Step 5: Commit**

```bash
git add migrations/0002_menu_management.sql tests/worker/migration.test.js
git commit -m "feat: add menu ordering, archival, and per-item applicability schema"
```

---

### Task 2: Extract `worker/menu-db.js` and rewrite the menu read

**Files:**
- Create: `worker/menu-db.js`
- Modify: `worker/db.js` (delete `BOOLEAN_COLUMNS`, `toBooleans`, `getMenu` — lines 1-28)
- Modify: `worker/routes/menu.js` (import from the new module)
- Test: `tests/worker/menu-db.test.js`

**Interfaces:**
- Consumes: the `0002` schema from Task 1.
- Produces: `getMenu(db)` from `worker/menu-db.js`, returning
  ```js
  {
    items: [{ id, name, description, size, available,
              milkOptionIds, customizationOptionIds,
              allows_milk_choice, allows_customizations }],
    milkOptions: [{ id, name, available }],
    customizationOptions: [{ id, name, type, available }],
  }
  ```
  Archived rows are excluded everywhere, including from the id lists. Ordering is `sort_order, name`. `allows_*` are derived, never read from the columns.

- [ ] **Step 1: Update the tests**

Replace `tests/worker/menu-db.test.js` entirely:

```js
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { getMenu } from '../../worker/menu-db.js'

describe('getMenu', () => {
  it('returns every unarchived row in sort order', async () => {
    const menu = await getMenu(env.DB)
    expect(menu.items.map((i) => i.name)).toEqual([
      'Americano', 'Cappuccino', 'Cortado', 'Espresso', 'Flat White', 'Latte', 'Matcha Latte', 'Mocha',
    ])
    expect(menu.milkOptions.map((m) => m.name)).toEqual(['Almond', 'Oat', 'Soy', 'Whole'])
    expect(menu.customizationOptions.map((c) => c.name)).toEqual([
      'Caramel Syrup', 'Cinnamon', 'Extra Shot', 'Hazelnut Syrup', 'Vanilla Syrup', 'Whipped Cream',
    ])
  })

  it('converts integer flags to booleans', async () => {
    const menu = await getMenu(env.DB)
    expect(menu.items.find((i) => i.name === 'Mocha').available).toBe(false)
    expect(menu.items.find((i) => i.name === 'Espresso').available).toBe(true)
    expect(menu.milkOptions.find((m) => m.name === 'Soy').available).toBe(false)
  })

  it('derives allows_* from the link tables rather than the columns', async () => {
    const menu = await getMenu(env.DB)
    const espresso = menu.items.find((i) => i.name === 'Espresso')
    const matcha = menu.items.find((i) => i.name === 'Matcha Latte')

    expect(espresso.allows_milk_choice).toBe(false)
    expect(espresso.allows_customizations).toBe(false)
    expect(espresso.milkOptionIds).toEqual([])
    expect(espresso.customizationOptionIds).toEqual([])

    // The case the old booleans could not express: milk yes, add-ons no.
    expect(matcha.allows_milk_choice).toBe(true)
    expect(matcha.allows_customizations).toBe(false)
    expect(matcha.milkOptionIds).toHaveLength(4)
    expect(matcha.customizationOptionIds).toEqual([])
  })

  it('derives allows_milk_choice from links, not from the stale column', async () => {
    // Prove the column is genuinely unread: leave it at 1 and remove the links.
    await env.DB.prepare(
      `DELETE FROM item_milk_options
        WHERE item_id = (SELECT id FROM items WHERE name = 'Latte')`
    ).run()

    const latte = (await getMenu(env.DB)).items.find((i) => i.name === 'Latte')
    expect(latte.allows_milk_choice).toBe(false)
  })

  it('excludes archived rows, and links that point at archived options', async () => {
    await env.DB.prepare("UPDATE items SET archived = 1 WHERE name = 'Mocha'").run()
    await env.DB.prepare("UPDATE milk_options SET archived = 1 WHERE name = 'Soy'").run()

    const menu = await getMenu(env.DB)
    expect(menu.items.map((i) => i.name)).not.toContain('Mocha')
    expect(menu.milkOptions.map((m) => m.name)).not.toContain('Soy')
    expect(menu.items.find((i) => i.name === 'Latte').milkOptionIds).toHaveLength(3)
  })

  it('orders by sort_order, not by name', async () => {
    await env.DB.prepare("UPDATE items SET sort_order = -1 WHERE name = 'Mocha'").run()
    expect((await getMenu(env.DB)).items[0].name).toBe('Mocha')
  })
})
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npm run test:worker -- tests/worker/menu-db.test.js`
Expected: FAIL — cannot resolve `../../worker/menu-db.js`.

- [ ] **Step 3: Create `worker/menu-db.js`**

```js
// Menu reads and menu management. Split out of db.js, which keeps orders,
// order details, and queue stats.

// SQLite stores booleans as 0/1; the Svelte components expect real booleans.
// allows_milk_choice / allows_customizations are absent from this list on
// purpose -- they are no longer read from the columns (see migrations/0002).
const BOOLEAN_COLUMNS = ['available', 'archived']

function toBooleans(row) {
  const out = { ...row }
  for (const column of BOOLEAN_COLUMNS) {
    if (column in out) out[column] = out[column] === 1
  }
  return out
}

// Link rows are filtered to unarchived options. Archiving an option therefore
// removes it from every drink's picker WITHOUT unlinking it, so restoring the
// option brings its links back exactly as they were.
const MILK_LINKS_SQL = `
  SELECT l.item_id, l.milk_option_id AS option_id
    FROM item_milk_options l
    JOIN milk_options o ON o.id = l.milk_option_id
   WHERE o.archived = 0
   ORDER BY o.sort_order, o.name`

const CUSTOMIZATION_LINKS_SQL = `
  SELECT l.item_id, l.customization_option_id AS option_id
    FROM item_customization_options l
    JOIN customization_options o ON o.id = l.customization_option_id
   WHERE o.archived = 0
   ORDER BY o.sort_order, o.name`

function linkMap(rows) {
  const map = new Map()
  for (const row of rows) {
    const existing = map.get(row.item_id)
    if (existing) existing.push(row.option_id)
    else map.set(row.item_id, [row.option_id])
  }
  return map
}

export async function getMenu(db) {
  const [items, milkOptions, customizationOptions, milkLinks, customizationLinks] = await db.batch([
    db.prepare(
      `SELECT id, name, description, size, available FROM items
        WHERE archived = 0 ORDER BY sort_order, name`
    ),
    db.prepare(
      `SELECT id, name, available FROM milk_options
        WHERE archived = 0 ORDER BY sort_order, name`
    ),
    db.prepare(
      `SELECT id, name, type, available FROM customization_options
        WHERE archived = 0 ORDER BY sort_order, name`
    ),
    db.prepare(MILK_LINKS_SQL),
    db.prepare(CUSTOMIZATION_LINKS_SQL),
  ])

  const milkByItem = linkMap(milkLinks.results)
  const customizationsByItem = linkMap(customizationLinks.results)

  return {
    items: items.results.map((row) => {
      const milkOptionIds = milkByItem.get(row.id) ?? []
      const customizationOptionIds = customizationsByItem.get(row.id) ?? []
      return {
        ...toBooleans(row),
        milkOptionIds,
        customizationOptionIds,
        // Derived, not stored. Menu.svelte keeps using these two names, so the
        // customer payload shape is unchanged.
        allows_milk_choice: milkOptionIds.length > 0,
        allows_customizations: customizationOptionIds.length > 0,
      }
    }),
    milkOptions: milkOptions.results.map(toBooleans),
    customizationOptions: customizationOptions.results.map(toBooleans),
  }
}
```

- [ ] **Step 4: Delete the moved code from `worker/db.js`**

Delete everything above the `// Collapses the flat order x item x customization join` comment — the `BOOLEAN_COLUMNS` const, `toBooleans`, and `getMenu`. That comment becomes the first line of the file. Leave everything else, including `updateAvailability` (Task 8 removes it).

- [ ] **Step 5: Repoint the import in `worker/routes/menu.js`**

```js
import { getMenu } from '../menu-db.js'

export async function handleMenu(request, env) {
  return getMenu(env.DB)
}
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS — 57 node, 71 worker. Nothing else imports `getMenu` from `db.js`; `tests/db-shape.test.js` imports only `groupOrderRows` / `groupOrderDetailRows`, which stay put.

- [ ] **Step 7: Commit**

```bash
git add worker/menu-db.js worker/db.js worker/routes/menu.js tests/worker/menu-db.test.js
git commit -m "refactor: move menu reads into worker/menu-db.js, derive allows_* from links"
```

---

### Task 3: Menu CRUD data functions

**Files:**
- Modify: `worker/menu-db.js` (append)
- Test: `tests/worker/menu-db.test.js` (append)

**Interfaces:**
- Consumes: `getMenu`, `toBooleans`, `linkMap`, the two `*_LINKS_SQL` constants from Task 2.
- Produces, all from `worker/menu-db.js`:
  - `MENU_KINDS` — `{ items: 'items', milk: 'milk_options', customizations: 'customization_options' }`
  - `getMenuForManagement(db)` → same three collections, **including archived rows**, each row carrying `archived` (boolean) and `sortOrder` (number); items also carry `milkOptionIds` / `customizationOptionIds`
  - `createMenuEntry(db, kind, fields)` → `number` (the new id)
  - `updateMenuEntry(db, kind, id, fields)` → `boolean` (false when no such row)
  - `reorderMenuEntries(db, kind, ids)` → `void`
  - `activeMenuIds(db, kind)` → `number[]`
  - `nameTaken(db, kind, name, excludeId = null)` → `boolean`
  - `optionIdsExist(db, kind, ids)` → `boolean`
  - `fields` is always `{ columns: { [dbColumn]: value }, links: { milk?: number[], customizations?: number[] } }`. Task 4 builds it; these functions trust it.

- [ ] **Step 1: Write the failing tests**

Append to `tests/worker/menu-db.test.js`. **Merge these names into the existing `worker/menu-db.js` import at the top of the file** rather than adding a second import statement from the same module:

```js
import {
  activeMenuIds,
  createMenuEntry,
  getMenuForManagement,
  nameTaken,
  optionIdsExist,
  reorderMenuEntries,
  updateMenuEntry,
} from '../../worker/menu-db.js'

const noFields = { columns: {}, links: {} }

describe('getMenuForManagement', () => {
  it('includes archived rows, sortOrder, and per-item links', async () => {
    await env.DB.prepare("UPDATE items SET archived = 1 WHERE name = 'Mocha'").run()

    const menu = await getMenuForManagement(env.DB)
    const mocha = menu.items.find((i) => i.name === 'Mocha')
    const cappuccino = menu.items.find((i) => i.name === 'Cappuccino')

    expect(mocha.archived).toBe(true)
    expect(cappuccino.archived).toBe(false)
    expect(cappuccino.sortOrder).toBe(1)
    expect(cappuccino.milkOptionIds).toHaveLength(4)
    expect(menu.customizationOptions[0].type).toBe('Syrups')
  })
})

describe('createMenuEntry', () => {
  it('creates a milk option at the end of the order', async () => {
    const id = await createMenuEntry(env.DB, 'milk', {
      columns: { name: 'Macadamia', available: 1 },
      links: {},
    })
    expect(typeof id).toBe('number')

    const menu = await getMenuForManagement(env.DB)
    const created = menu.milkOptions.find((m) => m.id === id)
    expect(created.name).toBe('Macadamia')
    expect(created.available).toBe(true)
    expect(created.archived).toBe(false)
    expect(created.sortOrder).toBe(4)
    expect(menu.milkOptions[menu.milkOptions.length - 1].id).toBe(id)
  })

  it('creates a drink with its links', async () => {
    const menu = await getMenuForManagement(env.DB)
    const oat = menu.milkOptions.find((m) => m.name === 'Oat')

    const id = await createMenuEntry(env.DB, 'items', {
      columns: { name: 'Cold Brew', description: 'Steeped 18 hours', size: 12, available: 1 },
      links: { milk: [oat.id], customizations: [] },
    })

    const created = (await getMenuForManagement(env.DB)).items.find((i) => i.id === id)
    expect(created.milkOptionIds).toEqual([oat.id])
    expect(created.customizationOptionIds).toEqual([])
    expect(created.size).toBe(12)
  })
})

describe('updateMenuEntry', () => {
  it('updates only the supplied columns', async () => {
    const before = (await getMenuForManagement(env.DB)).items.find((i) => i.name === 'Latte')
    await updateMenuEntry(env.DB, 'items', before.id, {
      columns: { name: 'Café Latte' },
      links: {},
    })

    const after = (await getMenuForManagement(env.DB)).items.find((i) => i.id === before.id)
    expect(after.name).toBe('Café Latte')
    expect(after.description).toBe(before.description)
    expect(after.milkOptionIds).toEqual(before.milkOptionIds)
  })

  it('replaces a link set wholesale', async () => {
    const menu = await getMenuForManagement(env.DB)
    const latte = menu.items.find((i) => i.name === 'Latte')
    const oat = menu.milkOptions.find((m) => m.name === 'Oat')

    await updateMenuEntry(env.DB, 'items', latte.id, {
      columns: {},
      links: { milk: [oat.id] },
    })

    const after = (await getMenuForManagement(env.DB)).items.find((i) => i.id === latte.id)
    expect(after.milkOptionIds).toEqual([oat.id])
  })

  it('preserves links to archived options when replacing a link set', async () => {
    // The editor only ever shows unarchived options, so the id list it sends
    // back cannot mention an archived one. Deleting unscoped would silently
    // destroy those links and break the promise that restoring an option
    // brings its links back exactly as they were.
    const menu = await getMenuForManagement(env.DB)
    const latte = menu.items.find((i) => i.name === 'Latte')
    const oat = menu.milkOptions.find((m) => m.name === 'Oat')
    const soy = menu.milkOptions.find((m) => m.name === 'Soy')

    await env.DB.prepare('UPDATE milk_options SET archived = 1 WHERE id = ?').bind(soy.id).run()
    await updateMenuEntry(env.DB, 'items', latte.id, { columns: {}, links: { milk: [oat.id] } })
    await env.DB.prepare('UPDATE milk_options SET archived = 0 WHERE id = ?').bind(soy.id).run()

    const after = (await getMenuForManagement(env.DB)).items.find((i) => i.id === latte.id)
    expect(after.milkOptionIds.sort()).toEqual([oat.id, soy.id].sort())
  })

  it('returns false for an unknown id', async () => {
    expect(await updateMenuEntry(env.DB, 'items', 99999, noFields)).toBe(false)
  })

  it('returns true for a link-only update of a real row', async () => {
    const latte = (await getMenuForManagement(env.DB)).items.find((i) => i.name === 'Latte')
    expect(await updateMenuEntry(env.DB, 'items', latte.id, { columns: {}, links: {} })).toBe(true)
  })
})

describe('reorderMenuEntries', () => {
  it('assigns sort_order by position', async () => {
    const ids = (await getMenuForManagement(env.DB)).milkOptions.map((m) => m.id)
    await reorderMenuEntries(env.DB, 'milk', [...ids].reverse())

    const after = await getMenuForManagement(env.DB)
    expect(after.milkOptions.map((m) => m.id)).toEqual([...ids].reverse())
    expect(after.milkOptions.map((m) => m.sortOrder)).toEqual([0, 1, 2, 3])
  })
})

describe('validation helpers', () => {
  it('activeMenuIds omits archived rows', async () => {
    await env.DB.prepare("UPDATE items SET archived = 1 WHERE name = 'Mocha'").run()
    expect(await activeMenuIds(env.DB, 'items')).toHaveLength(7)
  })

  it('nameTaken is case-insensitive and ignores archived rows', async () => {
    expect(await nameTaken(env.DB, 'items', 'latte')).toBe(true)
    expect(await nameTaken(env.DB, 'items', 'Cold Brew')).toBe(false)

    await env.DB.prepare("UPDATE items SET archived = 1 WHERE name = 'Latte'").run()
    expect(await nameTaken(env.DB, 'items', 'latte')).toBe(false)
  })

  it('nameTaken excludes the row being updated', async () => {
    const latte = (await getMenuForManagement(env.DB)).items.find((i) => i.name === 'Latte')
    expect(await nameTaken(env.DB, 'items', 'Latte', latte.id)).toBe(false)
  })

  it('optionIdsExist rejects unknown and archived ids', async () => {
    const menu = await getMenuForManagement(env.DB)
    const soy = menu.milkOptions.find((m) => m.name === 'Soy')

    expect(await optionIdsExist(env.DB, 'milk', [])).toBe(true)
    expect(await optionIdsExist(env.DB, 'milk', [soy.id])).toBe(true)
    expect(await optionIdsExist(env.DB, 'milk', [99999])).toBe(false)

    await env.DB.prepare('UPDATE milk_options SET archived = 1 WHERE id = ?').bind(soy.id).run()
    expect(await optionIdsExist(env.DB, 'milk', [soy.id])).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npm run test:worker -- tests/worker/menu-db.test.js`
Expected: FAIL — `createMenuEntry is not a function` and friends.

- [ ] **Step 3: Append the implementation to `worker/menu-db.js`**

```js
// The URL segment a barista route uses -> the table it manages. Table names
// cannot be bound as query parameters, so this doubles as the allowlist.
export const MENU_KINDS = {
  items: 'items',
  milk: 'milk_options',
  customizations: 'customization_options',
}

const LINK_TABLES = {
  milk: {
    table: 'item_milk_options',
    column: 'milk_option_id',
    optionTable: 'milk_options',
  },
  customizations: {
    table: 'item_customization_options',
    column: 'customization_option_id',
    optionTable: 'customization_options',
  },
}

function tableFor(kind) {
  const table = MENU_KINDS[kind]
  if (!table) throw new Error(`Unknown menu kind: ${kind}`)
  return table
}

export async function getMenuForManagement(db) {
  const [items, milkOptions, customizationOptions, milkLinks, customizationLinks] = await db.batch([
    db.prepare(
      `SELECT id, name, description, size, available, archived, sort_order
         FROM items ORDER BY sort_order, name`
    ),
    db.prepare(
      `SELECT id, name, available, archived, sort_order
         FROM milk_options ORDER BY sort_order, name`
    ),
    db.prepare(
      `SELECT id, name, type, available, archived, sort_order
         FROM customization_options ORDER BY sort_order, name`
    ),
    db.prepare(MILK_LINKS_SQL),
    db.prepare(CUSTOMIZATION_LINKS_SQL),
  ])

  const milkByItem = linkMap(milkLinks.results)
  const customizationsByItem = linkMap(customizationLinks.results)

  const shape = (row) => {
    const { sort_order: sortOrder, ...rest } = toBooleans(row)
    return { ...rest, sortOrder }
  }

  return {
    items: items.results.map((row) => ({
      ...shape(row),
      milkOptionIds: milkByItem.get(row.id) ?? [],
      customizationOptionIds: customizationsByItem.get(row.id) ?? [],
    })),
    milkOptions: milkOptions.results.map(shape),
    customizationOptions: customizationOptions.results.map(shape),
  }
}

// Replacement is scoped to links pointing at UNARCHIVED options: the editor
// only ever shows the barista unarchived options, so the id list it sends back
// cannot mention an archived one. An unscoped DELETE would silently destroy
// those links.
function linkStatements(db, itemId, links) {
  const statements = []

  for (const kind of Object.keys(LINK_TABLES)) {
    const ids = links[kind]
    if (!ids) continue

    const { table, column, optionTable } = LINK_TABLES[kind]
    statements.push(
      db
        .prepare(
          `DELETE FROM ${table}
            WHERE item_id = ?
              AND ${column} IN (SELECT id FROM ${optionTable} WHERE archived = 0)`
        )
        .bind(itemId)
    )
    for (const id of ids) {
      statements.push(
        db.prepare(`INSERT INTO ${table} (item_id, ${column}) VALUES (?, ?)`).bind(itemId, id)
      )
    }
  }

  return statements
}

export async function createMenuEntry(db, kind, fields) {
  const table = tableFor(kind)
  const columns = Object.keys(fields.columns)
  const next = await db
    .prepare(`SELECT COALESCE(MAX(sort_order), -1) + 1 AS position FROM ${table}`)
    .first()

  const inserted = await db
    .prepare(
      `INSERT INTO ${table} (${[...columns, 'sort_order'].join(', ')})
       VALUES (${[...columns, 'sort_order'].map(() => '?').join(', ')})`
    )
    .bind(...columns.map((column) => fields.columns[column]), next.position)
    .run()

  const id = inserted.meta.last_row_id

  // Links go in a second round trip because a D1 batch cannot feed one
  // statement's generated id into the next. If this half fails the drink
  // exists with no options attached -- visible, and fixed by editing it.
  const statements = kind === 'items' ? linkStatements(db, id, fields.links) : []
  if (statements.length > 0) await db.batch(statements)

  return id
}

export async function updateMenuEntry(db, kind, id, fields) {
  const table = tableFor(kind)

  // A link-only PATCH still has to prove the row exists, and an UPDATE that
  // matches nothing is indistinguishable from one that changed nothing.
  const existing = await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(id).first()
  if (!existing) return false

  const columns = Object.keys(fields.columns)
  const statements = []

  if (columns.length > 0) {
    statements.push(
      db
        .prepare(
          `UPDATE ${table} SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`
        )
        .bind(...columns.map((column) => fields.columns[column]), id)
    )
  }
  if (kind === 'items') statements.push(...linkStatements(db, id, fields.links))

  if (statements.length > 0) await db.batch(statements)
  return true
}

export async function reorderMenuEntries(db, kind, ids) {
  const table = tableFor(kind)
  if (ids.length === 0) return
  await db.batch(
    ids.map((id, index) =>
      db.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`).bind(index, id)
    )
  )
}

export async function activeMenuIds(db, kind) {
  const { results } = await db.prepare(`SELECT id FROM ${tableFor(kind)} WHERE archived = 0`).all()
  return results.map((row) => row.id)
}

// Uniqueness lives here rather than in a UNIQUE index because it has to ignore
// archived rows: reviving a name an archived row still holds is allowed.
export async function nameTaken(db, kind, name, excludeId = null) {
  const row = await db
    .prepare(
      `SELECT id FROM ${tableFor(kind)}
        WHERE archived = 0 AND LOWER(name) = LOWER(?) AND (? IS NULL OR id != ?)`
    )
    .bind(name, excludeId, excludeId)
    .first()
  return row !== null
}

export async function optionIdsExist(db, kind, ids) {
  if (ids.length === 0) return true
  const placeholders = ids.map(() => '?').join(',')
  const { results } = await db
    .prepare(`SELECT id FROM ${tableFor(kind)} WHERE archived = 0 AND id IN (${placeholders})`)
    .bind(...ids)
    .all()
  return results.length === new Set(ids).size
}
```

- [ ] **Step 4: Run the tests and watch them pass**

Run: `npm test`
Expected: PASS, zero failures. Worker tests should now number about 84 — a count far below that means a file was not collected.

If `createMenuEntry` returns `undefined`, `run()`'s meta field is not `last_row_id` on this D1 version — log `inserted.meta` and use the id field it actually reports.

- [ ] **Step 5: Commit**

```bash
git add worker/menu-db.js tests/worker/menu-db.test.js
git commit -m "feat: add menu CRUD, reorder, and validation helpers"
```

---

### Task 4: Menu admin HTTP routes

**Files:**
- Create: `worker/routes/body.js`
- Modify: `worker/routes/menu.js` (add the admin handler)
- Modify: `worker/routes/barista.js` (delegate; use the shared `readJsonBody`)
- Test: `tests/worker/menu-manager.test.js` (create)

**Interfaces:**
- Consumes: everything Task 3 produced from `worker/menu-db.js`.
- Produces: `handleMenuAdmin(request, env, url)` from `worker/routes/menu.js`, returning `{ status, body }` like `handleBarista`; and `readJsonBody(request)` from `worker/routes/body.js`.
- Routes: `GET /api/barista/menu`, `POST /api/barista/menu/:kind`, `PATCH /api/barista/menu/:kind/order`, `PATCH /api/barista/menu/:kind/:id`, with `:kind` ∈ `items|milk|customizations`.

**Do NOT remove the existing `PATCH /api/barista/(items|milk|customizations)/:id` availability routes in this task.** `BaristaView.svelte` still calls them until Task 8; removing them now leaves the branch broken in between.

- [ ] **Step 1: Write the failing tests**

Create `tests/worker/menu-manager.test.js`:

```js
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { handleMenuAdmin } from '../../worker/routes/menu.js'
import { getMenu } from '../../worker/menu-db.js'

const ORIGIN = 'https://cafecito.test'

// Exercised against handleMenuAdmin directly, past the Access gate. The gate
// itself is covered by barista-routes.test.js, and these tests must not mint a
// real Access token.
function call(method, path, body) {
  const url = new URL(`${ORIGIN}${path}`)
  return handleMenuAdmin(
    new Request(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : body,
    }),
    env,
    url
  )
}

const send = (method, path, payload) => call(method, path, JSON.stringify(payload))

async function itemNamed(name) {
  const menu = await call('GET', '/api/barista/menu')
  return menu.body.items.find((i) => i.name === name)
}

describe('GET /api/barista/menu', () => {
  it('returns all three collections including archived rows', async () => {
    await env.DB.prepare("UPDATE items SET archived = 1 WHERE name = 'Mocha'").run()
    const result = await call('GET', '/api/barista/menu')

    expect(result.status).toBe(200)
    expect(result.body.items).toHaveLength(8)
    expect(result.body.items.find((i) => i.name === 'Mocha').archived).toBe(true)
    expect(result.body.milkOptions).toHaveLength(4)
    expect(result.body.customizationOptions).toHaveLength(6)
  })
})

describe('POST /api/barista/menu/:kind', () => {
  it('creates a drink and returns 201 with its id', async () => {
    const result = await send('POST', '/api/barista/menu/items', {
      name: 'Cold Brew',
      description: 'Steeped 18 hours',
      size: 12,
    })

    expect(result.status).toBe(201)
    expect(typeof result.body.id).toBe('number')

    const created = await itemNamed('Cold Brew')
    expect(created.available).toBe(true)
    expect(created.archived).toBe(false)
  })

  it('creates a customization with its display heading', async () => {
    const result = await send('POST', '/api/barista/menu/customizations', {
      name: 'Lavender Syrup',
      type: 'Syrups',
    })
    expect(result.status).toBe(201)
  })

  it('rejects a duplicate name with 409', async () => {
    const result = await send('POST', '/api/barista/menu/items', { name: 'latte' })
    expect(result.status).toBe(409)
  })

  it('rejects a missing name, a blank name, and an over-long name', async () => {
    expect((await send('POST', '/api/barista/menu/items', {})).status).toBe(400)
    expect((await send('POST', '/api/barista/menu/items', { name: '   ' })).status).toBe(400)
    expect((await send('POST', '/api/barista/menu/items', { name: 'x'.repeat(61) })).status).toBe(400)
  })

  it('rejects a customization with no type', async () => {
    expect((await send('POST', '/api/barista/menu/customizations', { name: 'Nutmeg' })).status).toBe(400)
  })

  it('rejects an invalid size', async () => {
    for (const size of [0, 65, 8.5, 'eight']) {
      const result = await send('POST', '/api/barista/menu/items', { name: `Drink ${size}`, size })
      expect(result.status, `size=${size}`).toBe(400)
    }
  })

  it('rejects an over-long description', async () => {
    const result = await send('POST', '/api/barista/menu/items', {
      name: 'Wordy',
      description: 'x'.repeat(201),
    })
    expect(result.status).toBe(400)
  })

  it('rejects links to an unknown option', async () => {
    const result = await send('POST', '/api/barista/menu/items', {
      name: 'Ghost Latte',
      milkOptionIds: [99999],
    })
    expect(result.status).toBe(400)
  })

  it('returns 400, not 500, for a body that parses to a non-object', async () => {
    expect((await call('POST', '/api/barista/menu/items', 'null')).status).toBe(400)
    expect((await call('POST', '/api/barista/menu/items', '"oops"')).status).toBe(400)
    expect((await call('POST', '/api/barista/menu/items', 'not json')).status).toBe(400)
  })

  it('404s an unknown kind', async () => {
    expect((await send('POST', '/api/barista/menu/pastries', { name: 'Croissant' })).status).toBe(404)
  })
})

describe('PATCH /api/barista/menu/:kind/:id', () => {
  it('renames a drink without disturbing its other fields', async () => {
    const latte = await itemNamed('Latte')
    const result = await send('PATCH', `/api/barista/menu/items/${latte.id}`, { name: 'Café Latte' })

    expect(result.status).toBe(200)
    const after = await itemNamed('Café Latte')
    expect(after.description).toBe(latte.description)
    expect(after.milkOptionIds).toEqual(latte.milkOptionIds)
  })

  it('allows a row to keep its own name', async () => {
    const latte = await itemNamed('Latte')
    const result = await send('PATCH', `/api/barista/menu/items/${latte.id}`, { name: 'Latte' })
    expect(result.status).toBe(200)
  })

  it("rejects taking another row's name with 409", async () => {
    const latte = await itemNamed('Latte')
    const result = await send('PATCH', `/api/barista/menu/items/${latte.id}`, { name: 'Cortado' })
    expect(result.status).toBe(409)
  })

  it('archives a drink, removing it from the customer menu', async () => {
    const latte = await itemNamed('Latte')
    expect((await send('PATCH', `/api/barista/menu/items/${latte.id}`, { archived: true })).status).toBe(200)

    const customerMenu = await getMenu(env.DB)
    expect(customerMenu.items.map((i) => i.name)).not.toContain('Latte')

    // ...and restores it.
    await send('PATCH', `/api/barista/menu/items/${latte.id}`, { archived: false })
    expect((await getMenu(env.DB)).items.map((i) => i.name)).toContain('Latte')
  })

  it('archiving a drink leaves order history readable', async () => {
    const latte = await itemNamed('Latte')
    await env.DB.prepare(
      "INSERT INTO orders (customer_id, customer_name, submission_id) VALUES ('c','Ada','sub-archive')"
    ).run()
    const order = await env.DB.prepare("SELECT id FROM orders WHERE submission_id = 'sub-archive'").first()
    await env.DB.prepare(
      'INSERT INTO order_items (id, order_id, item_id, quantity) VALUES (?, ?, ?, 1)'
    ).bind(crypto.randomUUID(), order.id, latte.id).run()

    await send('PATCH', `/api/barista/menu/items/${latte.id}`, { archived: true })

    const row = await env.DB.prepare(
      `SELECT i.name FROM order_items oi JOIN items i ON i.id = oi.item_id WHERE oi.order_id = ?`
    ).bind(order.id).first()
    expect(row.name).toBe('Latte')
  })

  it('toggles availability', async () => {
    const latte = await itemNamed('Latte')
    await send('PATCH', `/api/barista/menu/items/${latte.id}`, { available: false })
    expect((await itemNamed('Latte')).available).toBe(false)
  })

  it('rejects a non-boolean available', async () => {
    const latte = await itemNamed('Latte')
    const result = await send('PATCH', `/api/barista/menu/items/${latte.id}`, { available: 'yes' })
    expect(result.status).toBe(400)
  })

  it('404s an unknown id', async () => {
    expect((await send('PATCH', '/api/barista/menu/items/99999', { available: true })).status).toBe(404)
  })
})

describe('PATCH /api/barista/menu/:kind/order', () => {
  it('reorders a kind', async () => {
    const menu = await call('GET', '/api/barista/menu')
    const ids = menu.body.milkOptions.map((m) => m.id)

    const result = await send('PATCH', '/api/barista/menu/milk/order', { ids: [...ids].reverse() })
    expect(result.status).toBe(200)

    const after = await call('GET', '/api/barista/menu')
    expect(after.body.milkOptions.map((m) => m.id)).toEqual([...ids].reverse())
  })

  it('rejects an incomplete id set', async () => {
    const menu = await call('GET', '/api/barista/menu')
    const ids = menu.body.milkOptions.map((m) => m.id)
    expect((await send('PATCH', '/api/barista/menu/milk/order', { ids: ids.slice(1) })).status).toBe(400)
  })

  it('rejects an id set containing something unknown', async () => {
    const menu = await call('GET', '/api/barista/menu')
    const ids = menu.body.milkOptions.map((m) => m.id)
    const result = await send('PATCH', '/api/barista/menu/milk/order', {
      ids: [...ids.slice(1), 99999],
    })
    expect(result.status).toBe(400)
  })

  it('rejects a non-array ids', async () => {
    expect((await send('PATCH', '/api/barista/menu/milk/order', { ids: 'nope' })).status).toBe(400)
  })
})
```

- [ ] **Step 2: Run the tests and watch them fail**

Run: `npm run test:worker -- tests/worker/menu-manager.test.js`
Expected: FAIL — `handleMenuAdmin` is not exported.

- [ ] **Step 3: Create `worker/routes/body.js`**

```js
// A parse failure (invalid JSON) and a valid parse of a non-object (null, a
// bare number, a bare string, ...) must both be treated as "no usable body" so
// field checks on the result can never throw.
export async function readJsonBody(request) {
  const body = await request.json().catch(() => null)
  return typeof body === 'object' && body !== null ? body : {}
}
```

- [ ] **Step 4: Rewrite `worker/routes/menu.js`**

```js
import {
  activeMenuIds,
  createMenuEntry,
  getMenu,
  getMenuForManagement,
  MENU_KINDS,
  nameTaken,
  optionIdsExist,
  reorderMenuEntries,
  updateMenuEntry,
} from '../menu-db.js'
import { readJsonBody } from './body.js'

export async function handleMenu(request, env) {
  return getMenu(env.DB)
}

const MAX_NAME = 60
const MAX_DESCRIPTION = 200
const MAX_TYPE = 30
const MAX_SIZE = 64

const LINK_FIELDS = [
  ['milkOptionIds', 'milk'],
  ['customizationOptionIds', 'customizations'],
]

function fail(message) {
  return { status: 400, body: { error: message } }
}

const notFound = { status: 404, body: { error: 'Not found' } }

function readIdList(value) {
  if (!Array.isArray(value)) return null
  if (value.some((id) => !Number.isInteger(id))) return null
  return [...new Set(value)]
}

// `creating` decides which fields are required. On update every field is
// optional and an absent field means "leave it alone", which is why this
// cannot simply validate a fully-populated object.
function readFields(kind, body, { creating }) {
  const columns = {}
  const links = {}

  if (creating || 'name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (name.length === 0 || name.length > MAX_NAME) {
      return { error: `name must be 1-${MAX_NAME} characters` }
    }
    columns.name = name
  }

  for (const flag of ['available', 'archived']) {
    if (flag in body) {
      if (typeof body[flag] !== 'boolean') return { error: `${flag} must be a boolean` }
      columns[flag] = body[flag] ? 1 : 0
    }
  }

  if (kind === 'items') {
    if ('description' in body) {
      if (body.description !== null && typeof body.description !== 'string') {
        return { error: 'description must be a string or null' }
      }
      const description = body.description === null ? null : body.description.trim()
      if (description !== null && description.length > MAX_DESCRIPTION) {
        return { error: `description must be at most ${MAX_DESCRIPTION} characters` }
      }
      columns.description = description
    }

    if ('size' in body) {
      const size = body.size
      if (size !== null && (!Number.isInteger(size) || size < 1 || size > MAX_SIZE)) {
        return { error: `size must be null or an integer from 1 to ${MAX_SIZE}` }
      }
      columns.size = size
    }

    for (const [field, linkKind] of LINK_FIELDS) {
      if (field in body) {
        const ids = readIdList(body[field])
        if (ids === null) return { error: `${field} must be an array of integers` }
        links[linkKind] = ids
      }
    }
  }

  if (kind === 'customizations' && (creating || 'type' in body)) {
    const type = typeof body.type === 'string' ? body.type.trim() : ''
    if (type.length === 0 || type.length > MAX_TYPE) {
      return { error: `type must be 1-${MAX_TYPE} characters` }
    }
    columns.type = type
  }

  return { fields: { columns, links } }
}

async function checkLinks(db, links) {
  for (const [field, linkKind] of LINK_FIELDS) {
    const ids = links[linkKind]
    if (ids && !(await optionIdsExist(db, linkKind, ids))) {
      return `${field} references an unknown or archived option`
    }
  }
  return null
}

async function create(env, kind, body) {
  const parsed = readFields(kind, body, { creating: true })
  if (parsed.error) return fail(parsed.error)
  const { fields } = parsed

  if (await nameTaken(env.DB, kind, fields.columns.name)) {
    return { status: 409, body: { error: 'That name is already in use' } }
  }
  const linkError = await checkLinks(env.DB, fields.links)
  if (linkError) return fail(linkError)

  return { status: 201, body: { id: await createMenuEntry(env.DB, kind, fields) } }
}

async function update(env, kind, id, body) {
  const parsed = readFields(kind, body, { creating: false })
  if (parsed.error) return fail(parsed.error)
  const { fields } = parsed

  if (fields.columns.name !== undefined && (await nameTaken(env.DB, kind, fields.columns.name, id))) {
    return { status: 409, body: { error: 'That name is already in use' } }
  }
  const linkError = await checkLinks(env.DB, fields.links)
  if (linkError) return fail(linkError)

  const updated = await updateMenuEntry(env.DB, kind, id, fields)
  return updated ? { status: 200, body: { ok: true } } : notFound
}

async function reorder(env, kind, body) {
  const ids = readIdList(body.ids)
  if (ids === null) return fail('ids must be an array of integers')

  // Set equality, not just length. A stale tab reordering a list someone else
  // has since added to would otherwise leave two rows sharing a position.
  const active = await activeMenuIds(env.DB, kind)
  const matches = ids.length === active.length && active.every((id) => ids.includes(id))
  if (!matches) return fail('ids must be exactly the current unarchived ids for this kind')

  await reorderMenuEntries(env.DB, kind, ids)
  return { status: 200, body: { ok: true } }
}

// `order` can never be mistaken for a row id: ids match \d+ only.
const MENU_PATH = /^\/api\/barista\/menu\/(items|milk|customizations)(?:\/(order|\d+))?$/

export async function handleMenuAdmin(request, env, url) {
  const method = request.method

  if (url.pathname === '/api/barista/menu' && method === 'GET') {
    return { status: 200, body: await getMenuForManagement(env.DB) }
  }

  const match = url.pathname.match(MENU_PATH)
  if (!match) return notFound

  const [, kind, tail] = match
  if (!MENU_KINDS[kind]) return notFound

  if (tail === undefined && method === 'POST') {
    return create(env, kind, await readJsonBody(request))
  }
  if (tail === 'order' && method === 'PATCH') {
    return reorder(env, kind, await readJsonBody(request))
  }
  if (tail !== undefined && tail !== 'order' && method === 'PATCH') {
    return update(env, kind, Number(tail), await readJsonBody(request))
  }

  return notFound
}
```

- [ ] **Step 5: Wire it into `worker/routes/barista.js`**

Delete the local `readJsonBody` function (lines 12-19) and import the shared one. Add the menu delegation as the **first** branch of `handleBarista`, before the orders routes:

```js
import { fetchAccessJwks, verifyAccessJwt } from '../auth.js'
import { getOrders, updateAvailability, updateOrderStatus } from '../db.js'
import { readJsonBody } from './body.js'
import { handleMenuAdmin } from './menu.js'
```

and inside `handleBarista`, immediately after `const method = request.method`:

```js
  // Everything under /api/barista/menu is menu management. It stays inside
  // this handler so it inherits the mount-point Access gate in index.js.
  if (path === '/api/barista/menu' || path.startsWith('/api/barista/menu/')) {
    return handleMenuAdmin(request, env, url)
  }
```

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: PASS, zero failures. Worker tests should now number about 107.

- [ ] **Step 7: Commit**

```bash
git add worker/routes/body.js worker/routes/menu.js worker/routes/barista.js tests/worker/menu-manager.test.js
git commit -m "feat: add menu management routes under the barista Access gate"
```

---

### Task 5: `groupByType` helper

**Files:**
- Create: `src/lib/menuGrouping.js`
- Test: `tests/menu-grouping.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `groupByType(options)` → `[{ type: string, options: object[] }]`. Groups appear in the order their first member appears; members keep their incoming order. Because callers pass a list already ordered by `sort_order`, this reproduces "groups ordered by their lowest member" without the helper ever knowing about `sort_order`.

- [ ] **Step 1: Write the failing test**

Create `tests/menu-grouping.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { groupByType } from '../src/lib/menuGrouping.js'

const option = (id, name, type) => ({ id, name, type })

describe('groupByType', () => {
  it('groups options under their type', () => {
    const groups = groupByType([
      option(1, 'Vanilla Syrup', 'Syrups'),
      option(2, 'Caramel Syrup', 'Syrups'),
      option(3, 'Cinnamon', 'Toppings'),
    ])

    expect(groups).toEqual([
      { type: 'Syrups', options: [option(1, 'Vanilla Syrup', 'Syrups'), option(2, 'Caramel Syrup', 'Syrups')] },
      { type: 'Toppings', options: [option(3, 'Cinnamon', 'Toppings')] },
    ])
  })

  it('orders groups by where their first member appears', () => {
    const groups = groupByType([
      option(3, 'Cinnamon', 'Toppings'),
      option(1, 'Vanilla Syrup', 'Syrups'),
    ])
    expect(groups.map((g) => g.type)).toEqual(['Toppings', 'Syrups'])
  })

  it('keeps a group together even when its members are not adjacent', () => {
    const groups = groupByType([
      option(1, 'Vanilla Syrup', 'Syrups'),
      option(3, 'Cinnamon', 'Toppings'),
      option(2, 'Caramel Syrup', 'Syrups'),
    ])

    expect(groups.map((g) => g.type)).toEqual(['Syrups', 'Toppings'])
    expect(groups[0].options.map((o) => o.id)).toEqual([1, 2])
  })

  it('handles a type it has never seen before', () => {
    const groups = groupByType([option(9, 'Sea Salt', 'Finishing Touches')])
    expect(groups).toEqual([{ type: 'Finishing Touches', options: [option(9, 'Sea Salt', 'Finishing Touches')] }])
  })

  it('returns an empty array for no options', () => {
    expect(groupByType([])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `npm run test:unit -- tests/menu-grouping.test.js`
Expected: FAIL — cannot resolve `../src/lib/menuGrouping.js`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/menuGrouping.js`:

```js
// Groups customization options under their `type`, which migration 0002 stores
// as the literal heading to display -- no title-casing, no pluralization.
//
// Groups appear in the order their first member does, and members keep their
// incoming order. Callers pass a list already ordered by sort_order, so that
// reproduces "groups ordered by their lowest member" without this module ever
// needing to know sort_order exists.
export function groupByType(options) {
  const groups = []
  const byType = new Map()

  for (const option of options) {
    let group = byType.get(option.type)
    if (!group) {
      group = { type: option.type, options: [] }
      byType.set(option.type, group)
      groups.push(group)
    }
    group.options.push(option)
  }

  return groups
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `npm test`
Expected: PASS, zero failures — 62 node tests, about 107 worker tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/menuGrouping.js tests/menu-grouping.test.js
git commit -m "feat: add groupByType helper for customization headings"
```

---

### Task 6: Client API and types

**Files:**
- Modify: `src/lib/api.js` (append after `updateOrderStatus`)
- Modify: `src/types.d.ts`

**Interfaces:**
- Consumes: the routes from Task 4.
- Produces, from `src/lib/api.js`:
  - `getMenuForManagement()` → the `GET /api/barista/menu` payload
  - `createMenuEntry(kind, fields)` → `{ id }`
  - `updateMenuEntry(kind, id, fields)` → `{ ok: true }`
  - `reorderMenuEntries(kind, ids)` → `{ ok: true }`
  - All reject with an `Error` carrying `.status`, per the existing `request` helper.

- [ ] **Step 1: Add the client functions**

Append to `src/lib/api.js`, after `updateOrderStatus`:

```js
// Menu management. These deliberately bypass the fetchMenu() de-duplication
// above: that cache exists to collapse the customer view's three polls into one
// request, and the manager needs archived rows and sort order, which the
// customer payload does not carry.
export async function getMenuForManagement() {
  return request('/api/barista/menu')
}

export async function createMenuEntry(kind, fields) {
  return request(`/api/barista/menu/${kind}`, {
    method: 'POST',
    body: JSON.stringify(fields),
  })
}

export async function updateMenuEntry(kind, id, fields) {
  return request(`/api/barista/menu/${kind}/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  })
}

export async function reorderMenuEntries(kind, ids) {
  return request(`/api/barista/menu/${kind}/order`, {
    method: 'PATCH',
    body: JSON.stringify({ ids }),
  })
}
```

- [ ] **Step 2: Extend `MenuItem` in `src/types.d.ts`**

```ts
export type MenuItem = {
    id: number;
    name: string;
    description: string;
    size: number;
    available: boolean;
    // Derived by the Worker from the item_* link tables, not stored columns.
    allows_milk_choice: boolean;
    allows_customizations: boolean;
    milkOptionIds: number[];
    customizationOptionIds: number[];
};
```

- [ ] **Step 3: Verify nothing broke**

Run: `npm run build && npm test`
Expected: build succeeds; tests pass with zero failures.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.js src/types.d.ts
git commit -m "feat: add menu management client API"
```

---

### Task 7: `MenuRowEditor` and `MenuSection`

**Files:**
- Create: `src/lib/MenuRowEditor.svelte`
- Create: `src/lib/MenuSection.svelte`

**Interfaces:**
- Consumes: `groupByType` from Task 5.
- Produces:
  - `MenuRowEditor` props: `kind` (`'items'|'milk'|'customizations'`), `row` (the row object, or `null` for a new one), `milkOptions`, `customizationOptions` (unarchived only), `onSave(fields)` → `Promise<boolean>`, `onArchive()`, `onCancel()`.
  - `MenuSection` props: `kind`, `title`, `addLabel`, `rows` (that kind's full list, archived included), `milkOptions`, `customizationOptions`, `editingId` (`number | 'new' | null`), `onEdit(id)`, `onSave(id, fields)` → `Promise<boolean>`, `onMove(id, delta)`, `onRestore(id)`.

There is no component test framework in this project (the node project is `environment: 'node'` with no jsdom, and no testing-library dependency). The gate for this task is a clean `npm run build`; behaviour is verified manually in Task 8 once the page is reachable.

- [ ] **Step 1: Create `src/lib/MenuRowEditor.svelte`**

```svelte
<script>
  import { groupByType } from "./menuGrouping";

  export let kind;
  export let row = null;
  export let milkOptions = [];
  export let customizationOptions = [];
  export let onSave;
  export let onArchive;
  export let onCancel;

  let name = row?.name ?? "";
  let description = row?.description ?? "";
  let size = row?.size ?? null;
  let type = row?.type ?? "";
  let available = row?.available ?? true;
  let milkIds = [...(row?.milkOptionIds ?? [])];
  let customizationIds = [...(row?.customizationOptionIds ?? [])];
  let saving = false;

  $: customizationGroups = groupByType(customizationOptions);
  $: knownTypes = [...new Set(customizationOptions.map((option) => option.type))];

  function toggle(list, id) {
    return list.includes(id) ? list.filter((each) => each !== id) : [...list, id];
  }

  function fields() {
    if (kind === "milk") return { name, available };
    if (kind === "customizations") return { name, type, available };
    return {
      name,
      description,
      // An empty size input means "no size badge", which the API spells null.
      size: size === "" || size === null ? null : Number(size),
      available,
      milkOptionIds: milkIds,
      customizationOptionIds: customizationIds,
    };
  }

  async function handleSubmit() {
    saving = true;
    // A false result means the save failed; the parent has shown the error and
    // this editor stays open so nothing typed is lost.
    await onSave(fields());
    saving = false;
  }
</script>

<form
  on:submit|preventDefault={handleSubmit}
  class="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3"
>
  <label class="block">
    <span class="text-sm font-medium text-gray-700">Name</span>
    <input
      bind:value={name}
      required
      maxlength="60"
      class="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
    />
  </label>

  {#if kind === "items"}
    <label class="block">
      <span class="text-sm font-medium text-gray-700">Description</span>
      <textarea
        bind:value={description}
        rows="2"
        maxlength="200"
        class="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
      ></textarea>
    </label>

    <label class="block">
      <span class="text-sm font-medium text-gray-700">Size (oz)</span>
      <input
        type="number"
        bind:value={size}
        min="1"
        max="64"
        placeholder="none"
        class="mt-1 w-32 px-3 py-2 border border-gray-300 rounded-md"
      />
    </label>
  {/if}

  {#if kind === "customizations"}
    <label class="block">
      <span class="text-sm font-medium text-gray-700">Heading</span>
      <input
        bind:value={type}
        required
        maxlength="30"
        list="customization-types"
        class="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
      />
      <datalist id="customization-types">
        {#each knownTypes as knownType}
          <option value={knownType}></option>
        {/each}
      </datalist>
      <span class="text-xs text-gray-500"
        >Shown as the heading above this option on the customer menu.</span
      >
    </label>
  {/if}

  <label class="flex items-center">
    <input type="checkbox" bind:checked={available} class="mr-2" />
    <span class="text-sm font-medium text-gray-700">Available</span>
  </label>

  {#if kind === "items"}
    <fieldset>
      <legend class="text-sm font-medium text-gray-700">Milk options</legend>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-1 mt-1">
        {#each milkOptions as milk (milk.id)}
          <label class="flex items-center text-sm">
            <input
              type="checkbox"
              checked={milkIds.includes(milk.id)}
              on:change={() => (milkIds = toggle(milkIds, milk.id))}
              class="mr-2"
            />
            {milk.name}
          </label>
        {/each}
      </div>
      <p class="text-xs text-gray-500 mt-1">
        Leave every box unchecked for a drink that takes no milk.
      </p>
    </fieldset>

    <fieldset>
      <legend class="text-sm font-medium text-gray-700">Customizations</legend>
      {#each customizationGroups as group (group.type)}
        <p class="text-xs uppercase tracking-wide text-gray-500 mt-2">{group.type}</p>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-1">
          {#each group.options as option (option.id)}
            <label class="flex items-center text-sm">
              <input
                type="checkbox"
                checked={customizationIds.includes(option.id)}
                on:change={() => (customizationIds = toggle(customizationIds, option.id))}
                class="mr-2"
              />
              {option.name}
            </label>
          {/each}
        </div>
      {/each}
    </fieldset>
  {/if}

  <div class="flex items-center justify-between pt-2">
    <div>
      {#if row}
        <button
          type="button"
          on:click={onArchive}
          class="text-sm text-red-600 hover:text-red-800"
        >
          Archive
        </button>
      {/if}
    </div>
    <div class="flex space-x-2">
      <button
        type="button"
        on:click={onCancel}
        class="px-3 py-2 text-sm rounded-md border border-gray-300 hover:bg-gray-100"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={saving}
        class="px-3 py-2 text-sm rounded-md bg-primary text-white hover:bg-accent disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  </div>
</form>
```

- [ ] **Step 2: Create `src/lib/MenuSection.svelte`**

```svelte
<script>
  import Icons from "./Icons.svelte";
  import MenuRowEditor from "./MenuRowEditor.svelte";

  export let kind;
  export let title;
  export let addLabel;
  export let rows = [];
  export let milkOptions = [];
  export let customizationOptions = [];
  export let editingId = null;
  export let onEdit;
  export let onSave;
  export let onMove;
  export let onRestore;

  $: activeRows = rows.filter((row) => !row.archived);
  $: archivedRows = rows.filter((row) => row.archived);

  function detail(row) {
    if (kind === "items") return row.size ? `${row.size}oz` : "";
    if (kind === "customizations") return row.type;
    return "";
  }
</script>

<section class="bg-white rounded-lg shadow p-5 mb-6">
  <div class="flex justify-between items-center mb-3">
    <h2 class="font-semibold text-gray-900">{title}</h2>
    <button
      on:click={() => onEdit("new")}
      class="text-sm px-3 py-1 rounded-md bg-primary text-white hover:bg-accent"
    >
      + {addLabel}
    </button>
  </div>

  {#if activeRows.length === 0 && editingId !== "new"}
    <p class="text-sm text-gray-500 py-4">Nothing here yet.</p>
  {/if}

  <ul class="divide-y divide-gray-200">
    {#each activeRows as row, index (row.id)}
      <li class="py-2">
        {#if editingId === row.id}
          <MenuRowEditor
            {kind}
            {row}
            {milkOptions}
            {customizationOptions}
            onSave={(fields) => onSave(row.id, fields)}
            onArchive={() => onSave(row.id, { archived: true })}
            onCancel={() => onEdit(null)}
          />
        {:else}
          <div class="flex items-center justify-between">
            <div class="flex items-center min-w-0">
              <div class="flex flex-col mr-3">
                <button
                  on:click={() => onMove(row.id, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${row.name} up`}
                  class="text-gray-400 hover:text-gray-700 disabled:opacity-30 leading-none"
                >
                  ▲
                </button>
                <button
                  on:click={() => onMove(row.id, 1)}
                  disabled={index === activeRows.length - 1}
                  aria-label={`Move ${row.name} down`}
                  class="text-gray-400 hover:text-gray-700 disabled:opacity-30 leading-none"
                >
                  ▼
                </button>
              </div>
              <span class="truncate">{row.name}</span>
              {#if detail(row)}
                <span class="ml-2 text-sm text-gray-500">{detail(row)}</span>
              {/if}
            </div>

            <div class="flex items-center space-x-3 flex-shrink-0">
              <span
                class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full"
                class:bg-green-100={row.available}
                class:text-green-800={row.available}
                class:bg-red-100={!row.available}
                class:text-red-800={!row.available}
              >
                {row.available ? "Available" : "Unavailable"}
              </span>
              <button
                on:click={() => onEdit(row.id)}
                aria-label={`Edit ${row.name}`}
                class="text-gray-500 hover:text-gray-800"
              >
                <Icons name="settings" size={18} />
              </button>
            </div>
          </div>
        {/if}
      </li>
    {/each}
  </ul>

  {#if editingId === "new"}
    <div class="pt-3">
      <MenuRowEditor
        {kind}
        row={null}
        {milkOptions}
        {customizationOptions}
        onSave={(fields) => onSave(null, fields)}
        onArchive={() => onEdit(null)}
        onCancel={() => onEdit(null)}
      />
    </div>
  {/if}

  {#if archivedRows.length > 0}
    <details class="mt-4">
      <summary class="text-sm text-gray-500 cursor-pointer">
        Archived ({archivedRows.length})
      </summary>
      <ul class="divide-y divide-gray-100 mt-2">
        {#each archivedRows as row (row.id)}
          <li class="flex items-center justify-between py-2 text-sm text-gray-500">
            <span class="truncate">{row.name}</span>
            <button
              on:click={() => onRestore(row.id)}
              class="text-gray-600 hover:text-gray-900 underline"
            >
              Restore
            </button>
          </li>
        {/each}
      </ul>
    </details>
  {/if}
</section>
```

- [ ] **Step 3: Compile-check both components**

`npm run build` would **not** catch a syntax error here: Vite only compiles what something imports, and nothing imports these until Task 8. Compile them directly instead:

```bash
node -e "
import('svelte/compiler').then(async ({ compile }) => {
  const { readFileSync } = await import('node:fs')
  for (const f of ['src/lib/MenuRowEditor.svelte', 'src/lib/MenuSection.svelte']) {
    compile(readFileSync(f, 'utf8'), { filename: f })
    console.log('compiles:', f)
  }
}).catch((e) => { console.error('FAILED', e.message); process.exit(1) })
"
```

Expected: two `compiles:` lines, exit 0.

This works only because both components are plain JS. Do **not** add `lang="ts"` to them — the raw compiler has no TypeScript preprocessor, so a `lang="ts"` component fails this check with a bare `Unexpected token` (which is why `Cart.svelte` cannot be checked this way).

Also run `npm test` to confirm nothing regressed.

- [ ] **Step 4: Commit**

```bash
git add src/lib/MenuRowEditor.svelte src/lib/MenuSection.svelte
git commit -m "feat: add menu row editor and section components"
```

---

### Task 8: `MenuManager`, wire into `BaristaView`, retire the old availability path

**Files:**
- Create: `src/lib/MenuManager.svelte`
- Modify: `src/lib/BaristaView.svelte` (delete lines 468-544 and the four toggle handlers; open the page instead)
- Modify: `src/lib/api.js` (delete `updateItemAvailability`, `updateMilkAvailability`, `updateCustomizationAvailability`)
- Modify: `worker/routes/barista.js` (delete the availability route and `AVAILABILITY_ROUTES`)
- Modify: `worker/db.js` (delete `updateAvailability` and `AVAILABILITY_TABLES`)
- Modify: `tests/worker/barista-routes.test.js` (drop the availability cases)

**Interfaces:**
- Consumes: `MenuSection` from Task 7; the client API from Task 6.
- Produces: `MenuManager` with a single prop `onClose`.

- [ ] **Step 1: Create `src/lib/MenuManager.svelte`**

```svelte
<script>
  import { onDestroy, onMount } from "svelte";
  import Icons from "./Icons.svelte";
  import MenuSection from "./MenuSection.svelte";
  import {
    createMenuEntry,
    getMenuForManagement,
    reorderMenuEntries,
    updateMenuEntry,
  } from "./api";

  export let onClose;

  const SECTIONS = [
    { kind: "items", title: "Drinks", addLabel: "Add drink", collection: "items" },
    { kind: "milk", title: "Milks", addLabel: "Add milk", collection: "milkOptions" },
    {
      kind: "customizations",
      title: "Customizations",
      addLabel: "Add customization",
      collection: "customizationOptions",
    },
  ];

  let menu = null;
  let loadFailed = false;
  let actionError = null;
  let errorTimeout;

  // One editor open at a time across all three sections: "<kind>" keyed to
  // either a row id or the string "new".
  let editingKind = null;
  let editingId = null;

  onMount(load);
  onDestroy(() => clearTimeout(errorTimeout));

  async function load() {
    try {
      menu = await getMenuForManagement();
      loadFailed = false;
    } catch (error) {
      console.error("Error loading menu:", error);
      loadFailed = true;
    }
  }

  function showError(message) {
    actionError = message;
    clearTimeout(errorTimeout);
    errorTimeout = setTimeout(() => (actionError = null), 4000);
  }

  function edit(kind, id) {
    editingKind = id === null ? null : kind;
    editingId = id;
  }

  async function save(kind, id, fields) {
    try {
      if (id === null) await createMenuEntry(kind, fields);
      else await updateMenuEntry(kind, id, fields);
      await load();
      edit(kind, null);
      return true;
    } catch (error) {
      console.error("Error saving menu entry:", error);
      showError(
        error.status === 409
          ? "That name is already in use."
          : "Couldn't save that — try again."
      );
      // The editor stays open so nothing typed is lost.
      return false;
    }
  }

  async function move(kind, collection, id, delta) {
    const ids = menu[collection].filter((row) => !row.archived).map((row) => row.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;

    [ids[from], ids[to]] = [ids[to], ids[from]];
    try {
      await reorderMenuEntries(kind, ids);
    } catch (error) {
      console.error("Error reordering menu:", error);
      showError("Couldn't reorder that — try again.");
    }
    // Reload either way: on failure this puts the list back to the truth.
    await load();
  }
</script>

<div class="fixed inset-0 z-40 overflow-y-auto bg-gray-100">
  <header class="bg-white shadow-sm">
    <div
      class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center"
    >
      <h1 class="text-xl font-semibold text-gray-900">Menu</h1>
      <button
        on:click={onClose}
        class="text-gray-600 hover:text-gray-900"
        aria-label="Close menu management"
      >
        <Icons name="close" size={24} />
      </button>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
    {#if loadFailed}
      <p class="text-center text-gray-600 py-16">
        Couldn't load the menu — check your connection and try again.
      </p>
    {:else if !menu}
      <p class="text-center text-gray-600 py-16">Loading menu…</p>
    {:else}
      {#each SECTIONS as section (section.kind)}
        <MenuSection
          kind={section.kind}
          title={section.title}
          addLabel={section.addLabel}
          rows={menu[section.collection]}
          milkOptions={menu.milkOptions.filter((row) => !row.archived)}
          customizationOptions={menu.customizationOptions.filter((row) => !row.archived)}
          editingId={editingKind === section.kind ? editingId : null}
          onEdit={(id) => edit(section.kind, id)}
          onSave={(id, fields) => save(section.kind, id, fields)}
          onMove={(id, delta) => move(section.kind, section.collection, id, delta)}
          onRestore={(id) => save(section.kind, id, { archived: false })}
        />
      {/each}
    {/if}
  </main>

  {#if actionError}
    <div class="fixed bottom-4 left-0 right-0 px-4 z-50">
      <div
        class="max-w-md mx-auto bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded-md text-center shadow"
      >
        {actionError}
      </div>
    </div>
  {/if}
</div>
```

- [ ] **Step 2: Rewire `src/lib/BaristaView.svelte`**

**Apply these seven edits from the bottom of the file upward**, or match on the quoted anchors — every line number below refers to the *original* file, and editing top-down invalidates the later ones.

1. Change the import block (lines 4-14) to drop the menu-management imports:

```js
  import { getOrders, updateOrderStatus, signOut } from "./api";
```

2. Add the component import next to the `Analytics` import:

```js
  import MenuManager from "./MenuManager.svelte";
```

3. Replace the `showManagement`, `menuItems`, `milkOptions`, `customizationOptions` declarations (lines 27-30) with a single:

```js
  let showMenuManager = false;
```

4. Delete `loadManagementData`, `toggleManagement`, `toggleMilkAvailability`, `toggleItemAvailability`, and `toggleCustomizationAvailability` (lines 186-232).

5. Change the gear button's handler (line 275) to `on:click={() => (showMenuManager = true)}` and its `aria-label` to `"Manage menu"`.

6. Delete the whole `{#if showManagement}` block (lines 468-544).

7. Extend the top-level conditional so the manager renders as a full page, exactly as `Analytics` does:

```svelte
{#if showAnalytics}
  <Analytics onClose={() => (showAnalytics = false)} />
{:else if showMenuManager}
  <MenuManager onClose={() => (showMenuManager = false)} />
{:else}
```

- [ ] **Step 3: Delete the three availability client functions**

Remove `updateItemAvailability`, `updateMilkAvailability`, and `updateCustomizationAvailability` from `src/lib/api.js`.

- [ ] **Step 4: Delete the availability routes**

In `worker/routes/barista.js`, delete the `AVAILABILITY_ROUTES` constant (lines 5-9), the `availabilityMatch` block, and `updateAvailability` from the `../db.js` import.

In `worker/db.js`, delete `AVAILABILITY_TABLES` and `updateAvailability`.

- [ ] **Step 5: Update `tests/worker/barista-routes.test.js`**

In the "rejects a missing Access JWT on every route" list, replace the three availability entries with the new menu routes, so the gate is still proven over the surface that exists:

```js
    const routes = [
      ['GET', '/api/barista/orders'],
      ['PATCH', '/api/barista/orders/1'],
      ['GET', '/api/barista/menu'],
      ['POST', '/api/barista/menu/items'],
      ['PATCH', '/api/barista/menu/items/1'],
      ['PATCH', '/api/barista/menu/milk/order'],
    ]
```

and change the request body line so POST is covered too:

```js
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'GET' ? undefined : JSON.stringify({ status: 'completed', name: 'x' }),
```

Delete the two availability body-validation cases (the `'/api/barista/items/1'` null case and the `'/api/barista/milk/1'` bare-string case). Keep both order-status cases — they still cover `handleBarista`'s own body parsing.

- [ ] **Step 6: Run everything**

Run: `npm run build && npm test`
Expected: build succeeds; tests pass. The worker count drops by exactly 2 — the two deleted availability body-validation cases.

- [ ] **Step 7: Verify by hand**

Run `wrangler dev`, open `/barista`, click the gear, and confirm:
1. Three cards render with the seeded drinks, milks, and customizations.
2. Editing Latte's name and saving updates the row; reopening shows the new name.
3. ▲ on the second drink moves it up and the order survives a page reload.
4. Archiving a drink moves it into "Archived (1)"; Restore brings it back.
5. Adding a drink with an existing name shows "That name is already in use." and the form stays open with the typed values.

- [ ] **Step 8: Commit**

```bash
git add src/lib/MenuManager.svelte src/lib/BaristaView.svelte src/lib/api.js \
        worker/routes/barista.js worker/db.js tests/worker/barista-routes.test.js
git commit -m "feat: full-page menu manager, replacing the availability slide-over"
```

---

### Task 9: Customer menu — filtered and grouped pickers

**Files:**
- Modify: `src/lib/Menu.svelte` (lines 167-206)

**Interfaces:**
- Consumes: `milkOptionIds` / `customizationOptionIds` on each item (Task 2), `groupByType` (Task 5).
- Produces: nothing other tasks depend on.

Line numbers below refer to the original `Menu.svelte`. Apply the edits from the bottom of the file upward, or match on the quoted anchors.

- [ ] **Step 1: Import the helper and derive the visible options**

Add to the `<script>` block of `src/lib/Menu.svelte`:

```js
  import { groupByType } from "./menuGrouping";
```

and, after the `let showCustomizationModal = false;` declaration:

```js
  // A drink now carries its own applicable options, so the pickers show that
  // subset rather than everything on the menu.
  $: visibleMilkOptions = selectedItem
    ? milkOptions.filter((milk) => selectedItem.milkOptionIds.includes(milk.id))
    : [];
  $: visibleCustomizationGroups = selectedItem
    ? groupByType(
        customizationOptions.filter((option) =>
          selectedItem.customizationOptionIds.includes(option.id)
        )
      )
    : [];
```

- [ ] **Step 2: Render the milk picker from the filtered list**

In the `{#if selectedItem.allows_milk_choice}` block, change the loop on line 172 from `{#each milkOptions as milk}` to:

```svelte
                {#each visibleMilkOptions as milk (milk.id)}
```

- [ ] **Step 3: Render customizations grouped under their headings**

Replace the body of the `{#if selectedItem.allows_customizations}` block (lines 192-205) with:

```svelte
              <h3 class="text-lg font-semibold mb-2">Customizations</h3>
              <div class="mb-4">
                {#each visibleCustomizationGroups as group (group.type)}
                  <p class="text-sm font-semibold text-gray-500 uppercase tracking-wide mt-3 mb-1">
                    {group.type}
                  </p>
                  <div class="space-y-2">
                    {#each group.options as customization (customization.id)}
                      <label class="flex items-center">
                        <input
                          type="checkbox"
                          checked={selectedCustomizationOptionIds.includes(customization.id)}
                          on:change={() => toggleCustomization(customization.id)}
                          class="mr-2"
                        />
                        {customization.name}
                      </label>
                    {/each}
                  </div>
                {/each}
              </div>
```

- [ ] **Step 4: Prune selections against the drink, not just the menu**

`refreshOptions` (lines 50-52) drops customization selections that have left the menu. It must also drop ones that are no longer applicable to the open drink — a barista can unlink an option mid-order. Replace those three lines with:

```js
    selectedCustomizationOptionIds = selectedCustomizationOptionIds.filter(
      (id) =>
        customizationOptions.some((option) => option.id === id) &&
        (!selectedItem || selectedItem.customizationOptionIds.includes(id))
    );
```

- [ ] **Step 5: Build and test**

Run: `npm run build && npm test`
Expected: build succeeds; tests pass with zero failures.

- [ ] **Step 6: Verify by hand**

With `wrangler dev` running:
1. Customize a Cappuccino — the milk picker shows all four milks and the customizations show under **Syrups** / **Toppings** / **Coffee** headings.
2. Customize Matcha Latte — the milk picker appears, the customization section does not.
3. Espresso still shows "Add to Cart" with no Customize step.
4. In the manager, unlink every milk from Latte; within five seconds the customer's Latte switches from "Customize" to "Add to Cart".

- [ ] **Step 7: Commit**

```bash
git add src/lib/Menu.svelte
git commit -m "feat: filter customer pickers per drink and group customizations by heading"
```

---

### Task 10: Documentation

**Files:**
- Modify: `README.md` (insert after the "Cloudflare Access (barista login)" section)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing.

- [ ] **Step 1: Add the section**

Insert into `README.md` after the Cloudflare Access section and before "GitHub Actions secrets":

```markdown
### Managing the menu

The barista page owns the menu. Sign in at `/barista` and use the gear icon:
drinks, milk options, and customizations can each be added, edited, reordered,
and archived without touching the database.

**Nothing is ever deleted.** `order_items` holds a foreign key into `items`,
and the analytics page reads drink names through that join, so a delete would
rewrite history. Archiving removes a row from the customer menu and hides it
behind the "Archived" disclosure in the manager; restoring it brings it back
along with every option it was linked to.

**Which milks and syrups a drink offers is per-drink**, stored in
`item_milk_options` and `item_customization_options`. A drink with no linked
milks takes no milk. The older `items.allows_milk_choice` and
`items.allows_customizations` columns are superseded by those tables and are no
longer read — the API still returns fields by those names, now derived. They
are deliberately left in the schema: migrations run *before* the new Worker
deploys, so dropping them in the same change would leave live customers with no
milk picker for the seconds in between.

**A customization's "heading" is the literal text shown above it** on the
customer menu (`Syrups`, `Toppings`, …). There is no fixed list — type a new
heading and a new group appears.

Drinks are ordered by `sort_order`, set with the ▲▼ buttons in the manager, not
alphabetically.
```

- [ ] **Step 2: Verify the suite is still green**

Run: `npm test`
Expected: PASS, zero failures.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document menu management"
```

---

## Verification Checklist

Run after the final task:

- [ ] `npm test` — zero failures; 62 node tests and roughly 105 worker tests
- [ ] `npm run build` — succeeds
- [ ] `wrangler deploy --env "" --dry-run` — succeeds
- [ ] `grep -rn "updateAvailability\|AVAILABILITY_\|showManagement" worker src` returns nothing
- [ ] `tests/analytics.test.js` and `tests/worker/authorization.test.js` are untouched: `git diff --stat main -- tests/analytics.test.js tests/worker/authorization.test.js` is empty
