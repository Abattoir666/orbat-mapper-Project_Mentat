<template>
    <div class="space-y-1 pt-2">
        <slot name="header" />
        <OrbatSide v-for="side in sides"
                   :key="side.id"
                   :side="side"
                   @unit-action="onUnitAction"
                   @unit-click="onUnitClick"
                   @side-action="onSideAction"
                   :hide-filter="hideFilter" />
        <OrbatPanelAddSide v-if="sides.length < 2"
                           :simple="sides.length >= 1"
                           class="mt-8"
                           @add="addSide()" />
    </div>

    <div v-if="isDragging && isCopying"
         class="bg-opacity-50 fixed top-2 right-1/2 z-50 rounded border bg-gray-50 p-2 text-center text-sm text-gray-900">
        <p>Dragging copy mode <span v-if="isCopyingState">(including state)</span></p>
    </div>
</template>

<script setup lang="ts">
    import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
    import OrbatPanelAddSide from "@/components/OrbatPanelAddSide.vue";
    import { injectStrict, triggerPostMoveFlash } from "@/utils";
    import { activeParentKey, activeScenarioKey } from "@/components/injects";
    import OrbatSide from "@/components/OrbatSide.vue";
    import type { NSide, NSideGroup, NUnit } from "@/types/internalModels";
    import { type SideAction, SideActions } from "@/types/constants";
    import { type DropTarget } from "@/components/types";
    import { useUnitActions } from "@/composables/scenarioActions";
    import { useEventBus, useEventListener } from "@vueuse/core";
    import { orbatUnitClick } from "@/components/eventKeys";
    import { useSelectedItems } from "@/stores/selectedStore";
    import { inputEventFilter } from "@/components/helpers";
    import { serializeUnit } from "@/scenariostore/io";
    import { addUnitHierarchy, orbatToText, parseApplicationOrbat } from "@/importexport/convertUtils";
    import { type EntityId } from "@/types/base";
    import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
    import { isSideDragItem, isSideGroupDragItem, isUnitDragItem } from "@/types/draggables";
    import { extractInstruction, type Instruction } from "@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item";

    interface Props {
        hideFilter?: boolean;
    }

    const props = withDefaults(defineProps<Props>(), { hideFilter: false });
    const activeScenario = injectStrict(activeScenarioKey);
    const { store, unitActions, io, time } = activeScenario;
    const activeParentId = injectStrict(activeParentKey);

    const isDragging = ref(false);
    const isCopying = ref(false);
    const isCopyingState = ref(false);

    const { state, groupUpdate } = store;
    const { changeUnitParent, addSide } = unitActions;
    const bus = useEventBus(orbatUnitClick);

    useEventListener(document, "paste", onPaste);
    useEventListener(document, "copy", onCopy);

    const sides = computed(() => state.sides.map((id) => state.sideMap[id]));

    const { onUnitAction: dispatchUnitAction } = useUnitActions();
    const { selectedUnitIds, activeUnitId } = useSelectedItems();

    /**
     * ✅ Safe ORBAT debug logging (UTF-8 / Unicode)
     * OFF by default. Enable with:
     *   localStorage.setItem("mentat.orbatDebug", "1"); location.reload();
     * Disable with:
     *   localStorage.setItem("mentat.orbatDebug", "0"); location.reload();
     */
    const ORBAT_DEBUG = (localStorage.getItem("mentat.orbatDebug") ?? "0") === "1";

    // throttle so we never spam/crash devtools
    let _lastLogMs = 0;
    function canLog(): boolean {
        if (!ORBAT_DEBUG) return false;
        const now = Date.now();
        if (now - _lastLogMs < 100) return false; // 10 logs/sec max
        _lastLogMs = now;
        return true;
    }

    function unitMini(u: any) {
        if (!u) return null;
        if (typeof u === "string") return { kind: "id", id: u };
        if (typeof u !== "object") return { kind: typeof u, v: u };
        const id = typeof (u as any).id === "string" ? (u as any).id : undefined;
        const name = typeof (u as any).name === "string" ? (u as any).name : undefined;
        const hasUnit = (u as any).unit && typeof (u as any).unit === "object";
        if (!id && hasUnit) {
            const uu = (u as any).unit;
            return { kind: "wrapper.unit", id: uu?.id, name: uu?.name };
        }
        return { kind: "obj", id, name };
    }

    function argMini(x: any) {
        if (x === null) return { t: "null" };
        if (x === undefined) return { t: "undefined" };
        if (typeof x === "string" || typeof x === "number" || typeof x === "boolean") return { t: typeof x, v: x };
        if (Array.isArray(x)) return { t: "array", n: x.length, sample: unitMini(x[0]) };
        if (x instanceof Set) return { t: "set", n: x.size, sample: unitMini([...x][0]) };
        return { t: "object", mini: unitMini(x) };
    }

    function selMini() {
        return {
            activeUnitId: activeUnitId.value ?? null,
            selectedCount: selectedUnitIds.value.size,
            selectedSample: [...selectedUnitIds.value].slice(0, 3),
        };
    }

    /**
     * 🔎 Instrumented wrapper: logs the exact payload that OrbatSide emits.
     * We DO NOT “fix” payload shape here — this is strictly diagnostic.
     */
    function onUnitAction(a: any, b: any, waypointIds?: EntityId[]) {
        const looksLikeUnit = (x: any) =>
            x && typeof x === "object" && typeof x.id === "string" && x.id.length > 0;

        // payload sometimes comes as (unit, action) and sometimes (action, unit)
        const unit = looksLikeUnit(a) ? a : (looksLikeUnit(b) ? b : null);
        const action = unit === a ? b : a;

        const rawKey =
            typeof action === "string"
                ? action
                : (action?.type ?? action?.action ?? action?.id ?? action?.name ?? action);

        const key = String(rawKey).toLowerCase();

        if (canLog()) {
            console.log("🧭 ORBAT ▶ unit-action", {
                unit: unitMini(unit),
                action: argMini(action),
                key,
                waypointIds: Array.isArray(waypointIds) ? { n: waypointIds.length, sample: waypointIds[0] } : argMini(waypointIds),
                selection: selMini(),
            });
        }

        function deferSelectUnit(newId: string) {
            // Let the clone + hierarchy rewiring settle, then let the map finish a render pass,
            // THEN update selection. This avoids transient "parent disappears" flicker.
            nextTick(() => {
                requestAnimationFrame(() => {
                    activeUnitId.value = newId;
                    activeParentId.value = newId;
                    try { selectedUnitIds.value.clear(); selectedUnitIds.value.add(newId); } catch { }

                    const el = document.getElementById(`ou-${newId}`);
                    if (el) triggerPostMoveFlash(el);
                });
            });
        }

        // ✅ Hard-handle Duplicate/Clone/Copy so hierarchy variants actually clone children
        if (unit?.id && (key.includes("duplicate") || key.includes("clone") || key.includes("copy"))) {
            const includeState =
                key.includes("state") ||
                key.includes("withstate") ||
                key.includes("with_state") ||
                action?.includeState === true;

            // The important part:
            const includeSubordinates =
                key.includes("hier") ||          // hierarchy / hierarchical
                key.includes("sub") ||           // subordinates
                key.includes("child") ||         // children
                key.includes("tree") ||          // tree
                action?.includeSubordinates === true;

            try {
                let newId: string | undefined;

                // Batch the clone so the map doesn't see intermediate partial hierarchy states.
                groupUpdate(() => {
                    const out = unitActions.cloneUnit(unit.id, { includeSubordinates, includeState });
                    newId = typeof out === "string" ? out : out?.id;

                    // 🔧 Critical: cloning can leave the ORIGINAL parent with a stale/cleared _state,
                    // which makes it look "off map" even though its underlying state hasn't changed.
                    (unitActions as any).updateUnitState?.(unit.id);

                    // Optional: also ensure the clone has _state computed immediately
                    if (newId) (unitActions as any).updateUnitState?.(newId);
                });

                if (canLog()) console.log("✅ ORBAT ▶ cloneUnit", { from: unit.id, to: newId, includeSubordinates, includeState });

                if (newId) {
                    deferSelectUnit(newId);
                }
            } catch (err) {
                console.error("💥 ORBAT ▶ cloneUnit threw", err);
            }
            return;
        }

        // Everything else: keep existing behavior (try both arg orders for robustness)
        try {
            dispatchUnitAction(a as any, b as any, waypointIds as any);
            if (canLog()) console.log("✅ ORBAT ▶ unit-action dispatched");
            return;
        } catch { }

        try {
            dispatchUnitAction(b as any, a as any, waypointIds as any);
            if (canLog()) console.log("✅ ORBAT ▶ unit-action dispatched (swapped)");
        } catch (err) {
            console.error("💥 ORBAT ▶ unit-action dispatch threw", err);
        }
    }




    function onUnitClick(unit: NUnit, event: MouseEvent) {
        if (canLog()) {
            console.log("🖱️ ORBAT ▶ unit-click", {
                unit: { id: unit.id, name: unit.name },
                keys: { shift: event.shiftKey, ctrl: event.ctrlKey, meta: event.metaKey, alt: event.altKey },
                before: selMini(),
            });
        }

        const ids = selectedUnitIds.value;

        if (event.shiftKey) {
            const selectedIds = calculateSelectedUnitIds(unit.id);
            selectedIds.forEach((id) => ids.add(id));
        } else if (event.ctrlKey || event.metaKey) {
            if (ids.has(unit.id)) ids.delete(unit.id);
            else ids.add(unit.id);
        } else {
            activeUnitId.value = unit.id;
            activeParentId.value = unit.id;
        }

        bus.emit(unit);

        if (canLog()) console.log("🧾 ORBAT ▶ selection after click", selMini());
    }

    function calculateSelectedUnitIds(newUnitId: EntityId): EntityId[] {
        const lastSelectedId = [...selectedUnitIds.value].pop();
        if (lastSelectedId === undefined) return [newUnitId];

        const allOpenUnits: EntityId[] = [];
        for (const side of state.sides) {
            unitActions.walkSide(side, (unit) => {
                allOpenUnits.push(unit.id);
                if (!unit._isOpen) return false;
            });
        }

        const lastSelectedIndex = allOpenUnits.indexOf(lastSelectedId);
        const newUnitIndex = allOpenUnits.indexOf(newUnitId);
        if (lastSelectedIndex === -1 || newUnitIndex === -1) return [newUnitId];

        return allOpenUnits.slice(
            Math.min(lastSelectedIndex, newUnitIndex),
            Math.max(lastSelectedIndex, newUnitIndex) + 1,
        );
    }

    function onSideAction(side: NSide, action: SideAction) {
        if (canLog()) {
            console.log("🧭 ORBAT ▶ side-action", { side: { id: side.id, name: side.name }, action });
        }

        if (action === SideActions.Delete) {
            unitActions.deleteSide(side.id);
        } else if (action === SideActions.MoveDown) {
            unitActions.reorderSide(side.id, "down");
        } else if (action === SideActions.MoveUp) {
            unitActions.reorderSide(side.id, "up");
        } else if (action === SideActions.Add) {
            addSide();
        } else if (action === SideActions.Lock) {
            unitActions.updateSide(side.id, { locked: true }, { noUndo: true });
        } else if (action === SideActions.Unlock) {
            unitActions.updateSide(side.id, { locked: false }, { noUndo: true });
        } else if (action === SideActions.Clone) {
            unitActions.cloneSide(side.id);
        } else if (action === SideActions.CloneWithState) {
            unitActions.cloneSide(side.id, { includeState: true });
        } else if (action === SideActions.Hide) {
            unitActions.updateSide(side.id, { isHidden: true });
        } else if (action === SideActions.Show) {
            unitActions.updateSide(side.id, { isHidden: false });
        }
    }

    let dndCleanup: () => void = () => { };
    onMounted(() => {
        if (ORBAT_DEBUG) {
            console.log("🟩 ORBAT ▶ mounted", {
                sides: state.sides.length,
                sideIds: [...state.sides],
                units: Object.keys(state.unitMap).length,
            });
        }

        dndCleanup = monitorForElements({
            canMonitor: ({ source }) =>
                isUnitDragItem(source.data) || isSideGroupDragItem(source.data) || isSideDragItem(source.data),

            onDragStart: ({ location }) => {
                isDragging.value = true;
                isCopying.value = location.initial.input.ctrlKey || location.initial.input.metaKey;
                isCopyingState.value = isCopying.value && location.initial.input.altKey;

                if (canLog()) {
                    console.log("🟦 ORBAT ▶ dragStart", {
                        copying: isCopying.value,
                        copyingState: isCopyingState.value,
                    });
                }
            },

            onDrop: ({ source, location }) => {
                isDragging.value = false;

                const destination = location.current.dropTargets[0];
                if (!destination) return;

                const instruction = extractInstruction(destination.data);
                if (!instruction) return;

                const sourceData = source.data;
                const destinationData = destination.data;

                const isDuplicateAction = location.initial.input.ctrlKey || location.initial.input.metaKey;
                const isDuplicateState = isDuplicateAction && location.initial.input.altKey;

                if (isUnitDragItem(sourceData) && !isSideDragItem(destinationData)) {
                    const target = mapInstructionToTarget(instruction);

                    if (isUnitDragItem(destinationData)) {
                        onUnitDrop(sourceData.unit, destinationData.unit, target, { isDuplicateAction, isDuplicateState });
                        if (instruction.type === "make-child") destinationData.unit._isOpen = true;
                    } else if (isSideGroupDragItem(destinationData)) {
                        onUnitDrop(sourceData.unit, destinationData.sideGroup, target, { isDuplicateAction, isDuplicateState });
                    }

                    const unitId = sourceData.unit.id;
                    nextTick(() => {
                        const el = document.getElementById(`ou-${unitId}`);
                        if (el) triggerPostMoveFlash(el);
                    });
                } else if (isSideGroupDragItem(sourceData)) {
                    const target = mapInstructionToTarget(instruction);

                    if (isSideGroupDragItem(destinationData)) {
                        let sourceId = sourceData.sideGroup.id;
                        groupUpdate(() => {
                            if (isDuplicateAction) {
                                sourceId = unitActions.cloneSideGroup(sourceId, { includeState: isDuplicateState })!;
                            }
                            unitActions.changeSideGroupParent(sourceId, destinationData.sideGroup.id, target);
                        });

                        nextTick(() => {
                            const el = document.getElementById(`osg-${sourceId}`);
                            if (el) triggerPostMoveFlash(el);
                        });
                    } else if (isSideDragItem(destinationData)) {
                        let sourceId = sourceData.sideGroup.id;
                        groupUpdate(() => {
                            if (isDuplicateAction) {
                                sourceId = unitActions.cloneSideGroup(sourceId, { includeState: isDuplicateState })!;
                            }
                            unitActions.changeSideGroupParent(sourceId, destinationData.side.id, "on");
                        });

                        nextTick(() => {
                            const el = document.getElementById(`os-${sourceId}`);
                            if (el) triggerPostMoveFlash(el);
                        });
                    }
                } else if (isSideDragItem(sourceData)) {
                    const target = mapInstructionToTarget(instruction);

                    groupUpdate(() => {
                        let sourceId = sourceData.side.id;
                        if (isDuplicateAction) {
                            sourceId = unitActions.cloneSide(sourceData.side.id, { includeState: isDuplicateState })!;
                        }
                        if (isSideDragItem(destinationData)) {
                            unitActions.moveSide(sourceId, destinationData.side.id, target);
                            nextTick(() => {
                                const el = document.getElementById(`os-${sourceId}`);
                                if (el) triggerPostMoveFlash(el);
                            });
                        }
                    });
                }
            },
        });
    });

    onUnmounted(() => {
        if (ORBAT_DEBUG) console.log("🟥 ORBAT ▶ unmounted");
        dndCleanup();
    });

    function mapInstructionToTarget(instruction: Instruction): DropTarget {
        if (instruction.type === "make-child") return "on";
        if (instruction.type === "reorder-above") return "above";
        return "below";
    }

    function onUnitDrop(
        unit: NUnit,
        destinationUnit: NUnit | NSideGroup,
        target: DropTarget,
        options: { isDuplicateAction?: boolean; isDuplicateState?: boolean } = {},
    ) {
        const isDuplicateAction = options.isDuplicateAction ?? false;
        const isDuplicateState = options.isDuplicateState ?? false;

        if (canLog()) {
            console.log("📦 ORBAT ▶ unit-drop", {
                unit: { id: unit.id, name: unit.name },
                dest: { id: (destinationUnit as any).id, name: (destinationUnit as any).name },
                target,
                isDuplicateAction,
                isDuplicateState,
            });
        }

        groupUpdate(() => {
            let unitId = unit.id;
            if (isDuplicateAction) {
                unitId = unitActions.cloneUnit(unit.id, {
                    includeSubordinates: true,
                    includeState: isDuplicateState,
                })!;
            }
            changeUnitParent(unitId, destinationUnit.id, target);
        });

        if (isDuplicateState) time.setCurrentTime(state.currentTime);
    }

    function getUnitIdFromElement(element: Element | null | undefined): string | undefined {
        if (element?.tagName === "LI" && (element as HTMLElement).id?.startsWith("ou-")) {
            return (element as HTMLElement).id.slice(3);
        }
    }

    function onCopy(c: ClipboardEvent) {
        if (!inputEventFilter(c)) return;

        const target = document.activeElement as HTMLElement;
        const unitId = getUnitIdFromElement(target.closest('li[id^="ou-"]'));

        if (!unitId) {
            if (canLog()) console.log("📋 ORBAT ▶ copy skipped (no focused ORBAT row)");
            return;
        }

        const serializedUnits = [...selectedUnitIds.value].map((id) => serializeUnit(id, state, { newId: true }));
        c.clipboardData?.setData("application/orbat", io.stringifyObject(serializedUnits));

        const txt = serializedUnits.map((unit) => orbatToText(unit).join("")).join("");
        c.clipboardData?.setData("text/plain", txt);

        c.preventDefault();

        if (canLog()) console.log("📋 ORBAT ▶ copy ok", { focusedUnitId: unitId, n: serializedUnits.length });
    }

    function onPaste(e: ClipboardEvent) {
        if (!inputEventFilter(e)) return;

        const target = document.activeElement as HTMLElement;
        const parentId = getUnitIdFromElement(target.closest('li[id^="ou-"]'));

        if (!parentId || !e.clipboardData?.types.includes("application/orbat")) {
            if (canLog()) console.log("📋 ORBAT ▶ paste skipped", { parentId: parentId ?? null });
            return;
        }

        const pastedOrbat = parseApplicationOrbat(e.clipboardData?.getData("application/orbat"));
        pastedOrbat?.forEach((unit) => addUnitHierarchy(unit, parentId, activeScenario));
        unitActions.getUnitById(parentId)._isOpen = true;

        e.preventDefault();

        if (canLog()) console.log("📋 ORBAT ▶ paste ok", { parentId, n: pastedOrbat?.length ?? 0 });
    }
</script>
