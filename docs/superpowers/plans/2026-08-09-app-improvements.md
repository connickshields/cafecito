# App Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell customers when the café is closed, remove the barista wordmark, and replace the text-only stats sidebar with a full-screen charted analytics view.

**Architecture:** All aggregation lives in a pure `src/lib/analytics.js` module with no DOM or Svelte dependency, so it can be unit-tested directly. Two small presentational chart components render inline SVG (vertical bars) and HTML/CSS (ranked horizontal bars). `Analytics.svelte` composes them into a full-screen overlay that `BaristaView` swaps in, keeping `BaristaView` from growing.

**Tech Stack:** Svelte 4, Vite 5, Tailwind 3, Supabase JS 2, Vitest (new, dev-only).

**Spec:** `docs/superpowers/specs/2026-08-09-app-improvements-design.md`

## Global Constraints

- **Svelte 4** — no runes (`$state`, `$derived`), no snippets (`{#snippet}`). Use `export let` for props and `$:` for derived values.
- **Component prop style** — pass callbacks as props (`export let onClose`), matching `OrderStatus.svelte` and `FloatingFooter.svelte`. Do not use `createEventDispatcher` for close actions.
- **Chart series color is exactly `#2a78d6`.** Validated against the light chart surface with the dataviz skill's `validate_palette.js` (lightness band PASS, chroma floor PASS, contrast ≥ 3:1 PASS). Do not substitute another color.
- **Light mode only.** The app has no dark-mode styling anywhere; do not add `dark:` variants.
- **Vitest is the only new dependency, and it is `devDependencies`.** No charting library, no runtime dependency.
- **No schema changes.** `functions.sql`, `schema.sql`, and `rls.sql` are untouched by this plan.
- **Copy strings are exact.** Where a task gives user-visible text, use it verbatim, including the em dash `—` and the é in "café".
- **Tailwind only for styling.** No `<style>` blocks in new components except where a task explicitly shows one.
- Run `npm run build` before any commit that touches a `.svelte` file; a Svelte compile error is otherwise invisible.

---

### Task 1: Closed Notice on the Customer View

**Files:**
- Create: `src/lib/ClosedNotice.svelte`
- Modify: `src/lib/CustomerView.svelte`

**Interfaces:**
- Consumes: `Icons.svelte` (existing, accepts `name` / `size` / `color`).
- Produces: `ClosedNotice.svelte`, a propless presentational component. Nothing later depends on it.

There is no component test runner in this project, so this task is verified by build plus manual browser check.

> **Branch note:** `HangoverNotice.svelte` lives on the unmerged `feat/hangover-notice` branch and does not exist here, so it is absent from Step 6's markup. When that branch merges, the two changes will conflict textually — resolve by keeping this task's `{#if}/{:else if}/{:else}` structure and placing `<HangoverNotice />` inside the final `{:else}`, so the notice stays hidden while the café is closed.

- [ ] **Step 1: Create the closed notice component**

Create `src/lib/ClosedNotice.svelte`:

```svelte
<script>
  import Icons from "./Icons.svelte";
</script>

<div role="status" class="text-center py-16">
  <div class="flex justify-center">
    <Icons name="stylized-cup" size={100} color="#93A8AC" />
  </div>
  <h2 class="mt-4 text-2xl font-bold text-gray-900">
    The café isn't accepting orders right now
  </h2>
  <p class="mt-2 text-gray-600">Check back soon — this page updates automatically.</p>
</div>
```

- [ ] **Step 2: Import the component and add failure state to CustomerView**

In `src/lib/CustomerView.svelte`, add the import beside the existing `HangoverNotice` import (around line 8):

```js
import ClosedNotice from "./ClosedNotice.svelte";
```

Add a state variable next to `let loading = true;` (around line 18):

```js
let menuLoadFailed = false;
```

- [ ] **Step 3: Make the first menu fetch survive a network failure**

Replace the `onMount` body in `src/lib/CustomerView.svelte:27-32`. Currently the `getMenuItems()` call is unguarded, so a throw leaves `loading` stuck at `true` forever.

```js
  onMount(async () => {
    try {
      menuItems = await getMenuItems();
    } catch (error) {
      console.error("Error loading menu:", error);
      menuLoadFailed = true;
    }
    loading = false;
    await refreshPageData();
    pollId = setInterval(refreshPageData, 5000);
  });
```

- [ ] **Step 4: Let a successful poll clear the failure flag**

In `refreshPageData` (`src/lib/CustomerView.svelte:38-50`), replace the first try/catch:

```js
    try {
      menuItems = await getMenuItems();
      menuLoadFailed = false;
    } catch (e) {
      // keep last known menu
    }
```

- [ ] **Step 5: Add the derived state**

Add beside the other `$:` statements in `src/lib/CustomerView.svelte` (near line 118):

```js
  $: menuUnavailable = !loading && !menuLoadFailed && menuItems.length === 0;
  $: canOrder = !loading && !menuLoadFailed && menuItems.length > 0;
```

- [ ] **Step 6: Branch the main content**

In `src/lib/CustomerView.svelte`, replace the `{#if loading} ... {:else} ... {/if}` block inside `<main>` (lines 148-173) so the closed and failed states short-circuit the whole ordering block. The `{:else}` branch keeps its existing contents unchanged:

```svelte
        {#if loading}
          <p class="text-center">Loading menu items...</p>
        {:else if menuLoadFailed}
          <p class="text-center text-gray-600">Couldn't load the menu — retrying…</p>
        {:else if menuUnavailable}
          <ClosedNotice />
        {:else}
          <div class="space-y-8">
            <h2 class="text-3xl font-bold mb-4 text-center">
              <span>Welcome, {customerName}!</span>
            </h2>
            {#if queueDepth && queueDepth.drinksAhead > 0}
              <div
                transition:fade
                class="bg-white border rounded-md px-4 py-2 text-center text-gray-700 shadow-sm"
              >
                Current queue: {queueDepth.drinksAhead} drink{queueDepth.drinksAhead === 1 ? "" : "s"}
                {#if bannerRange}&nbsp;· ~{bannerRange.low}–{bannerRange.high} min wait{/if}
              </div>
            {/if}
            <Menu {menuItems} {addToOrder} on:closeCart={() => (showCart = false)} />
            <Cart
              {orderItems}
              visible={showCart}
              on:removeItem={(event) => removeItem(event.detail)}
              on:updateQuantityEvent={updateQuantity}
            />
          </div>
        {/if}
```

- [ ] **Step 7: Hide the floating footer when ordering is impossible**

In `src/lib/CustomerView.svelte`, wrap the `<FloatingFooter ... />` element (lines 185-191):

```svelte
    {#if canOrder}
      <FloatingFooter
        {itemCount}
        {showCart}
        {submitting}
        onViewCart={toggleCart}
        onSubmitOrder={handleSubmitOrder}
      />
    {/if}
```

- [ ] **Step 8: Verify the build compiles**

Run: `npm run build`
Expected: exits 0, no Svelte compile warnings about unused or undefined variables.

- [ ] **Step 9: Verify manually in the browser**

Run: `npm run dev`

1. Sign in as a barista, open the settings (gear) panel, and mark every beverage Unavailable.
2. In a second tab, open the customer view. Within 5 seconds it must show the cup icon, "The café isn't accepting orders right now", and no floating footer.
3. Mark one beverage Available again. Within 5 seconds the customer view must show the menu and footer again without a reload.

- [ ] **Step 10: Commit**

```bash
git add src/lib/ClosedNotice.svelte src/lib/CustomerView.svelte
git commit -m "feat: tell customers when the cafe isn't accepting orders

Also guards the initial menu fetch so a network failure shows a retry
message instead of hanging on 'Loading menu items...' forever."
```

---

### Task 2: Remove the Barista Wordmark

**Files:**
- Modify: `src/lib/BaristaView.svelte:275-280`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Delete the wordmark**

In `src/lib/BaristaView.svelte`, delete these six lines entirely (they sit between the stat cluster `</div>` and the `<div class="flex items-center space-x-4">` holding the icon buttons):

```svelte
        <h1
          class="text-6xl font-bold text-primary font-display yesteryear-regular text-center absolute left-1/2 transform -translate-x-1/2"
          style="-webkit-text-stroke: 8px #000; paint-order: stroke fill;"
        >
          Cafecito
        </h1>
```

Do not change anything else in the header. The element is absolutely positioned, so the stat cluster stays left and the icon buttons stay right with no other edit.

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: exits 0.

- [ ] **Step 3: Verify manually**

Run: `npm run dev`, sign in as a barista. The header must show only the stat cluster on the left and the three icon buttons on the right, with no "Cafecito" text and a visibly shorter header.

- [ ] **Step 4: Commit**

```bash
git add src/lib/BaristaView.svelte
git commit -m "feat: remove wordmark from barista header to reduce clutter"
```

---

### Task 3: Vitest Setup and Fulfillment Timing Math

**Files:**
- Modify: `package.json`
- Modify: `vite.config.js`
- Create: `src/lib/analytics.js`
- Test: `tests/analytics.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces, from `src/lib/analytics.js`:
  - `fulfillmentDurations(orders: Order[]) => number[]` — ascending millisecond spans
  - `percentile(sortedValues: number[], p: number) => number | null`
  - `fulfillmentHistogram(durationsMs: number[]) => Array<{label: string, value: number}>` — always 7 entries
  - `formatDuration(ms: number | null) => string`

`Order` here is the shape returned by `getOrders()` in `src/lib/supabase.js`: `{ id, status, customerName, created_at, updated_at, items: Array<{ name, quantity, milkOption, customizations }> }`.

**Background the implementer needs:** `orders.updated_at` is overwritten by a Postgres trigger on every update, so for a `completed` order it is the completion time and there is no way to recover the `pending → in_progress` transition. Total fulfillment span is the only timing signal available. This is a known, accepted limitation — do not attempt to work around it.

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Add the test scripts**

In `package.json`, replace the `"scripts"` block:

```json
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
```

- [ ] **Step 3: Point vitest at the tests directory**

In `vite.config.js`, add a `test` key to the config object, after the existing `css` key:

```js
export default defineConfig({
  plugins: [svelte()],
  css: {
    postcss: {
      plugins: [
        tailwindcss,
        autoprefixer,
      ],
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
})
```

- [ ] **Step 4: Write the failing tests**

Create `tests/analytics.test.js`:

```js
import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  fulfillmentDurations,
  fulfillmentHistogram,
  percentile,
} from '../src/lib/analytics.js'

const order = (status, createdAt, updatedAt) => ({
  status,
  created_at: createdAt,
  updated_at: updatedAt,
  items: [],
})

describe('fulfillmentDurations', () => {
  it('returns ascending millisecond spans for completed orders only', () => {
    const orders = [
      order('completed', '2026-08-09T10:00:00Z', '2026-08-09T10:05:00Z'),
      order('completed', '2026-08-09T10:00:00Z', '2026-08-09T10:02:00Z'),
      order('pending', '2026-08-09T10:00:00Z', '2026-08-09T10:00:00Z'),
      order('cancelled', '2026-08-09T10:00:00Z', '2026-08-09T10:09:00Z'),
    ]
    expect(fulfillmentDurations(orders)).toEqual([120000, 300000])
  })

  it('drops non-positive spans from clock skew or backfilled rows', () => {
    const orders = [
      order('completed', '2026-08-09T10:05:00Z', '2026-08-09T10:00:00Z'),
      order('completed', '2026-08-09T10:00:00Z', '2026-08-09T10:00:00Z'),
      order('completed', '2026-08-09T10:00:00Z', '2026-08-09T10:03:00Z'),
    ]
    expect(fulfillmentDurations(orders)).toEqual([180000])
  })

  it('drops rows with an unparseable timestamp', () => {
    expect(fulfillmentDurations([order('completed', 'not-a-date', '2026-08-09T10:03:00Z')])).toEqual([])
  })

  it('returns an empty array for no orders', () => {
    expect(fulfillmentDurations([])).toEqual([])
  })
})

describe('percentile', () => {
  it('returns null for an empty set', () => {
    expect(percentile([], 50)).toBeNull()
  })

  it('returns the only value for a single-element set', () => {
    expect(percentile([42], 90)).toBe(42)
  })

  it('returns the middle value of an odd-sized set', () => {
    expect(percentile([1, 2, 3], 50)).toBe(2)
  })

  it('interpolates the median of an even-sized set', () => {
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5)
  })

  it('interpolates p90 between the closest ranks', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBeCloseTo(9.1)
  })
})

describe('fulfillmentHistogram', () => {
  it('always returns seven buckets, zeroed for empty input', () => {
    const result = fulfillmentHistogram([])
    expect(result).toHaveLength(7)
    expect(result.every((bucket) => bucket.value === 0)).toBe(true)
  })

  it('puts a value landing exactly on a boundary in the higher bucket', () => {
    const result = fulfillmentHistogram([2 * 60000, 4 * 60000, 15 * 60000])
    expect(result.find((b) => b.label === '2–4m').value).toBe(1)
    expect(result.find((b) => b.label === '4–6m').value).toBe(1)
    expect(result.find((b) => b.label === '15m+').value).toBe(1)
  })

  it('counts anything past the last boundary in the open bucket', () => {
    const result = fulfillmentHistogram([60 * 60000])
    expect(result.find((b) => b.label === '15m+').value).toBe(1)
  })

  it('counts a sub-boundary value in the first bucket', () => {
    const result = fulfillmentHistogram([90 * 1000])
    expect(result.find((b) => b.label === '0–2m').value).toBe(1)
  })
})

describe('formatDuration', () => {
  it('renders an em dash when there is no value', () => {
    expect(formatDuration(null)).toBe('—')
  })

  it('renders minutes and seconds', () => {
    expect(formatDuration(185000)).toBe('3m 5s')
  })

  it('renders zero minutes for a sub-minute span', () => {
    expect(formatDuration(45000)).toBe('0m 45s')
  })
})
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "../src/lib/analytics.js"`, because the module does not exist yet.

- [ ] **Step 6: Write the implementation**

Create `src/lib/analytics.js`:

```js
// Pure aggregation for the barista analytics view. Input is the array returned
// by getOrders() in supabase.js. No DOM, no Svelte — this module is unit-tested.

const MINUTE_MS = 60_000

// Upper bound in minutes for each bucket; the last one is open-ended.
const FULFILLMENT_BUCKETS = [
  { label: '0–2m', maxMinutes: 2 },
  { label: '2–4m', maxMinutes: 4 },
  { label: '4–6m', maxMinutes: 6 },
  { label: '6–8m', maxMinutes: 8 },
  { label: '8–10m', maxMinutes: 10 },
  { label: '10–15m', maxMinutes: 15 },
  { label: '15m+', maxMinutes: Infinity },
]

// A trigger overwrites updated_at on every status change, so for a completed
// order it is the completion time. Orders still in the queue have no usable
// span, and a non-positive one means clock skew or a backfilled row.
export function fulfillmentDurations(orders) {
  return orders
    .filter((order) => order.status === 'completed')
    .map(
      (order) =>
        new Date(order.updated_at).getTime() - new Date(order.created_at).getTime()
    )
    .filter((ms) => Number.isFinite(ms) && ms > 0)
    .sort((a, b) => a - b)
}

// Linear interpolation between closest ranks (the R-7 method).
export function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null
  const rank = (p / 100) * (sortedValues.length - 1)
  const lower = Math.floor(rank)
  const upper = Math.ceil(rank)
  if (lower === upper) return sortedValues[lower]
  return (
    sortedValues[lower] + (rank - lower) * (sortedValues[upper] - sortedValues[lower])
  )
}

// A value landing exactly on a boundary falls into the higher bucket.
export function fulfillmentHistogram(durationsMs) {
  const counts = FULFILLMENT_BUCKETS.map((bucket) => ({ label: bucket.label, value: 0 }))
  durationsMs.forEach((ms) => {
    const minutes = ms / MINUTE_MS
    const index = FULFILLMENT_BUCKETS.findIndex((bucket) => minutes < bucket.maxMinutes)
    counts[index].value += 1
  })
  return counts
}

export function formatDuration(ms) {
  if (ms == null) return '—'
  const minutes = Math.floor(ms / MINUTE_MS)
  const seconds = Math.floor((ms % MINUTE_MS) / 1000)
  return `${minutes}m ${seconds}s`
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — 18 tests across 4 suites (includes the null-`created_at`/`updated_at` guard cases added alongside the fulfillment timing math).

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vite.config.js src/lib/analytics.js tests/analytics.test.js
git commit -m "feat: add tested fulfillment timing math for analytics

Adds vitest as the project's first test runner."
```

---

### Task 4: Grouping, Ranking, and the computeAnalytics Entry Point

**Files:**
- Modify: `src/lib/analytics.js`
- Test: `tests/analytics.test.js`

**Interfaces:**
- Consumes: `fulfillmentDurations`, `percentile`, `fulfillmentHistogram` from Task 3.
- Produces, from `src/lib/analytics.js`:
  - `ordersByHour(orders) => Array<{label, value}>` — always 24 entries, labels `"0"`–`"23"`
  - `ordersByDayOfWeek(orders) => Array<{label, value}>` — always 7 entries, `"Sun"`–`"Sat"`
  - `drinkCounts(orders) / milkCounts(orders) / customizationCounts(orders) => Array<{label, value}>` — descending by value, ties broken alphabetically
  - `computeAnalytics(orders) => { totals, fulfillment, ordersByHour, ordersByDayOfWeek, fulfillmentHistogram, drinks, milk, customizations }`
    - `totals`: `{ orders, completed, cancelled, cancelRate, drinks }`
    - `fulfillment`: `{ count, medianMs, p90Ms }` — the `Ms` fields are `null` when `count` is 0

**Two deliberate semantic decisions, both different from the old sidebar code — do not "fix" them back:**

1. **Hour-of-day and day-of-week count every order**, whatever its final status. They measure demand.
2. **Drinks, milk, and customizations count completed orders only**, and multiply by `item.quantity`. The old `calculateStats` added `+1` per customization regardless of quantity, so three vanilla lattes recorded one vanilla. That was a bug; quantity is correct.

- [ ] **Step 1: Write the failing tests**

Append to `tests/analytics.test.js`:

```js
import {
  computeAnalytics,
  customizationCounts,
  drinkCounts,
  milkCounts,
  ordersByDayOfWeek,
  ordersByHour,
} from '../src/lib/analytics.js'

// Local time, so the expected hour and weekday match getHours()/getDay().
const at = (localIso) => new Date(localIso).toISOString()

const fullOrder = (status, createdAt, updatedAt, items) => ({
  status,
  created_at: createdAt,
  updated_at: updatedAt,
  items,
})

const item = (name, quantity, milkOption = null, customizations = []) => ({
  name,
  quantity,
  milkOption,
  customizations,
})

describe('ordersByHour', () => {
  it('returns all 24 hours, zeroed, for no orders', () => {
    const result = ordersByHour([])
    expect(result).toHaveLength(24)
    expect(result[0]).toEqual({ label: '0', value: 0 })
    expect(result[23]).toEqual({ label: '23', value: 0 })
  })

  it('counts every order regardless of status', () => {
    const orders = [
      fullOrder('completed', at('2026-08-09T09:15:00'), at('2026-08-09T09:20:00'), []),
      fullOrder('cancelled', at('2026-08-09T09:45:00'), at('2026-08-09T09:50:00'), []),
      fullOrder('pending', at('2026-08-09T14:05:00'), at('2026-08-09T14:05:00'), []),
    ]
    const result = ordersByHour(orders)
    expect(result[9].value).toBe(2)
    expect(result[14].value).toBe(1)
  })

  it('ignores an unparseable timestamp instead of throwing', () => {
    const result = ordersByHour([fullOrder('pending', 'not-a-date', 'not-a-date', [])])
    expect(result.reduce((sum, bucket) => sum + bucket.value, 0)).toBe(0)
  })
})

describe('ordersByDayOfWeek', () => {
  it('returns all seven days in Sun-first order', () => {
    expect(ordersByDayOfWeek([]).map((d) => d.label)).toEqual([
      'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat',
    ])
  })

  it('buckets by local weekday', () => {
    // 2026-08-09 is a Sunday, 2026-08-10 a Monday.
    const orders = [
      fullOrder('completed', at('2026-08-09T09:00:00'), at('2026-08-09T09:05:00'), []),
      fullOrder('completed', at('2026-08-10T09:00:00'), at('2026-08-10T09:05:00'), []),
      fullOrder('completed', at('2026-08-10T11:00:00'), at('2026-08-10T11:05:00'), []),
    ]
    const result = ordersByDayOfWeek(orders)
    expect(result[0].value).toBe(1)
    expect(result[1].value).toBe(2)
  })
})

describe('drinkCounts', () => {
  it('sums quantity across completed orders and sorts descending', () => {
    const orders = [
      fullOrder('completed', at('2026-08-09T09:00:00'), at('2026-08-09T09:05:00'), [
        item('Latte', 2),
        item('Espresso', 1),
      ]),
      fullOrder('completed', at('2026-08-09T10:00:00'), at('2026-08-09T10:05:00'), [
        item('Latte', 1),
      ]),
    ]
    expect(drinkCounts(orders)).toEqual([
      { label: 'Latte', value: 3 },
      { label: 'Espresso', value: 1 },
    ])
  })

  it('excludes cancelled and pending orders', () => {
    const orders = [
      fullOrder('cancelled', at('2026-08-09T09:00:00'), at('2026-08-09T09:05:00'), [item('Latte', 5)]),
      fullOrder('pending', at('2026-08-09T09:00:00'), at('2026-08-09T09:00:00'), [item('Latte', 5)]),
    ]
    expect(drinkCounts(orders)).toEqual([])
  })

  it('breaks ties alphabetically so the order is stable', () => {
    const orders = [
      fullOrder('completed', at('2026-08-09T09:00:00'), at('2026-08-09T09:05:00'), [
        item('Mocha', 1),
        item('Americano', 1),
      ]),
    ]
    expect(drinkCounts(orders).map((d) => d.label)).toEqual(['Americano', 'Mocha'])
  })
})

describe('milkCounts', () => {
  it('skips items with no milk option', () => {
    const orders = [
      fullOrder('completed', at('2026-08-09T09:00:00'), at('2026-08-09T09:05:00'), [
        item('Latte', 2, 'Oat'),
        item('Espresso', 1, null),
      ]),
    ]
    expect(milkCounts(orders)).toEqual([{ label: 'Oat', value: 2 }])
  })
})

describe('customizationCounts', () => {
  it('multiplies each customization by the item quantity', () => {
    const orders = [
      fullOrder('completed', at('2026-08-09T09:00:00'), at('2026-08-09T09:05:00'), [
        item('Latte', 3, 'Oat', ['Vanilla Syrup']),
      ]),
    ]
    expect(customizationCounts(orders)).toEqual([{ label: 'Vanilla Syrup', value: 3 }])
  })

  it('counts each customization on a multi-customization item', () => {
    const orders = [
      fullOrder('completed', at('2026-08-09T09:00:00'), at('2026-08-09T09:05:00'), [
        item('Latte', 1, 'Oat', ['Vanilla Syrup', 'Extra Shot']),
      ]),
    ]
    expect(customizationCounts(orders).map((c) => c.label).sort()).toEqual([
      'Extra Shot',
      'Vanilla Syrup',
    ])
  })
})

describe('computeAnalytics', () => {
  it('returns zeroed totals and null timings for no orders', () => {
    const result = computeAnalytics([])
    expect(result.totals).toEqual({
      orders: 0,
      completed: 0,
      cancelled: 0,
      cancelRate: 0,
      drinks: 0,
    })
    expect(result.fulfillment).toEqual({ count: 0, medianMs: null, p90Ms: null })
    expect(result.drinks).toEqual([])
    expect(result.ordersByHour).toHaveLength(24)
  })

  it('summarises a mixed set of orders', () => {
    const orders = [
      fullOrder('completed', at('2026-08-09T09:00:00'), at('2026-08-09T09:04:00'), [
        item('Latte', 2, 'Oat', ['Vanilla Syrup']),
      ]),
      fullOrder('completed', at('2026-08-09T09:10:00'), at('2026-08-09T09:16:00'), [
        item('Espresso', 1),
      ]),
      fullOrder('cancelled', at('2026-08-09T09:20:00'), at('2026-08-09T09:21:00'), [
        item('Latte', 1, 'Oat'),
      ]),
      fullOrder('pending', at('2026-08-09T09:30:00'), at('2026-08-09T09:30:00'), [
        item('Mocha', 1, 'Soy'),
      ]),
    ]
    const result = computeAnalytics(orders)
    expect(result.totals.orders).toBe(4)
    expect(result.totals.completed).toBe(2)
    expect(result.totals.cancelled).toBe(1)
    expect(result.totals.cancelRate).toBe(0.25)
    expect(result.totals.drinks).toBe(3)
    expect(result.fulfillment.count).toBe(2)
    expect(result.fulfillment.medianMs).toBe(300000)
    expect(result.drinks).toEqual([
      { label: 'Latte', value: 2 },
      { label: 'Espresso', value: 1 },
    ])
    expect(result.milk).toEqual([{ label: 'Oat', value: 2 }])
    expect(result.customizations).toEqual([{ label: 'Vanilla Syrup', value: 2 }])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `ordersByHour is not a function` and similar, since none of the new exports exist.

- [ ] **Step 3: Write the implementation**

Append to `src/lib/analytics.js`:

```js
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Demand pattern — every order counts, whatever became of it.
export function ordersByHour(orders) {
  const counts = Array.from({ length: 24 }, (_, hour) => ({
    label: String(hour),
    value: 0,
  }))
  orders.forEach((order) => {
    const hour = new Date(order.created_at).getHours()
    if (Number.isInteger(hour)) counts[hour].value += 1
  })
  return counts
}

export function ordersByDayOfWeek(orders) {
  const counts = DAY_LABELS.map((label) => ({ label, value: 0 }))
  orders.forEach((order) => {
    const day = new Date(order.created_at).getDay()
    if (Number.isInteger(day)) counts[day].value += 1
  })
  return counts
}

// Ranked counts over completed orders only — what the bar actually made.
// extract() maps one order item to zero or more { key, count } contributions.
function rankCounts(orders, extract) {
  const totals = new Map()
  orders
    .filter((order) => order.status === 'completed')
    .forEach((order) => {
      order.items.forEach((item) => {
        extract(item).forEach(({ key, count }) => {
          totals.set(key, (totals.get(key) ?? 0) + count)
        })
      })
    })
  return [...totals.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
}

export const drinkCounts = (orders) =>
  rankCounts(orders, (item) => [{ key: item.name, count: item.quantity }])

export const milkCounts = (orders) =>
  rankCounts(orders, (item) =>
    item.milkOption ? [{ key: item.milkOption, count: item.quantity }] : []
  )

// Quantity-weighted: three vanilla lattes are three vanilla pumps, not one.
export const customizationCounts = (orders) =>
  rankCounts(orders, (item) =>
    (item.customizations ?? []).map((name) => ({ key: name, count: item.quantity }))
  )

export function computeAnalytics(orders) {
  const completed = orders.filter((order) => order.status === 'completed')
  const cancelled = orders.filter((order) => order.status === 'cancelled')
  const durations = fulfillmentDurations(orders)

  return {
    totals: {
      orders: orders.length,
      completed: completed.length,
      cancelled: cancelled.length,
      cancelRate: orders.length === 0 ? 0 : cancelled.length / orders.length,
      drinks: completed.reduce(
        (sum, order) =>
          sum + order.items.reduce((count, item) => count + item.quantity, 0),
        0
      ),
    },
    fulfillment: {
      count: durations.length,
      medianMs: percentile(durations, 50),
      p90Ms: percentile(durations, 90),
    },
    ordersByHour: ordersByHour(orders),
    ordersByDayOfWeek: ordersByDayOfWeek(orders),
    fulfillmentHistogram: fulfillmentHistogram(durations),
    drinks: drinkCounts(orders),
    milk: milkCounts(orders),
    customizations: customizationCounts(orders),
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all suites green, 33 tests total (includes the null-`created_at` guard cases added for `ordersByHour` and `ordersByDayOfWeek`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/analytics.js tests/analytics.test.js
git commit -m "feat: add order grouping and ranking to analytics module"
```

---

### Task 5: Chart Components

**Files:**
- Create: `src/lib/BarChart.svelte`
- Create: `src/lib/RankedBars.svelte`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `BarChart.svelte` — props `data: Array<{label, value}>`, `emptyMessage: string` (default `"No data yet"`), `labelEvery: number` (default `1`). Vertical SVG bars for evenly-spaced ordered buckets.
  - `RankedBars.svelte` — props `data: Array<{label, value}>`, `emptyMessage: string` (default `"No data yet"`). Horizontal HTML/CSS bars for a sorted ranking.

**Why two components rather than one with an `orientation` prop:** the vertical form needs SVG geometry and a positioned tooltip; the horizontal form is a three-column grid with direct labels on every row. One component holding both would be two unrelated render paths behind one interface.

**Design rules from the dataviz skill that these encode — keep them:**
- Series color is exactly `#2a78d6`, validated for this light surface.
- Every bar is a single series, so there is no legend; the card title names the measure.
- 4px rounded data-ends anchored to the baseline; square where the bar meets the baseline.
- 2px surface gap between adjacent bars.
- Recessive axis (`#e5e7eb`), text in gray tokens — never the series color.
- Hover tooltip on every mark.
- Explicit empty state instead of a blank plot.

- [ ] **Step 1: Create the vertical bar chart**

Create `src/lib/BarChart.svelte`:

```svelte
<script>
  export let data = [];
  export let emptyMessage = "No data yet";
  export let labelEvery = 1;

  const SERIES = "#2a78d6";
  const WIDTH = 480;
  const HEIGHT = 190;
  const TOP = 10;
  const BASELINE = HEIGHT - 24; // leaves room for the x-axis labels
  const GAP = 2; // surface gap between adjacent bars

  let hovered = null;

  $: max = Math.max(1, ...data.map((d) => d.value));
  $: slot = data.length > 0 ? WIDTH / data.length : WIDTH;
  $: barWidth = Math.max(1, slot - GAP);
  $: hasData = data.some((d) => d.value > 0);

  function barHeight(value) {
    return (value / max) * (BASELINE - TOP);
  }

  // Rounded top corners only — the bottom stays flush with the baseline.
  function barPath(value, index) {
    const height = barHeight(value);
    if (height <= 0) return "";
    const x = index * slot + GAP / 2;
    const y = BASELINE - height;
    const r = Math.min(4, barWidth / 2, height);
    return `M ${x} ${BASELINE} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + barWidth - r} ${y} Q ${x + barWidth} ${y} ${x + barWidth} ${y + r} L ${x + barWidth} ${BASELINE} Z`;
  }
</script>

{#if !hasData}
  <p class="text-sm text-gray-500 py-12 text-center">{emptyMessage}</p>
{:else}
  <div class="relative">
    <svg
      viewBox="0 0 {WIDTH} {HEIGHT}"
      class="w-full h-auto"
      role="img"
      on:mouseleave={() => (hovered = null)}
    >
      <line
        x1="0"
        y1={BASELINE}
        x2={WIDTH}
        y2={BASELINE}
        stroke="#e5e7eb"
        stroke-width="1"
      />
      {#each data as point, index (point.label)}
        <path d={barPath(point.value, index)} fill={SERIES} />
        <!-- Full-height hit target, wider than the mark itself -->
        <rect
          x={index * slot}
          y={TOP}
          width={slot}
          height={BASELINE - TOP}
          fill="transparent"
          on:mouseenter={() => (hovered = index)}
        />
        {#if index % labelEvery === 0}
          <text
            x={index * slot + slot / 2}
            y={HEIGHT - 6}
            text-anchor="middle"
            font-size="11"
            fill="#6b7280"
          >
            {point.label}
          </text>
        {/if}
      {/each}
    </svg>

    {#if hovered !== null}
      <div
        class="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded bg-gray-900 px-2 py-1 text-xs text-white whitespace-nowrap shadow"
        style="left: {((hovered * slot + slot / 2) / WIDTH) * 100}%; top: {((BASELINE - barHeight(data[hovered].value) - 6) / HEIGHT) * 100}%;"
      >
        {data[hovered].label}: {data[hovered].value}
      </div>
    {/if}
  </div>
{/if}
```

- [ ] **Step 2: Create the ranked horizontal bars**

Create `src/lib/RankedBars.svelte`:

```svelte
<script>
  export let data = [];
  export let emptyMessage = "No data yet";

  const SERIES = "#2a78d6";

  $: max = Math.max(1, ...data.map((d) => d.value));
</script>

{#if data.length === 0}
  <p class="text-sm text-gray-500 py-12 text-center">{emptyMessage}</p>
{:else}
  <ul class="space-y-2">
    {#each data as row (row.label)}
      <li
        class="grid grid-cols-[9rem_1fr_3rem] items-center gap-3"
        title="{row.label}: {row.value}"
      >
        <span class="text-sm text-gray-700 truncate">{row.label}</span>
        <span class="h-3 rounded-full bg-gray-100 overflow-hidden">
          <span
            class="block h-full rounded-full"
            style="width: {(row.value / max) * 100}%; background-color: {SERIES};"
          ></span>
        </span>
        <span class="text-sm font-semibold text-gray-900 text-right tabular-nums">
          {row.value}
        </span>
      </li>
    {/each}
  </ul>
{/if}
```

- [ ] **Step 3: Verify the build compiles**

Run: `npm run build`
Expected: exits 0. A Svelte a11y warning about `on:mouseenter` on a non-interactive `<rect>` is acceptable; a compile *error* is not.

- [ ] **Step 4: Commit**

```bash
git add src/lib/BarChart.svelte src/lib/RankedBars.svelte
git commit -m "feat: add bar chart and ranked bar components"
```

---

### Task 6: Full-Screen Analytics View

**Files:**
- Create: `src/lib/Analytics.svelte`
- Modify: `src/lib/BaristaView.svelte`

**Interfaces:**
- Consumes: `computeAnalytics` and `formatDuration` from Task 3/4; `BarChart.svelte` and `RankedBars.svelte` from Task 5; `getOrders` from `src/lib/supabase.js`; `Icons.svelte`.
- Produces: `Analytics.svelte` with one prop, `onClose: () => void`.

- [ ] **Step 1: Create the analytics view**

Create `src/lib/Analytics.svelte`:

```svelte
<script>
  import { onMount } from "svelte";
  import BarChart from "./BarChart.svelte";
  import Icons from "./Icons.svelte";
  import RankedBars from "./RankedBars.svelte";
  import { computeAnalytics, formatDuration } from "./analytics";
  import { getOrders } from "./supabase";

  export let onClose;

  let stats = null;
  let loadFailed = false;

  onMount(async () => {
    try {
      stats = computeAnalytics(await getOrders());
    } catch (error) {
      console.error("Error loading analytics:", error);
      loadFailed = true;
    }
  });

  $: tiles = stats
    ? [
        { label: "Total orders", value: String(stats.totals.orders) },
        { label: "Completed", value: String(stats.totals.completed) },
        {
          label: "Cancelled",
          value: `${stats.totals.cancelled} (${Math.round(stats.totals.cancelRate * 100)}%)`,
        },
        { label: "Drinks made", value: String(stats.totals.drinks) },
        { label: "Median time", value: formatDuration(stats.fulfillment.medianMs) },
        { label: "p90 time", value: formatDuration(stats.fulfillment.p90Ms) },
      ]
    : [];
</script>

<div class="fixed inset-0 z-40 overflow-y-auto bg-gray-100">
  <header class="bg-white shadow-sm">
    <div
      class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center"
    >
      <h1 class="text-xl font-semibold text-gray-900">Analytics</h1>
      <button
        on:click={onClose}
        class="text-gray-600 hover:text-gray-900"
        aria-label="Close analytics"
      >
        <Icons name="close" size={24} />
      </button>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
    {#if loadFailed}
      <p class="text-center text-gray-600 py-16">
        Couldn't load analytics — check your connection and try again.
      </p>
    {:else if !stats}
      <p class="text-center text-gray-600 py-16">Loading analytics…</p>
    {:else}
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {#each tiles as tile (tile.label)}
          <div class="bg-white rounded-lg shadow p-4">
            <p class="text-2xl font-bold text-gray-900 tabular-nums">{tile.value}</p>
            <p class="text-sm text-gray-500 mt-1">{tile.label}</p>
          </div>
        {/each}
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section class="bg-white rounded-lg shadow p-5 lg:col-span-2">
          <h2 class="font-semibold text-gray-900">Orders by hour of day</h2>
          <p class="text-sm text-gray-500 mb-3">All orders</p>
          <BarChart data={stats.ordersByHour} labelEvery={3} emptyMessage="No orders yet" />
        </section>

        <section class="bg-white rounded-lg shadow p-5">
          <h2 class="font-semibold text-gray-900">Fulfillment time</h2>
          <p class="text-sm text-gray-500 mb-3">
            Completed orders · {stats.fulfillment.count} measured
          </p>
          <BarChart
            data={stats.fulfillmentHistogram}
            emptyMessage="No completed orders yet"
          />
        </section>

        <section class="bg-white rounded-lg shadow p-5">
          <h2 class="font-semibold text-gray-900">Orders by day of week</h2>
          <p class="text-sm text-gray-500 mb-3">All orders</p>
          <BarChart data={stats.ordersByDayOfWeek} emptyMessage="No orders yet" />
        </section>

        <section class="bg-white rounded-lg shadow p-5">
          <h2 class="font-semibold text-gray-900">Popular drinks</h2>
          <p class="text-sm text-gray-500 mb-3">Completed orders</p>
          <RankedBars data={stats.drinks} emptyMessage="No completed orders yet" />
        </section>

        <section class="bg-white rounded-lg shadow p-5">
          <h2 class="font-semibold text-gray-900">Milk split</h2>
          <p class="text-sm text-gray-500 mb-3">Completed orders</p>
          <RankedBars data={stats.milk} emptyMessage="No completed orders yet" />
        </section>

        <section class="bg-white rounded-lg shadow p-5 lg:col-span-2">
          <h2 class="font-semibold text-gray-900">Customizations</h2>
          <p class="text-sm text-gray-500 mb-3">Completed orders</p>
          <RankedBars data={stats.customizations} emptyMessage="No customizations yet" />
        </section>
      </div>
    {/if}
  </main>
</div>
```

- [ ] **Step 2: Delete the old stats code from BaristaView**

In `src/lib/BaristaView.svelte`, delete all of the following:

1. The state declarations `let showStats = false;` and `let statsPromise: Promise<Stats> | null = null;` (lines 24-25).
2. The `toggleStats` function (lines 159-164).
3. The `Stats` interface (lines 166-173).
4. The `calculateStats` function (lines 175-213).
5. The `sortEntries` function (lines 215-217).
6. The entire `{#if showStats} ... {/await}{/if}` block in the markup (lines 473-550).
7. The local `formatDuration` function (lines 90-94) — it is replaced by the shared one in the next step.

- [ ] **Step 3: Wire the analytics view into BaristaView**

In `src/lib/BaristaView.svelte`, add to the imports at the top:

```js
  import Analytics from "./Analytics.svelte";
  import { formatDuration } from "./analytics";
```

Add the replacement state where `showStats` used to be:

```js
  let showAnalytics = false;
```

Change the chart button's handler (the `on:click={toggleStats}` at what was line 283):

```svelte
          <button
            on:click={() => (showAnalytics = true)}
            class="text-gray-600 hover:text-gray-900"
            aria-label="View Analytics"
          >
            <Icons name="chart" size={24} />
          </button>
```

Wrap the entire root markup element so analytics takes over the screen. The opening line of the template becomes:

```svelte
{#if showAnalytics}
  <Analytics onClose={() => (showAnalytics = false)} />
{:else}
<div class="min-h-screen bg-gray-100 flex">
```

and the file's final `</div>` becomes:

```svelte
</div>
{/if}
```

- [ ] **Step 4: Verify the build compiles**

Run: `npm run build`
Expected: exits 0, and no "unused" or "not defined" warnings for `showStats`, `statsPromise`, `calculateStats`, `sortEntries`, or `Stats`. If any appear, a deletion in Step 2 was incomplete.

- [ ] **Step 5: Verify the unit tests still pass**

Run: `npm test`
Expected: PASS — all suites green. Nothing in this task should have changed `analytics.js`.

- [ ] **Step 6: Verify manually in the browser**

Run: `npm run dev`, sign in as a barista.

1. Click the chart icon. Analytics must fill the entire screen — no order list, no sidebar.
2. The six stat tiles show numbers, and median/p90 render as `Nm Ns` (or `—` if nothing is completed).
3. Hover a bar on "Orders by hour of day" — a dark tooltip appears above it reading `<hour>: <count>`.
4. The hour chart shows every third hour label (0, 3, 6 … 21) with no overlapping text.
5. Place and complete an order in a second tab, then reopen analytics — the new order is reflected.
6. Click the close (×) button and confirm the order list returns and still auto-refreshes.
7. Narrow the window to phone width — no horizontal page scroll, tiles reflow to two columns.

- [ ] **Step 7: Commit**

```bash
git add src/lib/Analytics.svelte src/lib/BaristaView.svelte
git commit -m "feat: replace stats sidebar with full-screen charted analytics

Adds hour-of-day and day-of-week demand charts and a fulfillment time
histogram alongside the existing drink, milk, and customization counts.
Customization counts are now quantity-weighted, which the old sidebar
got wrong."
```

---

## Final Verification

- [ ] **Run the full test suite**

Run: `npm test`
Expected: PASS, 33 tests.

- [ ] **Run the production build**

Run: `npm run build`
Expected: exits 0.

- [ ] **Confirm nothing is left of the old stats code**

Run: `grep -rn "showStats\|calculateStats\|sortEntries\|statsPromise" src/`
Expected: no output.

- [ ] **Confirm the wordmark is gone from the barista view only**

Run: `grep -rn "Cafecito" src/`
Expected: exactly three matches — `src/App.svelte` (the name-entry screen) and `src/lib/CustomerView.svelte` (the customer header), which both keep their visible wordmark, plus `src/lib/BaristaView.svelte`'s `<h1 class="sr-only">Cafecito — Barista</h1>`. Only the barista view's *visible* wordmark is removed; the screen-reader heading was added afterwards to restore the document outline, so no visible `Cafecito` text remains there.
