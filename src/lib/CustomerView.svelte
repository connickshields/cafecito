<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { fade, fly } from "svelte/transition";
  import Menu from "./Menu.svelte";
  import Cart from "./Cart.svelte";
  import FloatingFooter from "./FloatingFooter.svelte";
  import OrderStatus from "./OrderStatus.svelte";
  import HangoverNotice from "./HangoverNotice.svelte";
  import ClosedNotice from "./ClosedNotice.svelte";
  import { userSession, getMenuItems, submitOrder, getQueueStats } from "./supabase";
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
  let submitError = false;
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
    orderItems = orderItems.filter((item) => item.tempId !== id);
  }

  function updateQuantity(event: CustomEvent<{ tempId: number; quantity: number }>) {
    const { tempId, quantity } = event.detail;
    orderItems = orderItems.map((item) =>
      item.tempId === tempId ? { ...item, quantity } : item
    );
  }

  function toggleCart() {
    showCart = !showCart;
  }

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

  function closeOrderStatus() {
    showOrderStatus = false;
    currentOrderId = null;
  }

  $: bannerRange = queueDepth ? waitRange(queueDepth.drinksAhead, queueDepth.estMinsPerDrink) : null;

  $: itemCount = orderItems.reduce((sum, item) => sum + item.quantity, 0);

  $: menuUnavailable = !loading && !menuLoadFailed && menuItems.length === 0;
  $: canOrder = !loading && !menuLoadFailed && menuItems.length > 0;

  // Any cart change clears the error banner
  $: if (orderItems) submitError = false;
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
          Couldn't send your order — check your connection and try again
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
