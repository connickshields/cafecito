<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from "svelte";
  import type { MenuItem } from "../types";
  import Icons from "./Icons.svelte";
  import { getCustomizationOptions, getMilkOptions } from "./api";
  import { fade } from "svelte/transition";
  import { groupByType } from "./menuGrouping";

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

  // A drink now carries its own applicable options, so the pickers show that
  // subset rather than everything on the menu.
  $: visibleMilkOptions = selectedItem
    ? milkOptions.filter((milk) => (selectedItem.milkOptionIds ?? []).includes(milk.id))
    : [];
  $: visibleCustomizationGroups = selectedItem
    ? groupByType(
        customizationOptions.filter((option) =>
          (selectedItem.customizationOptionIds ?? []).includes(option.id)
        )
      )
    : [];

  // A drink "requires" milk only while at least one of ITS milks is actually
  // available. Without the availability half, 86'ing the last applicable milk
  // leaves Add to Cart permanently disabled with no way forward.
  $: milkRequired =
    !!selectedItem?.allows_milk_choice && visibleMilkOptions.some((milk) => milk.available);

  let justAddedItemId: number | null = null;

  let optionsPollId: NodeJS.Timeout;

  onMount(async () => {
    await refreshOptions();
    optionsPollId = setInterval(refreshOptions, 5000);
  });

  onDestroy(() => {
    clearInterval(optionsPollId);
  });

  async function refreshOptions() {
    try {
      milkOptions = await getMilkOptions(true); // unavailable milks render greyed out
      customizationOptions = await getCustomizationOptions();
    } catch (e) {
      return; // keep last known options
    }
    // selectedItem is a reference into the menuItems prop, which CustomerView
    // replaces wholesale on every poll. Without this resync it stays a frozen
    // snapshot for the life of the modal, and the applicability pruning below
    // could never fire.
    if (selectedItem) {
      const fresh = menuItems.find((item) => item.id === selectedItem.id);
      if (!fresh) {
        // The drink was archived or made unavailable while its modal was open.
        selectedItem = null;
        showCustomizationModal = false;
        return;
      }
      selectedItem = fresh;
    }
    // Selections in the open customize modal must not point at 86'd options
    if (selectedMilkOptionId !== null) {
      const milk = milkOptions.find((m) => m.id === selectedMilkOptionId);
      const applies =
        !selectedItem || (selectedItem.milkOptionIds ?? []).includes(selectedMilkOptionId);
      if (!milk || !milk.available || !applies) selectedMilkOptionId = null;
    }
    selectedCustomizationOptionIds = selectedCustomizationOptionIds.filter(
      (id) =>
        customizationOptions.some((option) => option.id === id) &&
        (!selectedItem || (selectedItem.customizationOptionIds ?? []).includes(id))
    );
  }

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

  function handleAddToCart(item: MenuItem, useSelections: boolean = false) {
    if (useSelections) {
      const selectedMilk = selectedMilkOptionId
        ? milkOptions.find((m) => m.id === selectedMilkOptionId)
        : null;
      const selectedCustomizations = customizationOptions.filter((c) =>
        selectedCustomizationOptionIds.includes(c.id)
      );
      addToOrder(item, selectedMilk, selectedCustomizations);
    } else {
      addToOrder(item, null, []);
    }
    animateAddToCart(item);
    selectedItem = null;
    showCustomizationModal = false;
  }

  function animateAddToCart(item: MenuItem) {
    justAddedItemId = item.id;
    setTimeout(() => {
      justAddedItemId = null;
    }, 2000); // Fade out after 2 seconds
  }
</script>

<div class="bg-white shadow rounded-lg p-6">
  <h2 class="text-2xl font-bold mb-4">Menu</h2>
  <ul class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
    {#each menuItems as item}
      <li class="border rounded-lg p-4 relative">
        <div class="flex flex-col h-full justify-between">
          <div>
            <div class="flex justify-between items-start">
              <h3 class="text-lg font-semibold">{item.name}</h3>
              {#if item.size !== null}
                <span
                  class="inline-block bg-gray-200 rounded-full px-2 py-1 text-xs text-gray-700 ml-2 mb-2"
                  >{item.size}oz</span
                >
              {/if}
            </div>
            <p class="text-gray-600">{item.description}</p>
          </div>
          {#if !item.allows_milk_choice && !item.allows_customizations}
            <button
              on:click={() => handleAddToCart(item)}
              class="mt-4 bg-primary text-white px-4 py-2 rounded-md hover:bg-accent"
            >
              Add to Cart
            </button>
          {:else}
            <button
              on:click={() => selectItem(item)}
              class="mt-4 bg-primary text-white px-4 py-2 rounded-md hover:bg-accent flex items-center justify-center"
            >
              Customize
            </button>
          {/if}
        </div>
        {#if justAddedItemId === item.id}
          <div
            transition:fade={{ duration: 300 }}
            class="absolute inset-0 bg-green-400 bg-opacity-80 flex items-center justify-center rounded-lg"
          >
            <div class="text-white text-center">
              <Icons name={"complete"} size={48} color="white" />
              <p class="font-semibold">Added to Cart</p>
            </div>
          </div>
        {/if}
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
            <h2 class="text-2xl font-bold mb-4">{selectedItem.name}</h2>

            {#if selectedItem.allows_milk_choice}
              <h3 class="text-lg font-semibold mb-2">
                Select Milk
                {#if milkRequired}
                  <span class="text-red-400">(required)</span>
                {/if}
              </h3>
              <div class="grid grid-cols-3 gap-2 mb-4">
                {#each visibleMilkOptions as milk (milk.id)}
                  <button
                    class="p-2 rounded-md text-center {selectedMilkOptionId === milk.id
                      ? 'bg-accent text-white'
                      : milk.available
                        ? 'bg-white text-gray-800 border border-gray-200 hover:bg-primary'
                        : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed'}"
                    on:click={() => milk.available && (selectedMilkOptionId = milk.id)}
                    disabled={!milk.available}
                  >
                    {milk.name}
                    {#if !milk.available}
                      <div class="text-xs">(unavailable)</div>
                    {/if}
                  </button>
                {/each}
              </div>
            {/if}

            {#if selectedItem.allows_customizations}
              <h3 class="text-lg font-semibold mb-2">Customizations</h3>
              <div class="mb-4">
                {#each visibleCustomizationGroups as group (group.type)}
                  <p class="text-sm font-semibold text-gray-500 uppercase tracking-wide mt-3 mb-1">
                    {group.type}
                  </p>
                  <div class="space-y-2">
                    {#each group.options as customization (customization.id)}
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
                {/each}
              </div>
            {/if}
          </div>
          <div class="bg-gray-50 px-4 py-3 sm:flex sm:flex-row-reverse sm:px-6">
            <button
              type="button"
              on:click={() => handleAddToCart(selectedItem, true)}
              class="inline-flex w-full justify-center rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-accent sm:ml-3 sm:w-auto"
              disabled={milkRequired && selectedMilkOptionId === null}
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
