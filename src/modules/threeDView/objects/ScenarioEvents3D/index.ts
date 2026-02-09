import { computed } from "vue";
import { useSelectedItems } from "@/stores/selectedStore";

/**
 * Defensive getter/setter for activeScenarioEventId, mirroring the patterns
 * we used for activeUnitId in 3D.
 */
export function useScenarioEventSelection3D() {
    const sel = useSelectedItems() as any;

    const activeScenarioEventId = computed<string | null>({
        get() {
            const v = sel?.activeScenarioEventId;
            if (v && typeof v === "object" && "value" in v) return v.value ?? null;
            return v ?? null;
        },
        set(next) {
            const v = sel?.activeScenarioEventId;
            if (v && typeof v === "object" && "value" in v) {
                v.value = next;
                return;
            }
            sel.activeScenarioEventId = next;
        },
    });

    function clearActiveScenarioEvent() {
        try {
            activeScenarioEventId.value = null;
        } catch {
            // swallow
        }
    }

    return { activeScenarioEventId, clearActiveScenarioEvent };
}
