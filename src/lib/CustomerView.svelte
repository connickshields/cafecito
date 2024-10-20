<script lang="ts">
  import { onMount } from "svelte";
  import { fade, fly } from "svelte/transition";
  import Menu from "./Menu.svelte";
  import Cart from "./Cart.svelte";
  import FloatingFooter from "./FloatingFooter.svelte";
  import OrderStatus from "./OrderStatus.svelte";
  import { userSession, getMenuItems, submitOrder } from "./supabase";
  import type { MenuItem, OrderItem } from "../types";

  export let customerName: string;

  let orderItems: OrderItem[] = [];
  let menuItems: MenuItem[] = [];
  let loading = true;
  let showCart = false;
  let showOrderStatus = false;
  let currentOrderId: number | null = null;

  onMount(async () => {
    menuItems = await getMenuItems();
    loading = false;
  });

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
    if (orderItems.length > 0 && $userSession) {
      try {
        const result = await submitOrder($userSession.user.id, customerName, orderItems);
        currentOrderId = result.orderId;
        showOrderStatus = true;
        orderItems = [];
      } catch (error) {
        console.error("Error submitting order:", error);
      }
    }
  }

  function closeOrderStatus() {
    showOrderStatus = false;
    currentOrderId = null;
  }

  $: itemCount = orderItems.reduce((sum, item) => sum + item.quantity, 0);
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
    <header class="bg-primary shadow">
      <div class="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 flex justify-center">
        <h1
          class="text-6xl font-bold text-white font-display"
          style="font-family: 'Brush Script MT', cursive; text-shadow: 4px 4px 8px #EF8354;"
        >
          Cafecito
        </h1>
      </div>
    </header>
    <main class="flex-grow container mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div class="max-w-3xl mx-auto">
        {#if loading}
          <p class="text-center">Loading menu items...</p>
        {:else}
          <div class="space-y-8">
            <h2 class="text-3xl font-bold mb-4 text-center">
              <span>Welcome, {customerName}!</span>
            </h2>
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
    <FloatingFooter
      {itemCount}
      {showCart}
      onViewCart={toggleCart}
      onSubmitOrder={handleSubmitOrder}
    />
  </div>
{/if}
