﻿<!-- src/modules/threeDView/GlobeView.vue -->
<script setup lang="ts">
    /* ───────────────── existing imports ───────────────── */
    import { ref, shallowRef, computed, onMounted, onBeforeUnmount, watch, defineAsyncComponent, nextTick, isRef, onActivated, unref } from "vue";
    import type { Ref } from "vue";
    import { useGlobePort } from "@/composables/useGlobePort";
    import { bindUnitsToView } from "@/composables/bindUnitsToView";
    import { useActiveScenario } from "@/composables/scenarioUtils";
    /* Lazy import Pinia store AFTER mount */
    const lazyUseMapSettingsStore = () =>
        import("@/stores/mapSettingsStore").then(m => m.useMapSettingsStore);

    /* 2D→3D layer conversion */
    import { convertScenarioImportedLayers, type Imported2DLayerUI } from "@/modules/threeDView/importedLayers/conversion";
    // Debug hook so you can call it from DevTools
    ; (window as any).convertScenarioImportedLayers = convertScenarioImportedLayers;
    import { syncImported2DTo3D } from "@/modules/threeDView/importedLayers/sync2DTo3D";

    /* ───────────────── inlined ScenarioTimeline imports (exact) ───────────────── */
    import { IconTriangleDown } from "@iconify-prerendered/vue-mdi";
    import { useElementSize, useThrottleFn } from "@vueuse/core";
    import { utcDay, utcHour } from "d3-time";
    import { utcFormat } from "d3-time-format";
    import { interpolateOranges } from "d3-scale-chromatic";
    import { scaleSequential } from "d3-scale";
    import TimelineContextMenu from "@/components/TimelineContextMenu.vue";
    const lazyUseTimeFormatStore = () =>
        import("@/stores/timeFormatStore").then(m => m.useTimeFormatStore);
    const lazyUseSelectedItems = () =>
        import("@/stores/selectedStore").then(m => m.useSelectedItems);
    import type { NScenarioEvent } from "@/types/internalModels";
    import CompassWidget from "./widgets/CompassWidget.vue";
import MeasureWidget from "./widgets/MeasureWidget.vue";
import PlaybackMenu from "@/modules/scenarioeditor/PlaybackMenu.vue";

    // baseLayers.ts
    const BASE_URL =
        (import.meta.env.BASE_URL ?? "/").endsWith("/")
            ? import.meta.env.BASE_URL
            : import.meta.env.BASE_URL + "/";

    /* ───────────────── Globe port + mount target ───────────────── */

    const mountRef = ref<HTMLDivElement | null>(null);
    const port = useGlobePort();
    const rightOpen = ref(true);
    function toggleRight() { rightOpen.value = !rightOpen.value; }

    /** Normalize globe whether it's a Ref or a plain object */
    const g = computed<any>(() => {
        const maybe = (port as any).globe;
        return isRef(maybe) ? maybe.value : maybe;
    });

    // Compass: open on button; close when clicking the widget itself
    const showCompass = ref(false);
    function openCompass() { showCompass.value = true; }
    function closeCompass() { showCompass.value = false; }

    // Measure tool: open/close via button + close icon in widget
const showMeasure = ref(false);
function openMeasure() { showMeasure.value = true; }
function closeMeasure() { showMeasure.value = false; }

    const globeApi = g;
    const mount = (port as any).mount as (el: HTMLDivElement) => Promise<void>;
    const flyToLatLon = (port as any).flyToLatLon as (lon: number, lat: number, h?: number) => void;

    /* Optional parent events */
    defineEmits<{
        (e: "showExport"): void;
        (e: "showLoad"): void;
        (e: "showSettings"): void;
    }>();

    /* Scenario store (2D) */
    const scenario = useActiveScenario();
    const store = (scenario as any)?.store ?? scenario;
    // Use the store-like object as the source for imported layer conversion
    const scenarioForLayers = computed(() => (scenario as any)?.store ?? scenario);

    /* Camera + exaggeration (left panel) */
    const lat = ref(34.0522);
    const lon = ref(-118.2437);
    const height = ref(12000);
    const exaggeration = ref(1.0);

    const controlsOpen = ref(true);
    function toggleControls() {
        controlsOpen.value = !controlsOpen.value;
    }

    /* Binder disposer */
    let disposeUnits: (() => void) | null = null;

    /* ─────────── Timeline state (store-backed with local fallback) ─────────── */
    const timelineReady = ref(true);

    /** Local fallback window if store not ready */
    const nowMsBoot = Date.now();
    const localStartMs = ref(nowMsBoot - 12 * 3600e3);
    const localStopMs = ref(nowMsBoot + 12 * 3600e3);
    const localCurMs = ref(nowMsBoot);

    /** Bounds */
    const startMs = computed<number>(() => {
        const s = store?.state?.info?.startTime;
        return typeof s === "number" ? s : localStartMs.value;
    });
    const stopMs = computed<number>(() => {
        const e = store?.state?.info?.stopTime;
        return typeof e === "number" ? e : localStopMs.value;
    });

    /** Current time (get from store if present; set writes to store or local) */
    function setCurrentTimeMs(v: number) {
        if (store?.state && typeof store.state.currentTime === "number") {
            store.state.currentTime = v;
        } else {
            localCurMs.value = v;
        }
    }
    const currentMs = computed<number>({
        get() {
            const v = store?.state?.currentTime;
            return typeof v === "number" ? v : localCurMs.value;
        },
        set(v: number) {
            setCurrentTimeMs(v);
            g.value?.setTime?.(v);
        },
    });

    /** Bounds setter – writes to store or local, then pushes to globe */
    function setBounds(s: number, e: number) {
        if (store?.state?.info) {
            store.state.info.startTime = s;
            store.state.info.stopTime = e;
        } else {
            localStartMs.value = s; localStopMs.value = e;
        }
        g.value?.setTimeBounds?.(s, e);
    }

    /* === Scenario clock (formatted) === */
    function fmtOffset(mins: number) {
        const sign = mins >= 0 ? "+" : "-";
        const a = Math.abs(mins);
        const hh = String(Math.floor(a / 60)).padStart(2, "0");
        const mm = String(a % 60).padStart(2, "0");
        return `UTC${sign}${hh}:${mm}`;
    }

    const scenarioClock = computed(() => {
        const ts = +tlScenarioTime.value;
        const fmt = tlFmtStore.value?.scenarioFormatter ?? tlFallbackFormatter;
        return fmt.format(ts);
    });

    const scenarioTzLabel = computed(() => fmtOffset(tlTzOffset ?? 0));

    function jumpToNow() {
        tlSetCurrentTime(Date.now());
    }

    /* ─────────── Sync bounds & clock to the globe ─────────── */
    let lastBounds = { s: Number.NaN, e: Number.NaN };
    watch([startMs, stopMs], ([s, e]) => {
        if (!g.value) return;
        if (s === lastBounds.s && e === lastBounds.e) return;
        lastBounds = { s, e };
        g.value.setTimeBounds?.(s, e);
    }, { immediate: true });

    let rafIdSend: number | null = null;
    let lastClockSent = Number.NaN;
    function flushClock(t: number) {
        if (!g.value) return;
        if (t === lastClockSent) return;
        lastClockSent = t;
        g.value.setTime?.(t);
    }
    watch(currentMs, (t) => {
    if (rafIdSend != null) cancelAnimationFrame(rafIdSend);
    rafIdSend = requestAnimationFrame(() => {
        rafIdSend = null;
        flushClock(t);
    });
}, { immediate: true });

    const jumpTimeLocal = ref<string>("");

    function jumpToTime() {
        if (!jumpTimeLocal.value) return;
        const dt = new Date(jumpTimeLocal.value);   // treated as local time
        if (Number.isNaN(+dt)) return;
        tlSetCurrentTime(dt.getTime());             // store expects ms since epoch
    }

    /* ─────────── Playback loop (kept) ─────────── */
    const isPlaying = ref(false);
    const speed = ref(60);

    let rafIdPlay: number | null = null;
    let lastTickTs = 0;

    function tick(ts: number) {
        if (!isPlaying.value) return;
        if (!lastTickTs) lastTickTs = ts;
        const dtReal = ts - lastTickTs;
        lastTickTs = ts;

        const dtSim = dtReal * (Number.isFinite(speed.value) ? speed.value : 1);
        const s = startMs.value;
        const e = stopMs.value;
        let next = currentMs.value + dtSim;

        if (e > s) {
            const span = e - s;
            if (next > e) next = s + ((next - s) % span);
            if (next < s) next = e - ((s - next) % span);
        }
        currentMs.value = next;
        rafIdPlay = requestAnimationFrame(tick);
    }
    function play() {
        if (isPlaying.value) return;
        isPlaying.value = true;
        lastTickTs = 0;
        rafIdPlay = requestAnimationFrame(tick);
    }
    function pause() {
        isPlaying.value = false;
        if (rafIdPlay != null) cancelAnimationFrame(rafIdPlay);
        rafIdPlay = null;
        lastTickTs = 0;
    }

    function setSpeedAndPlay(v: number) {
        speed.value = v;
        if (!isPlaying.value) play();
    }
    function togglePlayPause() {
        if (isPlaying.value) {
            pause();
        } else {
            if (!Number.isFinite(speed.value) || speed.value === 0) speed.value = 1;
            play();
        }
    }

    /* ─────────── Base-layer config & selection ─────────── */
    type BaseLayerRec = {
        name: string;
        key?: string;
        url?: string;
        minLevel?: number;
        maxLevel?: number;
        attribution?: string;
        scheme?: "webMercator" | "geographic";
        subdomains?: string[] | string;
    };

    const layers = ref<BaseLayerRec[]>([]);
    const selectedLayer = ref<string>("");

    /* Lazy Pinia store instance (typed) */
    type MapSettingsStoreT = ReturnType<import("@/stores/mapSettingsStore").useMapSettingsStore>;
    const mapSettings = shallowRef<MapSettingsStoreT | null>(null);

    function setSelectedFromStoreName(name?: string) {
        if (!name) return;
        const rec = layers.value.find(
            (l) => l.key?.toLowerCase() === name.toLowerCase() || l.name.toLowerCase() === name.toLowerCase()
        );
        if (rec) selectedLayer.value = rec.name;
    }

    let syncingFromStore = false;
    let syncingToStore = false;

    function normalizeConfig(data: any) {
        const arr = Array.isArray(data) ? data : Object.values(data ?? {});
        return arr.map((it: any) => {
            const src = it.sourceOptions ?? {};
            const isOSM = it.layerSourceType === "osm";
            const isXYZ = it.layerSourceType === "xyz";
            const defaultOSM = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
            const url =
                (isXYZ && src.url) ||
                (isOSM && (src.url || defaultOSM)) ||
                undefined;

            return {
                name: it.title ?? it.name ?? "Layer",
                url,
                key: it.name,
                minLevel: 0,
                maxLevel: typeof src.maxZoom === "number" ? src.maxZoom : 19,
                attribution: src.attributions,
                scheme: "webMercator" as const,
                subdomains: url === defaultOSM ? "abc" : undefined,
            };
        });
    }

    function wrapSetUnits() {
        if (!g.value) return;
        const orig = g.value.setUnits?.bind(g.value);
        if (orig) {
            (g.value as any).setUnits = (...args: any[]) => orig(...args);
        }
    }

    /* ─────────── Imported 2D Layers drawer (right) ─────────── */
    const importedLayers = ref<Imported2DLayerUI[]>([]);
    const importedOpen = ref(false);
    const zOffsetMeters = ref(3);

    let overlaySync: ReturnType<typeof syncImported2DTo3D> | null = null;

    async function refreshImportedLayers() {
        try {
            const ui = await convertScenarioImportedLayers(scenarioForLayers.value);
            importedLayers.value = ui;

            // Default OFF: ensure overlays start hidden (don’t upsert/add here; the sync manages creation)
            for (const row of importedLayers.value) {
                row.on = false;
                if (g.value?.setOverlayVisibility) {
                    g.value.setOverlayVisibility(row.id, false);
                }
            }
        } catch (e) {
            console.warn("[GlobeView] convertScenarioImportedLayers failed:", e);
        }
    }

    function onToggleImported(id: string) {
        const row = importedLayers.value.find(x => x.id === id);
        if (!row || !g.value) return;
        g.value.setOverlayVisibility?.(id, row.on);
        // No upsert here — syncImported2DTo3D creates & orders imagery overlays
    }

    function onAlphaImported(id: string) {
        const row = importedLayers.value.find(x => x.id === id);
        if (!row || !g.value) return;
        g.value.setOverlayAlpha?.(id, row.alpha);
    }
    watch(zOffsetMeters, (v) => {
        const list = importedLayers.value.map(u => u.layer);
        g.value?.setImported2DLayers?.(list, { zOffsetMeters: v });
    });

    /* ─────────── Lifecycle ─────────── */
    onMounted(async () => {
        try {
            if (mountRef.value) {
                console.log("[GlobeView] Mounting globe…");
                await mount(mountRef.value);
                await nextTick();
                console.log("[GlobeView] Globe mounted.", g.value);
                if (g.value && !overlaySync) {
                    overlaySync = syncImported2DTo3D(g.value, scenarioForLayers);
                }

                /* ── EXPOSE the live adapter instance + viewer for binder + DevTools ── */
                (window as any).MentatGlobe = g.value;
                try {
                    (window as any).MentatGlobeAdapterDebug = {
                        viewer: (g.value as any)?.viewer,
                        scene: (g.value as any)?.viewer?.scene,
                        Cesium: (g.value as any)?.Cesium ?? (window as any).Cesium,
                    };
                } catch { }
            }
        } catch (e) {
            console.error("[GlobeView] mount failed:", e);
        }

        await g.value?.frameFromScenario2D?.();
        wrapSetUnits();

        tryBindIfReady();

        try {
            const useMapSettingsStore = await lazyUseMapSettingsStore();
            mapSettings.value = useMapSettingsStore();
        } catch (e) {
            console.warn("[GlobeView] useMapSettingsStore() failed:", e);
        }

        // Lazy-init timeline-related Pinia stores AFTER mount to avoid getActivePinia() error
        try {
            const useTF = await lazyUseTimeFormatStore();
            tlFmtStore.value = useTF();
        } catch (e) {
            console.warn("[GlobeView] timeFormatStore unavailable, using fallback formatter.", e);
        }

        try {
            const useSel = await lazyUseSelectedItems();
            // store the whole store so we can write to its ref later
            selectedItemsStoreRef.value = useSel();
        } catch (e) {
            console.warn("[GlobeView] selectedStore unavailable; context actions will skip selection.", e);
        }

        try {
            const res = await fetch(`${BASE_URL}config/mapConfig.json`);
            const data = await res.json();
            layers.value = normalizeConfig(data);
        } catch (e) {
            console.warn("Failed to fetch mapConfig.json", e);
            layers.value = [
                { name: "ESRI World Imagery", key: "esriWorldImagery" },
                { name: "OpenStreetMap", url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", subdomains: "abc" },
            ];
        }

        if (mapSettings.value?.baseLayerName) setSelectedFromStoreName(mapSettings.value.baseLayerName);
        if (!selectedLayer.value) selectedLayer.value = layers.value[0]?.name ?? "";

        g.value?.setTimeBounds?.(startMs.value, stopMs.value);
        g.value?.setTime?.(currentMs.value);

        await refreshImportedLayers();

        (window as any).__scenario = scenario;
    });

    /* Bind as soon as either dependency becomes available */
    const isBound = ref(false);
    function tryBindIfReady() {
        if (isBound.value) return;
        if (!g.value) return;
        const src = (scenario && (scenario as any).store) ? (scenario as any).store : scenario;
        if (!src) return;
        try {
            disposeUnits?.();
            disposeUnits = bindUnitsToView(g.value, {
                scenarioStore: src,        // enables reactive bulk sync + incremental hooks
                useStrictLonLat: false,    // permissive first-paint; tighten later if you want
                sidcIconSize: 40,          // hint for icon cache (if present)
            });
            isBound.value = true;
            refreshImportedLayers().catch(() => { });
            console.log("[GlobeView] Units bound.");
        } catch (e) {
            console.warn("[GlobeView] bindUnitsToView failed:", e);
        }
    }

    watch(
        [
            () => Boolean(g.value),
            () => Boolean((scenario as any)?.store ?? scenario),
        ],
        () => tryBindIfReady(),
        { immediate: true }
    );

    // Restart imagery sync if scenario instance changes
    watch(
        () => scenarioForLayers.value,
        () => {
            if (!g.value) return;
            try { overlaySync?.stop(); } catch { }
            overlaySync = syncImported2DTo3D(g.value, scenarioForLayers);
            // refresh the UI list too (so the box updates when the scenario/store swaps)
            refreshImportedLayers().catch(() => { });
        },
        { immediate: false }
    );

    onActivated(async () => {
        await g.value?.frameFromScenario2D?.();
    });

    onBeforeUnmount(() => {
        try { disposeUnits?.(); } catch { }
        disposeUnits = null;
        if (rafIdSend != null) {
            cancelAnimationFrame(rafIdSend);
            rafIdSend = null;
        }
        if (rafIdPlay != null) {
            cancelAnimationFrame(rafIdPlay);
            rafIdPlay = null;
        }
        // Stop imagery overlay sync and clear any managed overlays
        try { overlaySync?.stop(); } catch { }
        overlaySync = null;
    });

    /* Controls */
    function fly() { flyToLatLon(lon.value, lat.value, height.value); }

    let lastSent = exaggeration.value;
    watch(exaggeration, async (val) => {
        if (!g.value) return;
        if (Math.abs(val - lastSent) < 0.005) return;
        lastSent = val;
        await g.value.setExaggeration?.(val);
    }, { immediate: false });

    watch(selectedLayer, (name) => {
        const rec = layers.value.find((l) => l.name === name);
        if (!rec || !g.value) return;

        if (rec.url && g.value.setBaseLayerTemplate) {
            g.value.setBaseLayerTemplate(rec.url, {
                minLevel: rec.minLevel,
                maxLevel: rec.maxLevel,
                attribution: rec.attribution,
                geographic: rec.scheme === "geographic",
                subdomains: rec.subdomains,
            });
        } else if (rec.key) {
            g.value.setBaseLayer?.(rec.key);
        }

        if (!syncingFromStore && mapSettings.value) {
            try {
                syncingToStore = true;
                const key = rec.key || rec.name;
                if (key && mapSettings.value.baseLayerName !== key) mapSettings.value.baseLayerName = key;
            } finally {
                nextTick(() => (syncingToStore = false));
            }
        }
    }, { immediate: true });

    watch(() => mapSettings.value?.baseLayerName, (name) => {
        if (!name) return;
        if (syncingToStore) return;
        try {
            syncingFromStore = true;
            setSelectedFromStoreName(name);
        } finally {
            nextTick(() => (syncingFromStore = false));
        }
    });

    /* ─────────── Day/Night & Skybox ─────────── */
    const isDayNight = ref(false);
    const isSkybox = ref(false);
    function toggleDayNight() {
        isDayNight.value = !isDayNight.value;
        g.value?.enableDayNight?.(isDayNight.value);
    }
    function toggleSkybox() {
        isSkybox.value = !isSkybox.value;
        g.value?.enableSkybox?.(isSkybox.value);
    }

    /* ─────────── 3D Range-rings visibility ─────────── */
    const showRangeRings3D = ref(true);
    function toggleRangeRings3D() {
        showRangeRings3D.value = !showRangeRings3D.value;
        g.value?.setRangeRingsVisible?.(showRangeRings3D.value);
    }

    /* ╔══════════════════════════════════════════════════════════════════╗
       ║     INLINED SCENARIOTIMELINE LOGIC (namespaced with tl*)         ║
       ╚══════════════════════════════════════════════════════════════════╝ */
    const TL_MS_PER_HOUR = 3600 * 1000;
    const TL_MS_PER_DAY = 24 * TL_MS_PER_HOUR;

    // Safe holders that we’ll populate after mount
    const tlFmtStore = shallowRef<null | { scenarioFormatter: Intl.DateTimeFormat }>(null);
    const selectedItemsStoreRef = shallowRef<null | { activeScenarioEventId: Ref<string | null | undefined> }>(null);

    // Fallback formatter so ticks/hover text work before the store is ready
    const tlFallbackFormatter = new Intl.DateTimeFormat("en-GB", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "UTC",
    });

    const {
        time: tlTime,
        store: tlStore,
    } = useActiveScenario();
    const {
        scenarioTime: tlScenarioTime,
        setCurrentTime: tlSetCurrentTime,
        timeZone: tlTimeZone,
        computeTimeHistogram: tlComputeTimeHistogram,
        goToScenarioEvent: tlGoToScenarioEvent,
        addScenarioEvent: tlAddScenarioEvent,
    } = tlTime;

    /* container & sizing */
    const tlEl = ref<HTMLDivElement | null>(null);
    const tlIsPointerInteraction = ref(false);
    const tlIsDragging = ref(false);
    const tlRedrawCounter = ref(0);
    const { width: tlWidth } = useElementSize(tlEl);
    const tlTzOffset = tlScenarioTime.value.utcOffset();


    /* formatters */
    const tlHourFormatter = utcFormat("%H");
    function tlGetMinorFormatter(majorWidth: number) {
        if (majorWidth < 50) {
            return (d: Date) => (d.getUTCHours() % 6 === 0 ? tlHourFormatter(d) : "");
        }
        if (majorWidth < 130) {
            return (d: Date) => (d.getUTCHours() % 3 === 0 ? tlHourFormatter(d) : "");
        }
        return (d: Date) => tlHourFormatter(d);
    }

    const tlMajorFormatterA = utcFormat("%a %b %d");
    const tlMajorFormatterB = utcFormat("%b %d");
    function tlGetMajorFormatter(majorWidth: number) {
        if (majorWidth < 65) return tlMajorFormatterB;
        return tlMajorFormatterA;
    }

    /* main timeline refs */
    type Tick = { label: string; timestamp: number };
    type EventWithX = { x: number; event: NScenarioEvent };
    type BinWithX = { x: number; count: number };

    const tlHoveredDate = ref<Date | null>(null);
    const tlMajorTicks = ref<Tick[]>([]);
    const tlMinorTicks = ref<Tick[]>([]);
    const tlEventsWithX = ref<EventWithX[]>([]);
    const tlBinsWithX = ref<BinWithX[]>([]);
    const tlCenterTimeStamp = ref(0);
    const tlXOffset = ref(0);
    const tlDraggedDiff = ref(0);
    const tlMajorWidth = ref(100);

    const tlMinorStep = computed(() => {
        if (tlMajorWidth.value < 100) return 12;
        if (tlMajorWidth.value < 180) return 6;
        if (tlMajorWidth.value < 300) return 4;
        if (tlMajorWidth.value < 500) return 2;
        return 1;
    });

    let tlMaxCount = 1;
    let tlHistogram: { t: number; count: number }[] = [];

    const tlMinorWidth = computed(() => tlMajorWidth.value / (24 / tlMinorStep.value));
    const tlCurrentTimestamp = ref(0);
    const tlAnimate = ref(false);
    const tlHoveredX = ref(0);
    const tlShowHoverMarker = ref(false);

    const tlCountColor = scaleSequential(interpolateOranges).domain([1, tlMaxCount]);

    const tlTimelineWidth = computed(() => tlMajorTicks.value.length * tlMajorWidth.value);
    const tlTotalXOffset = computed(() => tlXOffset.value + tlDraggedDiff.value);

    /* derived time from scenario */
    const tlScenarioMs = computed(() => +tlScenarioTime.value);
    function tlUpdateTicks(centerTime: Date, containerWidth: number, majorWidth: number, minorStep: number) {
        const tzMs = (tlTzOffset ?? 0) * 60_000;            // ← minutes → ms
        const shiftedCenter = new Date(centerTime.getTime() + tzMs); // work in “local scenario time”

        const safeWidth = Math.max(1, containerWidth);
        const safeMajor = Math.max(1, majorWidth);
        const dayPadding = Math.max(1, Math.ceil((safeWidth * 2) / safeMajor));

        const currentUtcDay = utcDay.floor(shiftedCenter);
        const startShifted = utcDay.offset(currentUtcDay, -dayPadding);
        const endShifted = utcDay.offset(currentUtcDay, dayPadding);

        const dayRange = utcDay.range(startShifted, endShifted);
        const majorFormatter = tlGetMajorFormatter(safeMajor);
        tlMajorTicks.value = dayRange.map((d) => ({ label: majorFormatter(d), timestamp: +d - tzMs }));  // shift back

        const hourRange = utcHour.range(startShifted, endShifted, minorStep);
        const minorFormatter = tlGetMinorFormatter(safeMajor);
        tlMinorTicks.value = hourRange.map((d) => ({ label: minorFormatter(d), timestamp: +d - tzMs })); // shift back

        return { minDate: new Date(+startShifted - tzMs), maxDate: new Date(+endShifted - tzMs) };       // unshift bounds
    }

    watch([tlWidth, tlMajorWidth, tlScenarioMs, tlMinorStep], () => {
        const width = tlWidth.value || 800;

        const { minDate, maxDate } = tlUpdateTicks(
            new Date(tlScenarioMs.value),
            width,
            tlMajorWidth.value,
            tlMinorStep.value
        );

        const binMs = tlMinorStep.value * TL_MS_PER_HOUR;
        const rawHist =
            typeof tlComputeTimeHistogram === "function"
                ? tlComputeTimeHistogram(+minDate, +maxDate, binMs)
                : [];

        const arr = tlToArrayHistogram(rawHist);
        tlHistogram = arr;
        tlMaxCount = Math.max(1, ...arr.map(h => h.count));
        (tlCountColor as any).domain([1, tlMaxCount]);

        // keep the *actual* center time
        tlCenterTimeStamp.value = +new Date(tlScenarioMs.value);

        // place strip so center is at visual center
        const dayOffset = (tlCenterTimeStamp.value - (+minDate)) / TL_MS_PER_DAY;
        tlXOffset.value = width / 2 - dayOffset * tlMajorWidth.value;
    }, { immediate: true });

    /* px→date calc */
    function tlCalculatePixelDate(x: number) {
        const center = tlWidth.value / 2;
        const msPerPixel = (TL_MS_PER_HOUR * 24) / tlMajorWidth.value;
        const diff = x - center;
        const newDate = tlCenterTimeStamp.value + diff * msPerPixel;
        const date = new Date(newDate);
        date.setUTCSeconds(0, 0);
        return { date, diff };
    }

    /* pointer handlers */
    let tlStartX = 0;
    let tlAccumulatedDrag = 0;
    let tlStartTimestamp = 0;

    function tlOnPointerDown(evt: PointerEvent) {
        const e = unref(tlEl)!;
        tlStartX = evt.clientX;
        tlStartTimestamp = tlScenarioTime.value.valueOf();
        e.setPointerCapture(evt.pointerId);
        tlIsPointerInteraction.value = true;
        tlIsDragging.value = false;
    }

    function tlOnPointerUp(evt: PointerEvent) {
        if (!tlIsDragging.value && evt.button !== 2) {
            const { date, diff } = tlCalculatePixelDate(evt.clientX);
            tlAnimate.value = true;
            tlDraggedDiff.value = -diff;
            date.setUTCMinutes(Math.round(date.getUTCMinutes() / 15) * 15);
            tlSetCurrentTime(date.valueOf());
        } else {
            tlAnimate.value = false;
            tlDraggedDiff.value = 0;
        }
        tlIsPointerInteraction.value = false;
        tlIsDragging.value = false;
        tlAccumulatedDrag = 0;
    }

    const tlThrottledTimeUpdate = useThrottleFn(tlSetCurrentTime, 0);

    function tlOnPointerMove(evt: PointerEvent) {
        if (tlIsPointerInteraction.value) {
            const diff = evt.clientX - tlStartX;
            tlAccumulatedDrag += Math.abs(diff);
            if (tlAccumulatedDrag < 5) {
                tlIsDragging.value = false;
                return;
            } else {
                tlIsDragging.value = true;
            }
            tlDraggedDiff.value = diff;
            const msPerPixel = (TL_MS_PER_HOUR * 24) / tlMajorWidth.value;
            tlCurrentTimestamp.value = Math.floor(tlStartTimestamp - diff * msPerPixel);
            tlThrottledTimeUpdate(tlCurrentTimestamp.value);
        }
    }

    function tlOnHover(e: MouseEvent) {
        const { date } = tlCalculatePixelDate(e.clientX);
        date.setUTCMinutes(Math.round(date.getUTCMinutes() / 15) * 15);
        tlHoveredX.value = e.clientX;
        tlHoveredDate.value = date;
    }

    const tlFormattedHoveredDate = computed(() => {
        if (!tlHoveredDate.value) return "";
        const ts = +tlHoveredDate.value;
        const fmt = tlFmtStore.value?.scenarioFormatter ?? tlFallbackFormatter;
        return fmt.format(ts);
    });

    const tlFormattedCurrentDate = computed(() => {
        const ts = +tlScenarioTime.value;
        const fmt = tlFmtStore.value?.scenarioFormatter ?? tlFallbackFormatter;
        return fmt.format(ts);
    });

    function tlOnWheel(e: WheelEvent) {
        e.preventDefault();
        e.stopPropagation();

        const width = tlWidth.value || 800;
        const x = e.clientX;
        const rect = tlEl.value?.getBoundingClientRect();
        const localX = rect ? (x - rect.left) : (width / 2);

        const oldW = tlMajorWidth.value;
        const zoomStep = 40;
        const newW = e.deltaY > 0 ? Math.max(oldW - zoomStep, 55) : (oldW + zoomStep);
        if (newW === oldW) return;

        const center = width / 2;
        const dx = localX - center;

        const oldMsPerPx = TL_MS_PER_DAY / oldW;
        const newMsPerPx = TL_MS_PER_DAY / newW;

        const tsAtX = tlCenterTimeStamp.value + dx * oldMsPerPx;
        const newCenter = tsAtX - dx * newMsPerPx;

        tlMajorWidth.value = newW;
        tlCenterTimeStamp.value = newCenter;
    }

    /* events list for bars/markers */
    const tlEvents = computed(() => {
        return tlStore.state.events.map((id: string) => tlStore.state.eventMap[id]);
    });

    /* histogram & recompute */
    function tlToArrayHistogram(h: any): { t: number; count: number }[] {
        if (!h) return [];
        if (Array.isArray(h) && h.length && typeof h[0] === "object" && "t" in h[0] && "count" in h[0]) {
            return h as { t: number; count: number }[];
        }
        if (h instanceof Map) {
            const arr: { t: number; count: number }[] = [];
            for (const [t, count] of h.entries()) arr.push({ t: Number(t), count: Number(count) });
            arr.sort((a, b) => a.t - b.t);
            return arr;
        }
        if (typeof h === "object") {
            const arr: { t: number; count: number }[] = [];
            for (const k of Object.keys(h)) {
                const t = Number(k);
                const c = Number((h as any)[k]);
                if (Number.isFinite(t) && Number.isFinite(c)) arr.push({ t, count: c });
            }
            arr.sort((a, b) => a.t - b.t);
            return arr;
        }
        return [];
    }

    // 1) Follow scenario time only when it changes
    watch(() => +tlScenarioTime.value, (v) => {
        tlCurrentTimestamp.value = v;
        tlCenterTimeStamp.value = v;
    }, { immediate: true });

    // 2) Recompute ticks/offsets on size/zoom/step changes, using current center
    watch([tlWidth, tlMajorWidth, tlMinorStep], () => {
        const width = tlWidth.value || 800;
        const safeMajor = Math.max(1, tlMajorWidth.value);

        const { minDate, maxDate } = tlUpdateTicks(
            new Date(tlCenterTimeStamp.value),
            width,
            safeMajor,
            tlMinorStep.value
        );

        const binMs = tlMinorStep.value * TL_MS_PER_HOUR;
        const rawHist =
            typeof tlComputeTimeHistogram === "function"
                ? tlComputeTimeHistogram(+minDate, +maxDate, binMs)
                : [];

        const arr = tlToArrayHistogram(rawHist);
        tlHistogram = arr;
        tlMaxCount = Math.max(1, ...arr.map(h => h.count));
        (tlCountColor as any).domain([1, tlMaxCount]);

        const dayOffset = (tlCenterTimeStamp.value - (+minDate)) / TL_MS_PER_DAY;
        tlXOffset.value = width / 2 - dayOffset * safeMajor;
    }, { immediate: true });

    /* context menu actions */
    function tlOnContextMenuAction(action: string, options?: Record<string, any>) {
        if (action === "zoomIn") {
            tlMajorWidth.value += 40;
        } else if (action === "zoomOut") {
            tlMajorWidth.value = Math.max(tlMajorWidth.value - 40, 55);
        } else if (action === "addScenarioEvent") {
            const day = tlHoveredDate.value!.getDate();
            const eventId = tlAddScenarioEvent({
                title: `Event ${day}`,
                startTime: +tlHoveredDate.value!,
            });

            const sel = selectedItemsStoreRef.value;
            if (sel?.activeScenarioEventId) {
                sel.activeScenarioEventId.value = eventId;
            }
        }
    }
</script>

<template>
    <div class="globe-wrap">

        <!-- Globe canvas -->
        <div ref="mountRef" class="globe-host"></div>

        <!-- Left controls -->
        <div class="controls-drawer controls-drawer--left" :class="{ closed: !controlsOpen }">
            <button class="drawer-toggle" @click="toggleControls" :aria-expanded="controlsOpen">
                <span v-if="controlsOpen">«</span>
                <span v-else>»</span>
            </button>

            <div class="controls">
                <div class="row">
                    <label>
                        Base layer
                        <select v-model="selectedLayer">
                            <option v-for="l in layers" :key="l.name" :value="l.name">{{ l.name }}</option>
                        </select>
                    </label>
                </div>
                <!-- Imported layers (draped imagery) -->
                <div class="row" style="flex-direction: column; align-items: stretch; gap: 8px;">
                    <div style="font-weight: 600;">Imported layers</div>

                    <div v-if="!importedLayers.length" class="badge">No imported layers detected</div>

                    <div v-for="row in importedLayers" :key="row.id"
                         style="display:flex; align-items:center; gap:10px;">
                        <label style="display:flex; align-items:center; gap:6px; flex: 1 1 auto;">
                            <input type="checkbox" v-model="row.on" @change="onToggleImported(row.id)" />
                            <span>{{ row.title || row.id }}</span>
                        </label>

                        <input type="range"
                               :min="0" :max="1" :step="0.05"
                               v-model.number="row.alpha"
                               @input="onAlphaImported(row.id)"
                               title="Opacity" style="width:140px;" />
                        <span class="badge" style="min-width:44px; text-align:right;">
                            {{ (row.alpha ?? 1).toFixed(2) }}
                        </span>
                    </div>
                </div>
                <div class="row">
                    <label>Lat <input v-model.number="lat" type="number" step="0.0001" /></label>
                    <label>Lon <input v-model.number="lon" type="number" step="0.0001" /></label>
                    <label>Hgt (m) <input v-model.number="height" type="number" step="100" /></label>
                    <button @click="fly">Fly</button>
                </div>

                <div class="row">
                    <label>
                        Exaggeration
                        <input v-model.number="exaggeration" type="range" :min="0.01" :max="5" :step="0.01" />
                        <span class="badge">{{ exaggeration.toFixed(2) }}×</span>
                    </label>
                </div>
            </div>
        </div>

        <!-- Timeline (bottom) — inlined ScenarioTimeline template -->
        <div class="timeline-overlay" v-if="timelineReady">
            <TimelineContextMenu @action="tlOnContextMenuAction"
                                 v-slot="{ onContextMenu }"
                                 :formattedHoveredDate="tlFormattedHoveredDate">
                <div ref="tlEl"
                     class="relative mb-0 w-full overflow-hidden border-t border-border text-sm select-none"
                     @wheel.prevent.stop="tlOnWheel"
                     @pointerdown="tlOnPointerDown"
                     @pointerup="tlOnPointerUp"
                     @pointermove="tlOnPointerMove"
                     @mousemove="tlOnHover"
                     @mouseenter="tlShowHoverMarker = true"
                     @mouseleave="tlShowHoverMarker = false"
                     @contextmenu="onContextMenu">

                    <!-- A. subtle grey scrim behind ticks (doesn't block input) -->
                    <div class="timeline-scrim" aria-hidden="true"></div>

                    <!-- sliding strip -->
                    <div class="timeline-strip touch-none text-sm select-none"
                         :class="tlAnimate ? 'transition-all' : 'transition-none'"
                         :style="{ transform: `translate(${tlTotalXOffset}px)`, width: tlTimelineWidth + 'px' }">
                        <!-- Major day ticks row -->
                        <div class="flex justify-center">
                            <div v-for="(t, i) in tlMajorTicks"
                                 :key="'maj-' + i + '-' + t.timestamp"
                                 class="flex shrink-0 items-center justify-center border-x px-2"
                                 :style="{ width: tlMajorWidth + 'px' }">
                                {{ t.label }}
                            </div>
                        </div>

                        <!-- Minor hour ticks row -->
                        <div class="flex items-center">
                            <div v-for="(t, i) in tlMinorTicks"
                                 :key="'min-' + i + '-' + t.timestamp"
                                 class="minor-tick flex shrink-0 items-center justify-center border-r"
                                 :style="{ width: tlMinorWidth + 'px' }">
                                <i class="tick-line" aria-hidden="true"></i>
                                <span class="opacity-90">{{ t.label }}</span>
                            </div>
                        </div>
                    </div>

                    <!-- hover readout + hairline -->
                    <p v-if="tlShowHoverMarker && !tlIsDragging"
                       class="timeline-readout">
                        {{ tlFormattedHoveredDate }}
                    </p>
                    <div v-if="tlShowHoverMarker"
                         class="timeline-hair"
                         :style="`left: ${tlHoveredX}px`" />

                    <!-- B. fixed center overlay: pill + arrow (always at screen center) -->
                    <div class="center-overlay" aria-hidden="true">
                        <div class="center-pill">{{ tlFormattedCurrentDate }}</div>
                        <IconTriangleDown class="center-triangle" />
                    </div>
                </div>
            </TimelineContextMenu>
        </div>

        <!-- Right drawer: fully hideable -->
        <div class="controls-drawer controls-drawer--right" :class="{ closed: !rightOpen }">
            <!-- Panel -->
            <div class="controls" style="min-width: 260px; gap: 12px;">
                <!-- Box 1: Environment -->
                <div class="row" style="flex-direction: column; align-items: stretch; gap: 8px;">
                    <div style="font-weight: 600;">Environment</div>
                    <div style="display:flex; gap:8px; flex-wrap: wrap;">
                        <button @click="toggleDayNight" :class="{ active: isDayNight }">🌞 Day/Night</button>
                        <button @click="toggleSkybox" :class="{ active: isSkybox }">🌌 Skybox</button>
                        <button @click="toggleRangeRings3D" :class="{ active: showRangeRings3D }">🎯 3D Range-rings</button>
                    </div>
                </div>

                <!-- Clock (scenario time) -->
                <div class="row clock-row" style="align-items:center; justify-content:space-between;">
                    <div class="clock-face" style="display:flex; align-items:center; gap:8px;">
                        <span aria-hidden="true">🕒</span>
                        <span>{{ scenarioClock }}</span>
                        <span class="tz" style="opacity:0.85; font-size:12px;">{{ scenarioTzLabel }}</span>
                    </div>
                </div>

                <!-- Jump to time (local) -->
                <div class="row jump-row">
                    <div class="jump-label">Jump-to-Time</div>

                    <div class="jump-controls">
                        <input id="jumpTimeLocal"
                               class="jump-input"
                               type="datetime-local"
                               v-model="jumpTimeLocal"
                               @keydown.enter.prevent="jumpToTime" />
                        <button class="jump-go" @click="jumpToTime" title="Set scenario time">Go</button>
                    </div>
                </div>



                <!-- Box 2: Playback / Compass -->
                <div class="row" style="flex-direction: column; align-items: stretch; gap: 8px;">
                    <div style="font-weight: 600;">Playback</div>

                    <!-- ▶▶▶ Speed chevrons (reverse / normal / forward) -->
                    <div class="ff-row" style="display:flex; gap:6px; flex-wrap: wrap;">
                        <button @click="setSpeedAndPlay(-60)" :class="{ active: isPlaying && speed === -60 }" title="Reverse by Minute">«</button>
                        <button @click="setSpeedAndPlay(-3600)" :class="{ active: isPlaying && speed === -3600 }" title="Reverse by Hour">««</button>
                        <button @click="setSpeedAndPlay(-86400)" :class="{ active: isPlaying && speed === -86400 }" title="Reverse by Day">«««</button>
                        <button @click="togglePlayPause" :class="{ active: isPlaying && Math.abs(speed) === 1 }" title="Play/Pause">
                            {{ isPlaying ? '⏸' : '▶' }}
                        </button>
                        <button @click="setSpeedAndPlay(86400)" :class="{ active: isPlaying && speed === 86400 }" title="Forward by Day">»»»</button>
                        <button @click="setSpeedAndPlay(3600)" :class="{ active: isPlaying && speed === 3600 }" title="Forward by Hour">»»</button>
                        <button @click="setSpeedAndPlay(60)" :class="{ active: isPlaying && speed === 60 }" title="Forward by Minute">»</button>
                    </div>

                    <!-- Compass -->
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap: wrap;">
                        <!-- Button only visible when compass is hidden -->
                        <button v-if="!showCompass"
                                @click="openCompass"
                                class="compass-trigger"
                                title="Show compass">
                            🧭 Compass
                        </button>

                        <!-- Expanded compass replaces the button -->
                        <div v-else
                             class="compass-pop"
                             @click="closeCompass"
                             title="Click to hide compass">
                            <CompassWidget :globe="g" />
                        </div>
                        <!-- Measure tool -->
                        <div style="display:flex; align-items:center; gap:8px; flex-wrap: wrap;">
                            <button v-if="!showMeasure"
                                    @click="openMeasure"
                                    class="measure-trigger"
                                    title="Measure distances">
                                📏 Measure
                            </button>

                            <div v-else
                                 class="measure-pop"
                                 @click.stop>
                                <MeasureWidget :globe="g" @close="closeMeasure" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Tiny arrow tab (mirrored) -->
            <button class="drawer-toggle drawer-toggle--right" @click="toggleRight" :aria-expanded="rightOpen">
                <span v-if="rightOpen">»</span>
                <span v-else>«</span>
            </button>
        </div>
    </div>
</template>

<style scoped>
    .clock-row {
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
    }


    /* ───────────────────── Layout shell ───────────────────── */
    .globe-wrap {
        position: relative;
        inset: 0;
        width: 100%;
        height: 100%;
        min-height: 100vh;
    }

    .globe-host {
        position: absolute;
        inset: 0;
        z-index: 0;
    }

    /* ───────────────────── Shared control panel ───────────────────── */
    .controls {
        background: rgba(0, 0, 0, 0.65);
        color: #fefefe;
        border-radius: 10px;
        display: grid;
        gap: 8px;
        font: 14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, "Helvetica Neue", Arial, "Noto Sans";
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
        transform: translateX(0);
        transition: transform 180ms ease-in-out, width 180ms ease-in-out, padding 180ms ease-in-out, opacity 120ms ease-in-out;
        overflow: hidden;
        padding: 10px 12px;
        opacity: 1;
    }

    /* Wider left panel (50% larger than before) */
    .controls-drawer--left .controls {
        width: 300px;
    }

    .controls-drawer--right .controls {
        width: 260px;
    }

    /* Inside the panel */
    .controls .row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
    }

    .controls label {
        display: flex;
        align-items: center;
        gap: 4px;
        color: #fff;
        font-weight: 500;
    }

    .controls .badge {
        padding: 2px 6px;
        border-radius: 6px;
        background: rgba(32,32,32,0.6);
        border: 1px solid rgba(255,255,255,0.2);
        color: #fff;
        font-weight: 500;
    }

    /* Inputs & dropdowns */
    .controls input[type="number"],
    .controls select,
    .controls input[type="range"] {
        background: rgba(255,255,255,0.1);
        border: 1px solid rgba(255,255,255,0.25);
        color: #fefefe;
        border-radius: 4px;
        padding: 3px 6px;
        font-size: 13px;
    }

    .controls input[type="range"] {
        accent-color: #4ea3ff !important;
    }

    .controls select {
        background-color: rgba(25,25,25,0.9);
        color: #fefefe;
        appearance: none;
    }

    select option {
        background-color: #1e1e1e;
        color: #fefefe;
    }

    /* Buttons */
    .controls button {
        background: rgba(255,255,255,0.15);
        border: 1px solid rgba(255,255,255,0.35);
        border-radius: 6px;
        color: #fff;
        font-weight: 600;
        cursor: pointer;
        padding: 5px 10px;
        transition: background 0.2s, color 0.2s;
    }

        .controls button:hover {
            background: rgba(255,255,255,0.4);
            color: #000;
        }

    /* ───────────────────── Drawers (left & right) ───────────────────── */
    .controls-drawer,
    .controls-drawer--left,
    .controls-drawer--right {
        position: absolute;
        top: 12px;
        z-index: 10050;
        display: flex;
        align-items: flex-start;
        gap: 6px;
        pointer-events: none;
    }

    .controls-drawer--left {
        left: 12px;
        flex-direction: row;
    }

    .controls-drawer--right {
        right: 12px;
        flex-direction: row;
    }

    .controls-drawer .controls,
    .controls-drawer .drawer-toggle {
        pointer-events: auto;
    }

    /* Fully hide when closed */
    .controls-drawer--left.closed .controls {
        transform: translateX(calc(-100% - 8px));
        width: 0;
        padding: 0;
        opacity: 0;
        pointer-events: none;
        box-shadow: none;
    }

    .controls-drawer--right.closed .controls {
        transform: translateX(calc(100% + 8px));
        width: 0;
        padding: 0;
        opacity: 0;
        pointer-events: none;
        box-shadow: none;
    }

    /* ───────────────────── Drawer toggle buttons (small tabs) ───────────────────── */
    .drawer-toggle,
    .drawer-toggle--right {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 32px;
        padding: 0;
        margin-top: 4px;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,0.35);
        background: rgba(0,0,0,0.65);
        color: #fff;
        cursor: pointer;
        user-select: none;
        backdrop-filter: blur(2px);
        box-shadow: 0 2px 8px rgba(0,0,0,0.35);
        z-index: 10070;
    }

    .controls-drawer--left .drawer-toggle {
        order: 0;
        margin-right: 4px;
    }

    .controls-drawer--right .drawer-toggle--right {
        order: 2;
        margin-left: 4px;
    }

    /* ───────────────────── Playback buttons smaller ───────────────────── */
    /* Playback row: slightly smaller buttons so they don't wrap */
    .ff-row {
        display: flex;
        gap: 4px;
        justify-content: center;
        align-items: center;
        flex-wrap: nowrap; /* keep to one line */
    }

        .ff-row > button {
            min-width: 26px; /* was 32px/42px */
            padding: 2px 5px; /* a little tighter */
            font-size: 12px; /* slightly smaller text */
            line-height: 1.1;
        }


    /* ───────────────────── Timeline overlay ───────────────────── */
    .timeline-overlay {
        position: fixed;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 10010;
        pointer-events: auto;
    }

    .timeline-scrim {
        position: absolute;
        inset: 0;
        background: rgba(34,34,34,0.35);
        pointer-events: none;
    }

    .timeline-strip {
        position: relative;
        z-index: 1;
    }

    .timeline-hair, .timeline-readout {
        z-index: 3;
    }

    .center-overlay {
        position: absolute;
        left: 50%;
        top: -26px;
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        pointer-events: none;
        z-index: 4;
    }

    .center-pill {
        padding: 2px 8px;
        border-radius: 8px;
        background: rgba(60,60,60,0.85);
        color: #fff;
        font-size: 12px;
        line-height: 1.2;
        border: 1px solid rgba(255,255,255,0.18);
        text-shadow: 0 1px 1px rgba(0,0,0,0.45);
        white-space: nowrap;
    }

    .center-triangle {
        width: 12px;
        height: 12px;
        color: #d0d0d0;
        filter: drop-shadow(0 1px 1px rgba(0,0,0,0.45));
        opacity: 0.95;
    }

    /* ───────────────────── Misc ───────────────────── */
    .compass-container {
        position: absolute;
        top: 1rem;
        right: 1rem;
        z-index: 100;
        background: rgba(0,0,0,0.25);
        border-radius: 9999px;
        padding: 0.25rem;
        pointer-events: auto;
    }

    /* Compact, floaty container for the expanded compass */
    .compass-pop {
        display: inline-flex;
        padding: 4px;
        border-radius: 8px;
        background: rgba(0,0,0,0.35);
        border: 1px solid rgba(255,255,255,0.25);
        box-shadow: 0 2px 10px rgba(0,0,0,.45);
        cursor: pointer; /* indicates you can click to collapse */
    }

    .compass-trigger {
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }

        .compass-trigger span {
            transition: opacity .15s ease;
        }

    .measure-pop {
        display: inline-flex;
        padding: 4px;
        border-radius: 8px;
        background: rgba(0,0,0,0.35);
        border: 1px solid rgba(255,255,255,0.25);
        box-shadow: 0 2px 10px rgba(0,0,0,.45);
    }

    .measure-trigger {
        display: inline-flex;
        align-items: center;
        gap: 6px;
    }

        .measure-trigger span {
            transition: opacity .15s ease;
        }


    /* --- Jump to time block --- */
    .jump-row {
        display: flex;
        flex-direction: column; /* label on its own line */
        gap: 4px;
        align-items: stretch;
    }

    .jump-label {
        font-weight: 600;
        white-space: nowrap;
    }

    .jump-controls {
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        flex-wrap: nowrap;
    }

    .jump-input {
        flex: 1 1 auto;
        min-width: 0;
        background: rgba(255,255,255,0.1);
        border: 1px solid rgba(255,255,255,0.25);
        color: #fefefe;
        border-radius: 4px;
        padding: 3px 6px;
        font-size: 13px;
    }

    .jump-go {
        flex: 0 0 auto;
        padding: 5px 10px;
        font-size: 13px;
        background: rgba(255,255,255,0.15);
        border: 1px solid rgba(255,255,255,0.35);
        border-radius: 6px;
        color: #fff;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.2s, color 0.2s;
    }

        .jump-go:hover {
            background: rgba(255,255,255,0.4);
            color: #000;
        }

    /* Center section titles like "Environment" and "Playback" */
    .controls .row > div[style*="font-weight: 600"],
    .controls .row > .section-title {
        text-align: center;
        width: 100%;
    }

    /* Center the button groups within Environment and Playback */
    .controls .row[style*="flex-direction: column"] {
        align-items: center !important; /* center horizontally */
        text-align: center;
    }

    /* Make the Environment and Playback titles bold + centered */
    .controls .row > div[style*="font-weight: 600"] {
        font-weight: 600 !important;
        text-align: center !important;
        margin-bottom: 4px;
    }

    /* Center the compass button horizontally in its row */
    .controls .row button[title="Show compass"] {
        display: block;
        margin: 0 auto;
    }
</style>