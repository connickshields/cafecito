<script lang="ts">
  export let name: "cart" | "coffee-bean" | "coffee-cup";
  export let size = 24;
</script>

{#if name === "cart"}
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle cx="9" cy="21" r="1"></circle>
    <circle cx="20" cy="21" r="1"></circle>
    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
  </svg>
{:else if name === "coffee-bean"}
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M12 3C7.5 3 4 7.5 4 12s3.5 9 8 9c3.5 0 6.5-2.5 7.5-6"></path>
    <path d="M12 21c4.5 0 8-4.5 8-9s-3.5-9-8-9c-3.5 0-6.5 2.5-7.5 6"></path>
    <path d="M7 12c0-2.8 2.2-5 5-5"></path>
    <path d="M17 12c0 2.8-2.2 5-5 5"></path>
  </svg>
{:else if name === "coffee-cup"}
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M18 8h1a4 4 0 0 1 0 8h-1"></path>
    <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"></path>
    <line x1="6" y1="1" x2="6" y2="4"></line>
    <line x1="10" y1="1" x2="10" y2="4"></line>
    <line x1="14" y1="1" x2="14" y2="4"></line>
  </svg>
{/if}
