import { computed } from "vue";
import type { Unit, UnitPersonnel } from "@/types/scenarioModels";

export function useDoctrinalToe(unit: Unit | null | undefined) {
    const baselinePersonnel = computed<UnitPersonnel[]>(
        () => unit?.toeBaseline?.personnel ?? [],
    );

    const baselineTotal = computed(() =>
        baselinePersonnel.value.reduce((s, p) => s + (Number(p.count) || 0), 0),
    );

    const templateKey = computed(() => unit?.toeBaseline?.templateKey ?? "");
    const source = computed(() => unit?.toeBaseline?.source ?? "");

    return { baselinePersonnel, baselineTotal, templateKey, source };
}
