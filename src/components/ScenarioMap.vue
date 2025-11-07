<script setup lang="ts">
import { ref, shallowRef } from "vue";
import MapContainer from "./MapContainer.vue";
import OLMap from "ol/Map";
import { useGeoStore } from "@/stores/geoStore";
import { useMapSettingsStore } from "@/stores/mapSettingsStore";
import type Select from "ol/interaction/Select";
import ScenarioMapLogic from "@/components/ScenarioMapLogic.vue";
import MapContextMenu from "@/components/MapContextMenu.vue";
import { useMapViewStore } from "@/stores/mapViewStore";
import View from "ol/View";
import { toLonLat } from "ol/proj";
import { get as getProj } from "ol/proj";

const emit = defineEmits<{
  (
    e: "map-ready",
    value: {
      olMap: OLMap;
      featureSelectInteraction: Select;
      unitSelectInteraction: Select;
    },
  ): void;
}>();

const mapLogicComponent = ref<InstanceType<typeof ScenarioMapLogic> | null>(null);
const mapSettings = useMapSettingsStore();
const mapViewStore = useMapViewStore();
const mapRef = shallowRef<OLMap>();
const geoStore = useGeoStore();

const onMapReady = (olMap: OLMap) => {
  mapRef.value = olMap;
  geoStore.olMap = olMap;
  (window as any).__olMap = olMap;
};

function onMoveEnd({ view }: { view: View }) {
    mapViewStore.zoomLevel = view.getZoom() ?? 0;

 // 👇 Cache a minimal camera payload the 3D side knows how to read
  try {
    const center = view.getCenter() ?? [0, 0];
    // Ensure we store in EPSG:3857 as expected by useGlobe.ts
    const proj = view.getProjection();
    let center3857: [number, number];
    if (proj && proj.getCode && proj.getCode() !== "EPSG:3857") {
      const merc = getProj("EPSG:3857");
      // @ts-ignore ol/proj overloads
      center3857 = (proj && merc) ? (proj.transform(center, merc) as [number, number]) : (center as [number, number]);
    } else {
      center3857 = center as [number, number];
    }
    const zoom = view.getZoom() ?? 2;
    const rotation = view.getRotation() ?? 0;
    (window as any).__scenario_camera = { center3857, zoom, rotation };
  } catch {}
}
</script>
<template>
  <div class="relative bg-white dark:bg-gray-900">
    <MapContextMenu :map-ref="mapRef" v-slot="{ onContextMenu }">
      <MapContainer
        @ready="onMapReady"
        @dragover.prevent
        :base-layer-name="mapSettings.baseLayerName"
        @contextmenu="onContextMenu"
        @moveend="onMoveEnd"
      />
    </MapContextMenu>

    <ScenarioMapLogic
      ref="mapLogicComponent"
      v-if="mapRef"
      :ol-map="mapRef"
      @map-ready="emit('map-ready', $event)"
    />
    <slot />
  </div>
</template>

<style>
.ol-scale-line {
  bottom: 2.2rem;
}
</style>
