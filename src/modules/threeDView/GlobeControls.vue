<!-- src/modules/threeDView/GlobeControls.vue -->
<script setup lang="ts">
    import { ref, shallowRef, computed, watch, onMounted, nextTick } from "vue";

    /* ───────────────────────── Globe API contract ───────────────────────── */
    type GlobeApi = {
        setBaseLayer?: (key: string) => void;
        setBaseLayerTemplate?: (
            url: string,
            opts?: {
                minLevel?: number;
                maxLevel?: number;
                attribution?: string;
                geographic?: boolean;
                subdomains?: string[] | string;
            }
        ) => void;
        setExaggeration?: (v: number) => Promise<void> | void;
        enableDayNight?: (enabled: boolean) => void;
        enableSkybox?: (enabled: boolean) => void;
    };

    const props = defineProps<{ globe: GlobeApi | null | undefined }>();

    /* ───────────────────────── Base layers from 2D config ───────────────────────── */
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

    const layerOptions = ref<BaseLayerRec[]>([]);
    const layersReady = ref(false);
    const selectedName = ref<string>("");

    const lazyUseMapSettingsStore = () =>
        import("@/stores/mapSettingsStore").then(m => m.useMapSettingsStore);
    type MapSettingsStoreT = ReturnType<import("@/stores/mapSettingsStore").useMapSettingsStore>;
    const mapSettings = shallowRef<MapSettingsStoreT | null>(null);

    function normalize2DConfig(data: any): BaseLayerRec[] {
        const arr = Array.isArray(data) ? data : Object.values(data ?? {});
        return arr.map((it: any) => {
            const src = it.sourceOptions ?? {};
            const isOSM = it.layerSourceType === "osm";
            const isXYZ = it.layerSourceType === "xyz";
            const defaultOSM = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
            const url = (isXYZ && src.url) || (isOSM && (src.url || defaultOSM)) || undefined;
            return {
                name: it.title ?? it.name ?? "Layer",
                key: it.name,
                url,
                minLevel: 0,
                maxLevel: typeof src.maxZoom === "number" ? src.maxZoom : 19,
                attribution: src.attributions,
                scheme: "webMercator",
                subdomains: url === defaultOSM ? "abc" : undefined,
            } as BaseLayerRec;
        });
    }

    /* Legacy fallbacks if 2D config isn't available */
    import {
        listImageryOptions,
        getAnyByKey,
        makeImageryProviders as legacyMakeImageryProviders,
    } from "@/modules/threeDView/makeImageryProviders";

    async function loadBaseLayersFrom2D() {
        layersReady.value = false;
        try {
            const res = await fetch("/config/mapConfig.json");
            const data = await res.json();
            const cfg = normalize2DConfig(data);
            if (cfg.length) {
                layerOptions.value = cfg;
                return;
            }
            throw new Error("Empty 2D mapConfig.json");
        } catch (e) {
            console.warn("[GlobeControls] 2D mapConfig.json not available, falling back to 3D providers:", e);
            try {
                const listFn = (listImageryOptions as unknown) as (() => Promise<any[]>);
                if (typeof listFn === "function") {
                    const opts = await listFn();
                    layerOptions.value = (opts || []).map((o: any) => ({ name: o.label ?? o.key, key: o.key }));
                } else {
                    const { providers } = legacyMakeImageryProviders() as any;
                    layerOptions.value = (providers || []).map((p: any) => ({ name: p.label ?? p.key, key: p.key }));
                }
            } catch (err) {
                console.error("[GlobeControls] Failed to build fallback providers:", err);
                layerOptions.value = [];
            }
        } finally {
            layersReady.value = true;
        }
    }

    async function applyBaseLayer(rec: BaseLayerRec) {
        if (!props.globe) return;
        if (rec.url && props.globe.setBaseLayerTemplate) {
            props.globe.setBaseLayerTemplate(rec.url, {
                minLevel: rec.minLevel,
                maxLevel: rec.maxLevel,
                attribution: rec.attribution,
                geographic: rec.scheme === "geographic",
                subdomains: rec.subdomains,
            });
        } else if (rec.key) {
            const anyFn = (getAnyByKey as unknown) as ((k: string) => Promise<any | undefined>);
            if (typeof anyFn === "function") {
                const entry = await anyFn(rec.key);
                if (entry?.kind === "template" && entry.template?.url && props.globe.setBaseLayerTemplate) {
                    const t = entry.template;
                    props.globe.setBaseLayerTemplate(t.url, {
                        minLevel: t.minLevel,
                        maxLevel: t.maxLevel,
                        attribution: t.attribution,
                        geographic: t.geographic,
                        subdomains: t.subdomains,
                    });
                } else {
                    props.globe.setBaseLayer?.(rec.key);
                }
            } else {
                props.globe.setBaseLayer?.(rec.key);
            }
        }
    }

    async function onLayerChange(ev: Event) {
        const name = (ev.target as HTMLSelectElement).value;
        selectedName.value = name;
        const rec = layerOptions.value.find((l) => l.name === name);
        if (!rec) return;
        await applyBaseLayer(rec);
        if (mapSettings.value) {
            const key = rec.key || rec.name;
            if (key && mapSettings.value.baseLayerName !== key) {
                mapSettings.value.baseLayerName = key;
            }
        }
    }

    /* ───────────────────────── Exaggeration & Toggles ───────────────────────── */
    const exag = ref<number>(1);
    watch(exag, (v) => props.globe?.setExaggeration?.(v));

    const dayNight = ref<boolean>(false);
    const skybox = ref<boolean>(false);
    watch(dayNight, (on) => props.globe?.enableDayNight?.(on));
    watch(skybox, (on) => props.globe?.enableSkybox?.(on));

    /* ───────────────────────── Lifecycle ───────────────────────── */
    onMounted(async () => {
        try {
            const useMapSettingsStore = await lazyUseMapSettingsStore();
            mapSettings.value = useMapSettingsStore();
        } catch (e) {
            console.warn("[GlobeControls] useMapSettingsStore() failed:", e);
        }

        await loadBaseLayersFrom2D();

        // Apply selection from store or default to first entry
        if (mapSettings.value?.baseLayerName) {
            const byStore = layerOptions.value.find(
                l => l.key?.toLowerCase() === mapSettings.value!.baseLayerName.toLowerCase()
                    || l.name.toLowerCase() === mapSettings.value!.baseLayerName.toLowerCase()
            );
            if (byStore) selectedName.value = byStore.name;
        }
        if (!selectedName.value && layerOptions.value.length)
            selectedName.value = layerOptions.value[0].name;

        const rec = layerOptions.value.find((l) => l.name === selectedName.value);
        if (rec) await applyBaseLayer(rec);

        // Push current toggle/exaggeration values
        props.globe?.setExaggeration?.(exag.value);
        props.globe?.enableDayNight?.(dayNight.value);
        props.globe?.enableSkybox?.(skybox.value);

        await nextTick();
    });
</script>

<template>
    <div class="controls">
        <!-- Base layer (mirrors 2D mapConfig + store) -->
        <div class="row">
            <label>
                Base layer:
                <select :disabled="!layersReady || layerOptions.length === 0"
                        :value="selectedName"
                        @change="onLayerChange">
                    <option v-for="o in layerOptions" :key="o.name" :value="o.name">
                        {{ o.name }}
                    </option>
                </select>
            </label>
            <span class="debug">{{ layersReady ? layerOptions.length : 0 }} layers</span>
        </div>

        <!-- Exaggeration -->
        <div class="row">
            <label>
                Exaggeration: {{ exag.toFixed(2) }}
                <input type="range" min="0.01" max="5" step="0.01" v-model.number="exag" />
            </label>
        </div>

        <!-- Lighting / Atmosphere -->
        <div class="row">
            <label class="checkbox" title="Realistic sun lighting & terminator">
                <input type="checkbox" v-model="dayNight" />
                🌞 Day/Night
            </label>

            <label class="checkbox" title="Skybox + Sun/Moon glyphs">
                <input type="checkbox" v-model="skybox" />
                🌌 Skybox
            </label>
        </div>
    </div>
</template>

<style scoped>
    .controls {
        position: absolute;
        top: 12px;
        left: 12px;
        background: rgba(0,0,0,0.7);
        color: #fff;
        padding: 10px 12px;
        border-radius: 8px;
        font: 14px/1.3 system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, "Helvetica Neue", Arial, "Noto Sans", "Apple Color Emoji", "Segoe UI Emoji";
        z-index: 100000;
        pointer-events: auto;
        min-width: 420px;
    }

    .row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 8px;
        flex-wrap: wrap;
    }

        .row:first-child {
            margin-top: 0;
        }

    select, input[type="range"] {
        margin-left: 8px;
    }

    select {
        background: #fff;
        color: #111;
        border: 1px solid #999;
        border-radius: 4px;
        padding: 2px 4px;
    }

    .checkbox {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        user-select: none;
        cursor: pointer;
    }

    .debug {
        opacity: 0.8;
        font-size: 12px;
    }
</style>
