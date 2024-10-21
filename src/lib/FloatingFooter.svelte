<script lang="ts">
  import { fade, fly } from "svelte/transition";
  import { onMount, afterUpdate } from "svelte";
  import Icons from "./Icons.svelte";
  export let itemCount: number;
  export let onViewCart: () => void;
  export let onSubmitOrder: () => void;
  export let showCart: boolean;

  let prevItemCount = itemCount;

  onMount(() => {
    prevItemCount = itemCount;
  });

  afterUpdate(() => {
    if (prevItemCount > 0 && itemCount === 0 && showCart) {
      onViewCart();
    }
    prevItemCount = itemCount;
  });
</script>

<div class="fixed bottom-0 left-0 right-0 bg-white shadow-lg p-4">
  <div class="max-w-3xl mx-auto flex justify-between items-center">
    <span class="text-lg font-semibold">
      {itemCount} item{itemCount !== 1 ? "s" : ""}
    </span>
    <div class="flex space-x-4">
      {#if itemCount > 0}
        <div in:fly={{ y: 20, duration: 300 }} out:fade={{ duration: 200 }}>
          <button
            on:click={onViewCart}
            class="bg-neutral text-white px-4 py-2 rounded-md hover:bg-background flex items-center"
          >
            <span class="mr-2">
              <Icons name="cart" size={20} />
            </span>
            {showCart ? "Hide Cart" : "View Cart"}
          </button>
        </div>
        <div in:fly={{ y: 20, duration: 300 }} out:fade={{ duration: 200 }}>
          <button
            on:click={onSubmitOrder}
            class="bg-green-500 text-white px-4 py-2 rounded-md hover:bg-green-600 flex items-center"
          >
            <span class="mr-2"><Icons name="coffee-cup" size={20} /></span>
            Submit Order
          </button>
        </div>
      {/if}
    </div>
  </div>
</div>
