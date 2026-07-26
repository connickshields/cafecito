# Customer Experience Improvements — Design

**Date:** 2026-07-26
**Status:** Approved pending spec review

## Goal

Improve the customer-facing experience of Cafecito for pop-up coffee events:
accurate queue visibility with an estimated wait time, order survival across
page refreshes, reliable order submission, menu freshness during an event, and
an unmissable "order ready" state.

Explicitly out of scope (rejected during brainstorming): "Order Again" cart
prefill, browser push-notification work beyond what exists, vibration (not
possible on iOS Safari), Supabase Realtime (polling retained), and adding a
test harness.

## Context and constraints

- Svelte 4 + Vite + Tailwind frontend; Supabase (Postgres + anonymous auth)
  backend. No test framework.
- Customers are anonymous Supabase users; baristas are non-anonymous.
- RLS (`rls.sql`) only lets anonymous users read **their own** orders. This is
  why the current `getOrdersAheadCount` in `src/lib/supabase.js` is broken: it
  queries `orders` directly as the customer and cannot see anyone else's
  orders, so it reports 0 ahead regardless of queue depth. RLS must **not** be
  loosened to fix this.
- All data updates use 5-second `setInterval` polling (existing pattern,
  retained by decision).
- SQL is applied manually via the Supabase SQL editor (like `schema.sql` and
  `rls.sql`). No schema changes to existing tables; new SQL lives in a new
  `functions.sql` file.

## Architecture (Approach A)

Exactly two things move into the database — crossing the RLS boundary safely
and transactional writes — everything else is client-side Svelte work.

```
functions.sql (new)
├── get_queue_stats(p_order_id)   SECURITY DEFINER — aggregate queue numbers
└── create_order(name, items)     SECURITY INVOKER — atomic order creation

src/lib/supabase.js
├── getQueueStats(orderId?)       replaces getOrdersAheadCount
├── submitOrder(...)              becomes one rpc('create_order') call
└── getActiveOrder()              new; plain select (own-orders RLS suffices)

Components: App.svelte, CustomerView.svelte, OrderStatus.svelte,
Menu.svelte, FloatingFooter.svelte (minor)
```

## Database layer

### `get_queue_stats(p_order_id int default null)`

`SECURITY DEFINER`, `EXECUTE` granted to `authenticated`. Reads all orders
internally but returns only aggregates — one row:

| column              | meaning                                                        |
| ------------------- | -------------------------------------------------------------- |
| `drinks_ahead`      | Sum of `order_items.quantity` in active orders (pending or in_progress). With `p_order_id`: only orders created before that order (queue position). Without: the whole active queue (pre-order banner). |
| `active_orders`     | Count of active orders behind that same filter.                |
| `est_mins_per_drink`| Recent drain rate, or `NULL` when there is not enough data.    |

Drain-rate computation (throughput, deliberately **not** per-order cycle time,
which double-counts queue wait): take the last 5 completed orders whose
`updated_at` is within the past 90 minutes. If fewer than 3, return `NULL`.
Otherwise, over those orders ordered by completion time, divide the drinks
completed **after** the earliest completion (i.e. excluding the first order's
drinks — fencepost) by the minutes between first and last completion. Guard
against a zero/near-zero denominator by returning `NULL`.

Known accepted limitation: barista idle time between completions inflates the
rate until fresh completions wash it out.

### `create_order(p_customer_name text, p_items jsonb)`

`SECURITY INVOKER` (existing insert policies already allow these writes).
Single transaction: insert into `orders` (with `auth.uid()` as `user_id` —
never trusted from the client), then `order_items`, then
`order_item_customizations`. Any failure rolls back everything; partial orders
become impossible. Raises on empty `p_items`. Returns the new order id.

`p_items` shape:
`[{ "item_id": 3, "milk_option_id": 2, "quantity": 1, "customization_option_ids": [1, 4] }]`
(`milk_option_id` null when none; `customization_option_ids` may be empty.)

## Client layer

### `src/lib/supabase.js`

- `getQueueStats(orderId?)` → `rpc('get_queue_stats', ...)`; replaces
  `getOrdersAheadCount`, which is deleted.
- `submitOrder(customerName, orderItems)` → shapes the component-level cart
  items into `p_items` and calls `rpc('create_order', ...)`. Components keep
  building orders exactly as today; the wrapper owns the translation. The
  `userId` parameter is dropped (the RPC uses `auth.uid()`).
- `getActiveOrder()` → selects the session's own order with status pending or
  in_progress, newest first, limit 1. Covered by the existing "view own
  orders" policy; no RPC needed.

### Restore on load (`App.svelte`, `CustomerView.svelte`)

In `App.svelte` `onMount`, after the session resolves: call `getActiveOrder()`.

- Active order found → set the customer name from the order and render
  `CustomerView` with a new optional `initialOrderId` prop;
  `CustomerView` initializes `currentOrderId`/`showOrderStatus` from it, so
  the customer lands directly on their status screen.
- No active order → show the name form with the input prefilled from
  `localStorage` key `cafecito-customer-name` (written on every name submit).
- Completed/cancelled orders never restore.

### Submit errors (`CustomerView.svelte`, `FloatingFooter.svelte`)

- While the RPC is in flight: Submit button disabled, label "Sending…" (also
  prevents double-tap duplicate orders).
- On failure: cart stays intact; an error banner renders just above the
  floating footer — "Couldn't send your order — check your connection and try
  again" — and Submit re-enables. Atomicity of `create_order` makes "try
  again" always safe.
- Banner clears on successful submit or any cart change.

### Wait display (`OrderStatus.svelte`)

The existing 5-second poll additionally calls `getQueueStats(orderId)`. While
pending/in_progress:

- Always: queue position — "3 drinks ahead of you" / "You're up next!" at 0.
- When `est_mins_per_drink` is non-null: "Estimated wait: 9–14 min" beneath
  it. Range = `drinks_ahead × est_mins_per_drink`, ±25%, rounded to whole
  minutes, floored at "1–2 min". When null, the line does not render.

### Ready state (`OrderStatus.svelte`)

On transition to `completed`:

- Modal background becomes full `bg-green-500`; customer name and order
  number (`#id`) render in large type — readable at a glance across a yard.
- A short soft chime plays (`public/assets/sounds/order-ready.mp3`, generated
  as part of implementation) via the same `Audio` pattern as the barista
  view's `new-order.mp3`. Playback errors are swallowed; the visual is the
  guarantee. Audio is unlocked by the earlier submit tap.
- Existing browser-notification code stays unchanged (bonus coverage only).
- Cancelled state keeps its current look.

### Pre-order queue banner (`CustomerView.svelte`)

A slim strip between the welcome header and the menu, fed by argument-less
`getQueueStats()` on a page-level 5-second poll:

- With rate: "Current queue: 4 drinks · ~10–16 min wait"
- Without rate: "Current queue: 4 drinks"
- Empty queue: banner hidden.
- Informational only; never blocks ordering.

### Menu freshness (`CustomerView.svelte`, `Menu.svelte`)

- `CustomerView`'s poll re-fetches menu items (currently fetched once).
- `Menu.svelte` re-fetches milk options and customization options on the same
  cadence. `getMilkOptions(true)` keeps returning unavailable milks so they
  render greyed out (current behavior).
- If an option selected in the open customize modal becomes unavailable, it is
  deselected immediately.

## Error handling summary

| Failure                          | Behavior                                            |
| -------------------------------- | --------------------------------------------------- |
| `create_order` fails             | Nothing saved; banner + retry; cart intact          |
| `get_queue_stats` fails          | Hide position/estimate lines (never show stale)     |
| `getActiveOrder` fails on load   | Fall through to normal name-form flow               |
| Chime playback fails             | Swallowed; green screen carries the signal          |
| Insufficient completion history  | `est_mins_per_drink` NULL → position only           |

## Verification plan (manual, no test harness)

Apply `functions.sql` in the Supabase SQL editor, then with two browser
windows (customer + barista) — using **different** anonymous sessions
(e.g. a private window) for multi-customer checks:

1. Two customers order; second customer's drinks-ahead reflects the first
   customer's active drinks (the RLS bug fix).
2. Estimate line absent until the 3rd completed order, present after.
3. Mid-order refresh restores the status screen; refresh with no active order
   shows prefilled name form.
4. Submit with network cut (devtools offline): banner appears, cart intact,
   retry succeeds; no partial order rows in the database.
5. Barista 86's a milk while a customer's customize modal is open: option
   greys out and deselects within ~5 seconds.
6. Completing an order turns the customer's screen green with name/number
   large and plays the chime.
7. Pre-order banner shows queue depth on the menu page and hides when the
   queue is empty.
