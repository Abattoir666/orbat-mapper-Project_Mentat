<template>
    <div v-if="media" class="group relative -mx-4 -mt-4 aspect-16/9 @-lg:aspect-16/5">
        <!-- Toggle button -->
        <button type="button"
                class="absolute right-2 top-2 z-20 rounded bg-black/50 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
                @click.stop="toggleFit()"
                @pointerdown.stop
                :title="fitToFrame ? 'Switch to actual size (pan/zoom)' : 'Fit to frame'">
            {{ fitToFrame ? "Fit" : `${Math.round(zoom * 100)}%` }}
        </button>

        <!-- Image viewport -->
        <div ref="viewportEl"
             class="absolute inset-0 overflow-auto"
             :class="fitToFrame ? 'cursor-default' : (isPanning ? 'cursor-grabbing' : 'cursor-grab')"
             style="touch-action: pan-x pan-y; overscroll-behavior: contain;"
             @wheel="onWheel"
             @pointerdown.stop
             @pointermove.stop
             @pointerup.stop
             @mousedown="onMouseDown"
             @mousemove="onMouseMove"
             @mouseup="onMouseUp"
             @mouseleave="onMouseUp"
             @click.stop
             @dblclick.stop="toggleFit()"
             @contextmenu.prevent
             @auxclick.prevent>
            <!-- Wrapper that defines the scrollable "canvas" size -->
            <div class="min-w-max min-h-max"
                 :style="canvasStyle">
                <img draggable="false"
                     class="block select-none"
                     :style="imgStyle"
                     :src="media.url"
                     :alt="media.caption" />
            </div>
        </div>

        <!-- Credits overlay -->
        <p class="prose prose-sm absolute right-0 bottom-0 left-0 hidden bg-white/80 p-2 text-sm text-black group-hover:block dark:bg-black/60 dark:text-white"
           @click.stop
           @pointerdown.stop
           @pointermove.stop
           @pointerup.stop>
            <a v-if="media.creditsUrl" :href="media.creditsUrl" target="_blank" rel="noopener noreferrer">
                {{ media.credits }}
            </a>
            <span v-else>{{ media.credits }}</span>
        </p>
    </div>
</template>

<script setup lang="ts">
    import { computed, onBeforeUnmount, ref } from "vue";
    import { type Media } from "@/types/scenarioModels";

    defineProps<{ media: Media }>();

    // Modes
    const fitToFrame = ref(true);

    // Zoom state (only used in Actual mode)
    const zoom = ref(1);
    const ZOOM_MIN = 0.25;
    const ZOOM_MAX = 6.0;
    const ZOOM_STEP = 1.12; // wheel notch multiplier (tweak to taste)

    const viewportEl = ref<HTMLDivElement | null>(null);

    // Middle-mouse pan state
    const isPanning = ref(false);
    let startX = 0;
    let startY = 0;
    let startScrollLeft = 0;
    let startScrollTop = 0;

    function clamp(v: number, min: number, max: number) {
        return Math.max(min, Math.min(max, v));
    }

    function toggleFit() {
        fitToFrame.value = !fitToFrame.value;

        // When entering Fit mode, reset zoom so returning to Actual starts sane.
        if (fitToFrame.value) {
            zoom.value = 1;
        }
    }

    // Styles:
    // - Fit mode: standard contain behavior, no scroll-canvas tricks.
    // - Actual mode: we use a scrollable canvas with scaled image.
    const canvasStyle = computed(() => {
        if (fitToFrame.value) {
            // Fill viewport; no need for min-w-max sizing logic
            return {
                width: "100%",
                height: "100%",
            } as Record<string, string>;
        }

        // In Actual mode, canvas is the scaled image size (so scrollbars match zoom).
        // We can't know natural image dims without measuring; instead we rely on the
        // image's intrinsic size and let the scaled element define the scroll area.
        // Setting display:inline-block via imgStyle + min-w-max/min-h-max works.
        return {
            width: "max-content",
            height: "max-content",
        } as Record<string, string>;
    });

    const imgStyle = computed(() => {
        if (fitToFrame.value) {
            return {
                width: "100%",
                height: "100%",
                objectFit: "contain",
                transform: "none",
                transformOrigin: "0 0",
                maxWidth: "100%",
                maxHeight: "100%",
            } as Record<string, string>;
        }

        return {
            width: "auto",
            height: "auto",
            maxWidth: "none",
            maxHeight: "none",
            transform: `scale(${zoom.value})`,
            transformOrigin: "0 0",
        } as Record<string, string>;
    });

    function onMouseDown(e: MouseEvent) {
        // Only enable drag-panning in Actual mode
        if (fitToFrame.value) return;

        // Middle mouse button (MMB)
        if (e.button !== 1) return;

        e.preventDefault();
        e.stopPropagation();

        const el = viewportEl.value;
        if (!el) return;

        isPanning.value = true;
        startX = e.clientX;
        startY = e.clientY;
        startScrollLeft = el.scrollLeft;
        startScrollTop = el.scrollTop;

        document.body.style.userSelect = "none";
    }

    function onMouseMove(e: MouseEvent) {
        if (!isPanning.value) return;

        e.preventDefault();
        e.stopPropagation();

        const el = viewportEl.value;
        if (!el) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        el.scrollLeft = startScrollLeft - dx;
        el.scrollTop = startScrollTop - dy;
    }

    function onMouseUp(e?: MouseEvent) {
        if (!isPanning.value) return;

        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }

        isPanning.value = false;
        document.body.style.userSelect = "";
    }

    function onWheel(e: WheelEvent) {
        // Fit mode: let normal scroll happen (or do nothing).
        // If you *never* want wheel to scroll the panel, keep preventDefault here too.
        if (fitToFrame.value) {
            // Still block globe zoom / outer scrolling:
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        const el = viewportEl.value;
        if (!el) return;

        // We are taking over wheel => prevent page/globe handling.
        e.preventDefault();
        e.stopPropagation();

        // Mouse position within the scroll viewport
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        // Current scroll + mouse gives us the point in "scaled content space"
        const oldZoom = zoom.value;
        const contentX = (el.scrollLeft + mx) / oldZoom;
        const contentY = (el.scrollTop + my) / oldZoom;

        // Wheel direction: negative deltaY = zoom in
        const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        const newZoom = clamp(oldZoom * factor, ZOOM_MIN, ZOOM_MAX);
        if (newZoom === oldZoom) return;

        zoom.value = newZoom;

        // After zoom, keep the same content point under the cursor
        el.scrollLeft = contentX * newZoom - mx;
        el.scrollTop = contentY * newZoom - my;
    }

    onBeforeUnmount(() => {
        document.body.style.userSelect = "";
    });
</script>
