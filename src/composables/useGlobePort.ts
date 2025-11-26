// src/composables/useGlobePort.ts
import { onMounted, onBeforeUnmount, shallowRef } from "vue";
import {
    createGlobeAdapter,
    type GlobePort,
    type UnitRenderable,
} from "@/modules/threeDView/globeAdapter";

export function useGlobePort() {
    const adapter = shallowRef<GlobePort | null>(null);
    const elRef = shallowRef<HTMLDivElement | null>(null);

    onMounted(async () => {
        if (!adapter.value) adapter.value = createGlobeAdapter();
        if (elRef.value) await adapter.value.mount(elRef.value);
    });

    onBeforeUnmount(() => {
        adapter.value?.unmount();
    });

    return {
        // element mount point for the globe canvas
        elRef,

        // lifecycle
        mount: async (el: HTMLDivElement) => {
            elRef.value = el;
            await adapter.value?.mount(el);
        },
        unmount: () => adapter.value?.unmount(),

        // unit API (same as your adapter)
        setUnits: (arr: UnitRenderable[]) => adapter.value?.setUnits(arr),
        upsertUnit: (u: UnitRenderable) => adapter.value?.upsertUnit(u),
        removeUnit: (id: string) => adapter.value?.removeUnit(id),

        // camera & misc
        flyToLatLon: (lon: number, lat: number, height?: number) =>
            adapter.value?.flyToLatLon(lon, lat, height),

        // access to the underlying adapter if needed
        get globe() {
            return adapter.value;
        },
    };
}