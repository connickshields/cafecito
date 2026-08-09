<script>
  import { fade } from "svelte/transition";

  let dismissed = false;
</script>

{#if !dismissed}
  <div
    role="status"
    transition:fade
    class="relative bg-amber-50 border border-amber-200 rounded-md shadow-sm px-10 py-2 text-center text-amber-900"
  >
    Heads up — orders may be slower than usual today. Your barista has a hangover. 🙃
    <button
      type="button"
      aria-label="Dismiss"
      on:click={() => (dismissed = true)}
      class="absolute right-1 top-1/2 -translate-y-1/2 leading-none text-2xl px-2 pb-1 rounded text-amber-700 hover:text-amber-900 hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-400"
    >
      ×
    </button>
  </div>
{/if}
