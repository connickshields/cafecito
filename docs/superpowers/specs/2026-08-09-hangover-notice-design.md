# Hangover notice — design

**Date:** 2026-08-09
**Status:** Approved

## Purpose

Show customers a light-hearted heads-up that drinks may be slower than usual today, so
longer waits feel explained rather than broken. It is a joke, not an operational signal —
the real wait numbers already come from `getQueueStats` and the queue banner.

## Scope

A single dismissable notice on the customer ordering screen. Deliberately **not** included:

- No database column, table, or settings row.
- No barista-facing toggle. Turning the notice off is a code change and a redeploy.
- No dismissal persistence. Reloading the page brings the notice back.

These were considered and rejected as unnecessary for a one-off joke.

## Component

`src/lib/HangoverNotice.svelte` — self-contained: takes no props and imports nothing from
the app (only `fade` from `svelte/transition`).

- **State:** one local `let dismissed = false`. The `×` button sets it to `true`.
- **Renders:** nothing once dismissed (`{#if !dismissed}`).
- **Interface:** none. Consumers place `<HangoverNotice />` and nothing else.

Because it holds no external dependencies, it can be moved, reused, or deleted without
touching any other module.

### Copy

> Heads up — orders may be slower than usual today. Your barista has a hangover. 🙃

### Presentation

Mirrors the existing queue banner (`CustomerView.svelte`, the `{#if queueDepth …}` block)
so the two read as one system: `border rounded-md shadow-sm`, centered text,
`transition:fade`.

The one deliberate difference is a warm amber tint (`bg-amber-50 border-amber-200` with
`text-amber-900`) instead of white. The queue banner carries live data; this carries an
aside. The colour difference keeps a customer from reading the joke as queue information.

### Accessibility

- Container is `role="status"` — announced by screen readers without stealing focus.
- Dismiss control is a real `<button>` with `aria-label="Dismiss"`, so it is keyboard
  reachable and operable by Enter/Space.
- Amber-900 text on amber-50 clears WCAG AA contrast.

## Integration

One insertion in `src/lib/CustomerView.svelte`: `<HangoverNotice />` immediately above the
`{#if queueDepth && queueDepth.drinksAhead > 0}` block, inside the existing `space-y-8`
stack.

Resulting order: **notice → queue/wait banner → menu → cart**.

Placing it inside the existing stack means vertical rhythm is inherited; the component
sets no outer margins of its own.

## Data flow

None. The component reads no state and emits no events. `CustomerView`'s polling,
cart, and order-submission paths are untouched.

## Error handling

Not applicable — there is no async work, no I/O, and no failure mode. If the component
throws it can only be a render error, which Svelte surfaces at build time.

## Testing and verification

The project has no test framework (`package.json` defines only `dev`, `build`, and
`preview`), and adding one is out of scope for this change. Verification is:

1. `npm run build` completes without error.
2. In `npm run dev`: the notice appears above the queue banner on the customer screen.
3. Clicking `×` removes it and leaves the queue banner and menu correctly spaced.
4. Reloading brings it back.
5. Tab to the dismiss button and activate with Enter — it dismisses.
