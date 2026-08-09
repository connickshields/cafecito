# App Improvements: Closed Notice, Barista Declutter, Full-Screen Analytics

Date: 2026-08-09

Three independent improvements to the Cafecito app.

## 1. Closed Notice (Customer View)

### Problem

When every menu item is marked unavailable, `CustomerView` still renders the
`Menu` component with an empty list. The customer sees a white card containing
only the word "Menu", with a cart and a Submit Order footer below it. Nothing
explains that the café is closed.

### Behavior

When `menuItems` is empty after loading completes, replace the entire ordering
block with a closed notice:

- Centered `stylized-cup` icon (reuse `Icons.svelte`)
- Heading: "The café isn't accepting orders right now"
- Subtext: "Check back soon — this page updates automatically."

Hidden in this state: the hangover notice, the queue banner, the menu grid, the
cart, and the `FloatingFooter`. There is no ordering path to dead-end into.

The existing 5-second `refreshPageData` poll restores the menu automatically
when a barista marks an item available again. No reload required.

### Load-failure distinction

`CustomerView.onMount` currently calls `getMenuItems()` without a try/catch
(`src/lib/CustomerView.svelte:28`). If that first fetch throws, `loading` stays
`true` permanently and the customer sees "Loading menu items..." forever.

Wrap it. On failure, set a `menuLoadFailed` flag and render a distinct message
("Couldn't load the menu — retrying") rather than the closed notice. A network
failure must never be presented as "we're closed."

The subsequent-poll path in `refreshPageData` already swallows errors and keeps
the last known menu, which is correct — leave it as is.

### Components

- New: `src/lib/ClosedNotice.svelte` — presentational, no props.
- Modified: `src/lib/CustomerView.svelte` — derived state and conditional render.

## 2. Remove Barista Logo

Delete the `Cafecito` wordmark `<h1>` at `src/lib/BaristaView.svelte:275-280`.

It is absolutely positioned (`absolute left-1/2 transform -translate-x-1/2`), so
its removal reflows nothing. The stat cluster stays left, the icon buttons stay
right. The header shrinks in height by the 6xl line box, which is the intended
decluttering.

## 3. Full-Screen Analytics

### Problem

Analytics today is a 1/5-width sidebar (`src/lib/BaristaView.svelte:473-550`)
showing three plain-text count lists and a status tally. No charts, no timing
data beyond the header's average fulfillment time.

### Presentation

A full-screen overlay inside `BaristaView`. The chart icon toggles `showStats`;
when true, `<Analytics on:close />` replaces the entire barista screen. A close
button returns to the order list. No routing is introduced — `App.svelte` has
none today and does not need any.

The 5-second order poll continues running underneath while analytics is open.

The existing header stats (Completed, Avg. Time, New Orders) stay in
`BaristaView` unchanged — they are live shift indicators, distinct from the
all-time analytics view.

### Scope of data

All time. No range toggle. `getOrders()` already returns every order.

### Metrics

Stat tiles:

- Total orders
- Completed
- Cancelled (with cancellation rate)
- Total drinks
- Median fulfillment time
- p90 fulfillment time

Charts:

1. **Orders by hour of day** — vertical bars, 24 buckets from `created_at`.
   Chosen over a raw timeline because it stays meaningful as data accumulates
   across an unbounded window.
2. **Fulfillment time distribution** — histogram over completed orders. Buckets:
   0–2, 2–4, 4–6, 6–8, 8–10, 10–15, 15+ minutes. Shows consistency, which an
   average alone hides.
3. **Orders by day of week** — vertical bars.
4. **Popular drinks** — horizontal bars, sorted descending.
5. **Milk split** — horizontal bars. Not a pie chart.
6. **Customizations** — horizontal bars, sorted descending.

Every chart renders an explicit empty state ("No completed orders yet") rather
than an empty plot area.

### Timing data limitation

`orders.updated_at` is overwritten by the `update_orders_modtime` trigger on
every update. The only recoverable timing signal is:

```
fulfillment_ms = updated_at - created_at   (for status = 'completed')
```

This is total time from order placed to final status. It cannot be decomposed
into queue wait (`pending → in_progress`) versus preparation time
(`in_progress → completed`), because the intermediate transition timestamp is
destroyed when the order completes.

Splitting those would require a schema change — a status-transition log table, or
`started_at` / `completed_at` columns on `orders`. **Out of scope for this
work.** Recorded here so the limitation is not rediscovered later.

Guard against non-positive durations (clock skew, backfilled rows) by excluding
them from percentile calculations rather than letting them distort the result.

### Architecture

Three new files, so `BaristaView.svelte` does not grow past its current 629
lines:

| File | Responsibility | Depends on |
|---|---|---|
| `src/lib/analytics.js` | `computeAnalytics(orders)` → all derived series and summary stats. Pure function, no DOM, no Svelte. | nothing |
| `src/lib/BarChart.svelte` | Reusable inline-SVG bar chart. Props: `data`, `orientation` (`"horizontal"` \| `"vertical"`), `title`, `valueFormat`. | nothing |
| `src/lib/Analytics.svelte` | Full-screen layout — stat tile row, chart grid, close button. Fetches orders, calls `computeAnalytics`. | `analytics.js`, `BarChart.svelte`, `supabase.js`, `Icons.svelte` |

`BaristaView.svelte` loses roughly 80 lines: the stats sidebar block, the
`calculateStats` function, `sortEntries`, and the `Stats` interface. The
aggregation logic moves into `analytics.js`; the rendering moves into
`Analytics.svelte`.

The interface boundary is clean: `computeAnalytics` takes the order array
returned by `getOrders()` and returns a plain data object. It can be understood
and tested without rendering anything.

### Chart rendering

Hand-rolled inline SVG. No new runtime dependency — the requirement is six bar
charts, and a charting library would be disproportionate for a project with four
runtime dependencies. Inline SVG also styles consistently with the existing
Tailwind classes.

Follow the `dataviz` skill:

- Run `scripts/validate_palette.js` on the chosen categorical colors. Do not
  eyeball colorblind safety.
- Thin marks, 4px rounded data-ends anchored to the baseline, recessive
  grid/axes, 2px surface gap between adjacent bars.
- Hover tooltip on every chart.
- Text uses text tokens, never the series color.

### Testing

Add `vitest` as a dev dependency — the project has an empty `tests/` directory
and no runner today.

Test `src/lib/analytics.js`:

- Percentile math (median, p90) — including even/odd counts and single-element
  input
- Fulfillment-time bucket boundaries — values landing exactly on a boundary
- Hour-of-day and day-of-week grouping
- Empty input returns zeroed stats, not `NaN` or a crash
- Non-positive durations are excluded from percentiles
- Drink, milk, and customization counts respect item quantity

No tests for the Svelte components; there is no component-testing setup and
adding one is not justified by this change.

## Out of Scope

- Schema changes to capture per-status transition timestamps
- A date-range filter on analytics
- Component-level tests
- Any refactoring of `BaristaView` beyond extracting the analytics code and
  deleting the wordmark
