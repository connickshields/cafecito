# Customer Experience Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accurate queue position + estimated wait time, atomic order submission with visible errors, order restore across refresh, a pre-order queue banner, menu freshness during events, and an unmissable "ready" state.

**Architecture:** Two Postgres functions (`get_queue_stats` SECURITY DEFINER for cross-customer aggregates without loosening RLS; `create_order` for transactional writes) in a new `functions.sql`, applied manually like `schema.sql`. Everything else is client-side Svelte work extending the existing 5-second polling pattern.

**Tech Stack:** Svelte 4, Vite, Tailwind, Supabase JS v2 (anonymous auth + RPC). No new dependencies. No test harness (per spec) — every task ends with concrete manual verification.

**Spec:** `docs/superpowers/specs/2026-07-26-customer-experience-design.md`

## Global Constraints

- Work on branch `customer-experience` off `main`.
- Polling interval is always `5000` ms.
- RLS policies in `rls.sql` are never modified.
- No schema changes to existing tables; all new SQL goes in `functions.sql` at repo root.
- localStorage key for the name: `cafecito-customer-name`.
- Submit error copy, verbatim: `Couldn't send your order — check your connection and try again`
- Estimate range: `drinks_ahead × est_mins_per_drink`, ±25%, whole minutes, floored at 1–2 min.
- Estimate requires ≥3 completed orders within the past 90 minutes, computed over the last 5.
- Deviation from spec, agreed at planning: the chime is `order-ready.wav` (not `.mp3`) — identical browser support, no encoder dependency.
- `npm run dev` starts the app. Applying `functions.sql` to the Supabase project is a **user step** (SQL editor); browser verification in Tasks 2+ depends on it.

---

### Task 1: Database functions (`functions.sql`)

**Files:**
- Create: `functions.sql`

**Interfaces:**
- Consumes: existing tables `orders`, `order_items`, `order_item_customizations` (schema.sql).
- Produces: `get_queue_stats(p_order_id int default null) → (drinks_ahead int, active_orders int, est_mins_per_drink numeric)`; `create_order(p_customer_name text, p_items jsonb) → int` where `p_items` is `[{"item_id": int, "milk_option_id": int|null, "quantity": int, "customization_option_ids": int[]}]`. Tasks 2+ call both via `supabase.rpc(...)`.

- [ ] **Step 1: Write `functions.sql`**

```sql
-- Customer-facing database functions. Apply after schema.sql and rls.sql.

-- Aggregate queue numbers for customers. SECURITY DEFINER so it can see all
-- orders internally while returning only bare aggregates; RLS stays strict.
-- With p_order_id: drinks/orders ahead of that order (queue position).
-- Without: the whole active queue (pre-order banner).
CREATE OR REPLACE FUNCTION get_queue_stats(p_order_id integer DEFAULT NULL)
RETURNS TABLE (
    drinks_ahead integer,
    active_orders integer,
    est_mins_per_drink numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    SELECT COALESCE(SUM(oi.quantity), 0)::int, COUNT(DISTINCT o.id)::int
      INTO drinks_ahead, active_orders
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
     WHERE o.status IN ('pending', 'in_progress')
       AND (p_order_id IS NULL
            OR o.created_at < (SELECT created_at FROM orders WHERE id = p_order_id));

    -- Drain rate (throughput): over the last 5 completed orders within 90
    -- minutes, drinks completed after the earliest completion divided by the
    -- minutes between first and last completion. NULL when < 3 completions
    -- or the span is under 60 seconds (guards a zero denominator).
    WITH recent AS (
        SELECT o.id,
               o.updated_at,
               (SELECT COALESCE(SUM(quantity), 0)
                  FROM order_items oi WHERE oi.order_id = o.id) AS drinks
          FROM orders o
         WHERE o.status = 'completed'
           AND o.updated_at > now() - interval '90 minutes'
         ORDER BY o.updated_at DESC
         LIMIT 5
    ),
    ordered AS (
        SELECT drinks,
               ROW_NUMBER() OVER (ORDER BY updated_at ASC) AS rn,
               COUNT(*)     OVER () AS n,
               MIN(updated_at) OVER () AS first_t,
               MAX(updated_at) OVER () AS last_t
          FROM recent
    )
    SELECT CASE
               WHEN MAX(n) IS NULL OR MAX(n) < 3 THEN NULL
               WHEN EXTRACT(EPOCH FROM (MAX(last_t) - MAX(first_t))) < 60 THEN NULL
               ELSE (EXTRACT(EPOCH FROM (MAX(last_t) - MAX(first_t))) / 60.0)
                    / NULLIF(SUM(drinks) FILTER (WHERE rn > 1), 0)
           END
      INTO est_mins_per_drink
      FROM ordered;

    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION get_queue_stats(integer) TO authenticated;

-- Atomic order creation: order + items + customizations in one transaction.
-- SECURITY INVOKER: existing insert policies already permit these writes.
-- user_id always comes from auth.uid(), never from the client.
CREATE OR REPLACE FUNCTION create_order(p_customer_name text, p_items jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
    v_order_id integer;
    v_item jsonb;
    v_order_item_id integer;
BEGIN
    IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'Order must contain at least one item';
    END IF;

    INSERT INTO orders (user_id, customer_name, status)
    VALUES (auth.uid(), p_customer_name, 'pending')
    RETURNING id INTO v_order_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
        INSERT INTO order_items (order_id, item_id, milk_option_id, quantity)
        VALUES (
            v_order_id,
            (v_item->>'item_id')::int,
            (v_item->>'milk_option_id')::int,
            GREATEST(COALESCE((v_item->>'quantity')::int, 1), 1)
        )
        RETURNING id INTO v_order_item_id;

        INSERT INTO order_item_customizations (order_item_id, customization_option_id)
        SELECT v_order_item_id, c.value::int
          FROM jsonb_array_elements_text(
                   COALESCE(v_item->'customization_option_ids', '[]'::jsonb)) c;
    END LOOP;

    RETURN v_order_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_order(text, jsonb) TO authenticated;
```

- [ ] **Step 2: USER STEP — apply to Supabase**

Ask the user to paste `functions.sql` into the Supabase SQL editor and run it. Do not proceed to browser verification in later tasks until this is done.

- [ ] **Step 3: Verify `get_queue_stats` in the SQL editor (user step, alongside Step 2)**

Run: `SELECT * FROM get_queue_stats();` and `SELECT * FROM get_queue_stats(1);`
Expected: one row each with integer `drinks_ahead`/`active_orders` (0 is fine on an empty queue) and `est_mins_per_drink` NULL unless ≥3 recent completed orders exist. (`create_order` can't be exercised from the editor — `auth.uid()` is NULL there and `orders.user_id` is NOT NULL; it is verified from the app in Task 2.)

- [ ] **Step 4: Commit**

```bash
git add functions.sql
git commit -m "feat: add get_queue_stats and create_order database functions"
```

---

### Task 2: Client wrappers in `supabase.js` + minimal call-site swaps

**Files:**
- Modify: `src/lib/supabase.js` (replace `submitOrder` body ~lines 108–155; delete `getOrdersAheadCount` ~lines 265–291; add `getQueueStats`, `getActiveOrder`)
- Modify: `src/lib/CustomerView.svelte:72` (submitOrder call)
- Modify: `src/lib/OrderStatus.svelte` (imports, `updateOrderDetails`, orders-ahead display)

**Interfaces:**
- Consumes: Task 1 RPCs.
- Produces: `getQueueStats(orderId = null) → Promise<{drinksAhead: number, activeOrders: number, estMinsPerDrink: number|null}>`; `submitOrder(customerName, orderItems) → Promise<{orderId: number}>` (note: **userId parameter removed**); `getActiveOrder() → Promise<{id, customer_name, status}|null>`. Tasks 3–7 use these exact names and shapes.

- [ ] **Step 1: Rewrite `submitOrder` and add the new wrappers in `src/lib/supabase.js`**

Replace the entire existing `submitOrder` (the multi-insert version) with:

```js
// Submit an order atomically via the create_order RPC
export async function submitOrder(customerName, orderItems) {
  const items = orderItems.map((item) => ({
    item_id: item.itemId,
    milk_option_id: item.milkOption?.id ?? null,
    quantity: item.quantity,
    customization_option_ids: (item.customizations ?? []).map((c) => c.id),
  }))

  const { data, error } = await supabase.rpc('create_order', {
    p_customer_name: customerName,
    p_items: items,
  })

  if (error) throw error
  return { orderId: data }
}
```

Delete `getOrdersAheadCount` entirely and add in its place:

```js
// Aggregate queue numbers (drinks ahead, active orders, recent drain rate).
// Without orderId: the whole active queue, for the pre-order banner.
export async function getQueueStats(orderId = null) {
  const { data, error } = await supabase.rpc('get_queue_stats', { p_order_id: orderId })
  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return {
    drinksAhead: row?.drinks_ahead ?? 0,
    activeOrders: row?.active_orders ?? 0,
    estMinsPerDrink: row?.est_mins_per_drink == null ? null : Number(row.est_mins_per_drink),
  }
}

// The current session's own active order, if any (own-orders RLS applies)
export async function getActiveOrder() {
  const { data, error } = await supabase
    .from('orders')
    .select('id, customer_name, status')
    .in('status', ['pending', 'in_progress'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data
}
```

- [ ] **Step 2: Update the `submitOrder` call in `src/lib/CustomerView.svelte`**

In `handleSubmitOrder`, change:

```js
const result = await submitOrder($userSession.user.id, customerName, orderItems);
```

to:

```js
const result = await submitOrder(customerName, orderItems);
```

- [ ] **Step 3: Swap `OrderStatus.svelte` to `getQueueStats`**

Change the import line to:

```js
import { cancelOrder, getOrderDetails, getQueueStats } from "./supabase";
```

Replace `let ordersAhead: number | null = null;` with:

```js
let queueStats: { drinksAhead: number; activeOrders: number; estMinsPerDrink: number | null } | null = null;
```

In `updateOrderDetails`, replace the `ordersAhead` try/catch with:

```js
try {
  queueStats = await getQueueStats(orderId);
} catch (e) {
  queueStats = null;
}
```

Replace the orders-ahead paragraph in the markup with drinks wording:

```svelte
{#if queueStats !== null && (orderDetails.status === "pending" || orderDetails.status === "in_progress")}
  <p class="text-sm text-gray-600 mb-2">
    {queueStats.drinksAhead === 0
      ? "You're up next!"
      : `${queueStats.drinksAhead} drink${queueStats.drinksAhead === 1 ? "" : "s"} ahead of you`}
  </p>
{/if}
```

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev`. Window A (normal): submit an order with a customized latte. Window B (private window = different anonymous session): submit another order.
Expected: both orders appear in the barista view with correct items/customizations (proves `create_order`); window B's status screen shows window A's drink count ahead of it (proves the RLS queue-count fix — this is broken before this task). Window A shows "You're up next!".

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase.js src/lib/CustomerView.svelte src/lib/OrderStatus.svelte
git commit -m "feat: atomic order creation and cross-session queue stats via RPCs"
```

---

### Task 3: Submit error handling + sending state

**Files:**
- Modify: `src/lib/CustomerView.svelte` (`handleSubmitOrder`, new state, error banner markup)
- Modify: `src/lib/FloatingFooter.svelte` (submitting prop on the Submit button)

**Interfaces:**
- Consumes: `submitOrder(customerName, orderItems)` from Task 2 (throws on failure; atomicity guarantees nothing was saved).
- Produces: `FloatingFooter` gains `export let submitting = false;`. Task 4 leaves this untouched.

- [ ] **Step 1: Add state and rework `handleSubmitOrder` in `CustomerView.svelte`**

```js
let submitting = false;
let submitError = false;

async function handleSubmitOrder() {
  if (orderItems.length === 0 || !$userSession || submitting) return;
  submitting = true;
  submitError = false;
  try {
    const result = await submitOrder(customerName, orderItems);
    currentOrderId = result.orderId;
    showOrderStatus = true;
    orderItems = [];
  } catch (error) {
    console.error("Error submitting order:", error);
    submitError = true;
  } finally {
    submitting = false;
  }
}

// Any cart change clears the error banner
$: if (orderItems) submitError = false;
```

- [ ] **Step 2: Add the error banner markup**

In `CustomerView.svelte`, directly before the `<FloatingFooter ... />` tag:

```svelte
{#if submitError}
  <div class="fixed bottom-20 left-0 right-0 px-4 z-10" transition:fade>
    <div
      class="max-w-3xl mx-auto bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded-md text-center"
    >
      Couldn't send your order — check your connection and try again
    </div>
  </div>
{/if}
```

Pass the flag down: `<FloatingFooter {itemCount} {showCart} {submitting} onViewCart={toggleCart} onSubmitOrder={handleSubmitOrder} />`. (`fade` is already imported in this file.)

- [ ] **Step 3: Wire the Submit button in `FloatingFooter.svelte`**

Add `export let submitting = false;` to the script. Change the Submit button to:

```svelte
<button
  on:click={onSubmitOrder}
  disabled={submitting}
  class="bg-green-500 text-white px-4 py-2 rounded-md hover:bg-green-600 flex items-center disabled:opacity-60 disabled:cursor-not-allowed"
>
  <span class="mr-2"><Icons name="coffee-cup" size={20} /></span>
  {submitting ? "Sending…" : "Submit Order"}
</button>
```

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev`. Add items, open devtools → Network → Offline, tap Submit.
Expected: button briefly shows "Sending…", then the red banner appears above the footer, cart still has its items, and the barista view / `orders` table gains **no** rows. Go back online, tap Submit again: order goes through, banner gone. Also verify rapid double-tap online creates exactly one order.

- [ ] **Step 5: Commit**

```bash
git add src/lib/CustomerView.svelte src/lib/FloatingFooter.svelte
git commit -m "feat: visible submit errors with safe retry and sending state"
```

---

### Task 4: Order restore across refresh

**Files:**
- Modify: `src/App.svelte` (`onMount`, `handleNameSubmit`, CustomerView render)
- Modify: `src/lib/CustomerView.svelte` (new `initialOrderId` prop)

**Interfaces:**
- Consumes: `getActiveOrder()` and `isBaristaUser(user)` from `src/lib/supabase.js`.
- Produces: `CustomerView` prop `export let initialOrderId = null;`. No later task depends on this.

- [ ] **Step 1: Add the prop to `CustomerView.svelte`**

```js
export let initialOrderId: number | null = null;

let showOrderStatus = initialOrderId !== null;
let currentOrderId: number | null = initialOrderId;
```

(These replace the existing `let showOrderStatus = false;` and `let currentOrderId: number | null = null;` declarations.)

- [ ] **Step 2: Restore logic in `App.svelte`**

Add `getActiveOrder` to the existing `./lib/supabase` import. Add `let initialOrderId = null;` beside the other state. Replace `onMount` with:

```js
onMount(async () => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session) {
    userSession.set(session);
  } else {
    await signInAnonymously();
  }

  const user = session?.user;
  if (user && !isBaristaUser(user)) {
    try {
      const active = await getActiveOrder();
      if (active) {
        submittedCustomerName = active.customer_name;
        initialOrderId = active.id;
      } else {
        customerName = localStorage.getItem("cafecito-customer-name") ?? "";
      }
    } catch (e) {
      // fall through to the normal name form
    }
  }
  loading = false;
});
```

In `handleNameSubmit`, after `submittedCustomerName = customerName.trim();` add:

```js
localStorage.setItem("cafecito-customer-name", submittedCustomerName);
```

Change the CustomerView render line to pass the prop:

```svelte
<CustomerView customerName={submittedCustomerName} {initialOrderId} />
```

- [ ] **Step 3: Verify in the browser**

Run: `npm run dev`. Submit an order, then refresh the page.
Expected: lands directly on the order status screen (no name form) with the right order. Have the barista complete the order, refresh again: name form appears with the name **prefilled**. Sign in as barista in another window and refresh: barista view unaffected (no restore attempt).

- [ ] **Step 4: Commit**

```bash
git add src/App.svelte src/lib/CustomerView.svelte
git commit -m "feat: restore active order and remembered name across refresh"
```

---

### Task 5: Wait estimate on the order status screen

**Files:**
- Modify: `src/lib/OrderStatus.svelte` (estimate line under the queue-position line from Task 2)

**Interfaces:**
- Consumes: `queueStats` state from Task 2 (`{drinksAhead, activeOrders, estMinsPerDrink|null}`).
- Produces: `waitRange(drinks, rate) → {low, high}|null` helper, reused verbatim in Task 7.

- [ ] **Step 1: Add the range computation to the script**

```js
// ±25% around drinks × recent minutes-per-drink, whole minutes, floor 1–2
function waitRange(drinks: number, rate: number | null): { low: number; high: number } | null {
  if (rate === null || drinks <= 0) return null;
  const mins = drinks * rate;
  return {
    low: Math.max(1, Math.round(mins * 0.75)),
    high: Math.max(2, Math.round(mins * 1.25)),
  };
}

$: estRange = queueStats ? waitRange(queueStats.drinksAhead, queueStats.estMinsPerDrink) : null;
```

- [ ] **Step 2: Render it under the queue-position paragraph**

Directly below the drinks-ahead `<p>` inside the same `{#if}` block:

```svelte
{#if estRange}
  <p class="text-sm text-gray-600 mb-2">
    Estimated wait: {estRange.low}–{estRange.high} min
  </p>
{/if}
```

- [ ] **Step 3: Verify in the browser**

Run: `npm run dev`. With fewer than 3 completed orders in the last 90 min: status screen shows position only, no estimate line. Complete 3 orders (a couple of minutes apart) via the barista view, then submit a new order from a second customer window.
Expected: estimate line appears with a plausible range; "You're up next!" (0 drinks ahead) never shows an estimate line.

- [ ] **Step 4: Commit**

```bash
git add src/lib/OrderStatus.svelte
git commit -m "feat: estimated wait range on order status screen"
```

---

### Task 6: Ready state — green screen + chime

**Files:**
- Create: `public/assets/sounds/order-ready.wav` (generated)
- Modify: `src/lib/OrderStatus.svelte` (completed-state layout, chime playback)

**Interfaces:**
- Consumes: the `previousStatus !== "completed"` transition detection already in `updateOrderDetails` (Task 2 kept it intact).
- Produces: nothing later tasks use.

- [ ] **Step 1: Generate the chime**

Write this to a temp file (e.g. `$SCRATCHPAD/gen-chime.mjs`) and run `node <path>/gen-chime.mjs` **from the repo root** (it writes a relative path). Two-note ascending chime (A5 → D6), ~0.4 s, 16-bit mono WAV:

```js
import { writeFileSync } from "node:fs";
const sr = 44100;
const notes = [[880, 0.18], [1174.66, 0.22]];
const samples = [];
for (const [freq, dur] of notes) {
  const n = Math.floor(sr * dur);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / (sr * 0.01)) * Math.exp((-3 * i) / n);
    samples.push(0.4 * env * Math.sin((2 * Math.PI * freq * i) / sr));
  }
}
const n = samples.length;
const buf = Buffer.alloc(44 + n * 2);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
samples.forEach((s, i) =>
  buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), 44 + i * 2)
);
writeFileSync("public/assets/sounds/order-ready.wav", buf);
console.log(`wrote order-ready.wav (${buf.length} bytes)`);
```

Verify: `afplay public/assets/sounds/order-ready.wav` plays a short two-note chime.

- [ ] **Step 2: Play it on the completed transition in `OrderStatus.svelte`**

Add next to `notifyOrderReady`:

```js
function playReadyChime() {
  try {
    const audio = new Audio("/assets/sounds/order-ready.wav");
    audio.play().catch(() => {}); // iOS silent switch / backgrounded tab: visual carries it
  } catch (e) {
    // ignore
  }
}
```

In `updateOrderDetails`, where `notifyOrderReady()` is called on the completed transition, add `playReadyChime();` on the line after it.

- [ ] **Step 3: Green completed layout**

Change the modal card's wrapper div to switch styling on completed:

```svelte
<div
  class="p-8 rounded-lg shadow-xl w-full max-w-md {orderDetails?.status === 'completed'
    ? 'bg-green-500 text-white'
    : 'bg-white'}"
>
```

Inside the `{:else if orderDetails.status === "completed"}` icon branch, replace the icon-only content with name/number in large type above the icon:

```svelte
<div in:fade={{ duration: 300 }} out:fade={{ duration: 300 }} class="text-center">
  <p class="text-4xl font-bold">{orderDetails.customerName}</p>
  <p class="text-2xl mb-2">Order #{orderDetails.id}</p>
  <Icons name="complete" size={140} color="white" />
  <p class="text-3xl font-bold mt-2">Ready!</p>
</div>
```

On the completed card the gray helper text is unreadable on green. In the order-details list, both `<span class="text-sm text-gray-600">` elements (milk option and customizations) become:

```svelte
<span class="text-sm {orderDetails.status === 'completed' ? 'text-green-100' : 'text-gray-600'}">
```

The cancelled state keeps its current look.

- [ ] **Step 4: Verify in the browser**

Run: `npm run dev`. Submit an order; complete it from the barista view.
Expected: within 5 s the customer card turns solid green with name + order number large and "Ready!", the chime plays, and all text on the card is legible. A cancelled order's card stays white.

- [ ] **Step 5: Commit**

```bash
git add public/assets/sounds/order-ready.wav src/lib/OrderStatus.svelte
git commit -m "feat: green ready screen with chime on order completion"
```

---

### Task 7: Pre-order queue banner + menu item polling

**Files:**
- Modify: `src/lib/CustomerView.svelte` (page-level poll, banner markup)

**Interfaces:**
- Consumes: `getQueueStats()` (no argument) and `getMenuItems()` from `src/lib/supabase.js`; the `waitRange` logic from Task 5 (copied locally — it is 8 lines; keeping components self-contained beats a shared util for now).
- Produces: nothing later tasks use.

- [ ] **Step 1: Add the poll to `CustomerView.svelte`**

Add `onDestroy` to the svelte import and `getQueueStats` to the supabase import. Then:

```js
let queueDepth: { drinksAhead: number; activeOrders: number; estMinsPerDrink: number | null } | null = null;
let pollId: NodeJS.Timeout;

onMount(async () => {
  menuItems = await getMenuItems();
  loading = false;
  await refreshPageData();
  pollId = setInterval(refreshPageData, 5000);
});

onDestroy(() => {
  clearInterval(pollId);
});

async function refreshPageData() {
  if (showOrderStatus) return; // status screen has its own poll
  try {
    menuItems = await getMenuItems();
  } catch (e) {
    // keep last known menu
  }
  try {
    queueDepth = await getQueueStats();
  } catch (e) {
    queueDepth = null; // hide banner rather than show stale numbers
  }
}

function waitRange(drinks: number, rate: number | null): { low: number; high: number } | null {
  if (rate === null || drinks <= 0) return null;
  const mins = drinks * rate;
  return {
    low: Math.max(1, Math.round(mins * 0.75)),
    high: Math.max(2, Math.round(mins * 1.25)),
  };
}

$: bannerRange = queueDepth ? waitRange(queueDepth.drinksAhead, queueDepth.estMinsPerDrink) : null;
```

(This replaces the existing bare `onMount`; the original two lines move inside it.)

- [ ] **Step 2: Banner markup**

Between the `<h2>` welcome heading and `<Menu ... />`:

```svelte
{#if queueDepth && queueDepth.drinksAhead > 0}
  <div
    transition:fade
    class="bg-white border rounded-md px-4 py-2 text-center text-gray-700 shadow-sm"
  >
    Current queue: {queueDepth.drinksAhead} drink{queueDepth.drinksAhead === 1 ? "" : "s"}
    {#if bannerRange}&nbsp;· ~{bannerRange.low}–{bannerRange.high} min wait{/if}
  </div>
{/if}
```

- [ ] **Step 3: Verify in the browser**

Run: `npm run dev`. With an empty queue: no banner on the menu page. Submit an order from a second window: banner appears within 5 s showing the drink count (and the `~x–y min wait` suffix once ≥3 recent completions exist). Complete/cancel all active orders: banner disappears. Barista 86's an item (e.g. Espresso) from the management panel: it vanishes from the customer menu within 5 s.

- [ ] **Step 4: Commit**

```bash
git add src/lib/CustomerView.svelte
git commit -m "feat: pre-order queue banner and live menu item polling"
```

---

### Task 8: Milk/customization freshness in the customize modal

**Files:**
- Modify: `src/lib/Menu.svelte` (options poll, deselection of gone options)

**Interfaces:**
- Consumes: `getMilkOptions(true)`, `getCustomizationOptions()` from `src/lib/supabase.js`.
- Produces: nothing later tasks use. Final task.

- [ ] **Step 1: Poll options and deselect what disappears**

Add `onDestroy` to the svelte import. Replace the existing `onMount` in `Menu.svelte` with:

```js
let optionsPollId: NodeJS.Timeout;

onMount(async () => {
  await refreshOptions();
  optionsPollId = setInterval(refreshOptions, 5000);
});

onDestroy(() => {
  clearInterval(optionsPollId);
});

async function refreshOptions() {
  try {
    milkOptions = await getMilkOptions(true); // unavailable milks render greyed out
    customizationOptions = await getCustomizationOptions();
  } catch (e) {
    return; // keep last known options
  }
  // Selections in the open customize modal must not point at 86'd options
  if (selectedMilkOptionId !== null) {
    const milk = milkOptions.find((m) => m.id === selectedMilkOptionId);
    if (!milk || !milk.available) selectedMilkOptionId = null;
  }
  selectedCustomizationOptionIds = selectedCustomizationOptionIds.filter((id) =>
    customizationOptions.some((c) => c.id === id)
  );
}
```

- [ ] **Step 2: Verify in the browser**

Run: `npm run dev`. Customer opens the customize modal for a latte and selects Oat milk. Barista toggles Oat milk unavailable.
Expected: within 5 s the Oat button greys out with "(unavailable)", the selection clears, and Add to Cart disables until another milk is picked. Same for a selected syrup: checkbox row disappears and the selection drops. Toggling availability back restores the options.

- [ ] **Step 3: Commit**

```bash
git add src/lib/Menu.svelte
git commit -m "feat: live milk and customization availability in customize modal"
```
