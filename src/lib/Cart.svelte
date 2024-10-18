<script lang="ts">
  import { fly } from "svelte/transition";
  import { createEventDispatcher } from "svelte";
  import type { OrderItem } from "../types";

  export let orderItems: OrderItem[] = [];
  export let visible = false;

  const dispatch = createEventDispatcher();

  function removeItem(tempId: number) {
    dispatch("removeItem", tempId);
  }

  function updateQuantity(tempId: number, newQuantity: number) {
    if (newQuantity > 0) {
      dispatch("updateQuantityEvent", { tempId, quantity: newQuantity });
    } else {
      removeItem(tempId);
    }
  }
</script>

{#if visible}
  <div
    class="fixed inset-x-0 bottom-16 z-50 flex justify-center"
    transition:fly={{ y: 200, duration: 300 }}
  >
    <div
      class="bg-white shadow-lg rounded-t-lg p-6 max-h-[calc(80vh-4rem)] overflow-y-auto w-full max-w-3xl mx-auto"
    >
      <h2 class="text-2xl font-bold mb-4">Your Cart</h2>
      {#if orderItems.length === 0}
        <p>Your cart is empty.</p>
      {:else}
        <ul class="space-y-4">
          {#each orderItems as item}
            <li class="border-b pb-4">
              <div class="flex justify-between items-center">
                <div>
                  <h3 class="text-lg font-semibold">{item.name}</h3>
                  {#if item.milkOption}
                    <p class="text-sm text-gray-600">Milk: {item.milkOption.name}</p>
                  {/if}
                  {#if item.customizations && item.customizations.length > 0}
                    <p class="text-sm text-gray-600">
                      Customizations: {item.customizations.map((c) => c.name).join(", ")}
                    </p>
                  {/if}
                </div>
                <div class="flex items-center">
                  <button
                    on:click={() => updateQuantity(item.tempId, item.quantity - 1)}
                    class="text-gray-500 hover:text-gray-700"
                  >
                    -
                  </button>
                  <span class="mx-2">{item.quantity}</span>
                  <button
                    on:click={() => updateQuantity(item.tempId, item.quantity + 1)}
                    class="text-gray-500 hover:text-gray-700"
                  >
                    +
                  </button>
                  <button
                    on:click={() => removeItem(item.tempId)}
                    class="ml-4 text-red-500 hover:text-red-700"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
{/if}
