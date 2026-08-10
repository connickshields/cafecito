<script>
  import { onDestroy, onMount } from "svelte";
  import Icons from "./Icons.svelte";
  import MenuSection from "./MenuSection.svelte";
  import {
    createMenuEntry,
    getMenuForManagement,
    reorderMenuEntries,
    updateMenuEntry,
  } from "./api";

  export let onClose;

  const SECTIONS = [
    { kind: "items", title: "Drinks", addLabel: "Add drink", collection: "items" },
    { kind: "milk", title: "Milks", addLabel: "Add milk", collection: "milkOptions" },
    {
      kind: "customizations",
      title: "Customizations",
      addLabel: "Add customization",
      collection: "customizationOptions",
    },
  ];

  let menu = null;
  let loadFailed = false;
  let actionError = null;
  let errorTimeout;

  // One editor open at a time across all three sections: "<kind>" keyed to
  // either a row id or the string "new".
  let editingKind = null;
  let editingId = null;

  onMount(load);
  onDestroy(() => clearTimeout(errorTimeout));

  async function load() {
    try {
      menu = await getMenuForManagement();
      loadFailed = false;
    } catch (error) {
      console.error("Error loading menu:", error);
      loadFailed = true;
    }
  }

  function showError(message) {
    actionError = message;
    clearTimeout(errorTimeout);
    errorTimeout = setTimeout(() => (actionError = null), 4000);
  }

  function edit(kind, id) {
    editingKind = id === null ? null : kind;
    editingId = id;
  }

  async function save(kind, id, fields) {
    try {
      if (id === null) await createMenuEntry(kind, fields);
      else await updateMenuEntry(kind, id, fields);
      await load();
      edit(kind, null);
      return true;
    } catch (error) {
      console.error("Error saving menu entry:", error);
      showError(
        error.status === 409
          ? "That name is already in use."
          : "Couldn't save that — try again."
      );
      // The editor stays open so nothing typed is lost.
      return false;
    }
  }

  async function move(kind, collection, id, delta) {
    const ids = menu[collection].filter((row) => !row.archived).map((row) => row.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;

    [ids[from], ids[to]] = [ids[to], ids[from]];
    try {
      await reorderMenuEntries(kind, ids);
    } catch (error) {
      console.error("Error reordering menu:", error);
      showError("Couldn't reorder that — try again.");
    }
    // Reload either way: on failure this puts the list back to the truth.
    await load();
  }
</script>

<div class="fixed inset-0 z-40 overflow-y-auto bg-gray-100">
  <header class="bg-white shadow-sm">
    <div
      class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center"
    >
      <h1 class="text-xl font-semibold text-gray-900">Menu</h1>
      <button
        on:click={onClose}
        class="text-gray-600 hover:text-gray-900"
        aria-label="Close menu management"
      >
        <Icons name="close" size={24} />
      </button>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
    {#if loadFailed}
      <p class="text-center text-gray-600 py-16">
        Couldn't load the menu — check your connection and try again.
      </p>
    {:else if !menu}
      <p class="text-center text-gray-600 py-16">Loading menu…</p>
    {:else}
      {#each SECTIONS as section (section.kind)}
        <MenuSection
          kind={section.kind}
          title={section.title}
          addLabel={section.addLabel}
          rows={menu[section.collection]}
          milkOptions={menu.milkOptions.filter((row) => !row.archived)}
          customizationOptions={menu.customizationOptions.filter((row) => !row.archived)}
          editingId={editingKind === section.kind ? editingId : null}
          onEdit={(id) => edit(section.kind, id)}
          onSave={(id, fields) => save(section.kind, id, fields)}
          onMove={(id, delta) => move(section.kind, section.collection, id, delta)}
          onRestore={(id) => save(section.kind, id, { archived: false })}
        />
      {/each}
    {/if}
  </main>

  {#if actionError}
    <div class="fixed bottom-4 left-0 right-0 px-4 z-50">
      <div
        class="max-w-md mx-auto bg-red-100 border border-red-400 text-red-700 px-4 py-2 rounded-md text-center shadow"
      >
        {actionError}
      </div>
    </div>
  {/if}
</div>
