import { ref } from "vue";
import type { Position } from "geojson";
import { altOf, formatAltIndicatorFromAlt, lonLatKey } from "@/geo/altitude";
import { trySampleSurfaceHeightMeters } from "@/geo/surfaceHeightRegistry";

export function useAltitudeIndicator() {
    const sfcCache = ref<Record<string, number>>({});
    const pending = new Set<string>();

    function queueSfc(pos: Position) {
        const lon = pos?.[0];
        const lat = pos?.[1];
        if (typeof lon !== "number" || typeof lat !== "number") return;

        const k = lonLatKey(lon, lat);
        if (sfcCache.value[k] != null) return;
        if (pending.has(k)) return;

        pending.add(k);
        void (async () => {
            const h = await trySampleSurfaceHeightMeters(lon, lat);
            if (typeof h === "number") {
                sfcCache.value = { ...sfcCache.value, [k]: h };
            }
            pending.delete(k);
        })();
    }

    function format(pos: Position | null | undefined): string {
        if (!pos) return "";

        const z = altOf(pos);
        if (z !== undefined) return formatAltIndicatorFromAlt(z);

        // clamped-to-surface: attempt numeric sampling if 3D view is available
        queueSfc(pos);
        const lon = pos[0] as number;
        const lat = pos[1] as number;
        const k = lonLatKey(lon, lat);
        const h = sfcCache.value[k];

        return typeof h === "number" ? `SFC ${Math.round(h)} m` : "SFC";
    }

    return { format };
}
