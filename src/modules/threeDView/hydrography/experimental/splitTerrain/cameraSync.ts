// src/modules/threeDView/hydrography/experimental/splitTerrain/cameraSync.ts
import type { Viewer } from "cesium";

export function installCameraSync(top: Viewer, bottom: Viewer) {
    let raf = 0;
    let disposed = false;

    const sync = () => {
        raf = 0;
        if (disposed) return;

        const c = top.camera;
        bottom.camera.setView({
            destination: c.positionWC,
            orientation: {
                direction: c.directionWC,
                up: c.upWC,
            },
        });
        bottom.scene.requestRender();
    };

    const onChanged = () => {
        if (raf) return;
        raf = requestAnimationFrame(sync);
    };

    top.camera.changed.addEventListener(onChanged);

    return () => {
        disposed = true;
        try { top.camera.changed.removeEventListener(onChanged); } catch { }
        if (raf) cancelAnimationFrame(raf);
    };
}
