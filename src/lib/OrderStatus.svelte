<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { fade } from "svelte/transition";
  import { cancelOrder, getOrderDetails, getOrdersAheadCount } from "./supabase";
  import type { OrderDetails } from "../types";
  import Icons from "./Icons.svelte";

  export let orderId: number;
  export let onClose: () => void;

  let orderDetails: OrderDetails | null = null;
  let intervalId: NodeJS.Timeout;
  let shouldShowOrderAgain = false;
  let ordersAhead: number | null = null;
  let previousStatus: string | null = null;

  const statusMap = {
    pending: "Pending",
    in_progress: "In Progress",
    completed: "Completed",
    cancelled: "Cancelled",
  };

  onMount(async () => {
    // Request notification permission when the modal opens (gracefully ignore if unsupported)
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        try {
          await Notification.requestPermission();
        } catch (e) {
          // ignore
        }
      }
    }
    await updateOrderDetails();
    intervalId = setInterval(updateOrderDetails, 5000);
  });

  onDestroy(() => {
    clearInterval(intervalId);
  });

  async function updateOrderDetails() {
    orderDetails = await getOrderDetails(orderId);
    try {
      ordersAhead = await getOrdersAheadCount(orderId);
    } catch (e) {
      ordersAhead = null;
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

  async function handleCancelOrder() {
    if (orderDetails && orderDetails.status === "pending") {
      await cancelOrder(orderId);
      await updateOrderDetails();
    }
  }
</script>

<div
  class="fixed inset-0 bg-espresso/60 overflow-y-auto h-full w-full flex items-center justify-center"
>
  <div class="bg-white p-8 rounded-2xl shadow-[0_8px_40px_rgba(44,24,16,0.2)] w-full max-w-md mx-4">
    <h2 class="text-2xl font-display font-semibold mb-4 text-espresso">Order Status</h2>
    <p class="mb-4 font-body text-espresso">Thank you, {orderDetails?.customerName}!</p>
    {#if orderDetails}
      <div class="mb-6">
        <div class="flex flex-col items-center justify-center mb-2">
          <span
            class="text-xs font-body font-semibold inline-block py-1 px-4 mb-4 rounded-full text-parchment bg-background uppercase tracking-wider"
          >
            {statusMap[orderDetails.status]}
          </span>
          {#if ordersAhead !== null && (orderDetails.status === "pending" || orderDetails.status === "in_progress")}
            <p class="text-sm text-neutral font-body mb-2">
              {ordersAhead === 0
                ? "You're up next!"
                : `${ordersAhead} order${ordersAhead === 1 ? "" : "s"} ahead of you`}
            </p>
          {/if}
          <div class="w-48 h-48 flex items-center justify-center">
            {#if orderDetails.status === "pending"}
              <div in:fade={{ duration: 300 }} out:fade={{ duration: 300 }}>
                <Icons name="pending" size={250} color="#FFCF33" />
              </div>
            {:else if orderDetails.status === "in_progress"}
              <div in:fade={{ duration: 300 }} out:fade={{ duration: 300 }}>
                <Icons name="stylized-cup" size={200} color="#FFCF33" />
              </div>
            {:else if orderDetails.status === "completed"}
              <div in:fade={{ duration: 300 }} out:fade={{ duration: 300 }}>
                <Icons name="complete" size={200} color="#FFCF33" />
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
        <h3 class="text-base font-display font-semibold mb-2 text-espresso">Order Details</h3>
        <ul class="list-disc pl-5">
          {#each orderDetails.items as item}
            <li>
              {item.name} x {item.quantity}
              {#if item.milkOption}
                <span class="text-sm text-neutral font-body">({item.milkOption})</span>
              {/if}
              {#if item.customizations && item.customizations.length > 0}
                <span class="text-sm text-neutral font-body">
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
          class="bg-red-500 text-white font-body font-semibold px-4 py-2 rounded-full hover:bg-red-600 mb-4"
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
        class="bg-primary text-espresso font-body font-semibold px-4 py-2 rounded-full hover:bg-accent"
      >
        Order Again
      </button>
    {/if}
  </div>
</div>
