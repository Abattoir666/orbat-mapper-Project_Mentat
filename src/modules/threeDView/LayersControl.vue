<!-- src/modules/threeDView/LayersControl.vue -->
<template>
  <div class="layersctl">
    <div class="row">
      <label class="hdr">Base layer</label>
      <select v-model="selectedBase" @change="onBaseChanged">
        <option v-for="b in baseLayers" :key="b.id" :value="b.id">{{ b.title || b.name || b.id }}</option>
      </select>
    </div>

    <div class="row">
      <label class="hdr">Overlays</label>
      <div class="list">
        <div v-for="o in overlays" :key="o.id" class="ov">
          <label>
            <input type="checkbox" v-model="overlayState[o.id].on" @change="onToggle(o)" />
            {{ o.title || o.name || o.id }}
          </label>
          <input
            v-model.number="overlayState[o.id].alpha"
            type="range" min="0" max="1" step="0.05"
            :disabled="!overlayState[o.id].on"
            @input="onAlpha(o)"
            title="Opacity"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";

/** Expecting the same shape your 2D uses; we only rely on generic fields. */
type LayerCfg = {
  id?: string;
  name?: string;
  title?: string;
  url?: string;
  layerType?: string;     // "baselayer" or overlay (anything else)
  type?: string;          // e.g., 'XYZ', 'OSM', etc.
  geographic?: boolean;
  subdomains?: string[] | string;
  minLevel?: number;
  maxLevel?: number;
  attribution?: string;
  alpha?: number;
};

type GlobePort = {
  setBaseLayerTemplate: (url: string, opts?: any) => void;
  addOverlayTemplate: (id: string, url: string, opts?: any) => void;
  removeOverlay: (id: string) => void;
  setOverlayVisibility: (id: string, show: boolean) => void;
  setOverlayAlpha: (id: string, alpha: number) => void;
};

const props = defineProps<{ globe: GlobePort }>();

const raw = ref<LayerCfg[]>([]);
const baseLayers = ref<LayerCfg[]>([]);
const overlays = ref<LayerCfg[]>([]);
const selectedBase = ref<string>("");

const overlayState = reactive<Record<string, { on: boolean; alpha: number }>>({});

function splitLayers(arr: LayerCfg[]) {
  const bases: LayerCfg[] = [];
  const overs: LayerCfg[] = [];
  for (const l of arr) {
    const lt = (l.layerType ?? "").toLowerCase();
    if (lt === "baselayer") bases.push(l);
    else overs.push(l);
  }
  return { bases, overs };
}

function toId(l: LayerCfg, fallbackIndex: number) {
  return l.id || l.name || l.title || `layer_${fallbackIndex}`;
}

async function loadConfig() {
  try {
    const res = await fetch("/config/mapConfig.json");
    const json = (await res.json()) as any[];
    raw.value = Array.isArray(json) ? json : [];
  } catch (e) {
    console.error("[LayersControl] Failed to fetch /config/mapConfig.json", e);
    raw.value = [];
  }

  const { bases, overs } = splitLayers(raw.value);
  // Normalize IDs
  baseLayers.value = bases.map((l, i) => ({ ...l, id: toId(l, i) }));
  overlays.value = overs.map((l, i) => ({ ...l, id: toId(l, i) }));

  // Choose first base by default (if any)
  if (baseLayers.value.length && !selectedBase.value) {
    selectedBase.value = baseLayers.value[0].id!;
    await applyBaseById(selectedBase.value);
  }

  // Initialize overlay state
  overlays.value.forEach((o) => {
    const a = typeof o.alpha === "number" ? Math.min(1, Math.max(0, o.alpha)) : 1;
    overlayState[o.id!] = { on: false, alpha: a };
  });
}

async function applyBaseById(id: string) {
  const b = baseLayers.value.find((x) => x.id === id);
  if (!b || !b.url) return;
  props.globe.setBaseLayerTemplate(b.url, {
    minLevel: b.minLevel,
    maxLevel: b.maxLevel,
    attribution: b.attribution,
    geographic: !!b.geographic,
    subdomains: b.subdomains,
  });
}

function onBaseChanged() {
  applyBaseById(selectedBase.value);
}

function onToggle(o: LayerCfg) {
  const st = overlayState[o.id!];
  if (!o.url) return;

  if (st.on) {
    // add or show overlay
    props.globe.addOverlayTemplate(o.id!, o.url, {
      minLevel: o.minLevel,
      maxLevel: o.maxLevel,
      attribution: o.attribution,
      geographic: !!o.geographic,
      subdomains: o.subdomains,
      alpha: st.alpha,
    });
    props.globe.setOverlayVisibility(o.id!, true);
  } else {
    props.globe.setOverlayVisibility(o.id!, false);
  }
}

function onAlpha(o: LayerCfg) {
  const st = overlayState[o.id!];
  props.globe.setOverlayAlpha(o.id!, st.alpha);
}

onMounted(loadConfig);
</script>

<style scoped>
.layersctl {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 9999;         /* <<< ensure on top of Cesium canvas */
  background: rgba(0,0,0,0.6);
  color: #fff;
  padding: 10px 12px;
  border-radius: 8px;
  width: 280px;
  font: 14px/1.3 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, "Helvetica Neue", Arial;
}
.hdr {
  display: inline-block;
  min-width: 86px;
  margin-right: 8px;
  color: #ddd;
}
.row {
  margin-bottom: 10px;
}
select {
  width: 170px;
}
.list {
  display: grid;
  grid-template-columns: 1fr;
  gap: 6px;
  max-height: 220px;
  overflow: auto;
}
.ov {
  display: grid;
  grid-template-columns: 1fr 90px;
  align-items: center;
  gap: 8px;
}
input[type="range"] {
  width: 100%;
}
</style>
