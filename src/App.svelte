<script lang="ts">
  import { onMount } from "svelte";
  import CustomerView from "./lib/CustomerView.svelte";
  import BaristaView from "./lib/BaristaView.svelte";
  import BaristaLogin from "./lib/BaristaLogin.svelte";
  import Icons from "./lib/Icons.svelte";
  import {
    userSession,
    isBaristaUser,
    signInAnonymously,
    supabase,
  } from "./lib/supabase";

  let customerName = "";
  let submittedCustomerName = "";
  let showBaristaLogin = false;
  let loading = true;

  onMount(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session) {
      userSession.set(session);
    } else {
      await signInAnonymously();
    }
    loading = false;
  });

  function handleNameSubmit() {
    if (customerName.trim()) {
      submittedCustomerName = customerName.trim();
      customerName = "";
    }
  }

  function toggleBaristaLogin() {
    showBaristaLogin = !showBaristaLogin;
  }
</script>

<div class="min-h-screen bg-gray-100 flex flex-col">
  {#if loading}
    <p class="text-center mt-8">Loading...</p>
  {:else if showBaristaLogin}
    <BaristaLogin on:close={toggleBaristaLogin} />
  {:else if $userSession}
    {#if isBaristaUser($userSession.user)}
      <BaristaView />
    {:else if !submittedCustomerName}
      <div class="flex flex-col min-h-screen">
        <!-- Customer name input form -->
        <header class="bg-white shadow">
          <div class="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8 flex justify-center">
            <h1
              class="text-6xl font-bold text-primary font-display yesteryear-regular"
              style="-webkit-text-stroke: 8px #000; paint-order: stroke fill;"
            >
              Cafecito
            </h1>
          </div>
        </header>
        <div class="flex-grow flex items-center justify-center">
          <form
            on:submit|preventDefault={handleNameSubmit}
            class="space-y-4 bg-white shadow-md rounded px-8 pt-6 pb-8 mb-4 max-w-md w-full"
          >
            <h2 class="text-2xl font-bold text-center mb-4">Welcome!</h2>
            <div class="flex justify-center m-4">
              <Icons name="stylized-cup" size={100} color={"#93A8AC"} />
            </div>
            <input
              type="text"
              id="firstName"
              bind:value={customerName}
              placeholder="Enter your name"
              class="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
            <button
              type="submit"
              class="w-full bg-primary text-white px-4 py-2 rounded-md hover:bg-accent"
            >
              Start Order
            </button>
          </form>
        </div>
      </div>
      <button
        on:click={toggleBaristaLogin}
        class="fixed bottom-4 right-4 bg-gray-200 text-gray-700 p-2 rounded-full hover:bg-gray-300"
        aria-label="Barista Login"
      >
        <Icons name="person" size={24} />
      </button>
    {:else}
      <CustomerView customerName={submittedCustomerName} />
    {/if}
  {:else}
    <p class="text-center mt-8">Loading...</p>
  {/if}
</div>
