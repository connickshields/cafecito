<script>
  export let data = [];
  export let emptyMessage = "No data yet";

  const SERIES = "#2a78d6";

  $: max = Math.max(1, ...data.map((d) => d.value));
  $: hasData = data.some((d) => d.value > 0);
</script>

{#if !hasData}
  <p class="text-sm text-gray-500 py-12 text-center">{emptyMessage}</p>
{:else}
  <ul class="space-y-2">
    {#each data as row (row.label)}
      <li
        class="grid grid-cols-[9rem_1fr_3rem] items-center gap-3"
        title="{row.label}: {row.value}"
      >
        <span class="text-sm text-gray-700 truncate">{row.label}</span>
        <span class="h-3 rounded-r bg-gray-100 overflow-hidden">
          <span
            class="block h-full rounded-r"
            style="width: {(row.value / max) * 100}%; background-color: {SERIES};"
          ></span>
        </span>
        <span class="text-sm font-semibold text-gray-900 text-right tabular-nums">
          {row.value}
        </span>
      </li>
    {/each}
  </ul>

  <!-- Redundant with the visible rows above, but keeps a single, table-shaped
       access path consistent with BarChart's sr-only table. -->
  <table class="sr-only">
    <caption>Ranked data</caption>
    <thead>
      <tr>
        <th scope="col">Label</th>
        <th scope="col">Value</th>
      </tr>
    </thead>
    <tbody>
      {#each data as row (row.label)}
        <tr>
          <td>{row.label}</td>
          <td>{row.value}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
