# Design Refresh: Neighbourhood Café Aesthetic

**Date:** 2026-03-01
**Scope:** Customer view (App entry, CustomerView, Menu, Cart, FloatingFooter, OrderStatus, BaristaLogin modal)
**Barista view:** Out of scope for this refresh

---

## Design Direction

**Aesthetic:** Warm & artisanal — neighbourhood coffee shop with handcrafted feel
**Approach:** Light parchment base with golden accents, elegant serif display type, subtle grain texture

---

## Color System

Keep all existing Tailwind config tokens. Add two new values:

| Token | Hex | Role |
|-------|-----|------|
| `primary` | `#FFCF33` | CTAs, golden accents (unchanged) |
| `accent` | `#F5BC00` | Hover states (unchanged) |
| `background` | `#424B54` | Dark elements, text, borders (role shifts from bg to accent) |
| `neutral` | `#93A8AC` | Secondary text, muted elements (unchanged) |
| `secondary` | `#E2B4BD` | Dusty rose badges, soft accents (unchanged) |
| `parchment` *(new)* | `#FBF7F0` | Page background (replaces `gray-100`) |
| `espresso` *(new)* | `#2C1810` | Body text (warmer than pure black) |

---

## Typography

Remove Playfair Display and Lato (never imported; falling back to system fonts). Replace with:

| Role | Font | Weights | Usage |
|------|------|---------|-------|
| Logo | **Yesteryear** | 400 | "Cafecito" brand mark — keep as-is |
| Display | **Cormorant Garamond** | 500, 600, 700 | Menu item names, section headers, modal titles |
| Body | **Nunito** | 400, 600, 700 | Descriptions, labels, UI text, buttons |

**Google Fonts import** (replace current single-font import in `index.html`):
```
Yesteryear:wght@400
Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600
Nunito:wght@400;600;700
```

Update `tailwind.config.js`:
- `display`: `['Cormorant Garamond', 'serif']`
- `body`: `['Nunito', 'sans-serif']`

---

## Visual Details

**Grain texture overlay:** Subtle CSS noise overlay applied via a pseudo-element on the root. Achieved with `background-image: url("data:image/svg+xml,...")` at ~3% opacity — purely CSS, no asset files.

**Card surfaces:** Menu items and modals use `bg-white`, `rounded-2xl`, and a warm soft shadow (`shadow-[0_2px_16px_rgba(44,24,16,0.08)]`).

**Logo text-stroke:** Change from `#000` / `#424B54` to `#2C1810` (espresso) for warmth.

---

## Component Changes

### `index.html`
- Update Google Fonts `<link>` to load Cormorant Garamond + Nunito + Yesteryear

### `tailwind.config.js`
- Add `parchment` and `espresso` color tokens
- Update `fontFamily.display` and `fontFamily.body`

### `src/app.css`
- Add grain texture pseudo-element on `body`
- Set `body { background-color: theme('colors.parchment'); color: theme('colors.espresso'); }`
- Add `font-body` as default

### `src/App.svelte`
- Replace `bg-gray-100` with `bg-parchment`
- Logo text-stroke: update to espresso brown
- Guest name input: underlined style with golden focus ring

### `src/lib/Menu.svelte`
- Menu cards: `bg-white rounded-2xl shadow-warm border border-amber-50`
- Item name: `font-display text-lg font-semibold text-espresso`
- Description: `font-body text-sm text-neutral`
- Size badge: `bg-secondary text-espresso text-xs rounded-full px-2 py-0.5`
- "Add to Cart" / "Customize" button: `bg-primary text-espresso font-body font-semibold rounded-full`
- Customization modal: white card, golden checked state on checkboxes/radio buttons

### `src/lib/Cart.svelte`
- Item name: `font-display`
- Surface: white with warm top-rounded corners (unchanged structurally)

### `src/lib/FloatingFooter.svelte`
- Background: `backdrop-blur-md bg-parchment/80` (frosted translucent parchment)
- "Submit Order": golden, pill-shaped
- "View Cart": outlined/ghost button (`border-2 border-background text-background`)

### `src/lib/OrderStatus.svelte`
- Card wrapper: `bg-white rounded-2xl shadow-warm`
- Typography: display font for order id/status title, body for details

### `src/lib/BaristaLogin.svelte`
- Minor: use parchment + white card aesthetic consistent with other modals

### `src/lib/CustomerView.svelte`
- Background propagation: parchment throughout
- Minimal structural changes

---

## What Does NOT Change

- All Svelte component structure and functionality
- Supabase integration and data flow
- Tailwind as the CSS framework
- Animation/transition behaviour (fly, fade)
- BaristaView (deferred to a future refresh)
- All existing color tokens (only additions, no removals)
