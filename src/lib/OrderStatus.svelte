<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { cancelOrder, getOrderDetails } from "./supabase";
  import type { OrderDetails } from "../types";

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
    <p class="mb-4">Thank you for your order!</p>
    {#if orderDetails}
      <p class="mb-4">Status: {statusMap[orderDetails.status]}</p>
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
      class="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600"
    >
      Back to Menu
    </button>
  </div>
</div>
