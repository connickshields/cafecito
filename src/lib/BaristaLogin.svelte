<script lang="ts">
  import { createEventDispatcher } from "svelte";
  import { signIn } from "./supabase";

  const dispatch = createEventDispatcher();

  let email = "";
  let password = "";
  let error = null;

  async function handleSubmit() {
    try {
      await signIn(email, password);
      dispatch("close");
    } catch (e) {
      error = e.message;
    }
  }

  function handleClose() {
    dispatch("close");
  }
</script>

<div
  class="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full flex items-center justify-center"
>
  <div class="bg-white p-8 rounded-lg shadow-xl w-96 relative">
    <button
      on:click={handleClose}
      class="absolute top-2 right-2 text-gray-500 hover:text-gray-700"
      aria-label="Close"
    >
      <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M6 18L18 6M6 6l12 12"
        />
      </svg>
    </button>
    <h2 class="text-2xl font-bold mb-4">Barista Login</h2>
    <form on:submit|preventDefault={handleSubmit} class="space-y-4">
      <input
        type="email"
        bind:value={email}
        placeholder="Email"
        required
        class="w-full px-3 py-2 border border-gray-300 rounded-md"
      />
      <input
        type="password"
        bind:value={password}
        placeholder="Password"
        required
        class="w-full px-3 py-2 border border-gray-300 rounded-md"
      />
      <button
        type="submit"
        class="w-full bg-blue-500 text-white py-2 rounded-md hover:bg-blue-600"
      >
        Sign In
      </button>
    </form>
    {#if error}
      <p class="text-red-500 mt-2">{error}</p>
    {/if}
  </div>
</div>
