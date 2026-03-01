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

<div class="fixed bottom-0 left-0 right-0 bg-parchment/85 backdrop-blur-md shadow-lg p-4 border-t border-amber-100">
  <div class="max-w-3xl mx-auto flex justify-between items-center">
    <span class="text-base font-body font-semibold text-espresso">
      {itemCount} item{itemCount !== 1 ? "s" : ""}
    </span>
    <div class="flex space-x-4">
      {#if itemCount > 0}
        <div in:fly={{ y: 20, duration: 300 }} out:fade={{ duration: 200 }}>
          <button
            on:click={onViewCart}
            class="border-2 border-background/40 text-espresso font-body font-semibold px-4 py-2 rounded-full hover:border-background flex items-center"
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
            class="bg-primary text-espresso font-body font-semibold px-4 py-2 rounded-full hover:bg-accent flex items-center"
          >
            <span class="mr-2"><Icons name="coffee-cup" size={20} /></span>
            Submit Order
          </button>
        </div>
      {/if}
    </div>
  </div>
</div>
