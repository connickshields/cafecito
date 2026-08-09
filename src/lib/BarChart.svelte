<script>
  export let data = [];
  export let emptyMessage = "No data yet";
  export let labelEvery = 1;

  const SERIES = "#2a78d6";
  const WIDTH = 480;
  const HEIGHT = 190;
  const TOP = 10;
  const BASELINE = HEIGHT - 24; // leaves room for the x-axis labels
  const GAP = 2; // surface gap between adjacent bars

  let hovered = null;

  $: max = Math.max(1, ...data.map((d) => d.value));
  $: slot = data.length > 0 ? WIDTH / data.length : WIDTH;
  $: barWidth = Math.max(1, slot - GAP);
  $: hasData = data.some((d) => d.value > 0);

  function barHeight(value) {
    return (value / max) * (BASELINE - TOP);
  }

  // Rounded top corners only — the bottom stays flush with the baseline.
  function barPath(value, index) {
    const height = barHeight(value);
    if (height <= 0) return "";
    const x = index * slot + GAP / 2;
    const y = BASELINE - height;
    const r = Math.min(4, barWidth / 2, height);
    return `M ${x} ${BASELINE} L ${x} ${y + r} Q ${x} ${y} ${x + r} ${y} L ${x + barWidth - r} ${y} Q ${x + barWidth} ${y} ${x + barWidth} ${y + r} L ${x + barWidth} ${BASELINE} Z`;
  }
</script>

{#if !hasData}
  <p class="text-sm text-gray-500 py-12 text-center">{emptyMessage}</p>
{:else}
  <div class="relative">
    <svg
      viewBox="0 0 {WIDTH} {HEIGHT}"
      class="w-full h-auto"
      role="img"
      on:mouseleave={() => (hovered = null)}
    >
      <line
        x1="0"
        y1={BASELINE}
        x2={WIDTH}
        y2={BASELINE}
        stroke="#e5e7eb"
        stroke-width="1"
      />
      {#each data as point, index (point.label)}
        <path d={barPath(point.value, index)} fill={SERIES} />
        <!-- Full-height hit target, wider than the mark itself. Focusable so the
             tooltip is reachable via keyboard, matching the mouse hover behavior. -->
        <rect
          x={index * slot}
          y={TOP}
          width={slot}
          height={BASELINE - TOP}
          fill="transparent"
          role="img"
          tabindex="0"
          aria-label="{point.label}: {point.value}"
          on:mouseenter={() => (hovered = index)}
          on:focus={() => (hovered = index)}
          on:blur={() => (hovered = null)}
        />
        {#if index % labelEvery === 0}
          <text
            x={index * slot + slot / 2}
            y={HEIGHT - 6}
            text-anchor="middle"
            font-size="11"
            fill="#6b7280"
          >
            {point.label}
          </text>
        {/if}
      {/each}
    </svg>

    {#if hovered !== null}
      <!-- Percentage positioning below assumes the svg's viewBox maps linearly onto its
           rendered box: keep the default preserveAspectRatio and the w-full h-auto sizing
           above, and don't add wrapper padding or a sibling element, or the tooltip will
           be misaligned. -->
      <div
        class="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded bg-gray-900 px-2 py-1 text-xs text-white whitespace-nowrap shadow"
        style="left: {((hovered * slot + slot / 2) / WIDTH) * 100}%; top: {((BASELINE - barHeight(data[hovered].value) - 6) / HEIGHT) * 100}%;"
      >
        {data[hovered].label}: {data[hovered].value}
      </div>
    {/if}
  </div>
{/if}
