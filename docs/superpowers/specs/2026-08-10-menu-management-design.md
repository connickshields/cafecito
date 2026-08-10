# Menu Management Design

**Date:** 2026-08-10
**Status:** Approved

## Problem

Supabase's dashboard let the menu be edited directly as SQL table rows: add a
drink, rename one, fix a description, set an ounce size, add a syrup. The
migration to D1 removed that, and nothing replaced it. What exists today is a
narrow slide-over in `BaristaView.svelte` that does exactly one thing — flip
`available` on `items`, `milk_options`, and `customization_options`. Every
other menu change now requires a `wrangler d1 execute` against production.

This design replaces both: a full-page menu manager in the barista area, with
more control than the Supabase table editor gave, and no raw SQL.

## Goals

- Create, edit, and archive drinks, milk options, and customizations from the UI
- Control the order drinks appear in, instead of hard-coded alphabetical
- Control *which* milks and customizations apply to each drink, instead of the
  current all-or-nothing booleans
- Never lose the ability to read historical orders correctly

## Non-goals

Prices, images, menu categories/sections, per-item stock counts, edit history,
and multi-barista conflict handling. Concurrent edits are last-write-wins.

---

## 1. Schema — migration `0002_menu_management.sql`

Additive only. Migrations run before the new Worker deploys, so nothing here
may break the currently-deployed code.

### 1.1 Display order

```sql
ALTER TABLE items ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE milk_options ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customization_options ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

UPDATE items SET sort_order =
  (SELECT COUNT(*) FROM items AS other WHERE other.name < items.name);
UPDATE milk_options SET sort_order =
  (SELECT COUNT(*) FROM milk_options AS other WHERE other.name < milk_options.name);
UPDATE customization_options SET sort_order =
  (SELECT COUNT(*) FROM customization_options AS other
    WHERE other.name < customization_options.name);
```

Backfilling to the current alphabetical position means the customer menu is
byte-identical the moment this deploys. Verified against a real SQLite copy of
`0001_init.sql`: the eight seed drinks land in positions 0–7 alphabetically.

### 1.2 Archival

```sql
ALTER TABLE items ADD COLUMN archived INTEGER NOT NULL DEFAULT 0
  CHECK (archived IN (0,1));
ALTER TABLE milk_options ADD COLUMN archived INTEGER NOT NULL DEFAULT 0
  CHECK (archived IN (0,1));
ALTER TABLE customization_options ADD COLUMN archived INTEGER NOT NULL DEFAULT 0
  CHECK (archived IN (0,1));
```

`ADD COLUMN` with a `CHECK` constraint is legal in SQLite — verified, not
assumed. There is **no hard delete anywhere in this design**. `order_items`
holds a foreign key into `items`, and analytics reads drink names through that
join; archiving keeps every historical order readable forever. Archived rows
leave the customer menu entirely and drop into a collapsed section of the
manager, from which they can be restored.

### 1.3 Per-item applicability

```sql
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

INSERT INTO item_milk_options (item_id, milk_option_id)
SELECT i.id, m.id FROM items i CROSS JOIN milk_options m
 WHERE i.allows_milk_choice = 1;

INSERT INTO item_customization_options (item_id, customization_option_id)
SELECT i.id, c.id FROM items i CROSS JOIN customization_options c
 WHERE i.allows_customizations = 1;
```

The backfill reproduces today's behavior exactly: Espresso, Americano, and
Cortado end with zero linked milks; the other five link to all four. Verified —
20 rows, distributed as expected.

This replaces two booleans with one concept. `allows_milk_choice` becomes
"has at least one linked milk," which is strictly more expressive: Matcha Latte
can now offer milk without also offering Extra Shot.

### 1.4 Customization types become display labels

```sql
UPDATE customization_options SET type = 'Syrups'   WHERE type = 'syrup';
UPDATE customization_options SET type = 'Toppings' WHERE type = 'topping';
UPDATE customization_options SET type = 'Coffee'   WHERE type = 'coffee';
```

`customization_options.type` is currently written by the seed and read by
nothing — not the customer picker, not analytics, not the barista view. This
design makes it real by grouping the customization picker under type headers.

Storing the type as the **exact string to display** removes every
transformation rule. There is no title-casing, no pluralization, no mapping
table: the header above a group is the type as typed. Naive pluralization would
render `coffee` as "Coffees"; a hard-coded enum would break the first time a
new type is invented. Neither problem exists if the barista simply types the
heading they want.

### 1.5 The superseded boolean columns

`items.allows_milk_choice` and `items.allows_customizations` **remain as
columns and stop being read**. The API keeps returning fields under those
names, now derived (`milkOptionIds.length > 0`), so `Menu.svelte`'s existing
checks keep working.

They are not dropped in this migration because migrations run *before* the new
Worker. For the seconds between the two, the still-deployed old Worker would
`SELECT *` and find the columns missing, serving every drink with no milk
picker to live customers. They can be dropped by a later migration in a
separate deploy, or simply left in place. A comment in `0002` says so.

---

## 2. Worker API

All new routes sit under `/api/barista/*`, which `worker/index.js` gates at the
mount point before any handler runs. No new route implements its own auth check.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/barista/menu` | Full manager payload, including archived rows |
| POST | `/api/barista/menu/:kind` | Create one row |
| PATCH | `/api/barista/menu/:kind/:id` | Partial update of one row |
| PATCH | `/api/barista/menu/:kind/order` | Reorder a whole kind |

`:kind` is `items` \| `milk` \| `customizations`, resolved through the table
allowlist already in `worker/routes/barista.js`. `:id` is matched as `(\d+)`,
so the literal `order` path can never be mistaken for a row id.

### 2.1 `GET /api/barista/menu`

```json
{
  "items": [
    {
      "id": 1, "name": "Espresso", "description": "Double shot of espresso",
      "size": null, "available": true, "archived": false, "sortOrder": 3,
      "milkOptionIds": [], "customizationOptionIds": []
    }
  ],
  "milkOptions": [
    { "id": 1, "name": "Whole", "available": true, "archived": false, "sortOrder": 3 }
  ],
  "customizationOptions": [
    { "id": 5, "name": "Vanilla Syrup", "type": "Syrups",
      "available": true, "archived": false, "sortOrder": 4 }
  ]
}
```

Ordered by `sort_order, name` within each kind. New fields are camelCase
(`sortOrder`, `milkOptionIds`), matching how `getOrders` already returns
`customerName`.

### 2.2 Create — `POST /api/barista/menu/:kind`

| kind | body |
|---|---|
| `items` | `{ name, description?, size?, available?, milkOptionIds?, customizationOptionIds? }` |
| `milk` | `{ name, available? }` |
| `customizations` | `{ name, type, available? }` |

`available` defaults to `true`, `archived` to `false`, `sortOrder` to
`MAX(sort_order) + 1` within that kind. Responds `201` with `{ "id": <n> }`.

### 2.3 Update — `PATCH /api/barista/menu/:kind/:id`

Accepts any subset of the create fields, plus `archived`. Absent fields are
left alone. For items, supplying `milkOptionIds` or `customizationOptionIds`
replaces that link set wholesale (delete + insert in one `batch()`, so a failed
save cannot leave an item half-linked). Responds `200 {"ok": true}`, or `404`
if no row matched.

### 2.4 Reorder — `PATCH /api/barista/menu/:kind/order`

Body is `{ "ids": [3, 1, 2] }` — the complete list of that kind's non-archived
ids in their new order. The Worker validates the submitted set equals the
current non-archived set for that kind (`400` otherwise), then assigns
`sort_order = index` in a single `batch()`. Set equality is what stops a stale
browser tab from scrambling the order after someone else added a drink.
Archived rows keep whatever `sort_order` they had.

### 2.5 Retired routes

`PATCH /api/barista/(items|milk|customizations)/:id` — the three
availability-only routes — are **removed**. The new PATCH supersedes them, and
their only caller is the slide-over this design deletes. `authorization.test.js`
does not reference them, so no security test changes.

### 2.6 Customer endpoint changes

`GET /api/menu` gains `milkOptionIds` and `customizationOptionIds` on each
item, excludes `archived = 1` rows from all three collections, and orders by
`sort_order, name` instead of `name`. `allows_milk_choice` and
`allows_customizations` are still returned, now derived.

The order-history join (`ORDER_JOIN` in `worker/db.js`) is deliberately **not**
filtered by `archived` — an in-flight order for a just-archived drink must
still render its real name.

### 2.7 Validation

| Field | Rule | Failure |
|---|---|---|
| `name` | required, trimmed, 1–60 chars | 400 |
| `name` | case-insensitively unique among non-archived rows of that kind, **excluding the row being updated** | 409 |
| `description` | optional, ≤200 chars | 400 |
| `size` | `null`, or an integer 1–64 | 400 |
| `type` | required for customizations, trimmed, 1–30 chars; stored verbatim as the display heading | 400 |
| `available`, `archived` | boolean | 400 |
| `milkOptionIds`, `customizationOptionIds` | arrays of ids of existing non-archived rows | 400 |

Uniqueness is enforced in the Worker rather than by a DB constraint because it
must ignore archived rows — a resurrected "Mocha" should not collide with an
archived one.

---

## 3. Worker file layout

`worker/db.js` is already ~300 lines covering menu reads, order writes, queue
stats, and availability. Adding menu CRUD there would push it past 430.

- **Create `worker/menu-db.js`** — takes `getMenu`, `toBooleans`, and
  `BOOLEAN_COLUMNS` from `db.js`, and adds the new CRUD and reorder functions.
- **`worker/db.js`** keeps orders, order details, queue stats, and
  `createOrder`. `updateAvailability` is deleted with its routes.
- **`worker/routes/menu.js`** grows from its current 4 lines to hold both the
  customer read handler and the admin handlers, exported separately.
- **`worker/routes/barista.js`** stays the auth boundary and order routes, and
  delegates `/api/barista/menu*` to `routes/menu.js`.

---

## 4. Frontend

### 4.1 New components

- **`src/lib/MenuManager.svelte`** — page chrome, data loading, save
  orchestration, error banner. Same shell as `Analytics.svelte`:
  `fixed inset-0 z-40 overflow-y-auto bg-gray-100`, white `shadow-sm` header
  with the title and a close button, `max-w-7xl mx-auto` body.
- **`src/lib/MenuSection.svelte`** — one `bg-white rounded-lg shadow` card:
  heading, "+ Add" button, rows, reorder controls, and a collapsed
  `<details>` disclosure listing archived rows with Restore buttons.
- **`src/lib/MenuRowEditor.svelte`** — the inline form, with different fields
  per kind.

Split three ways because one component doing all of it lands near 500 lines —
the size `BaristaView.svelte` already is.

### 4.2 Interaction

Three cards stack down one scrolling page: Drinks, Milks, Customizations.
Each row shows name, a kind-specific detail (ounce size for drinks), an
availability pill, and an edit button. Clicking edit expands that row in place
into the form; the list never scrolls out from under you.

Editor fields:

| kind | fields |
|---|---|
| items | name, description, size (blank = null), available, milk checkboxes, customization checkboxes grouped by type |
| milk | name, available |
| customizations | name, type (text input with a `<datalist>` of existing types), available |

Buttons are Archive (left, only for existing rows), Cancel, Save. Adding uses
the same form with an empty row appended.

**Reordering uses ▲▼ buttons, not drag-and-drop.** HTML5 drag events need a
touch shim to work on the iPad most likely to be on the counter, and are
keyboard-inaccessible without extra work. These lists are 4–8 rows. Each
button carries `aria-label="Move <name> up"` and is disabled at the ends.

A save issues its POST/PATCH, then refetches the whole manager payload and
collapses the editor. A failed save keeps the editor open with the typed values
intact and shows the transient error banner — the same pattern
`BaristaView.svelte` uses via `showActionError`.

### 4.3 Existing components

- **`BaristaView.svelte`** — delete the management slide-over (lines 468–544),
  the four toggle handlers, and the now-unused API imports. The gear button
  sets `showMenuManager = true`, mirroring how the chart button opens
  `Analytics`. Net −110 lines.
- **`Menu.svelte`** — the milk picker renders only the milks in
  `selectedItem.milkOptionIds`; the customization picker only those in
  `selectedItem.customizationOptionIds`, **grouped under type headers**
  (Syrups / Toppings / Coffee).
- **`src/lib/api.js`** — add `getMenuForManagement`, `createMenuEntry`,
  `updateMenuEntry`, `reorderMenuEntries`; remove the three availability
  functions.
- **`src/types.d.ts`** — `MenuItem` gains `milkOptionIds` and
  `customizationOptionIds`. The customer payload deliberately carries neither
  `sortOrder` nor `archived`.

### 4.4 Grouping helper

**`src/lib/menuGrouping.js`** exports `groupByType(options)`, returning
`[{ type, options }]`. Groups are ordered by the lowest `sortOrder` among their
members; options within a group by `sortOrder` then name. The heading rendered
is `type` verbatim (§1.4) — the helper formats nothing. Keeping it a pure
function means the ordering rules get a fast node test instead of a component
test, following the `analytics.js` precedent.

Deriving group order from membership rather than a hard-coded enum means a
brand-new type string renders sensibly the first time it is used.

Both the customer picker in `Menu.svelte` and the Customizations card in the
manager use this helper, so the two views group identically.

---

## 5. Behavior of archival

- Archiving a **drink** removes it from the customer menu immediately (within
  the 5-second poll). In-flight orders containing it still display its name.
- Archiving a **milk or customization** removes it from every drink's picker
  without unlinking it. Restoring brings the links back exactly as they were.
- `CustomerView.svelte` does not prune the cart on poll. A mid-session archive
  or 86'ing surfaces only at submit time: the Worker rejects the order with a
  409 listing the now-unavailable rows, `pruneUnavailable` removes exactly
  those from the cart, and the customer sees a "sold out" notice.

---

## 6. Testing

**Node project**

- `tests/menu-grouping.test.js` — group ordering by lowest member `sortOrder`,
  within-group ordering, a type string never seen before, single-group input,
  empty input.

**Workers pool**

- `tests/worker/menu-manager.test.js` (new) — create/update round-trips per
  kind; every validation rule in §2.7 including the 409; archive removes a row
  from `/api/menu` but not from order history; restore; reorder success;
  reorder rejects a stale/incomplete id set; link replacement is wholesale.
- `tests/worker/migration.test.js` — extend: `0002` applies cleanly, the
  backfill gives Espresso zero linked milks and Cappuccino four, `sort_order`
  reproduces the previous alphabetical order, and the seed types have become
  `Syrups` / `Toppings` / `Coffee`.
- `tests/worker/menu-db.test.js` — extend: derived `allows_milk_choice` /
  `allows_customizations`, archived exclusion, `sort_order` ordering.
- `tests/worker/barista-routes.test.js` — drop the availability-route cases.

`tests/analytics.test.js` and `tests/worker/authorization.test.js` are not
modified.

---

## 7. Documentation

`README.md` gains a "Managing the menu" section stating that the barista page
is the supported way to change the menu, that nothing is ever hard-deleted, and
that the two superseded boolean columns are intentionally left in place.
