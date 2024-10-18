<script lang="ts">
  export let itemCount: number;
  export let onViewCart: () => void;
  export let onSubmitOrder: () => void;
  export let showCart: boolean;
</script>

<div class="fixed bottom-0 left-0 right-0 bg-white shadow-lg p-4">
  <div class="max-w-3xl mx-auto flex justify-between items-center">
    <span class="text-lg font-semibold">
      {itemCount} item{itemCount !== 1 ? "s" : ""}
    </span>
    <div class="flex space-x-4">
      <button
        on:click={onViewCart}
        class="bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600"
      >
        {showCart ? "Hide Cart" : "View Cart"}
      </button>
      <button
        on:click={onSubmitOrder}
        class="bg-green-500 text-white px-4 py-2 rounded-md hover:bg-green-600"
      >
        Submit Order
      </button>
    </div>
  </div>
</div>
