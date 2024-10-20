<script lang="ts">
  import { onMount, createEventDispatcher } from "svelte";
  import type { MenuItem } from "../types";
  import Icons from "./Icons.svelte";
  import { getCustomizationOptions, getMilkOptions } from "./supabase";

  const dispatch = createEventDispatcher();

  export let menuItems: MenuItem[] = [];
  export let addToOrder: (
    item: MenuItem,
    milkOptionId: number,
    customizationOptionIds: number[]
  ) => void;

  let selectedItem: MenuItem | null = null;
  let selectedMilkOptionId: number | null = null;
  let selectedCustomizationOptionIds: number[] = [];

  let milkOptions = [];
  let customizationOptions = [];
  let showCustomizationModal = false;

  onMount(async () => {
    milkOptions = await getMilkOptions();
    customizationOptions = await getCustomizationOptions();
  });

  function selectItem(item: MenuItem) {
    selectedItem = item;
    selectedMilkOptionId = null;
    selectedCustomizationOptionIds = [];
    showCustomizationModal = true;
    dispatch("closeCart");
  }

  function toggleCustomization(id: number) {
    if (selectedCustomizationOptionIds.includes(id)) {
      selectedCustomizationOptionIds = selectedCustomizationOptionIds.filter(
        (optionId) => optionId !== id
      );
    } else {
      selectedCustomizationOptionIds = [...selectedCustomizationOptionIds, id];
    }
  }

  function handleAddToCart() {
    if (selectedItem) {
      const selectedMilk = selectedMilkOptionId
        ? milkOptions.find((m) => m.id === selectedMilkOptionId)
        : null;
      const selectedCustomizations = customizationOptions.filter((c) =>
        selectedCustomizationOptionIds.includes(c.id)
      );
      addToOrder(selectedItem, selectedMilk, selectedCustomizations);
      selectedItem = null;
      showCustomizationModal = false;
    }
  }
</script>

<div class="bg-white shadow rounded-lg p-6">
  <h2 class="text-2xl font-bold mb-4">Menu</h2>
  <ul class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
    {#each menuItems as item}
      <li class="border rounded-lg p-4">
        <div class="flex flex-col h-full justify-between">
          <div>
            <h3 class="text-lg font-semibold">{item.name}</h3>
            <p class="text-gray-600">{item.description}</p>
          </div>
          {#if !item.allows_milk_choice && !item.allows_customizations}
            <button
              on:click={() => addToOrder(item, null, [])}
              class="mt-4 bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600"
            >
              Add to Cart
            </button>
          {:else}
            <button
              on:click={() => selectItem(item)}
              class="mt-4 bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 flex items-center justify-center"
            >
              <span class="mr-2">
                <Icons name="coffee-cup" size={20} />
              </span>
              Customize
            </button>
          {/if}
        </div>
      </li>
    {/each}
  </ul>
</div>

{#if selectedItem}
  <div
    class="fixed inset-0 z-50 overflow-y-auto"
    aria-labelledby="modal-title"
    role="dialog"
    aria-modal="true"
  >
    <div class="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity"></div>

    <div class="fixed inset-0 z-10 overflow-y-auto">
      <div class="flex min-h-screen items-center justify-center p-4 text-center sm:p-0">
        <div
          class="relative transform overflow-hidden rounded-lg bg-white text-left shadow-xl transition-all w-full max-w-lg mx-auto"
        >
          <div
            class="bg-white px-4 pb-4 pt-5 sm:p-6 sm:pb-4 max-h-[80vh] overflow-y-auto"
          >
            <h2 class="text-2xl font-bold mb-4">Customize {selectedItem.name}</h2>

            {#if selectedItem.allows_milk_choice}
              <h3 class="text-lg font-semibold mb-2">Select Milk</h3>
              <div class="grid grid-cols-2 gap-2 mb-4">
                {#each milkOptions as milk}
                  <button
                    class="p-2 rounded-md text-center {selectedMilkOptionId === milk.id
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-200 text-gray-800'}"
                    on:click={() => (selectedMilkOptionId = milk.id)}
                  >
                    {milk.name}
                  </button>
                {/each}
              </div>
            {/if}

            {#if selectedItem.allows_customizations}
              <h3 class="text-lg font-semibold mb-2">Customizations</h3>
              <div class="space-y-2 mb-4">
                {#each customizationOptions as customization}
                  <label class="flex items-center">
                    <input
                      type="checkbox"
                      checked={selectedCustomizationOptionIds.includes(customization.id)}
                      on:change={() => toggleCustomization(customization.id)}
                      class="mr-2"
                    />
                    {customization.name}
                  </label>
                {/each}
              </div>
            {/if}
          </div>
          <div class="bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
            <button
              type="button"
              on:click={handleAddToCart}
              class="inline-flex w-full justify-center rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-500 sm:ml-3 sm:w-auto"
              disabled={selectedItem.allows_milk_choice && selectedMilkOptionId === null}
            >
              Add to Cart
            </button>
            <button
              type="button"
              on:click={() => (selectedItem = null)}
              class="mt-3 inline-flex w-full justify-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 sm:mt-0 sm:w-auto"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
{/if}
