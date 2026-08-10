<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { fade, fly } from "svelte/transition";
  import Menu from "./Menu.svelte";
  import Cart from "./Cart.svelte";
  import FloatingFooter from "./FloatingFooter.svelte";
  import OrderStatus from "./OrderStatus.svelte";
  import HangoverNotice from "./HangoverNotice.svelte";
  import ClosedNotice from "./ClosedNotice.svelte";
  import { getMenuItems, submitOrder, getQueueStats } from "./api";
  import { waitRange } from "./waitEstimate";
  import type { MenuItem, OrderItem } from "../types";

  export let customerName: string;
  export let initialOrderId: number | null = null;

  let orderItems: OrderItem[] = [];
  let menuItems: MenuItem[] = [];
  let loading = true;
  let menuLoadFailed = false;
  let showCart = false;
  let showOrderStatus = initialOrderId !== null;
  let currentOrderId: number | null = initialOrderId;
  let submitting = false;
  // Holds the message to show, or null. A string (not a boolean) so the 409
  // and network-failure paths can render distinct, accurate copy.
  let submitError: string | null = null;
  let submissionId = null;
  let queueDepth: { drinksAhead: number; activeOrders: number; estMinsPerDrink: number | null } | null = null;
  let pollId: NodeJS.Timeout;

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

  onDestroy(() => {
    clearInterval(pollId);
  });

  async function refreshPageData() {
    if (showOrderStatus) return; // status screen has its own poll
    try {
      menuItems = await getMenuItems();
      menuLoadFailed = false;
    } catch (e) {
      // keep last known menu
    }
    try {
      queueDepth = await getQueueStats();
    } catch (e) {
      queueDepth = null; // hide banner rather than show stale numbers
    }
  }

  function addToOrder(item: MenuItem, milkOption, customizations) {
    submitError = null; // a cart change is a fresh attempt; clear any prior banner
    const newItem: OrderItem = {
      tempId: Date.now(),
      itemId: item.id,
      name: item.name,
      quantity: 1,
      milkOption: milkOption ? { id: milkOption.id, name: milkOption.name } : undefined,
      customizations: customizations
        ? customizations.map((c) => ({ id: c.id, name: c.name }))
        : undefined,
    };

    const existingItemIndex = orderItems.findIndex(
      (orderItem) =>
        orderItem.name === newItem.name &&
        JSON.stringify(orderItem.milkOption) === JSON.stringify(newItem.milkOption) &&
        JSON.stringify(orderItem.customizations) ===
          JSON.stringify(newItem.customizations)
    );

    if (existingItemIndex !== -1) {
      orderItems = orderItems.map((item, index) =>
        index === existingItemIndex ? { ...item, quantity: item.quantity + 1 } : item
      );
    } else {
      orderItems = [...orderItems, newItem];
    }
  }

  function removeItem(id: number) {
    submitError = null; // a cart change is a fresh attempt; clear any prior banner
    orderItems = orderItems.filter((item) => item.tempId !== id);
  }

  function updateQuantity(event: CustomEvent<{ tempId: number; quantity: number }>) {
    submitError = null; // a cart change is a fresh attempt; clear any prior banner
    const { tempId, quantity } = event.detail;
    orderItems = orderItems.map((item) =>
      item.tempId === tempId ? { ...item, quantity } : item
    );
  }

  // Drops cart lines whose item, milk option, or customization the server
  // just reported as unavailable (409's `unavailable: [{table, id}, ...]`).
  // Leaves the cart untouched if the server did not send that detail.
  function pruneUnavailable(items: OrderItem[], unavailable) {
    if (!Array.isArray(unavailable) || unavailable.length === 0) return items;

    const badIds = { items: new Set(), milk_options: new Set(), customization_options: new Set() };
    for (const { table, id } of unavailable) {
      if (badIds[table]) badIds[table].add(id);
    }

    return items.filter((item) => {
      if (badIds.items.has(item.itemId)) return false;
      if (item.milkOption && badIds.milk_options.has(item.milkOption.id)) return false;
      if (item.customizations?.some((c) => badIds.customization_options.has(c.id))) return false;
      return true;
    });
  }

  function toggleCart() {
    showCart = !showCart;
  }

  async function handleSubmitOrder() {
    if (orderItems.length === 0 || submitting) return;
    // Reused across retries so a lost response cannot create a second order.
    if (!submissionId) submissionId = crypto.randomUUID();
    submitting = true;
    submitError = null;
    try {
      const result = await submitOrder(customerName, orderItems, submissionId);
      currentOrderId = result.orderId;
      showOrderStatus = true;
      orderItems = [];
      submissionId = null;
    } catch (error) {
      console.error("Error submitting order:", error);
      if (error.status === 409) {
        // The server never created an order for this submissionId, so it is
        // NOT safe to keep reusing it: the retry-idempotency guarantee is
        // "the same order gets at most one row," and after a 409 there is no
        // order yet to be "the same" as. The next attempt (once the cart is
        // corrected) is a genuinely new order and needs a fresh id. This is
        // the only path that resets submissionId.
        submissionId = null;
        orderItems = pruneUnavailable(orderItems, error.unavailable);
        submitError = "Something in your cart just sold out. Remove it and try again.";
      } else {
        // Network/5xx: we cannot tell whether the server actually created the
        // order before the response was lost, so submissionId is deliberately
        // KEPT. Retrying with the same submissionId lets createOrder's
        // unique-submission_id check return the original order instead of
        // creating a duplicate.
        submitError = "Couldn't send your order — check your connection and try again";
      }
    } finally {
      submitting = false;
    }
  }

  function closeOrderStatus() {
    showOrderStatus = false;
    currentOrderId = null;
  }

  $: bannerRange = queueDepth ? waitRange(queueDepth.drinksAhead, queueDepth.estMinsPerDrink) : null;

  $: itemCount = orderItems.reduce((sum, item) => sum + item.quantity, 0);

  $: menuUnavailable = !loading && !menuLoadFailed && menuItems.length === 0;
  $: canOrder = !loading && !menuLoadFailed && menuItems.length > 0;
</script>

{#if showOrderStatus && currentOrderId}
  <div in:fade out:fade>
    <OrderStatus orderId={currentOrderId} onClose={closeOrderStatus} />
  </div>
{:else}
  <div
    class="min-h-screen bg-gray-100 flex flex-col"
    in:fly={{ y: 200, duration: 300 }}
    out:fly={{ y: -200, duration: 300 }}
  >
    <header class="bg-white shadow">
      <div class="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 flex justify-center">
        <h1
          class="text-6xl font-bold text-primary font-display yesteryear-regular"
          style="-webkit-text-stroke: 8px #424B54; paint-order: stroke fill;"
        >
          Cafecito
        </h1>
      </div>
    </header>
    <main class="flex-grow container mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div class="max-w-3xl mx-auto">
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
            <HangoverNotice />
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
      </div>
    </main>
    {#if submitError}
      <div class="fixed bottom-20 left-0 right-0 px-4 z-10" transition:fade>
        <div
          class="max-w-3xl mx-auto bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded-md text-center"
        >
          {submitError}
        </div>
      </div>
    {/if}
    {#if canOrder}
      <FloatingFooter
        {itemCount}
        {showCart}
        {submitting}
        onViewCart={toggleCart}
        onSubmitOrder={handleSubmitOrder}
      />
    {/if}
  </div>
{/if}
