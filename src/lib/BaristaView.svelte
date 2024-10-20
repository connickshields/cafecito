<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { fly } from "svelte/transition";
  import { getOrders, updateOrderStatus, signOut } from "./supabase";
  import type { Order } from "../types";

  let orders: Order[] = [];
  let selectedOrder: Order | null = null;
  let activeOrders = 0;
  let completedOrders = 0;
  let averageFulfillmentTime = "";
  let intervalId: NodeJS.Timeout;
  let newOrderIds: Set<number> = new Set();

  onMount(async () => {
    await fetchOrders();
    intervalId = setInterval(fetchOrders, 5000); // Fetch orders every 5 seconds
  });

  onDestroy(() => {
    clearInterval(intervalId);
  });

  async function fetchOrders() {
    const newOrders = await getOrders();
    newOrders.sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    // Check for new orders
    const newIds = newOrders
      .filter(
        (order) => order.status === "pending" && !orders.some((o) => o.id === order.id)
      )
      .map((order) => order.id);
    if (newIds.length > 0) {
      playNewOrderSound();
      newIds.forEach((id) => newOrderIds.add(id));
      newOrderIds = newOrderIds; // Trigger reactivity

      // Remove highlight after 5 seconds
      setTimeout(() => {
        newIds.forEach((id) => newOrderIds.delete(id));
        newOrderIds = newOrderIds; // Trigger reactivity
      }, 5000);
    }

    orders = newOrders;
    orders.sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );

    // Calculate statistics
    activeOrders = orders.filter(
      (order) => order.status === "pending" || order.status === "in_progress"
    ).length;
    completedOrders = orders.filter((order) => order.status === "completed").length;

    const completedOrderTimes = orders
      .filter((order) => order.status === "completed")
      .map(
        (order) =>
          new Date(order.updated_at).getTime() - new Date(order.created_at).getTime()
      );

    if (completedOrderTimes.length > 0) {
      const avgTime =
        completedOrderTimes.reduce((sum, time) => sum + time, 0) /
        completedOrderTimes.length;
      averageFulfillmentTime = formatDuration(avgTime);
    } else {
      averageFulfillmentTime = "N/A";
    }
  }

  function formatDuration(ms: number): string {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }

  async function handleSignOut() {
    try {
      await signOut();
    } catch (error) {
      console.error("Error signing out:", error);
    }
  }

  function selectOrder(order: Order) {
    selectedOrder = order;
  }

  function closeOrderDetails() {
    selectedOrder = null;
  }

  function getOrderItemCount(order: Order): string {
    const count = order.items.reduce((sum, item) => sum + item.quantity, 0);
    return `${count} item${count !== 1 ? "s" : ""}`;
  }

  function getMilkColor(milkOption: string): string {
    const milkColors = {
      "Whole Milk": "#F0E6D2",
      "Oat Milk": "#D2B48C",
      "Almond Milk": "#FAEBD7",
      "Soy Milk": "#FFF8DC",
    };
    return milkColors[milkOption] || "#E0E0E0";
  }

  function getFormattedStatus(status: string): { text: string; color: string } {
    switch (status) {
      case "pending":
        return { text: "Pending", color: "bg-yellow-100 text-yellow-800" };
      case "in_progress":
        return { text: "In Progress", color: "bg-green-100 text-green-800" };
      case "completed":
        return { text: "Completed", color: "bg-blue-100 text-blue-800" };
      case "cancelled":
        return { text: "Cancelled", color: "bg-red-100 text-red-800" };
      default:
        return { text: status, color: "bg-gray-100 text-gray-800" };
    }
  }

  async function changeOrderStatus(orderId: number, newStatus: string) {
    await updateOrderStatus(orderId, newStatus);
    await fetchOrders(); // This will recalculate all orders and statistics
    if (selectedOrder && selectedOrder.id === orderId) {
      if (newStatus === "completed") {
        selectedOrder = null; // Close the flyout
      } else {
        selectedOrder = orders.find((order) => order.id === orderId) || null;
      }
    }
  }

  function playNewOrderSound() {
    const audio = new Audio("./assets/sounds/new-order.mp3");
    audio.play();
  }
</script>

<div class="min-h-screen bg-gray-100 flex">
  <!-- Main content -->
  <div class="flex-1 overflow-y-auto">
    <header class="bg-white shadow-sm">
      <div
        class="max-w-7xl mx-auto py-4 px-4 sm:px-6 lg:px-8 flex justify-between items-center"
      >
        <div class="flex-1 flex items-center space-x-8">
          <div class="flex flex-col items-center">
            <span class="text-2xl font-bold text-blue-600">{activeOrders}</span>
            <span class="text-sm text-gray-500">Active</span>
          </div>
          <div class="flex flex-col items-center">
            <span class="text-2xl font-bold text-green-600">{completedOrders}</span>
            <span class="text-sm text-gray-500">Completed</span>
          </div>
          <div class="flex flex-col items-center">
            <span class="text-2xl font-bold text-purple-600"
              >{averageFulfillmentTime}</span
            >
            <span class="text-sm text-gray-500">Avg. Time</span>
          </div>
          {#if orders.filter((order) => order.status === "pending").length > 0}
            <div class="flex flex-col items-center">
              <span class="text-2xl font-bold text-red-600"
                >{orders.filter((order) => order.status === "pending").length}</span
              >
              <span class="text-sm text-gray-500">New Orders</span>
            </div>
          {/if}
        </div>
        <button
          on:click={handleSignOut}
          class="text-gray-600 hover:text-gray-900"
          aria-label="Sign Out"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
            />
          </svg>
        </button>
      </div>
    </header>

    <main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div class="px-4 py-6 sm:px-0">
        <h2 class="text-xl font-semibold mb-4">Active Orders</h2>
        {#if orders.filter((order) => order.status === "pending" || order.status === "in_progress").length === 0}
          <div class="text-center py-12">
            <svg
              class="mx-auto h-24 w-24 text-gray-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
              <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
              <line x1="6" y1="1" x2="6" y2="4" />
              <line x1="10" y1="1" x2="10" y2="4" />
              <line x1="14" y1="1" x2="14" y2="4" />
              <path d="M4 12c3.5 1 6.5 1 10 0" />
            </svg>
            <h3 class="mt-2 text-sm font-medium text-gray-900">No active orders</h3>
            <p class="mt-1 text-sm text-gray-500">
              Time to relax! New orders will appear here.
            </p>
          </div>
        {:else}
          <div class="bg-white shadow overflow-hidden sm:rounded-md">
            <ul class="divide-y divide-gray-200">
              {#each orders.filter((order) => order.status === "pending" || order.status === "in_progress") as order (order.id)}
                <li
                  class="transition-colors duration-500"
                  class:bg-yellow-50={newOrderIds.has(order.id)}
                >
                  <button
                    on:click={() => selectOrder(order)}
                    class="block hover:bg-gray-50 w-full text-left"
                  >
                    <div class="px-4 py-4 sm:px-6">
                      <div class="flex items-center justify-between">
                        <p class="text-sm font-medium text-indigo-600 truncate">
                          {order.customerName}
                        </p>
                        <div class="ml-2 flex-shrink-0 flex">
                          {#if order.status === "pending" || order.status === "in_progress"}
                            {@const { text, color } = getFormattedStatus(order.status)}
                            <p
                              class={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${color}`}
                            >
                              {text}
                            </p>
                          {/if}
                        </div>
                      </div>
                      <div class="mt-2 sm:flex sm:justify-between">
                        <div class="sm:flex">
                          <p class="flex items-center text-sm text-gray-500">
                            {getOrderItemCount(order)}
                          </p>
                        </div>
                        <div class="mt-2 flex items-center text-sm text-gray-500 sm:mt-0">
                          <p>
                            {new Date(order.created_at).toLocaleTimeString()}
                          </p>
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    </main>
  </div>

  <!-- Order details sidebar -->
  {#if selectedOrder}
    <div
      class="w-1/3 bg-white border-l border-gray-200 overflow-y-auto"
      transition:fly={{ x: 300, duration: 300 }}
    >
      <div class="p-4">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-lg font-semibold">Order #{selectedOrder.id}</h2>
          <button on:click={closeOrderDetails} class="text-gray-500 hover:text-gray-700">
            <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
        <p class="text-sm text-gray-600 mb-2">Customer: {selectedOrder.customerName}</p>
        <p class="text-sm text-gray-600 mb-4">
          Status:
          {#if selectedOrder.status}
            {@const formatted = getFormattedStatus(selectedOrder.status)}
            <span class={`px-2 py-1 rounded-full ${formatted.color}`}>
              {formatted.text}
            </span>
          {/if}
        </p>

        <div class="space-y-4">
          {#each selectedOrder.items as item, itemIndex}
            {#each Array(item.quantity) as _, i}
              <button
                class="bg-gray-50 rounded-lg p-4 w-full text-left transition-colors duration-200 hover:bg-gray-100"
                on:click={() => {
                  item.completedInstances[i] = !item.completedInstances[i];
                  selectedOrder = { ...selectedOrder };
                }}
              >
                <div class="flex justify-between items-start">
                  <h3
                    class="font-semibold text-lg"
                    class:line-through={item.completedInstances &&
                      item.completedInstances[i]}
                    class:text-gray-400={item.completedInstances &&
                      item.completedInstances[i]}
                  >
                    {item.name}
                  </h3>
                  <div class="text-right">
                    {#if item.milkOption}
                      <span
                        class="inline-block px-3 py-1 text-sm font-semibold rounded-full mb-2"
                        style="background-color: {getMilkColor(item.milkOption)};"
                        class:opacity-50={item.completedInstances &&
                          item.completedInstances[i]}
                      >
                        {item.milkOption}
                      </span>
                    {/if}
                    {#if item.customizations && item.customizations.length > 0}
                      <div>
                        {#each item.customizations as customization}
                          <span
                            class="inline-block bg-gray-200 rounded-full px-3 py-1 text-sm font-semibold text-gray-700 ml-2 mb-2"
                            class:opacity-50={item.completedInstances &&
                              item.completedInstances[i]}
                          >
                            {customization}
                          </span>
                        {/each}
                      </div>
                    {/if}
                  </div>
                </div>
              </button>
            {/each}
          {/each}
        </div>

        <div class="mt-6 flex space-x-4">
          {#if selectedOrder.status === "pending"}
            <button
              on:click={() => changeOrderStatus(selectedOrder.id, "in_progress")}
              class="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 flex-1"
            >
              Start Order
            </button>
            <button
              on:click={() => changeOrderStatus(selectedOrder.id, "cancelled")}
              class="bg-red-500 text-white px-4 py-2 rounded-md hover:bg-red-600 flex-1"
            >
              Cancel Order
            </button>
          {:else if selectedOrder.status === "in_progress"}
            <button
              on:click={() => changeOrderStatus(selectedOrder.id, "completed")}
              class="bg-green-500 text-white px-4 py-2 rounded-md hover:bg-green-600 flex-1"
            >
              Complete Order
            </button>
          {/if}
        </div>
      </div>
    </div>
  {/if}
</div>
