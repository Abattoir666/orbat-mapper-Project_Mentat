<script setup lang="ts">
    import { ref, watch, computed, onMounted } from "vue";
    import InputGroup from "@/components/InputGroup.vue";
    import BaseButton from "@/components/BaseButton.vue";
    import { useFocusOnMount } from "@/components/helpers";
    import type { ScenarioFIRMSLayer, FirmsTimeMode, FirmsAreaMode } from "@/types/scenarioGeoModels";

    interface Props {
        layer: ScenarioFIRMSLayer;
    }
    const props = defineProps<Props>();
    const emit = defineEmits(["update", "cancel"]);

    const { focusId } = useFocusOnMount();

    type FIRMSFormData = {
        url: string;
        mapKey: string;
        source: string;

        area: string;
        areaMode: FirmsAreaMode;
        countryFiles: string[];
        clipToCountries: boolean;

        timeMode: FirmsTimeMode;
        windowBackHours: number;
        windowForwardHours: number;

        maxDetections: number;
        pointRadius: number;

        // Caching / prefetch (optional; stored on the layer)
        cacheEnabled: boolean;
        cacheBackDays: number;
        cacheForwardDays: number;
        maxCachedDays: number;

        // Filtering
        confidenceMode: "off" | "dropLowOrLt50" | "numeric";
        minConfidence: number;
        enableFrpFilter: boolean;
        minFrpMw: number;

        // Persistent hotspot suppression
        suppressPersistentHotspots: boolean;
        persistenceDays: number;
        persistenceCellDeg: number;
        persistenceMinDetections: number;

        _isNew?: boolean;
    };

    const formData = ref<FIRMSFormData>({
        url: props.layer.url,
        mapKey: props.layer.mapKey,
        source: props.layer.source,

        area: props.layer.area,
        areaMode:
            props.layer.areaMode ??
            ((props.layer.area ?? "").trim().toLowerCase() === "world" ? "world" : "bbox"),
        countryFiles: props.layer.countryFiles ?? [],
        clipToCountries: props.layer.clipToCountries ?? true,

        timeMode: (props.layer.timeMode ?? "hour") as FirmsTimeMode,
        windowBackHours: props.layer.windowBackHours ?? 24,
        windowForwardHours: props.layer.windowForwardHours ?? 0,

        maxDetections: props.layer.maxDetections ?? 50000,
        pointRadius: props.layer.pointRadius ?? 4,

        // ---- Caching / Prefetch ----
        cacheEnabled: (props.layer as any).cacheEnabled ?? true,
        cacheBackDays: (props.layer as any).cacheBackDays ?? 7,
        cacheForwardDays: (props.layer as any).cacheForwardDays ?? 3,
        maxCachedDays: (props.layer as any).maxCachedDays ?? 90,

        // ---- Filters (defaults tuned for ORBAT Mapper) ----
        confidenceMode: (props.layer as any).confidenceMode ?? "dropLowOrLt50",
        minConfidence: (props.layer as any).minConfidence ?? 50,
        enableFrpFilter: (props.layer as any).enableFrpFilter ?? true,
        minFrpMw: (props.layer as any).minFrpMw ?? 2,

        // ---- Persistent hotspot suppression ----
        suppressPersistentHotspots: (props.layer as any).suppressPersistentHotspots ?? true,
        persistenceDays: (props.layer as any).persistenceDays ?? 30,
        persistenceCellDeg: (props.layer as any).persistenceCellDeg ?? 0.02,
        persistenceMinDetections: (props.layer as any).persistenceMinDetections ?? 40,

        _isNew: false,
    });

    watch(
        () => props.layer,
        (v) => {
            formData.value = {
                url: v.url,
                mapKey: v.mapKey,
                source: v.source,

                area: v.area,
                areaMode:
                    v.areaMode ?? ((v.area ?? "").trim().toLowerCase() === "world" ? "world" : "bbox"),
                countryFiles: v.countryFiles ?? [],
                clipToCountries: v.clipToCountries ?? true,

                timeMode: (v.timeMode ?? "hour") as FirmsTimeMode,
                windowBackHours: v.windowBackHours ?? 24,
                windowForwardHours: v.windowForwardHours ?? 0,

                maxDetections: v.maxDetections ?? 50000,
                pointRadius: v.pointRadius ?? 4,

                // ---- Caching / Prefetch ----
                cacheEnabled: (v as any).cacheEnabled ?? true,
                cacheBackDays: (v as any).cacheBackDays ?? 7,
                cacheForwardDays: (v as any).cacheForwardDays ?? 3,
                maxCachedDays: (v as any).maxCachedDays ?? 90,

                // ---- Filters ----
                confidenceMode: (v as any).confidenceMode ?? "dropLowOrLt50",
                minConfidence: (v as any).minConfidence ?? 50,
                enableFrpFilter: (v as any).enableFrpFilter ?? true,
                minFrpMw: (v as any).minFrpMw ?? 2,

                // ---- Persistent hotspot suppression ----
                suppressPersistentHotspots: (v as any).suppressPersistentHotspots ?? true,
                persistenceDays: (v as any).persistenceDays ?? 30,
                persistenceCellDeg: (v as any).persistenceCellDeg ?? 0.02,
                persistenceMinDetections: (v as any).persistenceMinDetections ?? 40,

                _isNew: false,
            };
        },
        { immediate: true },
    );

    // ------------------------------------------------------------------------
    // Countries index + bbox union logic (existing behavior retained)
    // ------------------------------------------------------------------------

    type CountryIndex = { files: string[] };
    type BBox = { west: number; south: number; east: number; north: number };

    const BASE = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
    const assetUrl = (p: string) => BASE + p.replace(/^\/+/, "");

    const indexUrl = assetUrl("countrybordersjsonsindex.json");

    const countries = ref<string[]>([]);
    const indexLoadError = ref<string | null>(null);

    const countrySearch = ref("");
    const filteredCountries = computed(() => {
        const q = countrySearch.value.trim().toLowerCase();
        if (!q) return countries.value;
        return countries.value.filter((f) => labelFromFilename(f).toLowerCase().includes(q) || f.toLowerCase().includes(q));
    });

    function labelFromFilename(file: string): string {
        const base = file.split("/").pop() ?? file;
        const noExt = base.replace(/\.geo\.json$/i, "").replace(/\.json$/i, "");
        return noExt.replace(/[-_]/g, " ");
    }

    function bboxInit(): BBox {
        return { west: Number.POSITIVE_INFINITY, south: Number.POSITIVE_INFINITY, east: Number.NEGATIVE_INFINITY, north: Number.NEGATIVE_INFINITY };
    }

    function bboxExpand(b: BBox, lon: number, lat: number) {
        if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
        b.west = Math.min(b.west, lon);
        b.south = Math.min(b.south, lat);
        b.east = Math.max(b.east, lon);
        b.north = Math.max(b.north, lat);
    }

    function walkCoords(coords: any, cb: (lon: number, lat: number) => void) {
        if (!coords) return;
        if (typeof coords[0] === "number" && typeof coords[1] === "number") {
            cb(coords[0], coords[1]);
            return;
        }
        for (const c of coords) walkCoords(c, cb);
    }

    function bboxFromGeoJSON(geojson: any): BBox | null {
        const b = bboxInit();

        const handleGeom = (geom: any) => {
            if (!geom) return;
            if (geom.type === "GeometryCollection") {
                for (const g of geom.geometries ?? []) handleGeom(g);
                return;
            }
            walkCoords(geom.coordinates, (lon, lat) => bboxExpand(b, lon, lat));
        };

        if (geojson?.type === "FeatureCollection") {
            for (const f of geojson.features ?? []) handleGeom(f.geometry);
        } else if (geojson?.type === "Feature") {
            handleGeom(geojson.geometry);
        } else {
            handleGeom(geojson);
        }

        if (
            !Number.isFinite(b.west) ||
            !Number.isFinite(b.south) ||
            !Number.isFinite(b.east) ||
            !Number.isFinite(b.north) ||
            b.west === Number.POSITIVE_INFINITY
        ) {
            return null;
        }

        return b;
    }

    function bboxToAreaString(b: BBox): string {
        // FIRMS expects: west,south,east,north
        return `${b.west},${b.south},${b.east},${b.north}`;
    }

    const bboxComputing = ref(false);
    const lastBBox = ref<BBox | null>(null);

    async function loadCountryGeoJSON(file: string): Promise<any> {
        // Allow either "countries/xxx.json" style or bare "xxx.json"
        const p = file.includes("/") ? file : `countrybordersjsons/${file}`;
        const url = assetUrl(p);
        const resp = await fetch(url, { method: "GET" });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const raw = await resp.text();
        const cleaned = raw.replace(/^\uFEFF/, "");
        return JSON.parse(cleaned);
    }

    async function recomputeUnionBBoxFromSelected() {
        if (!formData.value.countryFiles?.length) {
            lastBBox.value = null;
            return;
        }

        bboxComputing.value = true;
        try {
            const union = bboxInit();

            for (const f of formData.value.countryFiles) {
                const geo = await loadCountryGeoJSON(f);
                const b = bboxFromGeoJSON(geo);
                if (b) {
                    bboxExpand(union, b.west, b.south);
                    bboxExpand(union, b.east, b.north);
                }
            }

            if (!Number.isFinite(union.west) || union.west === Number.POSITIVE_INFINITY) {
                lastBBox.value = null;
                return;
            }

            lastBBox.value = union;

            // When in countries mode, we drive FIRMS "area" by union bbox.
            if (formData.value.areaMode === "countries") {
                formData.value.area = bboxToAreaString(union);
            }
        } finally {
            bboxComputing.value = false;
        }
    }

    watch(
        () => formData.value.countryFiles.slice().join("|"),
        async () => {
            if (formData.value.areaMode !== "countries") return;
            await recomputeUnionBBoxFromSelected();
        },
    );

    // Keep your previous bugfix: when leaving Countries mode, don't accidentally keep clipping on.
    watch(
        () => formData.value.areaMode,
        (mode) => {
            if (mode !== "countries") {
                // Prevent "World" / "BBox" from still clipping to previously-selected countries.
                formData.value.clipToCountries = false;

                // Keep selections so the user can switch back to Countries without reselecting:
                // formData.value.countryFiles = [];
            }
        },
    );

    onMounted(async () => {
        indexLoadError.value = null;
        try {
            const resp = await fetch(indexUrl, { method: "GET" });
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

            // BOM-tolerant parse for your index file
            const raw = await resp.text();
            const cleaned = raw.replace(/^\uFEFF/, "");
            const data = JSON.parse(cleaned) as CountryIndex;

            const files: string[] = Array.isArray(data?.files) ? data.files : [];
            countries.value = files.filter((f) => typeof f === "string" && f.toLowerCase().endsWith(".json"));
        } catch (e) {
            indexLoadError.value = `Failed to load country index (${indexUrl}): ${String(e)}`;
            countries.value = [];
        }
    });

    function toggleCountry(file: string) {
        const set = new Set(formData.value.countryFiles ?? []);
        if (set.has(file)) set.delete(file);
        else set.add(file);
        formData.value.countryFiles = [...set].sort((a, b) => a.localeCompare(b));
    }

    function submit() {
        if (formData.value.areaMode === "world") {
            formData.value.area = "world";
        }

        emit("update", {
            ...formData.value,
            areaMode: formData.value.areaMode,
            countryFiles: formData.value.countryFiles,
            clipToCountries: formData.value.clipToCountries,
        });
    }
</script>

<template>
    <form @submit.prevent="submit" class="p-1">
        <div class="space-y-4">
            <InputGroup :id="focusId" label="API base URL" type="text" v-model="formData.url" required />

            <InputGroup label="MAP_KEY" type="password" v-model="formData.mapKey" placeholder="abcdef0123456789..." />

            <InputGroup label="Source" type="text" v-model="formData.source" placeholder="VIIRS_SNPP_SP" required />

            <div class="space-y-2">
                <div class="text-sm font-medium">Area mode</div>

                <label class="flex items-center gap-2 text-sm">
                    <input type="radio" value="world" v-model="formData.areaMode" />
                    World
                </label>

                <label class="flex items-center gap-2 text-sm">
                    <input type="radio" value="bbox" v-model="formData.areaMode" />
                    Bounding box
                </label>

                <label class="flex items-center gap-2 text-sm">
                    <input type="radio" value="countries" v-model="formData.areaMode" />
                    Countries (union bbox)
                </label>
            </div>

            <InputGroup label="Area"
                        type="text"
                        v-model="formData.area"
                        placeholder="world OR west,south,east,north"
                        :disabled="formData.areaMode === 'world' || formData.areaMode === 'countries'"
                        required />

            <div v-if="formData.areaMode === 'countries'" class="space-y-2 rounded border p-2">
                <div class="flex items-center justify-between">
                    <div class="text-sm font-medium">Countries</div>
                    <div class="text-xs text-gray-600">Selected: {{ formData.countryFiles.length }}</div>
                </div>

                <p v-if="indexLoadError" class="text-sm text-red-600">
                    {{ indexLoadError }}
                </p>

                <InputGroup label="Filter" type="text" v-model="countrySearch" placeholder="type to filter..." />

                <div class="max-h-64 overflow-auto rounded border p-2">
                    <div v-if="countries.length === 0 && !indexLoadError" class="text-sm text-gray-600">
                        No countries loaded (check /countrybordersjsonsindex.json)
                    </div>

                    <label v-for="file in filteredCountries" :key="file" class="flex items-center gap-2 py-1 text-sm">
                        <input type="checkbox" :checked="formData.countryFiles.includes(file)" @change="toggleCountry(file)" />
                        <span class="truncate">{{ labelFromFilename(file) }}</span>
                        <span class="ml-auto text-xs text-gray-500">{{ file }}</span>
                    </label>
                </div>

                <label class="mt-2 flex items-center gap-2 text-sm">
                    <input type="checkbox" v-model="formData.clipToCountries" />
                    Clip detections to country borders (slower, more precise)
                </label>

                <div class="mt-2 text-xs text-gray-600">
                    <span v-if="bboxComputing">Computing union bbox...</span>
                    <span v-else-if="lastBBox">Union bbox: {{ bboxToAreaString(lastBBox) }}</span>
                    <span v-else>Select one or more countries to compute a union bbox.</span>
                </div>

                <div class="mt-2">
                    <BaseButton small type="button" @click="recomputeUnionBBoxFromSelected" :disabled="bboxComputing">
                        Recompute bbox
                    </BaseButton>
                </div>
            </div>

            <div class="space-y-2">
                <div class="text-sm font-medium">Time mode</div>

                <label class="flex items-center gap-2 text-sm">
                    <input type="radio" value="hour" v-model="formData.timeMode" />
                    Hour (UTC)
                </label>

                <label class="flex items-center gap-2 text-sm">
                    <input type="radio" value="day" v-model="formData.timeMode" />
                    Day (UTC)
                </label>

                <label class="flex items-center gap-2 text-sm">
                    <input type="radio" value="window" v-model="formData.timeMode" />
                    Custom window
                </label>

                <div v-if="formData.timeMode === 'window'" class="grid grid-cols-2 gap-3">
                    <InputGroup label="Back (hours)" type="number" v-model.number="formData.windowBackHours" min="0" />
                    <InputGroup label="Forward (hours)" type="number" v-model.number="formData.windowForwardHours" min="0" />
                </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
                <InputGroup label="Max detections" type="number" v-model.number="formData.maxDetections" min="1" />
                <InputGroup label="Point radius" type="number" v-model.number="formData.pointRadius" min="1" />
            </div>

            <hr class="my-4" />

            <!-- Caching / Prefetch -->
            <div class="space-y-2 rounded border p-2">
                <div class="text-sm font-medium">Caching / Prefetch</div>

                <label class="flex items-center gap-2 text-sm">
                    <input type="checkbox" v-model="formData.cacheEnabled" />
                    Enable caching/prefetch (improves timeline scrubbing)
                </label>

                <div class="grid grid-cols-3 gap-3">
                    <InputGroup label="Cache back (days)" type="number" v-model.number="formData.cacheBackDays" min="0" />
                    <InputGroup label="Cache forward (days)" type="number" v-model.number="formData.cacheForwardDays" min="0" />
                    <InputGroup label="Max cached days (LRU)" type="number" v-model.number="formData.maxCachedDays" min="1" />
                </div>

                <p class="text-xs text-gray-600">
                    Note: FIRMS rendering remains time-sensitive (non-cumulative). Caching only reduces fetch churn.
                </p>
            </div>

            <hr class="my-4" />

            <!-- Filters -->
            <div class="space-y-2 rounded border p-2">
                <div class="text-sm font-medium">Filters</div>

                <div class="space-y-1">
                    <div class="text-sm font-medium">Confidence</div>

                    <label class="flex items-center gap-2 text-sm">
                        <input type="radio" value="dropLowOrLt50" v-model="formData.confidenceMode" />
                        Drop “low” (or numeric &lt; 50)
                    </label>

                    <label class="flex items-center gap-2 text-sm">
                        <input type="radio" value="numeric" v-model="formData.confidenceMode" />
                        Numeric threshold
                    </label>

                    <div v-if="formData.confidenceMode === 'numeric'" class="mt-2 grid grid-cols-2 gap-3">
                        <InputGroup label="Min confidence" type="number" v-model.number="formData.minConfidence" min="0" max="100" />
                        <div />
                    </div>

                    <label class="flex items-center gap-2 text-sm">
                        <input type="radio" value="off" v-model="formData.confidenceMode" />
                        Off
                    </label>
                </div>

                <div class="mt-3 space-y-2">
                    <label class="flex items-center gap-2 text-sm">
                        <input type="checkbox" v-model="formData.enableFrpFilter" />
                        Enable FRP filter
                    </label>

                    <div class="grid grid-cols-2 gap-3">
                        <InputGroup label="Min FRP (MW)" type="number" step="0.1" v-model.number="formData.minFrpMw" min="0" />
                        <div />
                    </div>
                </div>
            </div>

            <hr class="my-4" />

            <!-- Persistent hotspot suppression -->
            <div class="space-y-2 rounded border p-2">
                <div class="text-sm font-medium">Persistent hotspot suppression</div>

                <label class="flex items-center gap-2 text-sm">
                    <input type="checkbox" v-model="formData.suppressPersistentHotspots" />
                    Suppress persistent hotspots (gas flares, refineries, volcanoes, etc.)
                </label>

                <div class="grid grid-cols-3 gap-3">
                    <InputGroup label="History (days)" type="number" v-model.number="formData.persistenceDays" min="1" />
                    <InputGroup label="Cell size (deg)" type="number" step="0.001" v-model.number="formData.persistenceCellDeg" min="0.001" />
                    <InputGroup label="Min detections" type="number" v-model.number="formData.persistenceMinDetections" min="1" />
                </div>

                <p class="text-xs text-gray-600">
                    Uses cached history (when available) to learn “always-hot” cells and suppress them during render.
                </p>
            </div>
        </div>

        <footer class="mt-4 flex justify-end space-x-2">
            <BaseButton small primary type="submit">Update</BaseButton>
            <BaseButton small type="button" @click="emit('cancel')">Cancel</BaseButton>
        </footer>
    </form>
</template>
 