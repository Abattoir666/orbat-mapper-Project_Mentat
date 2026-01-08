<script setup lang="ts">
import UnderbarMeter from "./UnderbarMeter.vue";

const props = withDefaults(
  defineProps<{
    pct: number | null | undefined;
    hideWhenAtOrAbove?: number;

    /** Spacing classes only (e.g., mt-1). Do NOT pass w-/h-/rounded- here. */
    class?: string;
  }>(),
  {
    hideWhenAtOrAbove: 100,
    class: "mt-1",
  },
);
</script>

<template>
  <UnderbarMeter :pct="props.pct" :hide-when-at-or-above="props.hideWhenAtOrAbove" :class="props.class" />
</template>
