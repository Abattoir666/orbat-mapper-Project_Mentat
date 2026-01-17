<template>
  <FloatingPanel class="bt-glass pointer-events-auto flex items-center space-x-0 rounded-md p-1">
    <p class="text-muted-foreground hidden px-2 text-sm font-medium sm:block">Draw</p>
    <div class="border-border mr-2 h-5 border-l" />

    <MainToolbarButton title="Select" :active="!currentDrawType" @click="cancel()">
      <SelectIcon class="size-5" />
    </MainToolbarButton>

    <MainToolbarButton
      title="Point"
      @click="startDrawing('Point')"
      :active="currentDrawType === 'Point'"
    >
      <PointIcon class="size-5" />
    </MainToolbarButton>

    <MainToolbarButton
      title="Line"
      @click="startDrawing('LineString')"
      :active="currentDrawType === 'LineString'"
    >
      <LineStringIcon class="size-5" />
    </MainToolbarButton>

    <MainToolbarButton
      title="Polygon"
      @click="startDrawing('Polygon')"
      :active="currentDrawType === 'Polygon'"
    >
      <PolygonIcon class="size-5" />
    </MainToolbarButton>

    <MainToolbarButton
      title="Circle"
      @click="startDrawing('Circle')"
      :active="currentDrawType === 'Circle'"
    >
      <CircleIcon class="size-5" />
    </MainToolbarButton>

    <div class="mx-2 h-5 border-l border-gray-300" />

    <div class="flex items-center">
      <MainToolbarButton title="Snap to grid" @click="snap = !snap" :active="snap">
        <SnapIcon class="size-5" />
      </MainToolbarButton>
      <MainToolbarButton title="Edit" @click="isModifying = !isModifying" :active="isModifying">
        <EditIcon class="size-5" />
      </MainToolbarButton>
      <MainToolbarButton title="Modify feature history" @click="modifyHistory = !modifyHistory" :active="modifyHistory">
        <IconClockEdit class="size-5" />
      </MainToolbarButton>
      <MainToolbarButton title="translate" @click="translate = !translate" :active="translate">
        <MoveIcon class="size-5" />
      </MainToolbarButton>
      <MainToolbarButton
        title="Delete"
        :disabled="selectedFeatureIds.size === 0"
        @click="onFeatureDelete()"
      >
        <DeleteIcon class="size-5" />
      </MainToolbarButton>
    </div>

    <div class="bt-note hidden sm:block">3D draw/edit tools not wired yet</div>

    <MainToolbarButton title="Toggle toolbar" @click="store.clearToolbar()">
      <CloseIcon class="size-5" />
    </MainToolbarButton>
  </FloatingPanel>
</template>

<script setup lang="ts">
import {
  IconClose as CloseIcon,
  IconCursorDefaultOutline as SelectIcon,
  IconCursorMove as MoveIcon,
  IconMagnet as SnapIcon,
  IconMapMarker as PointIcon,
  IconSquareEditOutline as EditIcon,
  IconTrashCanOutline as DeleteIcon,
  IconVectorCircleVariant as CircleIcon,
  IconVectorLine as LineStringIcon,
  IconVectorSquare as PolygonIcon,
  IconClockEditOutline as IconClockEdit,
} from "@iconify-prerendered/vue-mdi";
import FloatingPanel from "@/components/FloatingPanel.vue";
import MainToolbarButton from "@/components/MainToolbarButton.vue";

import { ref } from "vue";
import { useMainToolbarStore } from "@/stores/mainToolbarStore";
import { injectStrict } from "@/utils";
import { activeScenarioKey } from "@/components/injects";
import { useSelectedItems } from "@/stores/selectedStore";

const store = useMainToolbarStore();
const { selectedFeatureIds } = useSelectedItems();

const { store: scenarioStore, geo } = injectStrict(activeScenarioKey);

const currentDrawType = ref<null | "Point" | "LineString" | "Polygon" | "Circle">(null);
const snap = ref(true);
const translate = ref(false);
const modifyHistory = ref(false);
const isModifying = ref(false);

function startDrawing(t: "Point" | "LineString" | "Polygon" | "Circle") {
  currentDrawType.value = t;
  // Actual Cesium drawing/editing will be wired in a later pass.
}

function cancel() {
  currentDrawType.value = null;
  isModifying.value = false;
  translate.value = false;
}

function onFeatureDelete() {
  try {
    scenarioStore.groupUpdate(() => {
      [...selectedFeatureIds.value.values()].forEach((featureId) => geo.deleteFeature(featureId));
    });
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
