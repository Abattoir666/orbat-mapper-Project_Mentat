<template>
  <div class="bt-host">
    <!-- Contextual toolbar floats just above the main bar -->
    <div class="bt-context" v-if="currentToolbar">
      <ThreeDMeasurementToolbar v-if="currentToolbar === 'measurements'" />
      <ThreeDDrawToolbar v-else-if="currentToolbar === 'draw'" />
      <ThreeDUnitTrackToolbar v-else-if="currentToolbar === 'track'" />
    </div>

    <ThreeDMainToolbar
      :requestGlobeLocation="requestGlobeLocation"
      :cancelGlobeLocation="cancelGlobeLocation"
      @open-time-modal="$emit('open-time-modal')"
      @inc-day="$emit('inc-day')"
      @dec-day="$emit('dec-day')"
      @next-event="$emit('next-event')"
      @prev-event="$emit('prev-event')"
      @show-settings="$emit('show-settings')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useMainToolbarStore } from "@/stores/mainToolbarStore";

import ThreeDMainToolbar from "./ThreeDMainToolbar.vue";
import ThreeDMeasurementToolbar from "./ThreeDMeasurementToolbar.vue";
import ThreeDDrawToolbar from "./ThreeDDrawToolbar.vue";
import ThreeDUnitTrackToolbar from "./ThreeDUnitTrackToolbar.vue";

type Position = [number, number, number?];

defineProps<{
  requestGlobeLocation: (cb: (pos: Position) => void) => void;
  cancelGlobeLocation: () => void;
}>();

defineEmits([
  "open-time-modal",
  "inc-day",
  "dec-day",
  "next-event",
  "prev-event",
  "show-settings",
]);

const store = useMainToolbarStore();
const currentToolbar = computed(() => store.currentToolbar);
</script>

<style scoped>
.bt-host {
  position: fixed;
  /*
    IMPORTANT:
    This toolbar must stay ABOVE the timeline overlay.
    GlobeView sets CSS var --mentat-timeline-h to the measured timeline height.
  */
  left: 50%;
  bottom: calc(var(--mentat-timeline-h, 0px) + 10px);
  transform: translateX(-50%);
  pointer-events: none;
  z-index: 44;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}
.bt-context {
  pointer-events: auto;
}
</style>
