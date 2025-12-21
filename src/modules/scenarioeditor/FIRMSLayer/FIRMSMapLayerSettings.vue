<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { getChangedValues } from "@/utils";
import DescriptionItem from "@/components/DescriptionItem.vue";
import { Button } from "@/components/ui/button";
import FIRMSMapLayerSettingsForm from "@/modules/scenarioeditor/FIRMSLayer/FIRMSMapLayerSettingsForm.vue";

import type { ScenarioFIRMSLayer } from "@/types/scenarioGeoModels";

interface Props {
  layer: ScenarioFIRMSLayer;
}
const props = defineProps<Props>();
const emit = defineEmits<{
  (e: "update", patch: Partial<ScenarioFIRMSLayer>): void;
}>();

const editMode = ref(false);

// Close edit view if we switch to a different layer instance.
watch(
  () => props.layer?.id,
  () => {
    editMode.value = false;
  },
);

const defaultEndpoint = "https://firms.modaps.eosdis.nasa.gov/api/area/csv";

const apiUrl = computed(() => {
  const u = (props.layer.url ?? "").trim();
  return u || defaultEndpoint;
});

const mapKey = computed(() => {
  const k = (props.layer.mapKey ?? "").trim();
  if (!k) return "Not set";
  if (k.length <= 8) return "********";
  return `${k.slice(0, 4)}...${k.slice(-4)}`;
});

const areaMode = computed(() => {
  const m = (props.layer as any).areaMode ?? "bbox";
  if (m === "world") return "World";
  if (m === "countries") return "Countries";
  return "Bounding box";
});

const countriesCount = computed(() => (props.layer.countryFiles?.length ?? 0));
const clipEnabled = computed(() => !!(props.layer as any).clipToCountries);

const cacheEnabled = computed(() => ((props.layer as any).cacheEnabled ?? true) !== false);
const cacheBackDays = computed(() => Number((props.layer as any).cacheBackDays ?? 0));
const cacheForwardDays = computed(() => Number((props.layer as any).cacheForwardDays ?? 0));
const maxCachedDays = computed(() => Number((props.layer as any).maxCachedDays ?? 60));

function updateData(nextLayer: any) {
  // Settings form typically emits a full layer-like object. We emit only changed values.
  const diff = getChangedValues({ ...nextLayer }, props.layer);
  editMode.value = false;
  emit("update", diff);
}

const status = computed(() => (props.layer as any)._status as string | undefined);
</script>

<template>
  <section class="space-y-2">
    <header class="flex justify-end">
      <span class="badge">FIRMS</span>
    </header>

    <FIRMSMapLayerSettingsForm
      v-if="editMode"
      :key="layer.id"
      :layer="layer"
      @cancel="editMode = false"
      @update="updateData"
    />

    <div v-else>
      <DescriptionItem label="Endpoint" dd-class="truncate">{{ apiUrl }}</DescriptionItem>
      <DescriptionItem label="MAP_KEY" dd-class="truncate">{{ mapKey }}</DescriptionItem>
      <DescriptionItem label="Source">{{ layer.source || "Not set" }}</DescriptionItem>

      <DescriptionItem label="Area mode">{{ areaMode }}</DescriptionItem>

      <DescriptionItem label="Area" dd-class="truncate">
        {{ layer.area || "Not set" }}
      </DescriptionItem>

      <template v-if="(layer as any).areaMode === 'countries'">
        <DescriptionItem label="Countries selected">{{ countriesCount }}</DescriptionItem>
        <DescriptionItem label="Clip to borders">{{ clipEnabled ? "Yes" : "No" }}</DescriptionItem>
      </template>

      <DescriptionItem label="Time mode">{{ layer.timeMode || "hour" }}</DescriptionItem>

      <template v-if="layer.timeMode === 'window'">
        <DescriptionItem label="Window back (hours)">{{ layer.windowBackHours ?? 0 }}</DescriptionItem>
        <DescriptionItem label="Window forward (hours)">{{ layer.windowForwardHours ?? 0 }}</DescriptionItem>
      </template>

      <DescriptionItem label="Max detections">{{ layer.maxDetections ?? 50000 }}</DescriptionItem>
      <DescriptionItem label="Point radius">{{ layer.pointRadius ?? 4 }}</DescriptionItem>

      <hr class="my-3" />

      <DescriptionItem label="Caching/prefetch">{{ cacheEnabled ? "Enabled" : "Disabled" }}</DescriptionItem>
      <DescriptionItem label="Cache back (days)">{{ cacheBackDays }}</DescriptionItem>
      <DescriptionItem label="Cache forward (days)">{{ cacheForwardDays }}</DescriptionItem>
      <DescriptionItem label="Max cached days (LRU)">{{ maxCachedDays }}</DescriptionItem>

      <p v-if="status === 'loading'" class="mt-2 text-sm text-gray-500">
        Loading FIRMS detections...
      </p>
      <p v-else-if="status === 'error'" class="mt-2 text-sm text-red-600">
        Error loading FIRMS detections. Enable debug and check the console.
      </p>
      <p v-else-if="status === 'uninitialized'" class="mt-2 text-sm text-gray-500">
        Set MAP_KEY + area + source to enable FIRMS rendering.
      </p>
      <p v-else-if="status === 'initialized'" class="mt-2 text-sm text-green-700">
        FIRMS layer initialized.
      </p>

      <p class="mt-2 text-xs text-gray-500">
        Debug: set <span class="font-mono">localStorage.setItem("orbat.firms.debug","1")</span> then reload.
      </p>

      <footer class="mt-4 flex justify-end space-x-2">
        <Button variant="outline" size="sm" @click="editMode = true">Edit</Button>
      </footer>
    </div>
  </section>
</template>
