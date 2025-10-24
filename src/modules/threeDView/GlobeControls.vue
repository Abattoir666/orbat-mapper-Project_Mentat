<script setup lang="ts">
import { ref, watch } from "vue";
import { makeImageryProviders } from "@/modules/threeDView/makeImageryProviders";

const props = defineProps<{
  globe: {
    setBaseLayer: (key: string) => void;
    setExaggeration: (v: number) => Promise<void>;
  };
}>();

// imagery options (keys must match makeImageryProviders.ts)
const { providers } = makeImageryProviders();
const baseLayerKey = ref<string>(providers[0]?.key ?? "osmXYZ");

const exag = ref<number>(1);

// initial apply on mount
props.globe.setBaseLayer(baseLayerKey.value);
props.globe.setExaggeration(exag.value);

// handlers
function onLayerChange() {
  props.globe.setBaseLayer(baseLayerKey.value);
}

watch(exag, (v) => {
  // v=0 → flat (no elevation), v>0 → elevation on; useGlobe takes care of this
  props.globe.setExaggeration(v);
});
</script>

<template>
  <div class="controls">
    <label>
      Base layer:
      <select v-model="baseLayerKey" @change="onLayerChange">
        <option v-for="p in providers" :key="p.key" :value="p.key">
          {{ p.label }}
        </option>
      </select>
    </label>

    <label style="display:block;margin-top:8px;">
      Exaggeration: {{ exag.toFixed(1) }}
      <input
        type="range"
        min="0.001"
        max="5"
        step="0.1"
        v-model.number="exag"
      />
    </label>
  </div>
</template>

<style scoped>
.controls {
  position: absolute;
  top: 12px;
  left: 12px;
  background: rgba(0,0,0,0.6);
  color: #fff;
  padding: 10px 12px;
  border-radius: 8px;
  font: 14px/1.3 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji";
}
select, input[type="range"] {
  margin-left: 8px;
}

/* --- minimal fix for invisible base-layer text --- */
.controls select {
  background: #fff;     /* give the closed control a solid light bg */
  color: #111;          /* dark text so it’s readable */
  border: 1px solid #999;
}
.controls select option {
  color: initial;       /* keep OS popup list readable */
  background: initial;
}
</style>
