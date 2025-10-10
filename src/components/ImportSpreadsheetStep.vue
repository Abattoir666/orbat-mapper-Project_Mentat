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
    import type { SymbolItem } from "@/types/constants";
    import { addUnitHierarchy } from "@/importexport/convertUtils";
    import InputCheckbox from "@/components/InputCheckbox.vue";
    import type { CellContext, ColumnDef, InitialTableState } from "@tanstack/vue-table";
    import DataGrid from "@/modules/grid/DataGrid.vue";
    import OrbatCellRenderer from "@/components/OrbatCellRenderer.vue";
    import { ChevronRightIcon } from "@heroicons/vue/20/solid";


    // --- NEW: store identity diags (one-time) ---
if (typeof window !== "undefined") {
  (window as any).__imp = {
    ...(window as any).__imp,
    _whoami() {
      const s = store;
      const scen = scenario?.store;
      console.log("[whoami] has $patch:", typeof (s as any)?.$patch === "function");
      console.log("[whoami] has update :", typeof (s as any)?.update  === "function");
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
  console.log("[Groups] side:", sid, "resolved groups:", resolved.map((g:any)=>g?.id));
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

function onMapped(rawRows: ImportRow[]) {
  try {
    console.log("[CSV] onMapped received", rawRows.length, "rows");

    // 1) keep only rows that actually have a name
    const rows = rawRows.filter((r) => (r.name ?? "").toString().trim().length > 0);

    // 2) ensure we have at least one side & group
    const allSides = sidesResolved.value;
    const fallbackSide =
      allSides.find((s: any) => s.id === defaultSideId.value) || allSides[0];

    const groupsForFallback = resolveGroupsForSide(fallbackSide);
    const fallbackGroup =
      groupsForFallback.find((g: any) => g.id === defaultGroupId.value) ||
      groupsForFallback[0];

    if (!fallbackSide || !fallbackGroup) {
      send({ type: "error", message: "No sides/groups in the scenario. Create one before importing." });
      console.warn("[CSV] missing fallback side/group → abort");
      return;
    }

    // 3) import context
    const ctx = {
      resolveSideId: (sideKey: string) => {
        if (overrideAll.value) return fallbackSide.id;
        if (!sideKey) return fallbackSide.id;
        const key = String(sideKey).toLowerCase();
        const found =
          allSides.find((s: any) => s.id === sideKey) ||
          allSides.find((s: any) => (s.name || "").toLowerCase() === key);
        return (found || fallbackSide).id;
      },

      resolveGroupId: (groupKey: string, sideId: string) => {
        const side = overrideAll.value
          ? fallbackSide
          : allSides.find((s: any) => s.id === sideId) || fallbackSide;

        const groups = resolveGroupsForSide(side);

        if (overrideAll.value) {
          const chosen =
            groups.find((g: any) => g.id === defaultGroupId.value) ??
            groups[0] ?? fallbackGroup;
          return chosen?.id ?? fallbackGroup?.id;
        }

        if (!groupKey) return (groups[0] ?? fallbackGroup)?.id;

        const gkey = String(groupKey).toLowerCase();
        const found =
          groups.find((g: any) => g.id === groupKey) ||
          groups.find((g: any) => (g.name || "").toLowerCase() === gkey);

        return (found ?? groups[0] ?? fallbackGroup)?.id;
      },

      existsId: (id: string) => !!lookupEntityById(id),
      findUnitById: (id: string) => findUnitById(id),
      findGroupById: (id: string) => findGroupById(id),
    };

    // 4) normalize rows (ensure id, resolve side/group — honors overrideAll)
    const normalized = rows.map((r) => {
      const sideId  = ctx.resolveSideId(String(r.side || ""));
      const groupId = ctx.resolveGroupId(String(r.group || ""), sideId);
      return {
        ...r,
        id: (r.id && String(r.id).trim()) ? r.id : makeId(),
        side: sideId,
        group: groupId,
      };
    });
    // After: const created = importRows(normalized, ctx);

const placements = normalized.map((r) => ({
  id: String(r.id),
  name: r.name,
  sideId: String(r.side),
  groupId: String(r.group),
  sidc: r.sidc,
  fillColor: r.fillColor,
  parentId: r.parent_id ? String(r.parent_id) : "",
}));

// IMPORTANT: use the store's update() (NOT $patch, NOT a custom updateState)
const store = scenario.store;

store.update((state: any) => {
  // Some builds keep a "repo" slice for the unit repository UI. If present, write there.
  // Otherwise fall back to the root scenario state.
  const target = state;

  // Ensure containers exist
  const uMap = target.unitMap      || (target.unitMap = {});
  const gMap = target.groupMap     || (target.groupMap = {});
  const sgm  = target.sideGroupMap || (target.sideGroupMap = {});
  const sMap = target.sideMap      || {};
  const nodes = target.nodesById   || (target.nodesById = {});
  const byId  = target.byId        || (target.byId = {});
  const flatUnits  = Array.isArray(target.units)  ? target.units  : (target.units  = []);
  const flatGroups = Array.isArray(target.groups) ? target.groups : (target.groups = []);
  const sidesArr   = Array.isArray(target.sides)  ? target.sides  : (target.sides  = []);

  const getSideObj = (sid: string) => sMap[sid] || sidesArr.find((s: any) => s?.id === sid);

  function ensureGroup(sideId: string, groupId: string, nameHint?: string) {
    let g = gMap[groupId];
    if (!g) {
      g = gMap[groupId] = { id: groupId, name: nameHint ?? groupId, type: "group", subUnits: [] };
      flatGroups.includes(groupId) || flatGroups.push(groupId);
    } else {
      Array.isArray(g.subUnits) || (g.subUnits = []);
      g.type || (g.type = "group");
    }

    // Mirror node in sideGroupMap keyed by GROUP ID; share the same subUnits array
    let gNode = sgm[groupId];
    if (!gNode) sgm[groupId] = gNode = { id: groupId, type: "group", name: g.name, subUnits: g.subUnits };
    else Array.isArray(gNode.subUnits) || (gNode.subUnits = g.subUnits);

    // Ensure a side node exists (keyed by SIDE ID) and that it references the group
    const sideNode = sgm[sideId] || (sgm[sideId] = { id: sideId, groups: [], subUnits: [] });
    Array.isArray(sideNode.groups) || (sideNode.groups = []);
    const hasGroup = sideNode.groups.some((x: any) => (typeof x === "string" ? x === groupId : x?.id === groupId));
    if (!hasGroup) sideNode.groups.push(gNode); // push object – several views expect objects

    // Also mirror IDs on the side object when available
    const sideObj = getSideObj(sideId);
    if (sideObj) {
      Array.isArray(sideObj.groups) || (sideObj.groups = []);
      Array.isArray(sideObj.groupIds) || (sideObj.groupIds = []);
      sideObj.groupIds.includes(groupId) || sideObj.groupIds.push(groupId);
      const sideHas = sideObj.groups.some((x: any) => (typeof x === "string" ? x === groupId : x?.id === groupId));
      if (!sideHas) sideObj.groups.push(groupId);
    }

    // Index for resolvers
    nodes[groupId] = g;
    byId[groupId]  = g;
    return g;
  }

  function inheritFromSide(sideId: string) {
  const s = getSideObj(sideId);
  // pull defaults from side root unit if the side itself doesn't carry SIDC
  const rootDefaults = getSideRootDefaults(sideId);

  return {
    sidc: s?.sidc ?? rootDefaults.sidc,
    standardIdentity: s?.standardIdentity ?? rootDefaults.standardIdentity,
    fillColor: s?.fillColor ?? rootDefaults.fillColor,
    symbolOptions: { ...(rootDefaults.symbolOptions || {}), ...(s?.symbolOptions || {}) },
  };
}

  for (const p of placements) {
    // Ensure unit exists + shape
    let u = uMap[p.id];
    if (!u) {
      u = uMap[p.id] = { id: p.id, type: "unit", name: p.name ?? p.id, subUnits: [], equipment: [], personnel: [] };
      flatUnits.includes(p.id) || flatUnits.push(p.id);
    } else {
      u.type || (u.type = "unit");
      Array.isArray(u.subUnits) || (u.subUnits = []);
      Array.isArray(u.equipment) || (u.equipment = []);
      Array.isArray(u.personnel) || (u.personnel = []);
      if (p.name && p.name !== u.name) u.name = p.name;
    }
    nodes[p.id] = u;
    byId[p.id]  = u;

    // SIDC/fillColor precedence: CSV > inherit from side defaults
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
    else if (!u.fillColor && d.fillColor) u.fillColor = d.fillColor;

    // set the parent pointer used by the repo tree
u._pid = p.parentId || p.groupId;

// keep a couple of helpful denorms many UIs expect
u.sideId = p.sideId;
u.groupId = p.groupId;

    // Parent → child, else attach to group
    if (p.parentId) {
      let parent = uMap[p.parentId];
      if (!parent) {
        parent = uMap[p.parentId] = { id: p.parentId, type: "unit", name: p.parentId, subUnits: [], equipment: [], personnel: [] };
        flatUnits.includes(p.parentId) || flatUnits.push(p.parentId);
        nodes[p.parentId] = parent; byId[p.parentId] = parent;
      }
      Array.isArray(parent.subUnits) || (parent.subUnits = []);
      parent.subUnits.includes(p.id) || parent.subUnits.push(p.id);
    } else {
  const g = ensureGroup(p.sideId, p.groupId);

  // push into both the base groupMap and the sideGroupMap node (tree reads the latter)
  g.subUnits.includes(p.id) || g.subUnits.push(p.id);
  const gNode = target.sideGroupMap?.[p.groupId];
  if (gNode) {
    Array.isArray(gNode.subUnits) || (gNode.subUnits = []);
    if (!gNode.subUnits.includes(p.id)) gNode.subUnits.push(p.id);
  }
}
  }

  // Nudge any watchers that key off simple counters
  target.unitStateCounter = (target.unitStateCounter ?? 0) + 1;
  target.featureStateCounter = (target.featureStateCounter ?? 0) + 1;

  // Quick post-checks in console:
  console.log("[post-patch] units created:", placements.map(p => p.id).filter(id => !!state.unitMap[id]));
  console.log("[post-patch] side node exists:", !!state.sideGroupMap[placements[0].sideId]);
  console.log("[post-patch] group node exists:", !!state.sideGroupMap[placements[0].groupId]);
  console.log("[post-patch] group.subUnits:", state.groupMap[placements[0].groupId]?.subUnits?.slice?.());
});

    console.table(normalized, ["id","name","side","group","parent_id","sidc"]);

    // 5) import rows (your existing function)
    const created = importRows
    emit("loaded");
  } catch (err: any) {
    console.error(err);
    send({ type: "error", message: err?.message || "CSV import failed." });
  }
}

    /* ---------------- ODIN UI state ------------------- */
    const rootUnitItems = computed<SymbolItem[]>(() => {
        const s = state.value as any;
        const sideGroupMap = s?.sideGroupMap ?? {};
        const unitMap = s?.unitMap ?? {};
        const subIds = Object.values(sideGroupMap)
            .map((v: any) => v?.subUnits ?? [])
            .flat();
        return subIds
            .map((id: string) => unitMap[id])
            .filter(Boolean)
            .map((u: any) => ({ text: u?.name ?? String(u?.id ?? "unknown"), code: u?.id, sidc: u?.sidc }));
    });

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
  console.log("[Groups] side:", sid, "resolved groups:", resolved.map((g:any)=>g?.id));
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
  _unitMapValue:  () => ({ ...unitMap.value }),
  _sideNode:      (sid: string) => (state.value?.sideGroupMap ?? {})[sid],
};
// END NEW
  if (typeof window !== "undefined") {
  (window as any).__imp = {
    ...((window as any).__imp || {}),
    _groupMapValue: () => groupMap.value,
    _unitMapValue:  () => unitMap.value,
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
            <CsvColumnMapper :initial-file="props.fileInfo?.originalFile"
                             @mapped="onMapped"
                             @cancel="showCsvMapper = false" />
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
