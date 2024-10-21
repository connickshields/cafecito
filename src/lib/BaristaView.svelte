<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { fly } from "svelte/transition";
  import { getOrders, updateOrderStatus, signOut } from "./supabase";
  import type { Order } from "../types";
  import Icons from "./Icons.svelte";

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
        <h1
          class="text-6xl font-bold text-primary font-display yesteryear-regular text-center absolute left-1/2 transform -translate-x-1/2"
          style="-webkit-text-stroke: 8px #000; paint-order: stroke fill;"
        >
          Cafecito
        </h1>
        <button
          on:click={handleSignOut}
          class="text-gray-600 hover:text-gray-900"
          aria-label="Sign Out"
        >
          <Icons name="logout" size={24} />
        </button>
      </div>
    </header>

    <main class="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
      <div class="px-4 py-6 sm:px-0">
        <h2 class="text-xl font-semibold mb-4">Active Orders</h2>
        {#if orders.filter((order) => order.status === "pending" || order.status === "in_progress").length === 0}
          <div class="text-center py-12">
            <div class="flex justify-center">
              <Icons name="stylized-cup" size={100} color={"#93A8AC"} />
            </div>
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
            <Icons name="close" size={24} />
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
