<script setup lang="ts">
import { onMounted, onUnmounted, watchEffect } from "vue";
import { injectStrict } from "@/utils";
import { activeMapKey, activeScenarioKey } from "@/components/injects";
import { parentLinkOverlay } from "@/stores/parentLinkOverlay";
import { fromLonLat } from "ol/proj";

const mapRef = injectStrict(activeMapKey);
const { store: scenarioStore } = injectStrict(activeScenarioKey);

function project(lon: number, lat: number) {
  const proj = mapRef.value.getView().getProjection();
  const coord = fromLonLat([lon, lat], proj);
  const [x, y] = mapRef.value.getPixelFromCoordinate(coord);
  return { x, y };
}

function getLL(u: any): [number, number] | null {
  const ll = u?._state?.location || u?.location;
  if (!ll) return null;
  if (Array.isArray(ll) && ll.length >= 2) return [Number(ll[0]), Number(ll[1])];
  if (typeof ll.lon === "number" && typeof ll.lat === "number") return [ll.lon, ll.lat];
  if (typeof ll.lng === "number" && typeof ll.lat === "number") return [ll.lng, ll.lat];
  return null;
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;

function draw() {
  if (!canvas || !ctx) return;
  const size = mapRef.value.getSize();
  if (!size) return;

  if (canvas.width !== size[0] || canvas.height !== size[1]) {
    canvas.width = size[0];
    canvas.height = size[1];
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!parentLinkOverlay.enabled || !parentLinkOverlay.segments.length) return;

  ctx.save();
  ctx.globalAlpha = parentLinkOverlay.opacity;
  ctx.lineWidth = parentLinkOverlay.width;
  ctx.strokeStyle = parentLinkOverlay.color;
  ctx.setLineDash(parentLinkOverlay.dash);

  for (const seg of parentLinkOverlay.segments) {
    const [lonlatA, lonlatB] = seg;
    const a = project(lonlatA[0], lonlatA[1]);
    const b = project(lonlatB[0], lonlatB[1]);

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();

    // arrow tip
    const tip = parentLinkOverlay.arrowAt === "child" ? b : a;
    const tail = parentLinkOverlay.arrowAt === "child" ? a : b;
    const dx = tip.x - tail.x, dy = tip.y - tail.y, L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    const head = 12, half = 7;

    const leftx = tip.x - ux * head + -uy * half;
    const lefty = tip.y - uy * head +  ux * half;
    const rightx = tip.x - ux * head +  uy * half;
    const righty = tip.y - uy * head + -ux * half;

    ctx.fillStyle = parentLinkOverlay.color;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(leftx, lefty);
    ctx.lineTo(rightx, righty);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

// Recompute segments when tracked set or scenario state changes
watchEffect(() => {
  const s = scenarioStore.state;
  if (!parentLinkOverlay.enabled) {
    parentLinkOverlay.segments = [];
    return;
  }

  const segs: [ [number, number], [number, number] ][] = [];
  for (const uid of parentLinkOverlay.tracked) {
    const child = s.unitMap?.[uid];
    if (!child) continue;
    const pid = child._pid;
    const parent = pid && s.unitMap?.[pid] ? s.unitMap[pid] : null;
    const c = getLL(child);
    const p = getLL(parent);
    if (!c || !p) continue;
    // store as [child, parent]
    segs.push([c, p]);
  }

  parentLinkOverlay.segments = segs;
});

// Draw on changes
onMounted(() => {
  const viewport = mapRef.value.getViewport() as HTMLElement;
  canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute; inset:0; pointer-events:none;";
  viewport.appendChild(canvas);
  ctx = canvas.getContext("2d");

  mapRef.value.on("moveend", draw);
  mapRef.value.on("postrender", draw);
});

onUnmounted(() => {
  if (canvas?.parentElement) canvas.parentElement.removeChild(canvas);
  ctx = null; canvas = null;
});

watchEffect(draw);
</script>
<template><div /></template>