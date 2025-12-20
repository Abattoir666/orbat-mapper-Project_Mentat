<script setup lang="ts">
    import { ref, computed } from "vue";
    import type { EntityId } from "@/types/base";
    import { injectStrict } from "@/utils";
    import { activeScenarioKey } from "@/components/injects";

    import MilitarySymbol from "@/components/MilitarySymbol.vue";
    import { useInvolvedUnits } from "@/modules/scenarioeditor/ExtendedScenarioEvents/useInvolvedUnits";
    import UnitPickerDialog from "@/modules/scenarioeditor/ExtendedScenarioEvents/UnitPickerDialog.vue";

    const props = defineProps<{ eventId: EntityId }>();

    const activeScenario = injectStrict(activeScenarioKey);
    const getCombinedSymbolOptions =
        (activeScenario as any)?.unitActions?.getCombinedSymbolOptions as ((u: any) => any) | undefined;

    const { selectedUnits, involvedUnitIds, setUnits, clear, averageColor, allUnits } = useInvolvedUnits(props.eventId);

    const pickerOpen = ref(false);
    const count = computed(() => involvedUnitIds.value.length);

    function openPicker() {
        pickerOpen.value = true;
    }
    function closePicker() {
        pickerOpen.value = false;
    }

    function symbolOptionsForUnit(unit: any, colorHex?: string | null) {
        const base = getCombinedSymbolOptions ? getCombinedSymbolOptions(unit) : {};
        if (!colorHex) return base;

        const DARK = "#111827"; // near-black (slate-900)

        return {
            ...base,

            // Keep frame/lines dark so echelon ticks are visible
            frameColor: base.frameColor ?? DARK,
            strokeColor: base.strokeColor ?? base.frameColor ?? DARK,
            outlineColor: (base as any).outlineColor ?? DARK,
            infoColor: (base as any).infoColor ?? DARK,
            textColor: (base as any).textColor ?? DARK,
            echelonColor: (base as any).echelonColor ?? DARK,

            // Tint interior/icon to unit color
            fillColor: colorHex,
            iconColor: colorHex,

            outlineWidth: Math.max(Number((base as any).outlineWidth ?? 2) || 2, 2),
        };
    }

    function sidcForUnit(u: any): string | null {
        return (u?.sidc ?? u?.SIDC ?? u?.symbolSidc ?? null) as string | null;
    }
</script>

<template>
    <div class="mt-4 space-y-4">
        <div class="flex items-center justify-between gap-2">
            <p class="text-xs font-medium text-muted-foreground">
                Involved units ({{ count }})
            </p>

            <div class="flex items-center gap-2">
                <div v-if="averageColor" class="flex items-center gap-2 text-xs text-muted-foreground">
                    <span class="inline-block h-3 w-3 rounded-full border" :style="{ backgroundColor: averageColor }"></span>
                    <span>{{ averageColor }}</span>
                </div>

                <button type="button" class="rounded border px-2 py-1 text-xs" @click="openPicker">
                    Edit selection
                </button>

                <button v-if="count" type="button" class="rounded border px-2 py-1 text-xs" @click="clear">
                    Clear
                </button>
            </div>
        </div>

        <div v-if="selectedUnits.length" class="rounded border">
            <div class="divide-y">
                <div v-for="u in selectedUnits" :key="u.id" class="flex items-center gap-2 p-2">
                    <div class="h-7 w-7 rounded border flex items-center justify-center">
                        <MilitarySymbol v-if="u.unit && sidcForUnit(u.unit)"
                                        :sidc="sidcForUnit(u.unit)!"
                                        :size="26"
                                        :options="symbolOptionsForUnit(u.unit, u.colorHex)" />
                        <span v-else class="text-[9px] text-muted-foreground">SYM</span>
                    </div>

                    <div class="min-w-0 flex-1">
                        <div class="truncate text-sm">{{ u.label }}</div>
                        <div class="truncate text-xs text-muted-foreground">{{ u.id }}</div>
                    </div>

                    <span v-if="u.colorHex"
                          class="inline-block h-3 w-3 rounded-full border"
                          :style="{ backgroundColor: u.colorHex }"></span>
                </div>
            </div>
        </div>

        <p v-else class="text-xs text-muted-foreground">
            No involved units selected. Use "Edit selection" to add units.
        </p>

        <!-- Performance: only feed the large list when the picker is open -->
        <UnitPickerDialog v-model:open="pickerOpen"
                          :selectedIds="involvedUnitIds"
                          :allUnits="pickerOpen ? allUnits : []"
                          @apply="(ids) => { setUnits(ids); closePicker(); }"
                          @cancel="closePicker" />
    </div>
</template>
