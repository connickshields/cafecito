<script>
  import { groupByType } from "./menuGrouping";

  export let kind;
  export let row = null;
  export let milkOptions = [];
  export let customizationOptions = [];
  export let onSave;
  export let onArchive = null;
  export let onCancel;

  let name = row?.name ?? "";
  let description = row?.description ?? "";
  let size = row?.size ?? null;
  let type = row?.type ?? "";
  let available = row?.available ?? true;
  let milkIds = [...(row?.milkOptionIds ?? [])];
  let customizationIds = [...(row?.customizationOptionIds ?? [])];
  let saving = false;

  $: customizationGroups = groupByType(customizationOptions);
  $: knownTypes = [...new Set(customizationOptions.map((option) => option.type))];

  function toggle(list, id) {
    return list.includes(id) ? list.filter((each) => each !== id) : [...list, id];
  }

  function fields() {
    if (kind === "milk") return { name, available };
    if (kind === "customizations") return { name, type, available };
    return {
      name,
      description,
      // An empty size input means "no size badge", which the API spells null.
      size: size === "" || size === null ? null : Number(size),
      available,
      milkOptionIds: milkIds,
      customizationOptionIds: customizationIds,
    };
  }

  async function handleSubmit() {
    saving = true;
    // A false result means the save failed; the parent has shown the error and
    // this editor stays open so nothing typed is lost.
    await onSave(fields());
    saving = false;
  }
</script>

<form
  on:submit|preventDefault={handleSubmit}
  class="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3"
>
  <label class="block">
    <span class="text-sm font-medium text-gray-700">Name</span>
    <input
      bind:value={name}
      required
      maxlength="60"
      class="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
    />
  </label>

  {#if kind === "items"}
    <label class="block">
      <span class="text-sm font-medium text-gray-700">Description</span>
      <textarea
        bind:value={description}
        rows="2"
        maxlength="200"
        class="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
      ></textarea>
    </label>

    <label class="block">
      <span class="text-sm font-medium text-gray-700">Size (oz)</span>
      <input
        type="number"
        bind:value={size}
        min="1"
        max="64"
        placeholder="none"
        class="mt-1 w-32 px-3 py-2 border border-gray-300 rounded-md"
      />
    </label>
  {/if}

  {#if kind === "customizations"}
    <label class="block">
      <span class="text-sm font-medium text-gray-700">Heading</span>
      <input
        bind:value={type}
        required
        maxlength="30"
        list="customization-types"
        class="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md"
      />
      <datalist id="customization-types">
        {#each knownTypes as knownType}
          <option value={knownType}></option>
        {/each}
      </datalist>
      <span class="text-xs text-gray-500"
        >Shown as the heading above this option on the customer menu.</span
      >
    </label>
  {/if}

  <label class="flex items-center">
    <input type="checkbox" bind:checked={available} class="mr-2" />
    <span class="text-sm font-medium text-gray-700">Available</span>
  </label>

  {#if kind === "items"}
    <fieldset>
      <legend class="text-sm font-medium text-gray-700">Milk options</legend>
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-1 mt-1">
        {#each milkOptions as milk (milk.id)}
          <label class="flex items-center text-sm">
            <input
              type="checkbox"
              checked={milkIds.includes(milk.id)}
              on:change={() => (milkIds = toggle(milkIds, milk.id))}
              class="mr-2"
            />
            {milk.name}
          </label>
        {/each}
      </div>
      <p class="text-xs text-gray-500 mt-1">
        Leave every box unchecked for a drink that takes no milk.
      </p>
    </fieldset>

    <fieldset>
      <legend class="text-sm font-medium text-gray-700">Customizations</legend>
      {#each customizationGroups as group (group.type)}
        <p class="text-xs uppercase tracking-wide text-gray-500 mt-2">{group.type}</p>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-1">
          {#each group.options as option (option.id)}
            <label class="flex items-center text-sm">
              <input
                type="checkbox"
                checked={customizationIds.includes(option.id)}
                on:change={() => (customizationIds = toggle(customizationIds, option.id))}
                class="mr-2"
              />
              {option.name}
            </label>
          {/each}
        </div>
      {/each}
    </fieldset>
  {/if}

  <div class="flex items-center justify-between pt-2">
    <div>
      {#if row}
        <button
          type="button"
          on:click={onArchive}
          class="text-sm text-red-600 hover:text-red-800"
        >
          Archive
        </button>
      {/if}
    </div>
    <div class="flex space-x-2">
      <button
        type="button"
        on:click={onCancel}
        class="px-3 py-2 text-sm rounded-md border border-gray-300 hover:bg-gray-100"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={saving}
        class="px-3 py-2 text-sm rounded-md bg-primary text-white hover:bg-accent disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  </div>
</form>
