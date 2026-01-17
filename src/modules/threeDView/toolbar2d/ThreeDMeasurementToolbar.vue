<template>
  <FloatingPanel class="bt-glass pointer-events-auto flex items-center space-x-0.5 rounded-md p-1">
    <p class="text-muted-foreground px-2 text-sm font-medium">Measure</p>

    <MainToolbarButton
      title="Length"
      @click="measurementType = 'LineString'"
      :active="measurementType === 'LineString'"
    >
      <LengthIcon class="size-5" />
    </MainToolbarButton>

    <MainToolbarButton
      title="Area"
      @click="measurementType = 'Polygon'"
      :active="measurementType === 'Polygon'"
    >
      <AreaIcon class="size-5" />
    </MainToolbarButton>

    <div class="h-5 border-l border-gray-300" />

    <MainToolbarButton
      title="Show segment lengths"
      @click="showSegments = !showSegments"
      :active="showSegments"
    >
      <ShowSegmentsIcon class="size-5" />
    </MainToolbarButton>

    <MainToolbarButton
      title="Show multiple measurements"
      @click="clearPrevious = !clearPrevious"
      :active="!clearPrevious"
    >
      <ShowMultipleIcon class="size-5" />
    </MainToolbarButton>

    <MainToolbarButton
      title="Show range circle"
      @click="showCircle = !showCircle"
      :active="showCircle"
    >
      <ShowCircleIcon class="size-5" />
    </MainToolbarButton>

    <MainToolbarButton title="Toggle snapping" @click="snap = !snap" :active="snap">
      <SnapIcon class="size-5" />
    </MainToolbarButton>

    <MainToolbarButton title="Clear measurements" @click="clearMeasurements()">
      <TrashIcon class="size-5" />
    </MainToolbarButton>

    <div class="bt-note hidden sm:block">
      3D measurement primitives not wired yet
    </div>

    <MainToolbarButton title="Toggle toolbar" @click="store.clearToolbar()">
      <CloseIcon class="size-5" />
    </MainToolbarButton>
  </FloatingPanel>
</template>

<script setup lang="ts">
import {
  IconClose as CloseIcon,
  IconMagnet as SnapIcon,
  IconMapMarkerDistance as ShowSegmentsIcon,
  IconSelectionEllipse as ShowCircleIcon,
  IconSelectMultipleMarker as ShowMultipleIcon,
  IconTrashCanOutline as TrashIcon,
  IconVectorLine as LengthIcon,
  IconVectorSquare as AreaIcon,
} from "@iconify-prerendered/vue-mdi";
import FloatingPanel from "@/components/FloatingPanel.vue";
import MainToolbarButton from "@/components/MainToolbarButton.vue";
import { useMainToolbarStore } from "@/stores/mainToolbarStore";
import { storeToRefs } from "pinia";
import { useMeasurementsStore } from "@/stores/geoStore";

const store = useMainToolbarStore();
const measureStore = useMeasurementsStore();
const {
  showSegments,
  clearPrevious,
  measurementType,
  measurementUnit,
  snap,
  showCircle,
} = storeToRefs(measureStore);

function clearMeasurements() {
  try {
    (measureStore as any).clear?.();
    // if no explicit clear(), just reset a few toggles so UI reflects "empty"
    showCircle.value = false;
    showSegments.value = true;
  } catch {
    // ignore
  }
}
</script>

<style scoped>
.bt-glass {
  background: rgba(0, 0, 0, 0.55) !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  backdrop-filter: blur(10px);
}
.bt-note {
  margin-left: 10px;
  padding: 0 8px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.10);
  background: rgba(0, 0, 0, 0.35);
  color: rgba(255, 255, 255, 0.75);
  font-size: 12px;
}
</style>
