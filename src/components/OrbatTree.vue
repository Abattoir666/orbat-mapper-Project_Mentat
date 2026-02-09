<script setup lang="ts">
    import { computed, ref, watch } from "vue";
    import OrbatTreeItem from "./OrbatTreeItem.vue";
    import { type UnitAction } from "@/types/constants";
    import type { EntityId } from "@/types/base";
    import type { NUnit } from "@/types/internalModels";
    import { filterUnits } from "@/composables/filtering";
    import { type UnitSymbolOptions } from "@/types/scenarioModels";

    interface Props {
        units: EntityId[];
        unitMap: Record<EntityId, NUnit>;
        filterQuery?: string;
        locationFilter?: boolean;
        symbolOptions?: UnitSymbolOptions;
    }

    const props = withDefaults(defineProps<Props>(), {
        filterQuery: "",
        locationFilter: false,
    });

    interface Emits {
        (e: "unit-action", unit: NUnit, action: UnitAction): void;

        (e: "unit-click", unit: NUnit, event: MouseEvent): void;
    }

    const emit = defineEmits<Emits>();

    const ORBAT_DEBUG = (localStorage.getItem("mentat.orbatDebug") ?? "0") === "1";
    let _orbatTreeLast = 0;
    function _orbatTreeCanLog() {
        if (!ORBAT_DEBUG) return false;
        const now = Date.now();
        if (now - _orbatTreeLast < 80) return false;
        _orbatTreeLast = now;
        return true;
    }
    function _orbatTreeLog(tag: string, data?: any) {
        if (!_orbatTreeCanLog()) return;
        try {
            console.log(`🌳 OrbatTree ▶ ${tag}`, data ?? "");
        } catch { }
    }

    const queryHasChanged = ref(true);

    watch(
        () => props.filterQuery,
        () => (queryHasChanged.value = true),
    );

    const onUnitAction = (unit: NUnit, action: UnitAction) => {
        _orbatTreeLog("unit-action passthrough", { unitId: unit?.id, name: (unit as any)?.name, action });
        emit("unit-action", unit, action);
    };

    const filteredUnits = computed(() => {
        const resetOpen = queryHasChanged.value;
        queryHasChanged.value = false;
        return filterUnits(
            props.units,
            props.unitMap,
            props.filterQuery,
            props.locationFilter,
            resetOpen,
        );
    });
</script>

<template>
    <ul class="">
        <OrbatTreeItem :item="orbatItem"
                       v-for="(orbatItem, index) in filteredUnits"
                       :key="orbatItem.unit.id"
                       @unit-action="onUnitAction"
                       @unit-click="(unit, event) => emit('unit-click', unit, event)"
                       :symbolOptions="symbolOptions"
                       :last-in-group="index === filteredUnits.length - 1" />
    </ul>
</template>
