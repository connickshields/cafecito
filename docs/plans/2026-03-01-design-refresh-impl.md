# Design Refresh — Neighbourhood Café Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refresh the customer-facing UI to a warm artisanal aesthetic: parchment background, Cormorant Garamond + Nunito fonts, white card surfaces, rounded pill buttons, grain texture overlay, frosted floating footer.

**Architecture:** Pure CSS/Tailwind class changes across 8 files. No logic, data flow, or Svelte component structure changes. Each task is one file. Start `npm run dev` once before Task 1 and keep it running to verify each task visually.

**Tech Stack:** Svelte 4, Tailwind CSS 3.4, Vite 5, Google Fonts

---

## Pre-flight

```bash
cd /Users/connick/Documents/projects/cafecito
git checkout design-refresh   # should already be on this branch
npm run dev                    # keep running throughout
```

Open http://localhost:5173 in a browser. Keep it open — use it to verify each task.

---

### Task 1: Fonts & Tailwind tokens

**Files:**
- Modify: `index.html:9`
- Modify: `tailwind.config.js:7-15`

**Step 1: Update Google Fonts import**

In `index.html`, replace line 9:
```html
<link href="https://fonts.googleapis.com/css2?family=Yesteryear&display=swap" rel="stylesheet">
```
with:
```html
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,500;1,600&family=Nunito:wght@400;600;700&family=Yesteryear&display=swap" rel="stylesheet">
```

**Step 2: Update Tailwind config**

In `tailwind.config.js`, replace lines 6–16 (the entire `theme.extend` block):
```js
    extend: {
      fontFamily: {
        display: ['Cormorant Garamond', 'serif'],
        body: ['Nunito', 'sans-serif'],
      },
      colors: {
        primary: '#FFCF33',
        secondary: '#E2B4BD',
        accent: '#F5BC00',
        background: '#424B54',
        neutral: '#93A8AC',
        parchment: '#FBF7F0',
        espresso: '#2C1810',
      },
    },
```

**Step 3: Verify**

In the browser, open DevTools → Elements. Inspect the `<h1>Cafecito</h1>`. The computed font should still be Yesteryear. Inspect any description text — the computed font-family fallback will still be system until Task 2 applies it globally.

**Step 4: Commit**
```bash
git add index.html tailwind.config.js
git commit -m "feat: add Cormorant Garamond + Nunito fonts and parchment/espresso color tokens"
```

---

### Task 2: Global styles

**Files:**
- Modify: `src/app.css`

**Step 1: Replace the entire file contents with:**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    background-color: theme('colors.parchment');
    color: theme('colors.espresso');
    font-family: theme('fontFamily.body');
  }
}

.transition-colors {
  transition: background-color 0.5s ease;
}

.yesteryear-regular {
  font-family: "Yesteryear", cursive;
  font-weight: 400;
  font-style: normal;
}

/* Subtle grain texture overlay — purely decorative, non-interactive */
body::after {
  content: '';
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 9999;
  opacity: 0.03;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  background-repeat: repeat;
  background-size: 150px 150px;
}
```

**Step 2: Verify**

Browser should now show the parchment background (`#FBF7F0`) and Nunito body text. A very subtle grain should be faintly visible over the whole page.

**Step 3: Commit**
```bash
git add src/app.css
git commit -m "feat: apply parchment background, Nunito body font, grain texture overlay"
```

---

### Task 3: App.svelte — entry screen

**Files:**
- Modify: `src/App.svelte`

**Step 1: Update the outer wrapper div (line 43)**

Replace:
```html
<div class="min-h-screen bg-gray-100 flex flex-col">
```
with:
```html
<div class="min-h-screen bg-parchment flex flex-col">
```

**Step 2: Update the header (line 54)**

Replace:
```html
          <header class="bg-white shadow">
```
with:
```html
          <header class="bg-parchment border-b border-amber-100">
```

**Step 3: Update the logo text-stroke (line 58)**

Replace:
```html
              style="-webkit-text-stroke: 8px #000; paint-order: stroke fill;"
```
with:
```html
              style="-webkit-text-stroke: 6px #2C1810; paint-order: stroke fill;"
```

**Step 4: Update the welcome card (line 67)**

Replace:
```html
            class="space-y-4 bg-white shadow-md rounded px-8 pt-6 pb-8 mb-4 max-w-md w-full"
```
with:
```html
            class="space-y-4 bg-white rounded-2xl shadow-[0_4px_24px_rgba(44,24,16,0.1)] px-8 pt-6 pb-8 mb-4 max-w-md w-full"
```

**Step 5: Update the Welcome heading (line 69)**

Replace:
```html
            <h2 class="text-2xl font-bold text-center mb-4">Welcome!</h2>
```
with:
```html
            <h2 class="text-2xl font-display font-semibold text-center mb-4 text-espresso">Welcome!</h2>
```

**Step 6: Update the name input (line 73–79)**

Replace:
```html
            <input
              type="text"
              id="firstName"
              bind:value={customerName}
              placeholder="Enter your name"
              class="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
```
with:
```html
            <input
              type="text"
              id="firstName"
              bind:value={customerName}
              placeholder="Enter your name"
              class="w-full px-0 py-2 border-0 border-b-2 border-neutral/50 bg-transparent focus:border-primary focus:outline-none text-espresso placeholder-neutral/50 font-body"
            />
```

**Step 7: Update the Start Order button (line 80–84)**

Replace:
```html
            <button
              type="submit"
              class="w-full bg-primary text-white px-4 py-2 rounded-md hover:bg-accent"
            >
```
with:
```html
            <button
              type="submit"
              class="w-full bg-primary text-espresso font-body font-semibold px-4 py-2 rounded-full hover:bg-accent"
            >
```

**Step 8: Verify**

The welcome screen should now show: parchment background, white card with soft shadow, underlined name input, pill-shaped golden button, espresso-brown logo stroke.

**Step 9: Commit**
```bash
git add src/App.svelte
git commit -m "feat: apply artisanal styling to App entry screen"
```

---

### Task 4: Menu.svelte — card grid

**Files:**
- Modify: `src/lib/Menu.svelte:75-123`

**Step 1: Update the outer container (line 75)**

Replace:
```html
<div class="bg-white shadow rounded-lg p-6">
```
with:
```html
<div class="p-4">
```

**Step 2: Update the section heading (line 76)**

Replace:
```html
  <h2 class="text-2xl font-bold mb-4">Menu</h2>
```
with:
```html
  <h2 class="text-2xl font-display font-semibold mb-4 text-espresso">Menu</h2>
```

**Step 3: Update the menu item card (line 79)**

Replace:
```html
      <li class="border rounded-lg p-4 relative">
```
with:
```html
      <li class="bg-white rounded-2xl shadow-[0_2px_16px_rgba(44,24,16,0.08)] border border-amber-50 p-4 relative">
```

**Step 4: Update the item name (line 83)**

Replace:
```html
              <h3 class="text-lg font-semibold">{item.name}</h3>
```
with:
```html
              <h3 class="text-base font-display font-semibold text-espresso">{item.name}</h3>
```

**Step 5: Update the size badge (line 85–88)**

Replace:
```html
                <span
                  class="inline-block bg-gray-200 rounded-full px-2 py-1 text-xs text-gray-700 ml-2 mb-2"
                  >{item.size}oz</span
                >
```
with:
```html
                <span
                  class="inline-block bg-secondary/60 rounded-full px-2 py-0.5 text-xs text-espresso ml-2 mb-2 font-body"
                  >{item.size}oz</span
                >
```

**Step 6: Update the item description (line 91)**

Replace:
```html
          <p class="text-gray-600">{item.description}</p>
```
with:
```html
          <p class="text-neutral text-sm font-body">{item.description}</p>
```

**Step 7: Update "Add to Cart" button (line 94–98)**

Replace:
```html
            <button
              on:click={() => handleAddToCart(item)}
              class="mt-4 bg-primary text-white px-4 py-2 rounded-md hover:bg-accent"
            >
```
with:
```html
            <button
              on:click={() => handleAddToCart(item)}
              class="mt-4 bg-primary text-espresso font-body font-semibold px-4 py-2 rounded-full hover:bg-accent"
            >
```

**Step 8: Update "Customize" button (line 101–106)**

Replace:
```html
            <button
              on:click={() => selectItem(item)}
              class="mt-4 bg-primary text-white px-4 py-2 rounded-md hover:bg-accent flex items-center justify-center"
            >
```
with:
```html
            <button
              on:click={() => selectItem(item)}
              class="mt-4 bg-primary text-espresso font-body font-semibold px-4 py-2 rounded-full hover:bg-accent flex items-center justify-center"
            >
```

**Step 9: Verify**

The menu grid should now show white cards floating on parchment, espresso-brown item names in Cormorant Garamond, sage descriptions, dusty rose size badges, and pill-shaped golden buttons.

**Step 10: Commit**
```bash
git add src/lib/Menu.svelte
git commit -m "feat: apply artisanal card styling to menu grid"
```

---

### Task 5: Menu.svelte — customization modal

**Files:**
- Modify: `src/lib/Menu.svelte:125-206`

**Step 1: Update modal backdrop (line 132)**

Replace:
```html
    <div class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>
```
with:
```html
    <div class="fixed inset-0 bg-espresso/60 transition-opacity"></div>
```

**Step 2: Update modal card (line 137)**

Replace:
```html
          class="relative transform overflow-hidden rounded-lg bg-white text-left shadow-xl transition-all w-full max-w-lg mx-auto"
```
with:
```html
          class="relative transform overflow-hidden rounded-2xl bg-white text-left shadow-[0_8px_40px_rgba(44,24,16,0.2)] transition-all w-full max-w-lg mx-auto"
```

**Step 3: Update modal item title (line 142)**

Replace:
```html
            <h2 class="text-2xl font-bold mb-4">{selectedItem.name}</h2>
```
with:
```html
            <h2 class="text-2xl font-display font-semibold mb-4 text-espresso">{selectedItem.name}</h2>
```

**Step 4: Update "Select Milk" heading (line 145)**

Replace:
```html
              <h3 class="text-lg font-semibold mb-2">
```
with:
```html
              <h3 class="text-sm font-body font-semibold mb-2 text-espresso uppercase tracking-wide">
```

**Step 5: Update milk option buttons — selected state (line 151)**

Replace the entire class expression on the milk button:
```svelte
                    class="p-2 rounded-md text-center {selectedMilkOptionId === milk.id
                      ? 'bg-accent text-white'
                      : milk.available
                        ? 'bg-white text-gray-800 border border-gray-200 hover:bg-primary'
                        : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'}"
```
with:
```svelte
                    class="p-2 rounded-xl text-sm font-body text-center {selectedMilkOptionId === milk.id
                      ? 'bg-primary text-espresso border-2 border-primary font-semibold'
                      : milk.available
                        ? 'bg-white text-espresso border border-neutral/30 hover:bg-parchment'
                        : 'bg-parchment text-neutral/50 border border-neutral/20 cursor-not-allowed'}"
```

**Step 6: Update "Customizations" heading (line 169)**

Replace:
```html
              <h3 class="text-lg font-semibold mb-2">Customizations</h3>
```
with:
```html
              <h3 class="text-sm font-body font-semibold mb-2 text-espresso uppercase tracking-wide">Customizations</h3>
```

**Step 7: Update modal footer background (line 185)**

Replace:
```html
          <div class="bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
```
with:
```html
          <div class="bg-parchment px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
```

**Step 8: Update "Add to Cart" modal button (line 186–192)**

Replace:
```html
            <button
              type="button"
              on:click={() => handleAddToCart(selectedItem, true)}
              class="inline-flex w-full justify-center rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-accent sm:ml-3 sm:w-auto"
              disabled={selectedItem.allows_milk_choice && selectedMilkOptionId === null}
            >
```
with:
```html
            <button
              type="button"
              on:click={() => handleAddToCart(selectedItem, true)}
              class="inline-flex w-full justify-center rounded-full bg-primary px-4 py-2 text-sm font-body font-semibold text-espresso shadow-sm hover:bg-accent disabled:opacity-40 sm:ml-3 sm:w-auto"
              disabled={selectedItem.allows_milk_choice && selectedMilkOptionId === null}
            >
```

**Step 9: Update "Cancel" modal button (line 193–198)**

Replace:
```html
            <button
              type="button"
              on:click={() => (selectedItem = null)}
              class="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto"
            >
```
with:
```html
            <button
              type="button"
              on:click={() => (selectedItem = null)}
              class="mt-3 inline-flex w-full justify-center rounded-full bg-transparent px-4 py-2 text-sm font-body font-semibold text-espresso border-2 border-background/30 hover:border-background sm:mt-0 sm:w-auto"
            >
```

**Step 10: Verify**

Open the customization modal for any item. Should show: espresso backdrop, white rounded card, Cormorant Garamond item name, small uppercase section headers, pill milk option buttons (golden when selected), parchment footer, pill-shaped action buttons.

**Step 11: Commit**
```bash
git add src/lib/Menu.svelte
git commit -m "feat: apply artisanal styling to customization modal"
```

---

### Task 6: Cart.svelte

**Files:**
- Modify: `src/lib/Cart.svelte`

**Step 1: Update cart title (line 33)**

Replace:
```html
      <h2 class="text-2xl font-bold mb-4">Your Cart</h2>
```
with:
```html
      <h2 class="text-2xl font-display font-semibold mb-4 text-espresso">Your Cart</h2>
```

**Step 2: Update item name (line 42)**

Replace:
```html
                  <h3 class="text-lg font-semibold">{item.name}</h3>
```
with:
```html
                  <h3 class="text-base font-display font-semibold text-espresso">{item.name}</h3>
```

**Step 3: Update milk/customizations text (lines 44 and 48)**

Replace both occurrences of:
```html
                    <p class="text-sm text-gray-600">
```
with:
```html
                    <p class="text-sm text-neutral font-body">
```

**Step 4: Verify**

Open the cart. Item names should be in Cormorant Garamond, secondary details in sage Nunito.

**Step 5: Commit**
```bash
git add src/lib/Cart.svelte
git commit -m "feat: apply artisanal typography to cart panel"
```

---

### Task 7: FloatingFooter.svelte

**Files:**
- Modify: `src/lib/FloatingFooter.svelte`

**Step 1: Update outer container (line 24)**

Replace:
```html
<div class="fixed bottom-0 left-0 right-0 bg-white shadow-lg p-4">
```
with:
```html
<div class="fixed bottom-0 left-0 right-0 bg-parchment/85 backdrop-blur-md shadow-lg p-4 border-t border-amber-100">
```

**Step 2: Update item count span (line 26)**

Replace:
```html
    <span class="text-lg font-semibold">
```
with:
```html
    <span class="text-base font-body font-semibold text-espresso">
```

**Step 3: Update "View/Hide Cart" button (line 34)**

Replace:
```html
          class="bg-neutral text-white px-4 py-2 rounded-md hover:bg-background flex items-center"
```
with:
```html
          class="border-2 border-background/40 text-espresso font-body font-semibold px-4 py-2 rounded-full hover:border-background flex items-center"
```

**Step 4: Update "Submit Order" button (line 44)**

Replace:
```html
          class="bg-green-500 text-white px-4 py-2 rounded-md hover:bg-green-600 flex items-center"
```
with:
```html
          class="bg-primary text-espresso font-body font-semibold px-4 py-2 rounded-full hover:bg-accent flex items-center"
```

**Step 5: Verify**

The floating footer should now be frosted/translucent parchment, with an outlined cart button and golden pill Submit button.

**Step 6: Commit**
```bash
git add src/lib/FloatingFooter.svelte
git commit -m "feat: frosted parchment floating footer with pill buttons"
```

---

### Task 8: OrderStatus.svelte

**Files:**
- Modify: `src/lib/OrderStatus.svelte`

**Step 1: Update overlay (line 89)**

Replace:
```html
  class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full flex items-center justify-center"
```
with:
```html
  class="fixed inset-0 bg-espresso/60 overflow-y-auto h-full w-full flex items-center justify-center"
```

**Step 2: Update card (line 91)**

Replace:
```html
    <div class="bg-white p-8 rounded-lg shadow-xl w-full max-w-md">
```
with:
```html
    <div class="bg-white p-8 rounded-2xl shadow-[0_8px_40px_rgba(44,24,16,0.2)] w-full max-w-md mx-4">
```

**Step 3: Update "Order Status" title (line 92)**

Replace:
```html
    <h2 class="text-2xl font-bold mb-4">Order Status</h2>
```
with:
```html
    <h2 class="text-2xl font-display font-semibold mb-4 text-espresso">Order Status</h2>
```

**Step 4: Update thank-you text (line 93)**

Replace:
```html
    <p class="mb-4">Thank you for your order, {orderDetails?.customerName}!</p>
```
with:
```html
    <p class="mb-4 font-body text-espresso">Thank you, {orderDetails?.customerName}!</p>
```

**Step 5: Update status badge (line 98)**

Replace:
```html
            class="text-lg font-semibold inline-block py-1 px-3 mb-4 rounded-full text-white bg-background"
```
with:
```html
            class="text-xs font-body font-semibold inline-block py-1 px-4 mb-4 rounded-full text-parchment bg-background uppercase tracking-wider"
```

**Step 6: Update orders-ahead text (line 103)**

Replace:
```html
              <p class="text-sm text-gray-600 mb-2">
```
with:
```html
              <p class="text-sm text-neutral font-body mb-2">
```

**Step 7: Update "Order Details" heading (line 131)**

Replace:
```html
        <h3 class="text-xl font-semibold mb-2">Order Details:</h3>
```
with:
```html
        <h3 class="text-base font-display font-semibold mb-2 text-espresso">Order Details</h3>
```

**Step 8: Update "Cancel Order" button (line 150)**

Replace:
```html
          class="bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 mb-4"
```
with:
```html
          class="bg-red-500 text-white font-body font-semibold px-4 py-2 rounded-full hover:bg-red-600 mb-4"
```

**Step 9: Update "Order Again" button (line 162)**

Replace:
```html
        class="bg-primary text-white px-4 py-2 rounded-md hover:bg-accent"
```
with:
```html
        class="bg-primary text-espresso font-body font-semibold px-4 py-2 rounded-full hover:bg-accent"
```

**Step 10: Verify**

Submit an order and view the status modal. Should show espresso backdrop, white rounded card, display font title, small uppercase status badge, and pill-shaped action buttons.

**Step 11: Commit**
```bash
git add src/lib/OrderStatus.svelte
git commit -m "feat: apply artisanal styling to order status modal"
```

---

### Task 9: BaristaLogin.svelte

**Files:**
- Modify: `src/lib/BaristaLogin.svelte`

**Step 1: Update overlay (line 27)**

Replace:
```html
  class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full flex items-center justify-center"
```
with:
```html
  class="fixed inset-0 bg-espresso/60 overflow-y-auto h-full w-full flex items-center justify-center"
```

**Step 2: Update card (line 29)**

Replace:
```html
    <div class="bg-white p-8 rounded-lg shadow-xl w-96 relative">
```
with:
```html
    <div class="bg-white p-8 rounded-2xl shadow-[0_8px_40px_rgba(44,24,16,0.2)] w-96 relative">
```

**Step 3: Update title (line 37)**

Replace:
```html
    <h2 class="text-2xl font-bold mb-4">Barista Login</h2>
```
with:
```html
    <h2 class="text-2xl font-display font-semibold mb-4 text-espresso">Barista Login</h2>
```

**Step 4: Update email input (line 40–45)**

Replace:
```html
      <input
        type="email"
        bind:value={email}
        placeholder="Email"
        required
        class="w-full px-3 py-2 border border-gray-300 rounded-md"
      />
```
with:
```html
      <input
        type="email"
        bind:value={email}
        placeholder="Email"
        required
        class="w-full px-0 py-2 border-0 border-b border-neutral/40 bg-transparent focus:border-primary focus:outline-none text-espresso placeholder-neutral/50 font-body"
      />
```

**Step 5: Update password input (line 46–51)**

Replace:
```html
      <input
        type="password"
        bind:value={password}
        placeholder="Password"
        required
        class="w-full px-3 py-2 border border-gray-300 rounded-md"
      />
```
with:
```html
      <input
        type="password"
        bind:value={password}
        placeholder="Password"
        required
        class="w-full px-0 py-2 border-0 border-b border-neutral/40 bg-transparent focus:border-primary focus:outline-none text-espresso placeholder-neutral/50 font-body"
      />
```

**Step 6: Update Sign In button (line 52–55)**

Replace:
```html
        class="w-full bg-primary text-white py-2 rounded-md hover:bg-accent"
```
with:
```html
        class="w-full bg-primary text-espresso font-body font-semibold py-2 rounded-full hover:bg-accent"
```

**Step 7: Verify**

Click the barista login button (person icon, bottom-right). Modal should show espresso backdrop, rounded white card, display font title, underline-only inputs, and a pill-shaped golden Sign In button.

**Step 8: Commit**
```bash
git add src/lib/BaristaLogin.svelte
git commit -m "feat: apply artisanal styling to barista login modal"
```

---

## Done

All 9 tasks complete. The customer-facing UI now has the Neighbourhood Café aesthetic:
- Parchment background with grain texture overlay
- Cormorant Garamond for display text, Nunito for body/UI
- White card surfaces with warm shadows on parchment
- Pill-shaped buttons throughout
- Frosted floating footer
- Consistent espresso/golden/sage color language
