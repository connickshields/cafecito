<script>
  import Icons from "./Icons.svelte";
  import MenuRowEditor from "./MenuRowEditor.svelte";

  export let kind;
  export let title;
  export let addLabel;
  export let rows = [];
  export let milkOptions = [];
  export let customizationOptions = [];
  export let editingId = null;
  export let onEdit;
  export let onSave;
  export let onMove;
  export let onRestore;

  $: activeRows = rows.filter((row) => !row.archived);
  $: archivedRows = rows.filter((row) => row.archived);

  function detail(row) {
    if (kind === "items") return row.size ? `${row.size}oz` : "";
    if (kind === "customizations") return row.type;
    return "";
  }
</script>

<section class="bg-white rounded-lg shadow p-5 mb-6">
  <div class="flex justify-between items-center mb-3">
    <h2 class="font-semibold text-gray-900">{title}</h2>
    <button
      on:click={() => onEdit("new")}
      class="text-sm px-3 py-1 rounded-md bg-primary text-white hover:bg-accent"
    >
      + {addLabel}
    </button>
  </div>

  {#if activeRows.length === 0 && editingId !== "new"}
    <p class="text-sm text-gray-500 py-4">Nothing here yet.</p>
  {/if}

  <ul class="divide-y divide-gray-200">
    {#each activeRows as row, index (row.id)}
      <li class="py-2">
        {#if editingId === row.id}
          <MenuRowEditor
            {kind}
            {row}
            {milkOptions}
            {customizationOptions}
            onSave={(fields) => onSave(row.id, fields)}
            onArchive={() => onSave(row.id, { archived: true })}
            onCancel={() => onEdit(null)}
          />
        {:else}
          <div class="flex items-center justify-between">
            <div class="flex items-center min-w-0">
              <div class="flex flex-col mr-3">
                <button
                  on:click={() => onMove(row.id, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${row.name} up`}
                  class="text-gray-400 hover:text-gray-700 disabled:opacity-30 leading-none"
                >
                  ▲
                </button>
                <button
                  on:click={() => onMove(row.id, 1)}
                  disabled={index === activeRows.length - 1}
                  aria-label={`Move ${row.name} down`}
                  class="text-gray-400 hover:text-gray-700 disabled:opacity-30 leading-none"
                >
                  ▼
                </button>
              </div>
              <span class="truncate">{row.name}</span>
              {#if detail(row)}
                <span class="ml-2 text-sm text-gray-500">{detail(row)}</span>
              {/if}
            </div>

            <div class="flex items-center space-x-3 flex-shrink-0">
              <span
                class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full"
                class:bg-green-100={row.available}
                class:text-green-800={row.available}
                class:bg-red-100={!row.available}
                class:text-red-800={!row.available}
              >
                {row.available ? "Available" : "Unavailable"}
              </span>
              <button
                on:click={() => onEdit(row.id)}
                aria-label={`Edit ${row.name}`}
                class="text-gray-500 hover:text-gray-800"
              >
                <Icons name="settings" size={18} />
              </button>
            </div>
          </div>
        {/if}
      </li>
    {/each}
  </ul>

  {#if editingId === "new"}
    <div class="pt-3">
      <MenuRowEditor
        {kind}
        row={null}
        {milkOptions}
        {customizationOptions}
        onSave={(fields) => onSave(null, fields)}
        onCancel={() => onEdit(null)}
      />
    </div>
  {/if}

  {#if archivedRows.length > 0}
    <details class="mt-4">
      <summary class="text-sm text-gray-500 cursor-pointer">
        Archived ({archivedRows.length})
      </summary>
      <ul class="divide-y divide-gray-100 mt-2">
        {#each archivedRows as row (row.id)}
          <li class="flex items-center justify-between py-2 text-sm text-gray-500">
            <span class="truncate">{row.name}</span>
            <button
              on:click={() => onRestore(row.id)}
              class="text-gray-600 hover:text-gray-900 underline"
            >
              Restore
            </button>
          </li>
        {/each}
      </ul>
    </details>
  {/if}
</section>
