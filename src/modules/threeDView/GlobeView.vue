<!-- src/modules/threeDView/GlobeView.vue -->
<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import GlobeControls from "./GlobeControls.vue";
import { createGlobeAdapter, type GlobePort } from "./globeAdapter";

const containerId = "globe-container";
const globe = ref<GlobePort | null>(null);
const isReady = ref(false);

onMounted(async () => {
  console.log("[GlobeView] Mounting Cesium globe...");
  const el = document.getElementById(containerId) as HTMLDivElement;
  if (!el) {
    console.error("[GlobeView] Container element not found!");
    return;
  }

  globe.value = createGlobeAdapter();
  await globe.value.mount(el);
  isReady.value = true;
  console.log("[GlobeView] Globe successfully mounted.");
});

onBeforeUnmount(() => {
  if (globe.value) {
    globe.value.unmount();
    console.log("[GlobeView] Globe destroyed.");
    globe.value = null;
  }
});
</script>

<template>
  <div class="globe-view">
    <!-- Cesium render target -->
    <div :id="containerId" class="globe-container"></div>

    <!-- Overlayed controls -->
    <GlobeControls v-if="isReady && globe" :globe="globe" />
  </div>
</template>

<style scoped>
.globe-view {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000 !important;   /* ensure parent is dark */
}

.globe-container {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  background: #000 !important;   /* no blue backdrops */
  border-radius: 0 !important;   /* kill any circular crop */
}

.globe-container canvas {
  background: transparent !important;
  border-radius: 0 !important;
}
</style>
