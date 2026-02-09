import * as Cesium from "cesium";

export function evtTime(e: any): number | undefined {
    const candidates = [
        e?.t,
        e?.time,
        e?.startTime,
        e?.start,
        e?.at,
        e?.timestamp,
        e?.ms,
    ];

    for (const v of candidates) {
        if (typeof v === "number" && Number.isFinite(v)) return v;
        if (typeof v === "string" && v.trim()) {
            const n = Number(v);
            if (Number.isFinite(n)) return n;
            const d = Date.parse(v);
            if (Number.isFinite(d)) return d;
        }
    }
    return undefined;
}

export function currentViewerMs(viewer?: Cesium.Viewer): number | undefined {
    try {
        const jd = viewer?.clock?.currentTime;
        return jd ? Cesium.JulianDate.toDate(jd).getTime() : undefined;
    } catch {
        return undefined;
    }
}
