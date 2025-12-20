<script setup lang="ts">
    import { IconTriangleDown } from "@iconify-prerendered/vue-mdi";
    import { computed, ref, unref, watch, watchEffect } from "vue";
    import { useElementSize, useThrottleFn } from "@vueuse/core";
    import { utcDay, utcHour } from "d3-time";
    import { utcFormat } from "d3-time-format";
    import { interpolateOranges } from "d3-scale-chromatic";
    import { scaleSequential } from "d3-scale";

    import { useActiveScenario } from "@/composables/scenarioUtils";
    import { type NScenarioEvent } from "@/types/internalModels";
    import { useTimeFormatStore } from "@/stores/timeFormatStore";
    import TimelineContextMenu from "@/components/TimelineContextMenu.vue";
    import { useSelectedItems } from "@/stores/selectedStore";
    import { useUiStore } from "@/stores/uiStore";
    import { useGeoStore } from "@/stores/geoStore";
    import { toLonLat } from "ol/proj";

    const MS_PER_HOUR = 3600 * 1000;
    const MS_PER_DAY = 24 * MS_PER_HOUR;

    const {
        time: { scenarioTime, setCurrentTime, computeTimeHistogram, goToScenarioEvent, addScenarioEvent },
        store,
    } = useActiveScenario();

    const fmt = useTimeFormatStore();
    const ui = useUiStore();
    const selected = useSelectedItems();

    const el = ref<HTMLDivElement | null>(null);
    const { width } = useElementSize(el);

    // -------------------------
    // Timeline interaction state
    // -------------------------
    const isPointerInteraction = ref(false);
    const isDragging = ref(false);
    const redrawCounter = ref(0);

    const centerTimeStamp = ref(0);
    const xOffset = ref(0);
    const draggedDiff = ref(0);
    const hoveredX = ref(0);
    const showHoverMarker = ref(false);
    const hoveredDate = ref<Date | null>(null);
    const animate = ref(false);
    const geoStore = useGeoStore();

    // Zoom
    const majorWidth = ref(100);
    const minorStep = computed(() => {
        if (majorWidth.value < 100) return 12;
        if (majorWidth.value < 180) return 6;
        if (majorWidth.value < 300) return 4;
        if (majorWidth.value < 500) return 2;
        return 1;
    });
    const minorWidth = computed(() => majorWidth.value / (24 / minorStep.value));

    // -------------------------
    // Tick models
    // -------------------------
    interface Tick {
        label: string;
        timestamp: number;
    }
    const majorTicks = ref<Tick[]>([]);
    const minorTicks = ref<Tick[]>([]);

    // -------------------------
    // Histogram + events models
    // -------------------------
    interface BinWithX {
        x: number;
        t: number;
        count: number;
    }
    type EventBar = { key: string; x1: number; x2: number; event: NScenarioEvent; row: number };

    const binsWithX = ref<BinWithX[]>([]);
    const showScenarioEventsRow = ref(true);
    const scenarioEventBars = ref<EventBar[]>([]);
    const maxScenarioEventRow = ref(0);

    // Visual tuning
    const EVENT_ROW_PX = 10; // thin bars
    const EVENT_MIN_BAR_PX = 6;

    // -------------------------
    // Scenario offset handling
    // Keep the grid/ticks, xOffset, hover conversion, and event positions consistent
    // -------------------------
    const scenarioUtcOffsetMinutes = computed(() => {
        const st = scenarioTime.value as any;
        const off = typeof st?.utcOffset === "function" ? st.utcOffset() : null;
        if (typeof off === "number" && Number.isFinite(off)) return off;

        // fallback: browser offset at current time
        return -new Date(store.state.currentTime).getTimezoneOffset();
    });
    const scenarioOffsetMs = computed(() => scenarioUtcOffsetMinutes.value * 60 * 1000);

    function shiftTs(ts: number) {
        return ts + scenarioOffsetMs.value;
    }
    function unshiftTs(ts: number) {
        return ts - scenarioOffsetMs.value;
    }

    // -------------------------
    // Formatting
    // -------------------------
    const fmtHour = utcFormat("%H");
    const fmtHourMin = utcFormat("%H:%M");
    function formatHourSmart(d: Date) {
        return d.getUTCMinutes() === 0 ? fmtHour(d) : fmtHourMin(d);
    }

    function getMinorFormatter(majorW: number) {
        if (majorW < 50) return () => "";
        return (d: Date) => formatHourSmart(d);
    }
    function getMajorFormatter(majorW: number) {
        if (majorW < 100) return utcFormat("%d %b");
        return utcFormat("%a %d %b");
    }

    // -------------------------
    // Derived layout
    // -------------------------
    const timelineWidth = computed(() => majorTicks.value.length * majorWidth.value);
    const totalXOffset = computed(() => xOffset.value + draggedDiff.value);

    // -------------------------
    // Hover formatting
    // -------------------------
    const formattedHoveredDate = computed(() => {
        if (!hoveredDate.value) return "";
        const t = +hoveredDate.value;
        if (!Number.isFinite(t)) return "";
        return fmt.scenarioFormatter.format(t);
    });

    // -------------------------
    // Highlight logic (event selected OR unit selected that the event references)
    // -------------------------
    const scenarioEventIdsByUnitId = computed<Map<string, Set<string>>>(() => {
        const idx = new Map<string, Set<string>>();
        for (const id of store.state.events) {
            const ev = store.state.eventMap[id] as any;
            if (!ev) continue;
            const where = ev?.where;
            if (where?.type !== "units" || !Array.isArray(where.units)) continue;

            for (const unitId of where.units) {
                let set = idx.get(unitId);
                if (!set) idx.set(unitId, (set = new Set()));
                set.add(ev.id);
            }
        }
        return idx;
    });

    function getMaybeRefValue<T>(x: any): T | null {
        if (x && typeof x === "object" && "value" in x) return x.value as T;
        if (x === undefined) return null;
        return x as T;
    }

    const highlightedScenarioEventIds = computed<Set<string>>(() => {
        const out = new Set<string>();

        const activeEventId = getMaybeRefValue<string>((selected as any).activeScenarioEventId);
        if (activeEventId) out.add(activeEventId);

        const activeUnitId = getMaybeRefValue<string>((selected as any).activeUnitId);
        if (activeUnitId) {
            const set = scenarioEventIdsByUnitId.value.get(activeUnitId);
            if (set) for (const id of set) out.add(id);
        }
        return out;
    });

    function isScenarioEventHighlighted(eventId: string): boolean {
        return highlightedScenarioEventIds.value.has(eventId);
    }

    const highlightFrameClass = "ring-2 ring-yellow-400 border-yellow-400 z-10";

    // -------------------------
    // Tick generation in shifted (scenario-local) time
    // Return original (unshifted) min/max for filtering events/histogram
    // -------------------------
    function updateTicks(centerTimeOriginal: Date, containerWidth: number, majorW: number, minorStepHours: number) {
        const centerTs = +centerTimeOriginal;
        if (!Number.isFinite(centerTs) || !Number.isFinite(containerWidth) || containerWidth <= 0) {
            majorTicks.value = [];
            minorTicks.value = [];
            const d = new Date(Number.isFinite(centerTs) ? centerTs : Date.now());
            return { minDate: d, maxDate: d };
        }
        if (!Number.isFinite(majorW) || majorW <= 0) {
            majorTicks.value = [];
            minorTicks.value = [];
            const d = new Date(centerTs);
            return { minDate: d, maxDate: d };
        }

        // Use shifted timestamps so “midnight boundaries” align with scenario-local time.
        const centerShifted = new Date(shiftTs(centerTs));
        const dayPadding = Math.ceil((containerWidth * 2) / majorW);

        const currentShiftedDay = utcDay.floor(centerShifted);
        const startShifted = utcDay.offset(currentShiftedDay, -dayPadding);
        const endShifted = utcDay.offset(currentShiftedDay, dayPadding);

        const majorFormatter = getMajorFormatter(majorW);
        const dayRangeShifted = utcDay.range(startShifted, endShifted);
        majorTicks.value = dayRangeShifted.map((d) => ({
            label: majorFormatter(d),
            timestamp: unshiftTs(+d), // store original-ish timestamp for stability/keys
        }));

        const hourRangeShifted = utcHour.range(startShifted, endShifted, minorStepHours);
        const minorFormatter = getMinorFormatter(majorW);
        minorTicks.value = hourRangeShifted.map((d) => ({
            label: minorFormatter(d),
            timestamp: unshiftTs(+d),
        }));

        // Convert window back to original timestamps for filtering
        return { minDate: new Date(unshiftTs(+startShifted)), maxDate: new Date(unshiftTs(+endShifted)) };
    }

    // -------------------------
    // Pixel->time conversion (also in shifted time)
    // -------------------------
    function calculatePixelDate(xClient: number) {
        const w = width.value;
        const mw = majorWidth.value;
        const centerTs = centerTimeStamp.value;

        if (!Number.isFinite(w) || w <= 0) return null;
        if (!Number.isFinite(mw) || mw <= 0) return null;
        if (!Number.isFinite(centerTs)) return null;

        const centerPx = w / 2;
        const msPerPixel = MS_PER_DAY / mw; // ms per px
        if (!Number.isFinite(msPerPixel) || msPerPixel <= 0) return null;

        const diffPx = xClient - centerPx;
        const newShiftedTs = shiftTs(centerTs) + diffPx * msPerPixel;
        const newTs = unshiftTs(newShiftedTs);

        if (!Number.isFinite(newTs)) return null;

        const date = new Date(newTs);
        date.setUTCSeconds(0, 0);
        return { date, diffPx };
    }

    // -------------------------
    // Drag scrubbing (kept), single-click time-jump removed, use double-click instead
    // -------------------------
    let startX = 0;
    let accumulatedDrag = 0;
    let startTimestamp = 0;

    // Optional: slow down scrub speed; 1.0 = 1:1
    const DRAG_SENSITIVITY = 0.35;

    const throttledTimeUpdate = useThrottleFn((ts: number) => setCurrentTime(ts), 0);

    function onPointerDown(evt: PointerEvent) {
        const e = unref(el);
        if (!e) return;

        startX = evt.clientX;
        startTimestamp = store.state.currentTime;

        e.setPointerCapture(evt.pointerId);
        isPointerInteraction.value = true;
        isDragging.value = false;
        accumulatedDrag = 0;
    }

    function onPointerMove(evt: PointerEvent) {
        if (!isPointerInteraction.value) return;

        const diff = evt.clientX - startX;
        accumulatedDrag += Math.abs(diff);

        if (accumulatedDrag < 5) {
            isDragging.value = false;
            return;
        }

        isDragging.value = true;
        draggedDiff.value = diff * DRAG_SENSITIVITY;

        // pixels per ms
        const pxPerMs = majorWidth.value / MS_PER_DAY;
        if (!pxPerMs) return;

        // Convert pointer movement to time delta; operate in shifted space for consistency
        const deltaMs = (diff / pxPerMs) * DRAG_SENSITIVITY;
        let ts = Math.floor(startTimestamp - deltaMs);

        // snap to 15 minutes
        const snapped = new Date(ts);
        snapped.setUTCSeconds(0, 0);
        snapped.setUTCMinutes(Math.round(snapped.getUTCMinutes() / 15) * 15);
        ts = +snapped;

        throttledTimeUpdate(ts);
    }

    function onPointerUp(evt: PointerEvent) {
        const e = unref(el);
        if (e && e.hasPointerCapture(evt.pointerId)) e.releasePointerCapture(evt.pointerId);

        isPointerInteraction.value = false;
        isDragging.value = false;
        accumulatedDrag = 0;

        animate.value = false;
        draggedDiff.value = 0;
    }

    function onDoubleClick(evt: MouseEvent) {
        // left button only
        if (evt.button !== 0) return;

        const res = calculatePixelDate(evt.clientX);
        if (!res) return;

        const { date, diffPx } = res;
        date.setUTCMinutes(Math.round(date.getUTCMinutes() / 15) * 15);
        date.setUTCSeconds(0, 0);

        animate.value = true;
        draggedDiff.value = -diffPx;
        setCurrentTime(+date);

        setTimeout(() => {
            animate.value = false;
            draggedDiff.value = 0;
        }, 100);
    }

    // -------------------------
    // Hover + zoom
    // -------------------------
    function onHover(e: MouseEvent) {
        const res = calculatePixelDate(e.clientX);
        if (!res) return;

        const { date } = res;
        date.setUTCMinutes(Math.round(date.getUTCMinutes() / 15) * 15);
        hoveredX.value = e.clientX;
        hoveredDate.value = date;
    }

    function onWheel(e: WheelEvent) {
        if (e.deltaY > 0) {
            majorWidth.value = Math.max(majorWidth.value - 40, 55);
        } else {
            majorWidth.value += 40;
        }
    }

    // -------------------------
    // Histogram data (existing store logic)
    // -------------------------
    const maxCount = ref(1);
    let histogram: { t: number; count: number }[] = [];

    const countColor = computed(() =>
        scaleSequential(interpolateOranges).domain([1, Math.max(1, maxCount.value)]),
    );

    function colorScale(count: number): string {
        return countColor.value(count);
    }

    // -------------------------
    // Scenario events source
    // -------------------------
    const scenarioEvents = computed<NScenarioEvent[]>(() => {
        return store.state.events.map((id) => store.state.eventMap[id]);
    });

    // -------------------------
    // Optional: lazy “go to event location” hook (won’t crash if unavailable)
    // -------------------------
    type GoToEventLocationFn = (eventId: string) => void | Promise<void>;
    let goToEventLocationLazy: GoToEventLocationFn | null = null;

    async function ensureGoToEventLocation(): Promise<GoToEventLocationFn | null> {
        if (goToEventLocationLazy) return goToEventLocationLazy;

        try {
            const mod = await import("@/modules/scenarioeditor/ExtendedScenarioEvents/useScenarioEventLocation");
            const api = mod.useScenarioEventLocation?.();
            const fn = (api as any)?.goToEventLocation;
            if (typeof fn === "function") {
                goToEventLocationLazy = fn;
                return goToEventLocationLazy;
            }
            return null;
        } catch (err) {
            console.warn("[ScenarioTimeline] goToEventLocation unavailable", err);
            return null;
        }
    }

    // -------------------------
    // Unit IDs per hour (best-effort, lazy + cached)
    // -------------------------
    const unitIdsByT = ref<Record<number, string[]>>({});

    async function getUnitIdsForHour(t: number): Promise<string[]> {
        if (unitIdsByT.value[t]) return unitIdsByT.value[t];

        // Fallback scan: look for per-unit events arrays with timestamps inside [t, t+1h)
        // This is intentionally conservative and only runs on click (not every redraw).
        const start = t;
        const end = t + MS_PER_HOUR;

        const out: string[] = [];
        const units = Object.values(store.state.unitMap as any);

        for (const u of units) {
            const unitId = u?.id;
            if (!unitId) continue;

            const uEvents = u?.events ?? u?.scenarioEvents ?? u?.unitEvents ?? [];
            if (!Array.isArray(uEvents) || uEvents.length === 0) continue;

            let hit = false;
            for (const ev of uEvents) {
                const ts = ev?.startTime ?? ev?.t;
                if (typeof ts !== "number") continue;
                if (ts >= start && ts < end) {
                    hit = true;
                    break;
                }
            }
            if (hit) out.push(unitId);
        }

        unitIdsByT.value[t] = out;
        return out;
    }

    // -------------------------
    // Update event/bins positions within visible range
    // -------------------------
    function updateEvents(minDate: Date, maxDate: Date) {
        const minTs = +minDate;
        const maxTs = +maxDate;
        const pxPerMs = majorWidth.value / MS_PER_DAY;
        if (!pxPerMs) return;

        // A) Scenario event bars (stacked)
        const visible = scenarioEvents.value
            .filter((e) => e && e.startTime >= minTs && e.startTime <= maxTs)
            .slice()
            .sort((a, b) => a.startTime - b.startTime);

        const rawBars = visible.map((event) => {
            const start = event.startTime;
            const end =
                typeof (event as any).endTime === "number" && (event as any).endTime > start
                    ? (event as any).endTime
                    : start;

            const x1 = (start - minTs) * pxPerMs;
            const x2Raw = (end - minTs) * pxPerMs;
            const x2 = Math.max(x2Raw, x1 + EVENT_MIN_BAR_PX);

            const id = (event as any).id ?? (event as any)._id ?? (event as any).eventId ?? "no-id";
            const endKey = typeof (event as any).endTime === "number" ? (event as any).endTime : "no-end";
            const key = `${id}-${event.startTime}-${endKey}`;

            return { key, event, x1, x2 };
        });

        // Greedy stacking by x-overlap
        const rowEnd: number[] = [];
        const bars: EventBar[] = [];
        let maxRow = 0;

        for (const b of rawBars) {
            let row = 0;
            while (row < rowEnd.length && b.x1 <= rowEnd[row] + 2) row++;
            if (row === rowEnd.length) rowEnd.push(b.x2);
            else rowEnd[row] = b.x2;

            maxRow = Math.max(maxRow, row);
            bars.push({ key: (b as any).key, event: b.event, x1: b.x1, x2: b.x2, row });
        }

        scenarioEventBars.value = bars;
        maxScenarioEventRow.value = maxRow;

        // B) Histogram bins
        binsWithX.value = histogram
            .filter((bin) => bin.t >= minTs && bin.t <= maxTs)
            .map((bin) => ({
                x: (bin.t - minTs) * pxPerMs,
                t: bin.t,
                count: bin.count,
            }));
    }

    // -------------------------
    // Click handlers
    // -------------------------
    async function onEventClick(event: NScenarioEvent) {
        // Select the event
        (selected as any).clear?.();
        (selected as any).selectEvents?.([event.id]);

        // If selection store is ref-based, also set active id (best-effort)
        const activeEventRef = (selected as any).activeScenarioEventId;
        if (activeEventRef && typeof activeEventRef === "object" && "value" in activeEventRef) {
            activeEventRef.value = event.id;
        }

        // Open details panel + jump time
        ui?.showEventPanel?.();
        goToScenarioEvent?.(event);

        // Optional: pan/zoom map to event location if that module is available
        const go = await ensureGoToEventLocation();
        await go?.(event.id);
    }

    async function onUnitBinClick(t: number) {
        // Jump time to bin start
        setCurrentTime(t);

        // Attempt to select units that have an event in this hour
        const ids = await getUnitIdsForHour(t);
        if (ids.length > 0) {
            (selected as any).clear?.();
            (selected as any).selectUnits?.(ids);
            ui?.showUnitPanel?.();
        }
    }

    // -------------------------
    // Context menu
    // -------------------------
    function onContextMenuAction(action: string) {
        if (action === "zoomIn") {
            majorWidth.value += 40;
        } else if (action === "zoomOut") {
            majorWidth.value = Math.max(majorWidth.value - 40, 55);
        } else if (action === "addScenarioEvent") {
            if (!hoveredDate.value) return;
            const day = hoveredDate.value.getDate();

            // Default event location: current map center
            let where: any = undefined;
            const map: any = (geoStore as any).olMap;
            const view = map?.getView?.();
            const center = view?.getCenter?.();
            const proj = view?.getProjection?.();

            if (Array.isArray(center) && center.length >= 2) {
                const [lon, lat] = toLonLat(center, proj);
                where = {
                    type: "geometry",
                    geometry: { type: "Point", coordinates: [lon, lat] },
                    maxZoom: 10,
                };
            }

            const eventId = addScenarioEvent({
                title: `Event ${day}`,
                startTime: +hoveredDate.value,
                ...(where ? { where } : {}),
            });

            const activeEventRef = (selected as any).activeScenarioEventId;
            if (activeEventRef && typeof activeEventRef === "object" && "value" in activeEventRef) {
                activeEventRef.value = eventId;
            }
        }
    }

    // -------------------------
    // Histogram recompute trigger (existing behavior)
    // -------------------------
    watch(
        [() => store.state.unitStateCounter, () => store.state.featureStateCounter],
        () => {
            const { histogram: hg, max: mc } = computeTimeHistogram();
            histogram = hg;
            maxCount.value = mc;
            redrawCounter.value += 1;
        },
        { immediate: true },
    );

    // -------------------------
    // Main redraw loop
    // -------------------------
    watchEffect(() => {
        if (!width.value) return;

        const currentScenarioTimestamp = store.state.currentTime;
        redrawCounter.value;

        const tt = new Date(currentScenarioTimestamp);

        let redrawTimeline = false;
        if (isDragging.value) {
            // while dragging, we rely on the scrub updates
        } else if (animate.value === true) {
            setTimeout(() => {
                animate.value = false;
                draggedDiff.value = 0;
            }, 100);
        } else {
            redrawTimeline = true;
        }

        if (!redrawTimeline) return;

        centerTimeStamp.value = currentScenarioTimestamp;
        animate.value = false;

        // Compute xOffset using shifted time so it matches tick grid.
        const shifted = new Date(shiftTs(currentScenarioTimestamp));
        const minutesIntoDay =
            shifted.getUTCHours() * 60 + shifted.getUTCMinutes() + shifted.getUTCSeconds() / 60;

        xOffset.value = minutesIntoDay * (majorWidth.value / (24 * 60)) * -1;

        const { minDate, maxDate } = updateTicks(tt, width.value, majorWidth.value, minorStep.value);
        updateEvents(minDate, maxDate);
    });
</script>

<template>
    <TimelineContextMenu @action="onContextMenuAction"
                         v-slot="{ onContextMenu }"
                         :formattedHoveredDate="formattedHoveredDate">
        <div ref="el"
             class="bg-sidebar border-border relative mb-2 w-full transform overflow-x-hidden border-t text-sm transition-all select-none"
             @pointerdown="onPointerDown"
             @pointerup="onPointerUp"
             @pointermove="onPointerMove"
             @dblclick.prevent.stop="onDoubleClick"
             @wheel.prevent="onWheel"
             @mousemove="onHover"
             @mouseenter="showHoverMarker = true"
             @mouseleave="showHoverMarker = false"
             @contextmenu="onContextMenu">
            <div class="bg-sidebar flex h-3.5 items-center justify-center overflow-clip">
                <IconTriangleDown class="h-4 w-4 scale-x-150 transform text-red-900" />
            </div>

            <div class="touch-none text-sm select-none"
                 :class="animate ? 'transition-all' : 'transition-none'"
                 :style="`transform:translate(${totalXOffset}px)`">
                <!-- Scenario events row (stacked bars) -->
                <div class="flex justify-center">
                    <div class="relative flex-none text-center"
                         :style="`width: ${timelineWidth}px; height: ${
              showScenarioEventsRow ? (maxScenarioEventRow + 1) * EVENT_ROW_PX : 0
            }px;`">
                        <button type="button"
                                class="absolute left-1 top-0 z-10 text-xs opacity-70 hover:opacity-100"
                                @click.stop="showScenarioEventsRow = !showScenarioEventsRow"
                                :title="showScenarioEventsRow ? 'Hide scenario events' : 'Show scenario events'">
                            {{ showScenarioEventsRow ? "Events ▾" : "Events ▸" }}
                        </button>

                        <template v-if="showScenarioEventsRow">
                            <button v-for="{ key, x1, x2, event, row } in scenarioEventBars"
  :key="key"
                                    type="button"
                                    :class="[
                  'absolute cursor-pointer rounded-sm border',
                  'bg-amber-500/70 hover:bg-amber-500 border-gray-500',
                  isScenarioEventHighlighted(event.id) ? highlightFrameClass : '',
                ]"
                                    :style="{
                  left: `${x1}px`,
                  width: `${Math.max(10, x2 - x1)}px`,
                  bottom: `${row * EVENT_ROW_PX}px`,
                  height: `${EVENT_ROW_PX}px`,
                }"
                                    :title="event.title"
                                    @click.stop="onEventClick(event)" />
                        </template>
                    </div>
                </div>

                <!-- Unit histogram bins row -->
                <div class="flex justify-center">
                    <div class="relative h-4 flex-none text-center" :style="`width: ${timelineWidth}px`">
                        <button v-for="bin in binsWithX"
                                :key="bin.t"
                                type="button"
                                class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full border border-gray-500 cursor-pointer hover:opacity-90"
                                :style="{
    left: `${bin.x}px`,
    width: `${EVENT_ROW_PX}px`,
    height: `${EVENT_ROW_PX}px`,
    backgroundColor: '#4B5320',
  }"
                                :title="`${bin.count} unit events`"
                                @click.stop="onUnitBinClick(bin.t)" />
                    </div>
                </div>

                <!-- Spacer row (kept to match your layout) -->
                <div class="flex justify-center">
                    <div class="relative flex-none text-center" :style="`width: ${timelineWidth}px`"></div>
                </div>

                <!-- Major ticks -->
                <div class="border-muted-foreground flex justify-center">
                    <div v-for="tick in majorTicks"
                         :key="tick.timestamp"
                         class="border-muted-foreground flex-none border-r border-b pl-0.5"
                         :style="`width: ${majorWidth}px`">
                        {{ tick.label }}
                    </div>
                </div>

                <!-- Minor ticks -->
                <div class="flex justify-center text-xs">
                    <div v-for="tick in minorTicks"
                         :key="tick.timestamp"
                         class="text-muted-foreground border-muted-foreground min-h-[1rem] flex-none border-r pl-0.5"
                         :style="`width: ${minorWidth}px`">
                        {{ tick.label }}
                    </div>
                </div>
            </div>

            <p v-if="showHoverMarker && !isDragging"
               class="absolute top-0 right-1 hidden p-0 text-xs text-red-900 select-none sm:block dark:text-red-600">
                {{ formattedHoveredDate }}
            </p>

            <div v-if="showHoverMarker"
                 class="hover-hover:flex absolute top-0 bottom-0 w-0.5 bg-red-900/50 dark:bg-red-600/50"
                 :style="`left: ${hoveredX}px`" />
        </div>
    </TimelineContextMenu>
</template>
