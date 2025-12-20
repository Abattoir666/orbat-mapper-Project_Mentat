<script setup lang="ts">
    /* ---------------- CSV Mapper + Import wiring ---------------- */
    import CsvColumnMapper from "@/components/CsvColumnMapper.vue";
    import { importRows, type ImportRow } from "@/importexport/importUnits";
    import { injectStrict } from "@/utils";
    import { ref, computed, watchEffect, h, shallowRef } from "vue";
    import { useNotifications } from "@/composables/notifications";

    /* ---------------- Existing ODIN Dragon importer ------------- */
    import { readSpreadsheet } from "@/extlib/xlsx-read-lazy";
    import BaseButton from "@/components/BaseButton.vue";
    import { inject as vueInject } from "vue";
    import { activeScenarioKey } from "@/components/injects";
    import type { ImportedFileInfo } from "@/importexport/fileHandling";
    import { detectSpreadsheetDialect } from "@/importexport/spreadsheets/utils";
    import {
        type OdinUnitInfoRow,
        parseOdinDragon,
    } from "@/importexport/spreadsheets/odinDragon";
    import type { Unit } from "@/types/scenarioModels";
    import SymbolCodeSelect from "@/components/SymbolCodeSelect.vue";
    import type { SymbolItem, NullableSymbolItem } from "@/types/constants";
    import { addUnitHierarchy } from "@/importexport/convertUtils";
    import InputCheckbox from "@/components/InputCheckbox.vue";
    import type { CellContext, ColumnDef, InitialTableState } from "@tanstack/vue-table";
    import DataGrid from "@/modules/grid/DataGrid.vue";
    import OrbatCellRenderer from "@/components/OrbatCellRenderer.vue";
    import { ChevronRightIcon } from "@heroicons/vue/20/solid";

    const __lastPlacements = ref<any[] | null>(null);

    const selectableParents = computed(() => {
        const s = (state?.value as any) || {};
        const sideGroupMap = s.sideGroupMap ?? {};
        const unitMap = s.unitMap ?? {};

        // Gather all group sub-unit IDs, flatten, map to unit objects
        const subIds = Object.values(sideGroupMap)
            .map((v: any) => v?.subUnits ?? [])
            .flat();

        return subIds
            .map((id: string) => unitMap[id])
            .filter(Boolean)
            .map((u: any) => ({
                text: u?.name ?? String(u?.id ?? "unknown"),
                code: String(u?.id ?? ""),
                sidc: u?.sidc,
            }));
    });

    type SelectItem = { text: string; value: string; sidc?: string };

    // Expose the name the template is bound to
    const rootUnitItems = computed<NullableSymbolItem[]>(() => {
        const s = (state?.value as any) || {};
        const sideGroupMap = s.sideGroupMap ?? {};
        const unitMap = s.unitMap ?? {};

        const subIds = Object.values(sideGroupMap)
            .map((v: any) => v?.subUnits ?? [])
            .flat();

        const list = subIds
            .map((id: string) => unitMap[id])
            .filter(Boolean)
            .map((u: any) => ({
                text: u?.name ?? String(u?.id ?? "unknown"),
                code: String(u?.id ?? ""), // <- SymbolCodeSelect needs 'code'
                sidc: u?.sidc,
            }));

        return list;
    });

    // --- NEW: store identity diags (one-time) ---
    if (typeof window !== "undefined") {
        (window as any).__imp = {
            ...(window as any).__imp,
            _whoami() {
                const s = store;
                const scen = scenario?.store;
                console.log("[whoami] has $patch:", typeof (s as any)?.$patch === "function");
                console.log("[whoami] has update :", typeof (s as any)?.update === "function");
                console.log("[whoami] s === scenario.store:", s === scen);
                console.log("[whoami] s.state === scenario.store.state:", s?.state === scen?.state);
                console.log("[whoami] keys unitMap:", Object.keys(s?.state?.unitMap || {}));
                console.log("[whoami] keys groupMap:", Object.keys(s?.state?.groupMap || {}));
                console.log("[whoami] keys sideGroupMap:", Object.keys(s?.state?.sideGroupMap || {}));
                return true;
            }
        };
    }
    // --- END NEW ---

    /* ---------------- Props / Emits ---------------- */
    interface Props {
        fileInfo: ImportedFileInfo;
    }
    const props = defineProps<Props>();
    const emit = defineEmits(["cancel", "loaded"]);
    const showCsvMapper = ref(props.fileInfo?.dialect === "CSV");
    const makeId = () =>
        (store?.io?.newId?.() as string | undefined) ??
        (globalThis?.crypto?.randomUUID?.() ?? `u_${Math.random().toString(36).slice(2)}`);

    function onCancel() {
        emit("cancel");
    }

    // --- Auto-open CSV mapper if this file was detected as CSV ---
    watchEffect(() => {
        // If the file was guessed as CSV upstream, show the CSV mapper tab
        if (props.fileInfo?.dialect === "CSV") {
            showCsvMapper.value = true;
        }
    });

    /* ---------------- Stores / Notifications -------- */
    // Try to get the wrapped scenario (may be null the first time)
    const scenario = vueInject(activeScenarioKey, null as any);

    // Prefer the scenario store if present, else fall back to global store
    const store = (scenario && scenario.store)
        ? scenario.store
        : (vueInject("scenarioStore", null as any));

    // A *safe* state object we can always read from
    const state = computed(() => (store?.state ?? {} as any));


    // --- DEBUG: what does this component actually see?
    console.log("[ImportSpreadsheetStep] fileInfo:", props.fileInfo);
    console.log("[ImportSpreadsheetStep] store.state.sides length:",
        Array.isArray(store?.state?.sides) ? store.state.sides.length : "not-an-array");

    import { watch } from "vue";
    watch(
        () => store?.state?.sides,
        (nv) => {
            const n = Array.isArray(nv) ? nv.length : "not-an-array";
            console.log("[ImportSpreadsheetStep] sides changed ->", n, nv);
        },
        { immediate: true, deep: true }
    );

    const { send } = useNotifications();


    // true once Pinia has populated sides
    const hasSides = computed(() => sideOptions.value.length > 0);

    /* ---------------- Helpers : find entities ---------- */

    function findGroupById(id: string): any | undefined {
        // Fast paths
        if (groupNodeMap.value[id]) return groupNodeMap.value[id];
        if (groupMap?.value?.[id]) return groupMap.value[id];

        // Walk sides → groups (resolving ids through sideGroupMap)
        for (const side of sidesResolved.value) {
            const rawGroups: any[] = (side.groups ?? side.groupIds ?? []) as any[];
            for (const g of rawGroups) {
                const obj = resolveGroupRef(g);
                if (obj?.id === id) return obj;
            }
        }
        return undefined;
    }

    function findUnitById(id: string): any | undefined {
        const uMap = unitMap.value;

        for (const side of sidesResolved.value) {
            const rawGroups: any[] = (side.groups ?? side.groupIds ?? []) as any[];
            for (const g of rawGroups) {
                const groupObj = typeof g === "string" ? groupMap.value[g] : g;
                if (!groupObj) continue;

                const stack: any[] = [...(groupObj.subUnits ?? [])];

                while (stack.length) {
                    const u = stack.pop();

                    // subUnits can also be IDs
                    const uObj = typeof u === "string" ? uMap[u] : u;
                    if (!uObj) continue;

                    if (uObj.id === id) return uObj;
                    if (uObj.subUnits?.length) stack.push(...uObj.subUnits);
                }
            }
        }
        return undefined;
    }

    function lookupEntityById(id: string): any | undefined {
        return findGroupById(id) || findUnitById(id);
    }
    /* ---------------- CSV Side/Group fallback UI ---------------- */

    // maps we can use to resolve IDs → objects
    const sideMap = computed(() => (scenario?.store?.state?.sideMap ?? store?.state?.sideMap) || {});
    // Try all the usual suspects for a "groups by id" map
    const groupMap = computed<Record<string, any>>(() =>
        (state.value?.groupMap ??
            state.value?.groupsById ??
            state.value?.groupIdMap ??
            state.value?.nodesById ??   // some builds keep a single nodes map
            state.value?.byId ??        // generic byId
            {}) as Record<string, any>
    );

    // Groups are stored in sideGroupMap keyed by GROUP ID in this build
    const groupNodeMap = computed<Record<string, any>>(
        () => (state.value?.sideGroupMap ?? {}) as Record<string, any>
    );

    // helper that resolves id→object using all the places groups might be
    const resolveGroupRef = (g: any) =>
        typeof g === "string"
            ? (groupNodeMap.value[g]                 // <— first: sideGroupMap has group nodes by id
                ?? (groupMap?.value?.[g] as any)      // if you still have a groupMap, fine as fallback
                ?? (unitMap?.value?.[g] as any))      // last resort: sometimes groups were stored as units/nodes
            : g;

    // (keep your sideMap / unitMap as-is)
    const unitMap = computed(() => (scenario?.store?.state?.unitMap ?? store?.state?.unitMap) || {});

    // Some builds keep a flat list of groups in state
    const rawGroupList = computed<any[]>(() =>
        (scenario?.store?.state?.groups ?? store?.state?.groups ?? [])
    );



    // sides may be an array of objects OR an array of IDs; normalize to objects here
    const sidesResolved = computed<any[]>(() => {
        const raw = (scenario?.store?.state?.sides ?? store?.state?.sides ?? []) as any[];
        return raw
            .map(s => (typeof s === "string" ? sideMap.value[s] : s))
            .filter(Boolean);
    });

    const sideOptions = computed(() =>
        sidesResolved.value.map((s: any) => ({ id: s.id, name: s.name || s.id }))
    );

    // default side selection (kept valid as sides appear/change)
    const defaultSideId = ref<string>("");

    watchEffect(() => {
        if (!defaultSideId.value && sideOptions.value.length) {
            defaultSideId.value = sideOptions.value[0].id;
        }
        if (
            defaultSideId.value &&
            !sideOptions.value.some(o => o.id === defaultSideId.value) &&
            sideOptions.value.length
        ) {
            defaultSideId.value = sideOptions.value[0].id;
        }
    });

    // groups can be in `side.groups` (objects) or `side.groupIds` (IDs); normalize to objects
    // Helper: get group objects for a side from ANY shape:
    // - side.groups (objects)
    // - side.groups (ids) or side.groupIds (ids) -> resolve via groupMap
    // - state.sideGroupMap[sideId].groups / groupIds (ids/objects)
    function resolveGroupsForSide(side: any): any[] {
        if (!side) return [];

        // 1) side.groups (ids or objects)
        if (Array.isArray(side.groups) && side.groups.length) {
            const list = side.groups.map(resolveGroupRef).filter(Boolean);
            if (list.length) return list;
        }

        // 2) side.groupIds (ids)
        if (Array.isArray(side.groupIds) && side.groupIds.length) {
            const list = side.groupIds.map((id: string) => resolveGroupRef(id)).filter(Boolean);
            if (list.length) return list;
        }

        // 3) sideGroupMap *nodes* sometimes nest children in various keys
        //    (but your logs showed sideGroupMap[side.id] is undefined, so this is a fallback)
        const sgm = state.value?.sideGroupMap ?? {};
        const node = sgm[side.id];
        if (node) {
            const buckets = ["groups", "groupIds", "subGroups", "children", "subUnits", "items"] as const;
            for (const key of buckets) {
                const arr: any[] = Array.isArray((node as any)[key]) ? (node as any)[key] : [];
                if (!arr.length) continue;
                const list = arr.map(resolveGroupRef).filter(Boolean);
                if (list.length) return list;
            }
        }

        // 4) nothing found
        return [];
    }

    const groupOptions = computed(() => {
        const side =
            sidesResolved.value.find((s: any) => s.id === defaultSideId.value) ??
            sidesResolved.value[0];

        const groups = resolveGroupsForSide(side);
        return groups.map((g: any) => ({ id: g.id, name: g.name || g.id }));
    });

    watch([defaultSideId, groupOptions], ([sid, opts]) => {
        const side = sidesResolved.value.find((s: any) => s.id === sid) ?? sidesResolved.value[0];
        const resolved = resolveGroupsForSide(side);
        console.log("[Groups] side:", sid, "resolved groups:", resolved.map((g: any) => g?.id));
    }, { immediate: true });

    const defaultGroupId = ref<string>("");

    // keep group selection valid as side/groups change
    watchEffect(() => {
        const opts = groupOptions.value;
        if (!opts.length) {
            defaultGroupId.value = "";
            return;
        }
        if (!defaultGroupId.value || !opts.some(o => o.id === defaultGroupId.value)) {
            defaultGroupId.value = opts[0].id;
        }
    });

    // If true, force ALL rows to the selected side/group (ignores CSV side/group)
    const overrideAll = ref(false);

    function normalizeGroups(side: any): any[] {
        const raw = (side?.groups ?? side?.groupIds ?? []);
        return raw
            .map(resolveGroupRef)
            .filter(Boolean);
    }


    /* ---------------- CSV mapped handler --------------- */
    // NEW — safer state updater with internal try/catch + fallback + debug
    function updateState(mutator: (state: any) => void) {
        const root = (store as any)?.state ?? store;
        const usePinia = store && typeof (store as any).$patch === "function";

        if (usePinia) {
            try {
                (store as any).$patch((st: any) => {
                    try {
                        mutator(st);
                    } catch (e) {
                        console.error("[CSV] $patch mutator threw:", e);
                        throw e; // bubble so outer catch shows the toast
                    }
                });
            } catch (e) {
                console.error("[CSV] $patch failed, falling back to direct mutate:", e);
                if (root) mutator(root);
            }
        } else {
            try {
                if (root) mutator(root);
            } catch (e) {
                console.error("[CSV] direct mutate threw:", e);
                throw e;
            }
        }
    }

    function ensureUnitShape(u: any) {
        if (!u) return;
        if (!Array.isArray(u.subUnits)) u.subUnits = [];
        if (!Array.isArray(u.equipment)) u.equipment = [];
        if (!Array.isArray(u.personnel)) u.personnel = [];
    }

    // ------- NEW: side root defaults used when SIDC is blank/"none"
    function getSideRootDefaults(sideId: string) {
        const s = (state.value || {}) as any;
        const side =
            s.sideMap?.[sideId] ||
            (Array.isArray(s.sides) ? s.sides.find((x: any) => x?.id === sideId) : null);

        // try “root” unit referenced on the side
        const uRef = Array.isArray(side?.units) && side.units[0] ? side.units[0] : undefined;
        const uObj = typeof uRef === "string" ? s.unitMap?.[uRef] : uRef;

        return {
            sidc: uObj?.sidc,
            standardIdentity: uObj?.standardIdentity ?? side?.standardIdentity,
            symbolOptions: { ...(side?.symbolOptions || {}), ...(uObj?.symbolOptions || {}) },
            fillColor: uObj?.fillColor ?? side?.fillColor,
        };
    }

    // ------- NEW: default SIDC helper for new units
    function getDefaultSidcForSide(side: any): string | undefined {
        try {
            if (!side) return undefined;
            // Prefer the first “root” unit listed on the side
            const uRef = (Array.isArray(side.units) && side.units[0]) ? side.units[0] : undefined;
            const uObj = typeof uRef === "string" ? unitMap.value?.[uRef] : uRef;
            if (uObj?.sidc) return uObj.sidc;

            // Fallback: sometimes sides keep a “root-like” unit id under sideGroupMap
            // (no-op if not present)
            return undefined;
        } catch {
            return undefined;
        }
    }
    // ------- END NEW

    function parseMsMaybe(v: unknown): number | undefined {
        if (v == null) return undefined;
        if (typeof v === "number" && Number.isFinite(v)) {
            // seconds → ms
            return v < 1e12 ? Math.round(v * 1000) : v;
        }
        if (typeof v === "string" && v.trim()) {
            const n = Number(v);
            if (Number.isFinite(n)) return n < 1e12 ? Math.round(n * 1000) : n;
            const d = Date.parse(v);
            if (Number.isFinite(d)) return d;
        }
        return undefined;
    }


    // ---- Scenario time finder (repo-aware, deep, noisy on purpose) ----
    function isEpochMs(n: unknown) {
        return typeof n === "number" && Number.isFinite(n) && n > 10_000_000_000 && n < 10_000_000_000_000; // ~1970..2286
    }
    function toMs(v: unknown): number | undefined {
        if (v == null) return undefined;
        if (typeof v === "number") {
            // seconds -> ms, heuristically
            if (v < 1e12 && v > 10_000_000) return Math.round(v * 1000);
            return isEpochMs(v) ? v : undefined;
        }
        if (typeof v === "string" && v.trim()) {
            const n = Number(v);
            if (Number.isFinite(n)) return toMs(n);
            const d = Date.parse(v);
            if (Number.isFinite(d)) return d;
        }
        if (typeof v === "object" && v && "value" in (v as any)) return toMs((v as any).value);
        return undefined;
    }
    type Hit = { path: string; key: string; value: any; ms?: number };

    function findTimesDeep(rootLike: any) {
        const seen = new WeakSet();
        const hits: Hit[] = [];
        const MAX_NODES = 30_000; // bail-out safety
        let nodes = 0;

        const KEY = /^(?:start|current).*time.*$|^(?:time.*start|time.*current)$/i;

        function walk(node: any, path: string) {
            if (!node || typeof node !== "object") return;
            if (seen.has(node)) return;
            if (++nodes > MAX_NODES) return;
            seen.add(node);

            for (const k of Object.keys(node)) {
                const v = (node as any)[k];
                const p = path ? `${path}.${k}` : k;

                if (KEY.test(k)) {
                    const ms = toMs(v);
                    if (ms !== undefined) hits.push({ path: p, key: k, value: v, ms });
                }
                if (v && typeof v === "object") walk(v, p);
            }
        }

        walk(rootLike, "");
        // prefer the most “specific” looking starts/current
        const startCand = hits
            .filter(h => /start/i.test(h.key))
            .sort((a, b) => b.path.length - a.path.length)[0]; // deeper path = more specific

        const currentCand = hits
            .filter(h => /current/i.test(h.key))
            .sort((a, b) => b.path.length - a.path.length)[0];

        return {
            startMs: startCand?.ms,
            currentMs: currentCand?.ms,
            hits,
        };
    }

    // Canonical resolver you can call inside onMapped
    function resolveScenarioTimesFromActiveStore(rootState: any) {
        // If your build has state.repo, that’s where the ORBAT lives; otherwise root
        const target = (rootState && typeof rootState.repo === "object") ? rootState.repo : rootState;

        const { startMs, currentMs, hits } = findTimesDeep(target);
        if (hits.length) {
            console.group("[CSV] scenario time probe");
            console.table(hits.map(h => ({
                path: h.path,
                sample: typeof h.value === "object" ? JSON.stringify(h.value) : String(h.value),
                ms: h.ms
            })));
            console.log("chosen startMs:", startMs, "currentMs:", currentMs);
            console.groupEnd();
        } else {
            console.warn("[CSV] scenario time probe found nothing under store; will fall back to Date.now()");
        }
        return {
            startMs: startMs ?? Date.now(),
            currentMs: currentMs ?? Date.now(),
        };
    }

    function onMapped(arg: ImportRow[] | { rows: ImportRow[]; timestampMode?: "csv" | "scenario-current" | "scenario-start" }) {
        try {
            // Back-compat: accept plain array or {rows, timestampMode}
            const rawRows = Array.isArray(arg) ? arg : (arg?.rows ?? []);
            const mode: "csv" | "scenario-current" | "scenario-start" =
                (Array.isArray(arg) ? "csv" : (arg?.timestampMode ?? "csv"));

            console.log("[CSV] onMapped received", rawRows.length, "rows; mode:", mode);

            // keep only rows with a name
            const rows = (rawRows ?? []).filter((r) => (r?.name ?? "").toString().trim().length > 0);

            // --- resolve side/group defaults ---
            const allSides = sidesResolved.value ?? [];
            const fallbackSide = allSides.find((s: any) => s?.id === defaultSideId.value) || allSides[0];

            const groupsForFallback = resolveGroupsForSide(fallbackSide) ?? [];
            const fallbackGroup =
                groupsForFallback.find((g: any) => g?.id === defaultGroupId.value) || groupsForFallback[0];

            if (!fallbackSide || !fallbackGroup) {
                send({ type: "error", message: "No sides/groups in the scenario. Create one before importing." });
                return;
            }

            const ctx = {
                resolveSideId: (sideKey: unknown) => {
                    if (overrideAll.value) return defaultSideId.value || (fallbackSide?.id as string);
                    const key = String(sideKey ?? "").toLowerCase();
                    const found =
                        allSides.find((s: any) => s?.id === sideKey) ||
                        allSides.find((s: any) => (s?.name ?? "").toLowerCase() === key);
                    return (found || fallbackSide)?.id as string;
                },
                resolveGroupId: (groupKey: unknown, sideId: string) => {
                    const side = allSides.find((s: any) => s?.id === sideId) || fallbackSide;
                    const groups = resolveGroupsForSide(side) ?? [];

                    if (overrideAll.value) {
                        const chosen =
                            groups.find((g: any) => g?.id === defaultGroupId.value) ?? groups[0] ?? fallbackGroup;
                        return chosen?.id ?? fallbackGroup?.id;
                    }

                    if (!groupKey) return (groups[0] ?? fallbackGroup)?.id;

                    const gkey = String(groupKey).toLowerCase();
                    const found =
                        groups.find((g: any) => g?.id === groupKey) ||
                        groups.find((g: any) => (g?.name ?? "").toLowerCase() === gkey);

                    return (found ?? groups[0] ?? fallbackGroup)?.id;
                },
            };

            // ---- scenario time lookup (single, canonical) ----
            const stateLike = (scenario?.store?.state as any) ?? (store?.state as any) ?? {};
            // Try the shapes used across the repo
            const startCandidates: unknown[] = [
                (scenario as any)?.time?.startTimeMs,
                stateLike.startTimeMs,
                stateLike.time?.startTimeMs,
                stateLike.scenario?.startTimeMs,
                stateLike.meta?.startTimeMs,
                stateLike.time?.start,
                stateLike.startTime,
            ];
            const currentCandidates: unknown[] = [
                (scenario as any)?.time?.currentTimeMs,
                stateLike.currentTimeMs,
                stateLike.time?.currentTimeMs,
                stateLike.time?.nowMs,
                stateLike.currentTime,
            ];
            const firstNum = (x: unknown) => {
                if (typeof x === "number" && Number.isFinite(x)) return x;
                const n = Number((x as any)?.value ?? x);
                return Number.isFinite(n) ? n : undefined;
            };

            // ...inside onMapped, before building `normalized`:
            const rootState = (store as any)?.state ?? store;
            const { startMs, currentMs } = resolveScenarioTimesFromActiveStore(rootState);

            // normalize rows → placement records
            const normalized = rows.map((r) => {
                // local numeric helper
                const toNumLoose = (v: unknown) =>
                    v == null || v === "" || Number.isNaN(Number(v as any)) ? undefined : Number(v as any);

                const sideId = ctx.resolveSideId((r as any).side);
                const groupId = ctx.resolveGroupId((r as any).group, sideId);

                // time selection policy
                let tFromCsv = toNumLoose((r as any).t);
                // If CSV time looks like seconds, promote to ms
                if (typeof tFromCsv === "number" && tFromCsv < 1e12) {
                    tFromCsv = Math.round(tFromCsv * 1000);
                }

                let t: number;
                switch (mode) {
                    case "csv":
                        // default to scenario start if CSV time missing/invalid
                        t = typeof tFromCsv === "number" ? tFromCsv : startMs;
                        break;
                    case "scenario-current":
                        t = currentMs;
                        break;
                    case "scenario-start":
                    default:
                        t = startMs;
                }

                return {
                    id: String(
                        (r as any).id ??
                        makeId?.() ??
                        globalThis.crypto?.randomUUID?.() ??
                        `m_${Math.random().toString(36).slice(2)}`
                    ),
                    name: String((r as any).name),
                    sideId,
                    groupId,
                    parentId: (r as any).parent_id ? String((r as any).parent_id) : undefined,
                    sidc: (r as any).sidc ? String((r as any).sidc) : undefined,
                    t,
                    lat: toNumLoose((r as any).lat),
                    lon: toNumLoose((r as any).lon),
                    initState: (r as any).initState as { t: number; location: [number, number] } | undefined,
                    fillColor: (r as any).fillColor ? String((r as any).fillColor) : undefined,
                };
            });

            __lastPlacements.value = normalized;


            // --- write to store ---
            // --- write to store ---
            updateState((rootState: any) => {
                // Write into the repo slice if it exists; otherwise the root state.
                const target = (rootState && typeof rootState.repo === "object") ? rootState.repo : rootState;

                // Core containers (create if missing)
                const uMap = (target.unitMap ||= {});
                const gMap = (target.groupMap ||= {});
                const sMap = (target.sideMap ||= {});
                const nodes = (target.nodesById ||= {});
                const byId = (target.byId ||= {});
                const flatUnits = (Array.isArray(target.units) ? target.units : (target.units = [])) as string[];
                const flatGroups = (Array.isArray(target.groups) ? target.groups : (target.groups = [])) as string[];
                const sidesArr = (Array.isArray(target.sides) ? target.sides : (target.sides = [])) as any[];
                const sideGroupMap = (target.sideGroupMap ||= {} as Record<string, any>);

                const getSideObj = (sid: string) => sMap[sid] || sidesArr.find((s: any) => s?.id === sid);

                // Keep latest point in u.state[], mirror to u._state and optional index
                function upsertState(u: any, t?: number, lat?: number, lon?: number, root?: any) {
                    if (t == null || lat == null || lon == null) return;
                    const pt = { t, location: [lon, lat] as [number, number] };

                    if (!Array.isArray(u.state)) u.state = [];
                    const idx = u.state.findIndex((p: any) => p?.t === t);
                    if (idx >= 0) u.state[idx] = pt; else u.state.push(pt);

                    const last = u.state.reduce((a: any, b: any) => (a && a.t > b.t ? a : b), pt);
                    u._state = last;

                    if (root) {
                        if (!root.unitStateById) root.unitStateById = {};
                        root.unitStateById[u.id] = last;
                    }
                }

                // === STEP 1: make group structures the tree expects ===
                function ensureGroup(sideId: string, groupId: string, nameHint?: string) {
                    // canonical group
                    let g = gMap[groupId];
                    if (!g) {
                        g = gMap[groupId] = { id: groupId, type: "group", name: nameHint ?? groupId, subUnits: [] };
                        if (!flatGroups.includes(groupId)) flatGroups.push(groupId);
                    } else {
                        if (!Array.isArray(g.subUnits)) g.subUnits = [];
                        g.type || (g.type = "group");
                    }

                    // group NODE keyed by GROUP ID in sideGroupMap (many trees read this)
                    let gNode = sideGroupMap[groupId];
                    if (!gNode) {
                        gNode = sideGroupMap[groupId] = { id: groupId, type: "group", name: g.name, subUnits: g.subUnits };
                    } else {
                        if (!Array.isArray(gNode.subUnits)) gNode.subUnits = g.subUnits;
                    }

                    // side NODE keyed by SIDE ID; attach the *object* of the group (not the id)
                    let sideNode = sideGroupMap[sideId];
                    if (!sideNode) sideNode = sideGroupMap[sideId] = { id: sideId, groups: [], subUnits: [] };
                    if (!Array.isArray(sideNode.groups)) sideNode.groups = [];
                    if (!Array.isArray(sideNode.subUnits)) sideNode.subUnits = [];

                    const hasGroupObj = sideNode.groups.some(
                        (x: any) => (typeof x === "string" ? x === groupId : x?.id === groupId)
                    );
                    if (!hasGroupObj) sideNode.groups.push(gNode); // <-- push OBJECT

                    // also mirror on the side object (ids are fine here)
                    const sideObj = getSideObj(sideId);
                    if (sideObj) {
                        if (!Array.isArray(sideObj.groupIds)) sideObj.groupIds = [];
                        if (!Array.isArray(sideObj.groups)) sideObj.groups = [];
                        if (!sideObj.groupIds.includes(groupId)) sideObj.groupIds.push(groupId);
                        const sideHas = sideObj.groups.some((x: any) => (typeof x === "string" ? x === groupId : x?.id === groupId));
                        if (!sideHas) sideObj.groups.push(groupId);
                        if (!Array.isArray(sideObj.units)) sideObj.units = [];
                    }

                    // index for resolvers
                    nodes[groupId] = g;
                    byId[groupId] = g;

                    return { g, gNode, sideNode };
                }

                function inheritFromSide(sideId: string) {
                    const s = getSideObj(sideId);
                    const rootDefaults = getSideRootDefaults(sideId);
                    return {
                        sidc: s?.sidc ?? rootDefaults.sidc,
                        standardIdentity: s?.standardIdentity ?? rootDefaults.standardIdentity,
                        fillColor: s?.fillColor ?? rootDefaults.fillColor,
                        symbolOptions: { ...(rootDefaults.symbolOptions || {}), ...(s?.symbolOptions || {}) },
                    };
                }

                // === Create/attach all imported units ===
                for (const p of normalized) {
                    const t = Number.isFinite(p.t) ? (p.t as number) : undefined;
                    const lat = Number.isFinite(p.lat) ? (p.lat as number) : undefined;
                    const lon = Number.isFinite(p.lon) ? (p.lon as number) : undefined;

                    // upsert unit record
                    const existing = uMap[p.id];
                    const base =
                        existing ||
                        ({
                            id: p.id,
                            name: p.name,
                            sideId: p.sideId,
                            groupId: p.groupId,
                            subUnits: [],
                            equipment: [],
                            personnel: [],
                            positionState: [],
                            ...inheritFromSide(p.sideId),
                        } as any);

                    const u = (uMap[p.id] = { ...base, name: p.name, sideId: p.sideId, groupId: p.groupId });

                    // symbology precedence
                    const d = inheritFromSide(p.sideId);
                    if (p.sidc && String(p.sidc).trim()) {
                        u.sidc = String(p.sidc).trim();
                        if (!u.standardIdentity && d.standardIdentity) u.standardIdentity = d.standardIdentity;
                    } else {
                        if (!u.sidc && d.sidc) u.sidc = d.sidc;
                        if (!u.standardIdentity && d.standardIdentity) u.standardIdentity = d.standardIdentity;
                        u.symbolOptions = { ...(d.symbolOptions || {}), ...(u.symbolOptions || {}) };
                    }
                    if (p.fillColor && String(p.fillColor).trim()) u.fillColor = String(p.fillColor).trim();

                    // denorms used elsewhere
                    u._pid = p.parentId || p.groupId;
                    u.sideId = p.sideId;
                    u.groupId = p.groupId;

                    // register in indexes
                    if (!flatUnits.includes(p.id)) flatUnits.push(p.id);
                    nodes[p.id] = u;
                    byId[p.id] = u;

                    if (p.parentId) {
                        // parent → child
                        let parent = uMap[p.parentId];
                        if (!parent) {
                            parent = uMap[p.parentId] = { id: p.parentId, name: String(p.parentId), subUnits: [], equipment: [], personnel: [] };
                            if (!flatUnits.includes(p.parentId)) flatUnits.push(p.parentId);
                            nodes[p.parentId] = parent;
                            byId[p.parentId] = parent;
                        }
                        if (!Array.isArray(parent.subUnits)) parent.subUnits = [];
                        if (!parent.subUnits.includes(p.id)) parent.subUnits.push(p.id);
                    } else {
                        // === STEP 2: this is the block you asked for (no parent case) ===
                        const { g, gNode, sideNode } = ensureGroup(p.sideId, p.groupId);

                        // canonical subUnits (groupMap)
                        if (!g.subUnits.includes(p.id)) g.subUnits.push(p.id);

                        // mirror for the tree (sideGroupMap[groupId].subUnits)
                        if (!Array.isArray(gNode.subUnits)) gNode.subUnits = g.subUnits;
                        if (!gNode.subUnits.includes(p.id)) gNode.subUnits.push(p.id);

                        // side flat units (ids)
                        const sideObj = getSideObj(p.sideId);
                        if (sideObj) {
                            if (!Array.isArray(sideObj.units)) sideObj.units = [];
                            if (!sideObj.units.includes(p.id)) sideObj.units.push(p.id);
                        }

                        // some views also check sideNode.subUnits
                        if (!sideNode.subUnits.includes(p.id)) sideNode.subUnits.push(p.id);
                    }

                    // initial position/time
                    upsertState(u, t, lat, lon, target);
                }

                // bump versions so watchers refresh
                target.unitStateCounter = (target.unitStateCounter ?? 0) + 1;
                target.featureStateCounter = (target.featureStateCounter ?? 0) + 1;
                target.structureVersion = (target.structureVersion ?? 0) + 1;
                target.nodesVersion = (target.nodesVersion ?? 0) + 1;

                // quick sanity log
                const sample = normalized[0];
                if (sample) {
                    const sideObj = getSideObj(sample.sideId);
                    const gNode = gMap[sample.groupId];
                    console.log("[post-patch] units created:", normalized.map((x) => x.id).filter((id) => !!uMap[id]));
                    console.log("[post-patch] side exists:", !!sideObj, "side.units contains sample:", !!sideObj?.units?.includes(sample.id));
                    console.log("[post-patch] group exists:", !!gNode, "group.subUnits:", (gNode?.subUnits ?? []).slice());
                }
            });

                console.table(normalized, ["id", "name", "sideId", "groupId", "parentId", "sidc", "lat", "lon", "t"]);
                emit("loaded");
            } catch (err: any) {
                console.error(err);
                send({ type: "error", message: err?.message || "CSV import failed." });
        }
}

    const expandTemplates = ref(true);
    const includeEquipment = ref(true);
    const includePersonnel = ref(true);

    // Safe default for the dropdowns that depend on rootUnitItems
    const parentUnitId = ref<string>(rootUnitItems.value[0]?.code ?? "");
    /* ---------------- Grid ---------------------------- */
    function renderExpandCell({ getValue, row }: CellContext<Unit, string>) {
        return h(OrbatCellRenderer, {
            value: getValue(),
            sidc: row.original.sidc,
            expanded: row.getIsExpanded(),
            level: row.depth,
            canExpand: row.getCanExpand(),
            onToggle: row.getToggleExpandedHandler(),
            symbolOptions: {},
        });
    }

    const columns: ColumnDef<Unit, any>[] = [
        {
            accessorFn: (f) => f.name,
            id: "name",
            cell: renderExpandCell,
            header: ({ table }) =>
                h(
                    "button",
                    {
                        type: "button",
                        title: "Expand/collapse all",
                        onClick: table.getToggleAllRowsExpandedHandler(),
                        class: "flex items-center gap-2",
                    },
                    [
                        h(ChevronRightIcon, {
                            class: [
                                "size-6 transform transition-transform text-gray-500",
                                table.getIsAllRowsExpanded() ? "rotate-90" : "",
                            ],
                        }),
                        "Unit",
                    ],
                ),
            enableGlobalFilter: true,
            size: 450,
            enableSorting: false,
        },
        {
            accessorKey: "TEMPLATE NAME",
            header: "Template",
            size: 300,
            accessorFn: (u) => rowMapTest.value?.get(+u.id)?.["TEMPLATE NAME"],
        },
    ];

    const initialTableState: InitialTableState = {
        // grouping: ["PARENT NAME"],
        expanded: true,
    };

    /* ---------------- ODIN load logic ----------------- */
    const importedUnits = shallowRef<Unit[]>([]);
    const rowMapTest = shallowRef<Map<number, OdinUnitInfoRow>>();

    async function onLoad(e: Event) {
        // Only allow ODIN on real XLSX with a DRAGON dialect
        if (props.fileInfo.format !== "xlsx" || !props.fileInfo.dataAsArrayBuffer) {
            send({ message: "Invalid file format for ODIN import.", type: "error" });
            return;
        }

        const workbook = readSpreadsheet(props.fileInfo.dataAsArrayBuffer);
        const dialect = detectSpreadsheetDialect(workbook);
        if (dialect !== "ODIN_DRAGON") {
            send({ message: "Spreadsheet is not a DRAGON export.", type: "error" });
            return;
        }

        const { rootUnits, rowMap } = parseOdinDragon(workbook, {
            rowsOnly: false,
            expandTemplates: expandTemplates.value,
            includeEquipment: includeEquipment.value,
            includePersonnel: includePersonnel.value,
        });

        importedUnits.value = rootUnits;
        rowMapTest.value = rowMap;

        if (!scenario) {
            send({ type: "error", message: "No active scenario context available." });
            return;
        }
        rootUnits.forEach((unit) => {
            addUnitHierarchy(unit, parentUnitId.value, scenario);
        });

        emit("loaded");
    }
    watch([defaultSideId, groupOptions], ([sid, opts]) => {
        const side =
            sidesResolved.value.find((s: any) => s.id === sid) ?? sidesResolved.value[0];
        const resolved = resolveGroupsForSide(side);
        console.log("[Groups] side:", sid, "resolved groups:", resolved.map((g: any) => g?.id));
    }, { immediate: true });

    if (typeof window !== "undefined") {
        // NEW: merge to keep any earlier helpers like _whoami
        (window as any).__imp = {
            ...((window as any).__imp || {}),
            store,
            scenario,
            state,
            sidesResolved,
            groupMap,
            unitMap,
            groupOptions,
            resolveGroupsForSide,
            defaultSideId,
            defaultGroupId,
            _groupMapValue: () => ({ ...groupMap.value }),
            _unitMapValue: () => ({ ...unitMap.value }),
            _sideNode: (sid: string) => (state.value?.sideGroupMap ?? {})[sid],
        };
        // END NEW
        if (typeof window !== "undefined") {
            (window as any).__imp = {
                ...((window as any).__imp || {}),
                _groupMapValue: () => groupMap.value,
                _unitMapValue: () => unitMap.value,
                _anyById: (id: string) =>
                    groupMap.value?.[id] ??
                    unitMap.value?.[id] ??
                    state.value?.groupsById?.[id] ??
                    state.value?.groupIdMap?.[id] ??
                    state.value?.nodesById?.[id] ??
                    state.value?.byId?.[id],
            };
        }
        if (typeof window !== "undefined") {
            (window as any).__imp = {
                ...((window as any).__imp || {}),
                _groupNodeKeys: () => Object.keys(groupNodeMap.value ?? {}),
                _groupNode: (id: string) => groupNodeMap.value?.[id],
                _resolveGroupsForSide: resolveGroupsForSide,
            };
        }
        console.log("[ImportSpreadsheetStep] debug available as window.__imp");
    }
    if (typeof window !== "undefined") {
        const get = (o: any, path: (string | number)[]) =>
            path.reduce((acc, k) => (acc == null ? acc : acc[k as any]), o);

        const listPaths = (u: any, st: any) => {
            const paths: [string, (string | number)[]][] = [
                ["u._state", ["_state"]],
                ["u.state[0]", ["state", 0]],
                ["u.state[last]", ["state", Math.max(0, (u?.state?.length ?? 1) - 1)]],
                ["u.feature.geometry.coordinates", ["feature", "geometry", "coordinates"]],
                ["state.unitStateById[id]", ["unitStateById", u?.id]],
                ["state.byId[id]._state", ["byId", u?.id, "_state"]],
                ["state.nodesById[id]._state", ["nodesById", u?.id, "_state"]],
            ];
            return paths.map(([label, p]) => {
                try { return { label, value: get(u && st ? { ...st, ...u, u } : u, p) }; }
                catch { return { label, value: undefined }; }
            });
        };

        const posAsLonLat = (anyPos: any) => {
            // Try to normalize a position into [lon,lat]
            if (!anyPos) return undefined;
            if (Array.isArray(anyPos) && anyPos.length >= 2 && Number.isFinite(anyPos[0]) && Number.isFinite(anyPos[1])) {
                return [anyPos[0], anyPos[1]];
            }
            if (anyPos?.location && Array.isArray(anyPos.location)) return anyPos.location;
            if (anyPos?.geometry?.type && anyPos?.geometry?.coordinates) return anyPos.coordinates ?? anyPos.geometry.coordinates;
            return undefined;
        };

        const extractLatest = (u: any, st: any) => {
            // prefer explicit _state
            if (u?._state) return u._state;
            // else most recent in state[]
            if (Array.isArray(u?.state) && u.state.length) {
                return [...u.state].sort((a: any, b: any) => (+a?.t || 0) - (+b?.t || 0)).at(-1);
            }
            // else indexed
            const idx = st?.unitStateById?.[u?.id];
            if (idx) return idx;
            // else feature
            const coords = u?.feature?.geometry?.coordinates;
            if (coords) return { id: "feature", t: undefined, location: coords };
            return undefined;
        };

        (window as any).__imp = {
            ...((window as any).__imp || {}),
            // Show where a specific unit's position is stored
            pos(id: string) {
                const st = state.value as any;
                const u = st?.unitMap?.[id] ?? st?.byId?.[id] ?? st?.nodesById?.[id];
                if (!u) { console.warn("[pos] unit not found:", id); return null; }
                const paths = listPaths(u, st);
                console.group(`[pos] ${id} — ${u?.name ?? ""}`);
                console.table(paths.map(p => ({ path: p.label, value: JSON.stringify(p.value) })));
                const latest = extractLatest(u, st);
                console.log("latest (normalized):", latest ? { t: latest.t, loc: posAsLonLat(latest) } : undefined);
                console.groupEnd();
                return { unit: u, paths, latest };
            },

            // Show what we attempted to write last CSV import vs. what's in store now
            posLast() {
                const st = state.value as any;
                const pl = __lastPlacements.value ?? [];
                const rows = pl.map(p => {
                    const u = st?.unitMap?.[p.id];
                    const latest = u ? (u._state ?? (Array.isArray(u.state) && u.state.at(-1)) ?? st?.unitStateById?.[p.id]) : undefined;
                    return {
                        id: p.id,
                        name: u?.name ?? p.name,
                        csv_t: p.t,
                        csv_lat: p.lat,
                        csv_lon: p.lon,
                        hasUnit: !!u,
                        latest_t: latest?.t,
                        latest_loc: latest?.location ?? u?.feature?.geometry?.coordinates ?? null
                    };
                });
                console.table(rows);
                return rows;
            }
        };

    }
</script>

<template>
    <div>
        <!-- Toggle CSV / ODIN -->
        <div class="flex gap-2 mb-3">
            <button type="button"
                    class="border rounded px-2 py-1"
                    :class="showCsvMapper ? 'bg-black/5 dark:bg-white/10' : ''"
                    @click="showCsvMapper = true">
                CSV
            </button>

            <button type="button"
                    class="border rounded px-2 py-1"
                    :class="!showCsvMapper ? 'bg-black/5 dark:bg-white/10' : ''"
                    @click="showCsvMapper = false">
                ODIN Dragon
            </button>
        </div>

        <!-- CSV mode -->
        <template v-if="showCsvMapper">
            <!-- Defaults bar (only when sides are ready) -->
            <div v-if="hasSides" class="mb-3 grid gap-2 sm:grid-cols-3 items-end">
                <div>
                    <label class="block text-xs opacity-70 mb-1">Default Side</label>
                    <select v-model="defaultSideId" class="border rounded px-2 py-1 w-full">
                        <option v-for="s in sideOptions" :key="s.id" :value="s.id">{{ s.name }}</option>
                    </select>
                </div>

                <div>
                    <label class="block text-xs opacity-70 mb-1">Default Group</label>
                    <select v-model="defaultGroupId" class="border rounded px-2 py-1 w-full">
                        <option v-for="g in groupOptions" :key="g.id" :value="g.id">{{ g.name }}</option>
                    </select>
                </div>

                <label class="inline-flex items-center gap-2 select-none">
                    <input type="checkbox" v-model="overrideAll" />
                    <span class="text-sm">Override all rows with selected Side/Group</span>
                </label>
            </div>

            <!-- Hydration/help text while sides are not ready yet -->
            <div v-else class="mb-3 text-sm opacity-70">
                Looking for sides/groups… (create at least one side and one group in this scenario)
            </div>

            <!-- Mapper -->
            <CsvColumnMapper :initial-file="fileInfo"
                             :onMapped="onMapped"
                             :onCancel="onCancel" />
        </template>

        <!-- ODIN Dragon importer -->
        <form v-else @submit.prevent="onLoad" class="mt-4 flex max-h-[80vh] flex-col">
            <div class="shrink-0 overflow-auto">
                <div class="prose prose-sm max-w-none">
                    <p>
                        Import units exported from
                        <a href="https://odin.tradoc.army.mil/DATEWORLD"
                           target="_blank"
                           rel="noopener noreferrer">https://odin.tradoc.army.mil/DATEWORLD</a>. Only the DRAGON Excel export format is currently supported.
                    </p>
                </div>

                <section class="mt-4 space-y-4 px-1">
                    <div class="grid gap-4 sm:grid-cols-3">
                        <InputCheckbox label="Expand unit templates"
                                       description="This will create a lot of units!"
                                       v-model="expandTemplates" />
                        <template v-if="expandTemplates">
                            <InputCheckbox label="Include equipment"
                                           v-model="includeEquipment"
                                           :disabled="!expandTemplates" />
                            <InputCheckbox label="Include personnel"
                                           v-model="includePersonnel"
                                           :disabled="!expandTemplates" />
                        </template>
                    </div>
                    <SymbolCodeSelect label="Select parent unit"
                                      :items="rootUnitItems"
                                      v-model="parentUnitId" />
                </section>
            </div>

            <section class="mt-2 flex-auto">
                <DataGrid :data="importedUnits"
                          :columns="columns"
                          :row-count="rowMapTest?.size"
                          :row-height="40"
                          class="max-h-[40vh]"
                          show-global-filter
                          :initial-state="initialTableState"
                          :get-sub-rows="(row) => row.subUnits" />
            </section>

            <footer class="flex shrink-0 items-center justify-end space-x-2 pt-4">
                <BaseButton type="submit" primary small>Import</BaseButton>
                <BaseButton small @click="emit('cancel')">Cancel</BaseButton>
            </footer>
        </form>
    </div>
</template>
