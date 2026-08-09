<script>
  import { onMount } from "svelte";
  import BarChart from "./BarChart.svelte";
  import Icons from "./Icons.svelte";
  import RankedBars from "./RankedBars.svelte";
  import { computeAnalytics, formatDuration } from "./analytics";
  import { getOrders } from "./supabase";

  export let onClose;

  let stats = null;
  let loadFailed = false;

  onMount(async () => {
    try {
      stats = computeAnalytics(await getOrders());
    } catch (error) {
      console.error("Error loading analytics:", error);
      loadFailed = true;
    }
  });

  $: tiles = stats
    ? [
        { label: "Total orders", value: String(stats.totals.orders) },
        { label: "Completed", value: String(stats.totals.completed) },
        {
          label: "Cancelled",
          value: `${stats.totals.cancelled} (${Math.round(stats.totals.cancelRate * 100)}%)`,
        },
        { label: "Drinks made", value: String(stats.totals.drinks) },
        { label: "Median time", value: formatDuration(stats.fulfillment.medianMs) },
        { label: "p90 time", value: formatDuration(stats.fulfillment.p90Ms) },
      ]
    : [];
</script>

<div class="fixed inset-0 z-40 overflow-y-auto bg-gray-100">
  <header class="bg-white shadow-sm">
    <div
      class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center"
    >
      <h1 class="text-xl font-semibold text-gray-900">Analytics</h1>
      <button
        on:click={onClose}
        class="text-gray-600 hover:text-gray-900"
        aria-label="Close analytics"
      >
        <Icons name="close" size={24} />
      </button>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
    {#if loadFailed}
      <p class="text-center text-gray-600 py-16">
        Couldn't load analytics — check your connection and try again.
      </p>
    {:else if !stats}
      <p class="text-center text-gray-600 py-16">Loading analytics…</p>
    {:else}
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {#each tiles as tile (tile.label)}
          <div class="bg-white rounded-lg shadow p-4">
            <p class="text-2xl font-bold text-gray-900 tabular-nums">{tile.value}</p>
            <p class="text-sm text-gray-500 mt-1">{tile.label}</p>
          </div>
        {/each}
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section class="bg-white rounded-lg shadow p-5 lg:col-span-2">
          <h2 class="font-semibold text-gray-900">Orders by hour of day</h2>
          <p class="text-sm text-gray-500 mb-3">All orders</p>
          <BarChart
            data={stats.ordersByHour}
            labelEvery={3}
            emptyMessage="No orders yet"
            caption="Orders by hour of day"
          />
        </section>

        <section class="bg-white rounded-lg shadow p-5">
          <h2 class="font-semibold text-gray-900">Fulfillment time</h2>
          <p class="text-sm text-gray-500 mb-3">
            Completed orders · {stats.fulfillment.count} measured
          </p>
          <BarChart
            data={stats.fulfillmentHistogram}
            emptyMessage="No completed orders yet"
            caption="Fulfillment time"
          />
        </section>

        <section class="bg-white rounded-lg shadow p-5">
          <h2 class="font-semibold text-gray-900">Orders by day of week</h2>
          <p class="text-sm text-gray-500 mb-3">All orders</p>
          <BarChart
            data={stats.ordersByDayOfWeek}
            emptyMessage="No orders yet"
            caption="Orders by day of week"
          />
        </section>

        <section class="bg-white rounded-lg shadow p-5">
          <h2 class="font-semibold text-gray-900">Popular drinks</h2>
          <p class="text-sm text-gray-500 mb-3">Completed orders</p>
          <RankedBars
            data={stats.drinks}
            emptyMessage="No completed orders yet"
            caption="Popular drinks"
          />
        </section>

        <section class="bg-white rounded-lg shadow p-5">
          <h2 class="font-semibold text-gray-900">Milk split</h2>
          <p class="text-sm text-gray-500 mb-3">Completed orders</p>
          <RankedBars
            data={stats.milk}
            emptyMessage="No completed orders yet"
            caption="Milk split"
          />
        </section>

        <section class="bg-white rounded-lg shadow p-5 lg:col-span-2">
          <h2 class="font-semibold text-gray-900">Customizations</h2>
          <p class="text-sm text-gray-500 mb-3">Completed orders</p>
          <RankedBars
            data={stats.customizations}
            emptyMessage="No customizations yet"
            caption="Customizations"
          />
        </section>
      </div>
    {/if}
  </main>
</div>
