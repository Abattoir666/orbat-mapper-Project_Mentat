<!-- src/modules/threeDView/widgets/MeasureWidget.vue -->
<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from "vue";
import {
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  Cartesian3,
  Cartographic,
  Color,
  EllipsoidGeodesic,
  sampleTerrainMostDetailed,
  defined,
  Viewer,
} from "cesium";

const emit = defineEmits<{ (e: "close"): void }>();

type GlobeLike = {
  viewer?: Viewer;
};

const props = defineProps<{
  globe: GlobeLike | null;
}>();

type MeasurePoint = {
  id: string;
  cartesian: Cartesian3;
  cartographic: Cartographic;
  altitudeMode: "terrain" | "custom";
};

const points = ref<MeasurePoint[]>([]);
const straightMeters = ref(0);
const terrainMeters = ref<number | null>(null);
const terrainBusy = ref(false);
const terrainEnabled = ref(true);

let handler: ScreenSpaceEventHandler | null = null;
let pointEntityIds: string[] = [];
let polylineEntityId: string | null = null;

const altDown = ref(false);

function currentViewer(): Viewer | null {
  const g: any = props.globe;
  const viewer: Viewer | undefined = g?.viewer;
  return viewer ?? null;
}

/* ───────────────────── Alt key tracking ───────────────────── */

function onKeyDown(e: KeyboardEvent) {
  if (e.key === "Alt") altDown.value = true;
}

function onKeyUp(e: KeyboardEvent) {
  if (e.key === "Alt") altDown.value = false;
}

function setupKeyboard() {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
}

function teardownKeyboard() {
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
  altDown.value = false;
}

/* ───────────────────── Click handler ───────────────────── */

function setupHandler() {
  const viewer = currentViewer();
  if (!viewer) return;
  if (handler) {
    handler.destroy();
    handler = null;
  }
  handler = new ScreenSpaceEventHandler(viewer.canvas);

  handler.setInputAction(
    (movement: any) => {
      handleClick(movement.position);
    },
    ScreenSpaceEventType.LEFT_CLICK
  );
}

function teardownHandler() {
  if (handler) {
    try {
      handler.destroy();
    } catch {
      // ignore
    }
    handler = null;
  }
}

function clearEntities(viewer: Viewer | null) {
  if (!viewer) return;
  for (const id of pointEntityIds) {
    try {
      viewer.entities.removeById(id);
    } catch {
      // ignore
    }
  }
  pointEntityIds = [];
  if (polylineEntityId) {
    try {
      viewer.entities.removeById(polylineEntityId);
    } catch {
      // ignore
    }
    polylineEntityId = null;
  }
}

function clearAll() {
  const viewer = currentViewer();
  clearEntities(viewer);
  points.value = [];
  straightMeters.value = 0;
  terrainMeters.value = null;
}

async function handleClick(screenPos: { x: number; y: number }) {
  const viewer = currentViewer();
  if (!viewer) return;
  const scene = viewer.scene;

  const canvasPos = screenPos as any;

  let worldPos: Cartesian3 | undefined;
  try {
    worldPos = scene.pickPosition(canvasPos);
  } catch {
    worldPos = undefined;
  }

  // Fallback: hit the ellipsoid if depth buffer / terrain pick fails
  if (!defined(worldPos)) {
    const ray = viewer.camera.getPickRay(canvasPos);
    const globe = scene.globe;
    const ellipsoidHit = globe.pick(ray, scene);
    if (!ellipsoidHit) return;
    worldPos = ellipsoidHit;
  }

  let carto = Cartographic.fromCartesian(worldPos as Cartesian3);
  let altitudeMode: "terrain" | "custom" = "terrain";

  // Alt+click → prompt for custom altitude
  if (altDown.value) {
    const current = carto.height ?? 0;
    const txt = window.prompt(
      "Altitude in meters (relative to mean sea level):",
      current.toFixed(0)
    );
    if (txt != null && txt.trim() !== "" && !isNaN(+txt)) {
      const h = +txt;
      carto = new Cartographic(carto.longitude, carto.latitude, h);
      worldPos = Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height);
      altitudeMode = "custom";
    }
  }

  addPoint(worldPos as Cartesian3, carto, altitudeMode);
}

/* ───────────────────── Data + drawing ───────────────────── */

function addPoint(
  cartesian: Cartesian3,
  cartographic: Cartographic,
  altitudeMode: "terrain" | "custom"
) {
  const viewer = currentViewer();
  if (!viewer) return;

  const id = `__measure_point_${Date.now()}_${points.value.length}`;
  viewer.entities.add({
    id,
    position: cartesian,
    point: {
      pixelSize: 8,
      color: Color.YELLOW.withAlpha(0.9),
      outlineColor: Color.BLACK,
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
  pointEntityIds.push(id);

  points.value = [...points.value, { id, cartesian, cartographic, altitudeMode }];
  updatePolyline();
  recomputeStraightDistance();
  if (terrainEnabled.value) {
    void recomputeTerrainDistance();
  } else {
    terrainMeters.value = null;
  }
}

function updatePolyline() {
  const viewer = currentViewer();
  if (!viewer) return;
  if (points.value.length < 2) {
    if (polylineEntityId) {
      try {
        viewer.entities.removeById(polylineEntityId);
      } catch {
        // ignore
      }
      polylineEntityId = null;
    }
    return;
  }

  const positions = points.value.map(p => p.cartesian);

  if (!polylineEntityId) {
    const id = "__measure_polyline";
    viewer.entities.add({
      id,
      polyline: {
        positions,
        width: 2,
        material: Color.CYAN.withAlpha(0.9),
        depthFailMaterial: Color.CYAN.withAlpha(0.6),
      },
    });
    polylineEntityId = id;
  } else {
    const ent = viewer.entities.getById(polylineEntityId);
    if (ent && ent.polyline) {
      ent.polyline.positions = positions;
    }
  }
}

function recomputeStraightDistance() {
  let sum = 0;
  const arr = points.value;
  for (let i = 1; i < arr.length; i++) {
    sum += Cartesian3.distance(arr[i - 1].cartesian, arr[i].cartesian);
  }
  straightMeters.value = sum;
}

/**
 * Approximate terrain-following distance by walking along geodesics
 * between points and sampling terrain heights.
 */
async function recomputeTerrainDistance() {
  const viewer = currentViewer();
  if (!viewer) return;
  if (points.value.length < 2) {
    terrainMeters.value = null;
    return;
  }

  terrainBusy.value = true;
  try {
    const terrainProvider = viewer.terrainProvider;
    if (!terrainProvider) {
      terrainMeters.value = null;
      return;
    }

    const SAMPLES_PER_SEGMENT = 16;

    const allCartos: Cartographic[] = [];
    const segments: Array<{ from: Cartographic; to: Cartographic }> = [];

    for (let i = 1; i < points.value.length; i++) {
      const a = points.value[i - 1].cartographic;
      const b = points.value[i].cartographic;
      segments.push({ from: a, to: b });
    }

    for (const seg of segments) {
      const geod = new EllipsoidGeodesic(seg.from, seg.to);
      const steps = SAMPLES_PER_SEGMENT;
      for (let j = 0; j <= steps; j++) {
        const f = j / steps;
        const c = geod.interpolateUsingFraction(f);
        allCartos.push(new Cartographic(c.longitude, c.latitude));
      }
    }

    const sampled = await sampleTerrainMostDetailed(terrainProvider, allCartos);

    let sum = 0;
    for (let i = 1; i < sampled.length; i++) {
      const c0 = sampled[i - 1];
      const c1 = sampled[i];
      const p0 = Cartesian3.fromRadians(c0.longitude, c0.latitude, c0.height);
      const p1 = Cartesian3.fromRadians(c1.longitude, c1.latitude, c1.height);
      sum += Cartesian3.distance(p0, p1);
    }
    terrainMeters.value = sum;
  } catch (e) {
    console.warn("[MeasureWidget] terrain distance failed:", e);
    terrainMeters.value = null;
  } finally {
    terrainBusy.value = false;
  }
}

function undoLast() {
  if (!points.value.length) return;
  const viewer = currentViewer();
  const last = points.value[points.value.length - 1];
  if (viewer) {
    try {
      viewer.entities.removeById(last.id);
    } catch {
      // ignore
    }
  }
  points.value = points.value.slice(0, -1);
  pointEntityIds.pop();
  updatePolyline();
  recomputeStraightDistance();
  if (terrainEnabled.value) {
    void recomputeTerrainDistance();
  } else {
    terrainMeters.value = null;
  }
}

/* ───────────────────── Derived values ───────────────────── */

const segmentCount = computed(() => Math.max(points.value.length - 1, 0));
const straightKm = computed(() => straightMeters.value / 1000);
const terrainKm = computed(() =>
  terrainMeters.value == null ? null : terrainMeters.value / 1000
);

const hasTerrain = computed(() => terrainMeters.value != null);

/* ───────────────────── Lifecycle ───────────────────── */

onMounted(() => {
  setupKeyboard();
  setupHandler();
});

onBeforeUnmount(() => {
  teardownHandler();
  teardownKeyboard();
  clearEntities(currentViewer());
});
</script>

<template>
    <div class="measure-root" @click.stop>
        <div class="measure-header">
            <span>📏 Measure</span>
            <button class="measure-close" type="button" @click="emit('close')">×</button>
        </div>

        <div class="measure-body">
            <div class="measure-row">
                <span>Points:</span>
                <strong>{{ points.length }}</strong>
            </div>
            <div class="measure-row">
                <span>Segments:</span>
                <strong>{{ segmentCount }}</strong>
            </div>
            <div class="measure-row">
                <span>Straight-line:</span>
                <strong>{{ straightKm.toFixed(2) }} km</strong>
            </div>
            <div class="measure-row">
                <span>Terrain distance:</span>
                <template v-if="terrainEnabled">
                    <span v-if="terrainBusy" class="measure-subtle">computing…</span>
                    <strong v-else-if="hasTerrain">{{ terrainKm!.toFixed(2) }} km</strong>
                    <span v-else class="measure-subtle">n/a</span>
                </template>
                <span v-else class="measure-subtle">disabled</span>
            </div>

            <label class="measure-row measure-toggle">
                <input type="checkbox" v-model="terrainEnabled" />
                <span>Sample terrain for distance (slower)</span>
            </label>
            <p class="measure-hint">
                Click to add points. Hold <kbd>Alt</kbd> while clicking to set a custom altitude for that point.
            </p>
        </div>

        <div class="measure-footer">
            <button type="button" @click="undoLast" :disabled="!points.length">Undo last</button>
            <button type="button" @click="clearAll" :disabled="!points.length">Clear</button>
        </div>
    </div>
</template>

<style scoped>
    .measure-root {
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 6px 8px;
        min-width: 220px;
        max-width: 280px;
        color: #fff;
        font: 13px/1.3 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .measure-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        font-weight: 600;
    }

    .measure-close {
        border: none;
        background: transparent;
        color: inherit;
        cursor: pointer;
        font-size: 16px;
        line-height: 1;
        padding: 0 2px;
    }

    .measure-body {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .measure-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        font-size: 12px;
    }

        .measure-row strong {
            font-variant-numeric: tabular-nums;
        }

    .measure-subtle {
        font-size: 11px;
        opacity: 0.8;
    }

    .measure-toggle {
        margin-top: 4px;
        gap: 6px;
        justify-content: flex-start;
    }

        .measure-toggle input {
            margin: 0;
        }

    .measure-hint {
        margin: 4px 0 0;
        font-size: 11px;
        opacity: 0.8;
    }

        .measure-hint kbd {
            font-family: inherit;
            font-size: 11px;
            padding: 1px 4px;
            border-radius: 3px;
            border: 1px solid rgba(255, 255, 255, 0.4);
            background: rgba(0, 0, 0, 0.35);
        }

    .measure-footer {
        display: flex;
        justify-content: flex-end;
        gap: 6px;
        margin-top: 4px;
    }

        .measure-footer > button {
            font-size: 11px;
            padding: 2px 6px;
            border-radius: 4px;
            border: 1px solid rgba(255, 255, 255, 0.45);
            background: rgba(0, 0, 0, 0.35);
            color: inherit;
            cursor: pointer;
        }

            .measure-footer > button:disabled {
                opacity: 0.4;
                cursor: default;
            }
</style>
