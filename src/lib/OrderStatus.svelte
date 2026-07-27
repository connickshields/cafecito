<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { fade } from "svelte/transition";
  import { cancelOrder, getOrderDetails, getQueueStats } from "./supabase";
  import type { OrderDetails } from "../types";
  import Icons from "./Icons.svelte";
  import { waitRange } from "./waitEstimate";

  export let orderId: number;
  export let onClose: () => void;

  let orderDetails: OrderDetails | null = null;
  let intervalId: NodeJS.Timeout;
  let shouldShowOrderAgain = false;
  let queueStats: { drinksAhead: number; activeOrders: number; estMinsPerDrink: number | null } | null = null;
  let previousStatus: string | null = null;

  $: estRange = queueStats ? waitRange(queueStats.drinksAhead, queueStats.estMinsPerDrink) : null;

  const statusMap = {
    pending: "Pending",
    in_progress: "In Progress",
    completed: "Completed",
    cancelled: "Cancelled",
  };

  onMount(async () => {
    // Request notification permission when the modal opens (gracefully ignore if unsupported).
    // Fire-and-forget: do not block the first fetch/poll on the user answering the prompt.
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        Notification.requestPermission().catch(() => {
          // ignore
        });
      }
    }
    try {
      await updateOrderDetails();
    } catch (e) {
      // ignore - the poll below will retry
    }
    intervalId = setInterval(updateOrderDetails, 5000);
  });

  onDestroy(() => {
    clearInterval(intervalId);
  });

  async function updateOrderDetails() {
    try {
      orderDetails = await getOrderDetails(orderId);
    } catch (e) {
      // leave orderDetails unchanged on failure so a mid-session blip doesn't crash the poll
    }
    try {
      queueStats = await getQueueStats(orderId);
    } catch (e) {
      queueStats = null;
    }
    shouldShowOrderAgain =
      orderDetails?.status === "cancelled" || orderDetails?.status === "completed";

    // Notify when the order transitions to completed
    if (
      previousStatus !== "completed" &&
      orderDetails &&
      orderDetails.status === "completed"
    ) {
      notifyOrderReady();
      playReadyChime();
    }
    previousStatus = orderDetails ? orderDetails.status : null;
  }

  function notifyOrderReady() {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return; // Unsupported
    if (Notification.permission !== "granted") return; // Respect user choice

    try {
      // Use a tag to avoid duplicate stacking if the user reopens
      new Notification("Your order is ready!", {
        body: `Order #${orderId} is completed. Enjoy!`,
        tag: `order-ready-${orderId}`,
      });
    } catch (e) {
      // Swallow errors to avoid breaking UI
    }
  }

  function playReadyChime() {
    try {
      const audio = new Audio("/assets/sounds/order-ready.wav");
      audio.play().catch(() => {}); // iOS silent switch / backgrounded tab: visual carries it
    } catch (e) {
      // ignore
    }
  }

  async function handleCancelOrder() {
    if (orderDetails && orderDetails.status === "pending") {
      await cancelOrder(orderId);
      await updateOrderDetails();
    }
  }
</script>

<div
  class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full flex items-center justify-center"
>
  <div class="p-8 rounded-lg shadow-xl w-full max-w-md {orderDetails?.status === 'completed'
    ? 'bg-green-500 text-white'
    : 'bg-white'}">
    <h2 class="text-2xl font-bold mb-4">Order Status</h2>
    {#if orderDetails}
      <p class="mb-4">Thank you for your order, {orderDetails.customerName}!</p>
      <div class="mb-6">
        <div class="flex flex-col items-center justify-center mb-2">
          <span
            class="text-lg font-semibold inline-block py-1 px-3 mb-4 rounded-full text-white bg-background"
          >
            {statusMap[orderDetails.status]}
          </span>
          {#if queueStats !== null && (orderDetails.status === "pending" || orderDetails.status === "in_progress")}
            <p class="text-sm text-gray-600 mb-2">
              {queueStats.drinksAhead === 0
                ? "You're up next!"
                : `${queueStats.drinksAhead} drink${queueStats.drinksAhead === 1 ? "" : "s"} ahead of you`}
            </p>
            {#if estRange}
              <p class="text-sm text-gray-600 mb-2">
                Estimated wait: {estRange.low}–{estRange.high} min
              </p>
            {/if}
          {/if}
          <div class="w-48 {orderDetails.status === 'completed' ? 'h-auto' : 'h-48'} flex items-center justify-center">
            {#if orderDetails.status === "pending"}
              <div in:fade={{ duration: 300 }} out:fade={{ duration: 300 }}>
                <Icons name="pending" size={250} color="#FFCF33" />
              </div>
            {:else if orderDetails.status === "in_progress"}
              <div in:fade={{ duration: 300 }} out:fade={{ duration: 300 }}>
                <Icons name="stylized-cup" size={200} color="#FFCF33" />
              </div>
            {:else if orderDetails.status === "completed"}
              <div in:fade={{ duration: 300 }} out:fade={{ duration: 300 }} class="text-center">
                <p class="text-4xl font-bold">{orderDetails.customerName}</p>
                <p class="text-2xl mb-2">Order #{orderDetails.id}</p>
                <Icons name="complete" size={140} color="white" />
                <p class="text-3xl font-bold mt-2">Ready!</p>
              </div>
            {:else if orderDetails.status === "cancelled"}
              <div in:fade={{ duration: 300 }} out:fade={{ duration: 300 }}>
                <Icons name="cancelled" size={200} color="#FFCF33" />
              </div>
            {/if}
          </div>
        </div>
      </div>
      <div class="mb-4">
        <h3 class="text-xl font-semibold mb-2">Order Details:</h3>
        <ul class="list-disc pl-5">
          {#each orderDetails.items as item}
            <li>
              {item.name} x {item.quantity}
              {#if item.milkOption}
                <span class="text-sm {orderDetails.status === 'completed' ? 'text-green-100' : 'text-gray-600'}">({item.milkOption})</span>
              {/if}
              {#if item.customizations && item.customizations.length > 0}
                <span class="text-sm {orderDetails.status === 'completed' ? 'text-green-100' : 'text-gray-600'}">
                  ({item.customizations.join(", ")})
                </span>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
      {#if orderDetails.status === "pending"}
        <button
          on:click={handleCancelOrder}
          class="bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 mb-4"
        >
          Cancel Order
        </button>
      {/if}
    {:else}
      <p class="mb-4">Loading order details...</p>
    {/if}
    {#if shouldShowOrderAgain}
      <button
        on:click={onClose}
        class="bg-primary text-white px-4 py-2 rounded-md hover:bg-accent"
      >
        Order Again
      </button>
    {/if}
  </div>
</div>
