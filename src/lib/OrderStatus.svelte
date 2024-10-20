<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { fade } from "svelte/transition";
  import { cancelOrder, getOrderDetails } from "./supabase";
  import type { OrderDetails } from "../types";
  import Icons from "./Icons.svelte";

  export let orderId: number;
  export let onClose: () => void;

  let orderDetails: OrderDetails | null = null;
  let intervalId: NodeJS.Timeout;

  const statusMap = {
    pending: "Pending",
    in_progress: "In Progress",
    completed: "Completed",
    cancelled: "Cancelled",
  };

  onMount(async () => {
    await updateOrderDetails();
    intervalId = setInterval(updateOrderDetails, 5000);
  });

  onDestroy(() => {
    clearInterval(intervalId);
  });

  async function updateOrderDetails() {
    orderDetails = await getOrderDetails(orderId);
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
  <div class="bg-white p-8 rounded-lg shadow-xl w-full max-w-md">
    <h2 class="text-2xl font-bold mb-4">Order Status</h2>
    <p class="mb-4">Thank you for your order, {orderDetails?.customerName}!</p>
    {#if orderDetails}
      <div class="mb-6">
        <div class="flex flex-col items-center justify-center mb-2">
          <span
            class="text-lg font-semibold inline-block py-1 px-3 mb-4 rounded-full text-white bg-background"
          >
            {statusMap[orderDetails.status]}
          </span>
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
        <h3 class="text-xl font-semibold mb-2">Order Details:</h3>
        <ul class="list-disc pl-5">
          {#each orderDetails.items as item}
            <li>
              {item.name} x {item.quantity}
              {#if item.milkOption}
                <span class="text-sm text-gray-600">({item.milkOption})</span>
              {/if}
              {#if item.customizations && item.customizations.length > 0}
                <span class="text-sm text-gray-600">
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
    <button
      on:click={onClose}
      class="bg-primary text-white px-4 py-2 rounded-md hover:bg-accent"
    >
      Order Again
    </button>
  </div>
</div>
