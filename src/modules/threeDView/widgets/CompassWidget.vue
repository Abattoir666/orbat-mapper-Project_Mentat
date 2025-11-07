<!-- src/modules/threeDView/widgets/CompassWidget.vue -->
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, watch } from "vue";

const emit = defineEmits<{ (e: "close"): void }>();

/** Globe API contract: we only need onCameraChange(cb) -> off() */
type CamPayload = { heading: number; pitch: number; roll: number };
const props = defineProps<{ globe: { onCameraChange?: (cb: (o: CamPayload) => void) => () => void } | null }>();

/** Internal heading in *compass degrees*: 0 = North, clockwise */
const headingDeg = ref(0);

/** Toggle this if your build’s heading appears “east-zero” instead of “north-zero”. */
const CESIUM_ZERO_IS_EAST = false; // set to true if you see 0° when looking east

const toCompassDeg = (headingRad: number) => {
  const deg = (headingRad * 180) / Math.PI;
  // Cesium usually reports 0° = North, increasing clockwise.
  // If your build behaves “0° = East”, switch the boolean above.
  const mapped = CESIUM_ZERO_IS_EAST ? (90 - deg) : deg;
  const norm = (mapped % 360 + 360) % 360;
  return norm;
};

let off: null | (() => void) = null;
let retry: number | null = null;

function trySubscribe(source: any) {
  if (off) return;
  const fn = source?.onCameraChange;
  if (typeof fn === "function") {
    off = fn(({ heading }) => {
      headingDeg.value = toCompassDeg(heading);
    });
    // first paint without waiting for interaction
    try { (window as any).__lastCompassDeg = headingDeg.value; } catch {}
    return true;
  }
  return false;
}

onMounted(() => {
  // 1) try the prop
  if (!trySubscribe(props.globe)) {
    // 2) try global (adapter publishes to window)
    if (!(trySubscribe((window as any).MentatGlobe))) {
      // 3) late-binding retry loop
      retry = window.setInterval(() => {
        if (off) { if (retry) clearInterval(retry); retry = null; return; }
        trySubscribe(props.globe || (window as any).MentatGlobe);
      }, 250) as unknown as number;
    }
  }
});

onBeforeUnmount(() => {
  try { off?.(); } catch {}
  if (retry) { clearInterval(retry); retry = null; }
});

/** Style for the needle group in the SVG */
const needleTransform = computed(() => `rotate(${headingDeg.value} 50 50)`);
const headingText = computed(() => String(Math.round(headingDeg.value)).padStart(3, "0"));

// Temporary diagnostics — remove if noisy
watch(headingDeg, v => console.log("[Compass] headingDeg =", v));
</script>


<template>
  <div class="compass" @click="emit('close')" title="Click to hide">
    <!-- Dial + needle (single SVG so z-ordering is predictable) -->
    <svg class="dial" viewBox="0 0 100 100" role="img" aria-label="Compass">
      <defs>
        <circle id="rim" cx="50" cy="50" r="48" />
      </defs>

      <!-- outer rim -->
      <use href="#rim" class="rim" />

      <!-- tick marks (every 6°, major every 30°) -->
      <g class="ticks">
        <g v-for="i in 60" :key="i" :transform="`rotate(${(i-1)*6} 50 50)`">
          <line x1="50" y1="6" x2="50" :y2="(i-1)%5===0 ? 12 : 9" class="tick"/>
        </g>
      </g>

      <!-- cardinal labels -->
      <text x="50" y="18" class="label">N</text>
      <text x="86" y="54" class="label">E</text>
      <text x="50" y="92" class="label">S</text>
      <text x="14" y="54" class="label">W</text>

      <!-- needle (group rotates); designed to be clearly visible -->
      <g class="needle" :transform="needleTransform">
        <!-- tail -->
        <polygon points="50,50 48,56 52,56" class="needle-tail" />
        <!-- body -->
        <rect x="49.2" y="20" width="1.6" height="32" rx="0.8" class="needle-body" />
        <!-- tip -->
        <polygon points="50,6 46.5,20 53.5,20" class="needle-tip" />
        <!-- hub -->
        <circle cx="50" cy="50" r="2.6" class="needle-hub" />
      </g>
    </svg>

    <!-- numeric readout -->
    <div class="readout">
      {{ headingText }}° 
    </div>
  </div>
</template>

<style scoped>
.compass {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 10px;
  background: rgba(0,0,0,0.55);
  color: #fff;
  border: 1px solid rgba(255,255,255,0.25);
  user-select: none;
}

.dial { width: 72px; height: 72px; display: block; }
.rim { fill: none; stroke: rgba(255,255,255,0.6); stroke-width: 2; }
.tick { stroke: rgba(255,255,255,0.5); stroke-width: 1.3; stroke-linecap: round; }
.label {
  fill: rgba(255,255,255,0.85);
  font: 700 10px system-ui, -apple-system, Segoe UI, Roboto, Arial;
  text-anchor: middle;
  dominant-baseline: middle;
}

/* needle styling */
.needle-tip  { fill: #ff6a6a; }                 /* bright tip */
.needle-body { fill: rgba(255,255,255,0.9); }
.needle-tail { fill: rgba(255,255,255,0.6); }
.needle-hub  { fill: rgba(0,0,0,0.75); stroke: rgba(255,255,255,0.9); stroke-width: 1; }

/* numeric readout */
.readout {
  min-width: 64px;
  text-align: right;
  font: 600 14px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Arial;
  color: #fff;
  opacity: 0.95;
}
</style>
