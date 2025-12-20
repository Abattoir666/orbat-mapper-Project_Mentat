// src/modules/scenarioeditor/ExtendedScenarioEvents/eventIconStyle.ts
import Style from "ol/style/Style";
import Icon from "ol/style/Icon";
import CircleStyle from "ol/style/Circle";
import Fill from "ol/style/Fill";
import Stroke from "ol/style/Stroke";
import Text from "ol/style/Text";
import type { FeatureLike } from "ol/Feature";
import { resolveEventIcon } from "./eventIconRegistry";

// Cached tinted SVG data-URIs (keyed by `${src}|${tint}`)
const svgTintCache = new Map<string, string>();
const svgTintInflight = new Map<string, Promise<void>>();

/**
 * Override fill/stroke inside an SVG markup string so that OpenLayers Icon tinting works
 * even when the SVG has explicit colors. We do a conservative replacement:
 * - replace common fill/stroke attributes with the tint
 * - preserve fill="none" / stroke="none"
 *
 * Note: This is a best-effort approach; if your SVGs use CSS or complex paint servers,
 * you may need to normalize them upstream.
 */
function tintSvgMarkup(svgText: string, tint: string): string {
    if (!svgText || !tint) return svgText;

    // Replace fill="..." except fill="none"
    svgText = svgText.replace(/\bfill\s*=\s*(['"])(?!none\b)[^'"]*\1/gi, `fill="${tint
        }"`);

    // Replace stroke="..." except stroke="none"
    svgText = svgText.replace(/\bstroke\s*=\s*(['"])(?!none\b)[^'"]*\1/gi, `stroke="${tint
        }"`);

    // Also handle inline style="...fill:...; stroke:...;"
    svgText = svgText.replace(/style\s*=\s*(['"])([^'"]*)\1/gi, (_m, q, body) => {
        let out = String(body);
        out = out.replace(/fill\s*:\s*(?!none\b)[^;]+/gi, `fill:${tint}`);
        out = out.replace(/stroke\s*:\s*(?!none\b)[^;]+/gi, `stroke:${tint}`);
        return `style=${q}${out}${q}`;
    });

    return svgText;
}

function encodeSvgDataUri(svgText: string): string {
    // Use encodeURIComponent to keep it robust; OL accepts utf8 data uri.
    return `data:image/svg+xml;utf8,${encodeURIComponent(svgText)}`;
}

/**
 * Pre-tint a data:image/svg+xml URI and return a new URI.
 * This is used because OL Icon "color" tinting can be unreliable depending on SVG authoring.
 */
function tintSvgDataUri(src: string, tint: string, feature?: any): string {
    if (!src || !tint) return src;

    const cacheKey = `${src}|${tint}`;

    // Fast path: already cached
    const cached = svgTintCache.get(cacheKey);
    if (cached) {
        if (feature?.set) feature.set("_eventTintedIconKey", cacheKey);
        return cached;
    }

    // If we previously queued an inflight tint, return original src for now;
    // the next style evaluation will pick up the cached tint.
    if (svgTintInflight.has(cacheKey)) {
        return src;
    }

    // Only attempt to tint SVG data URIs here. External URLs can be tinted by OL "color" if same-origin/cors allows,
    // but we avoid fetch complexity in this helper.
    if (src.startsWith("data:image/svg+xml")) {
        const p = (async () => {
            try {
                let svgText = "";

                if (src.startsWith("data:image/svg+xml;base64,")) {
                    const b64 = src.slice("data:image/svg+xml;base64,".length);
                    svgText = atob(b64);
                } else {
                    // data:image/svg+xml,<svg ...> or data:image/svg+xml;utf8,...
                    const comma = src.indexOf(",");
                    const payload = comma >= 0 ? src.slice(comma + 1) : "";
                    svgText = decodeURIComponent(payload);
                }

                const tintedText = tintSvgMarkup(svgText, tint);
                const tintedUri = encodeSvgDataUri(tintedText);

                svgTintCache.set(cacheKey, tintedUri);
            } finally {
                svgTintInflight.delete(cacheKey);
            }
        })();

        svgTintInflight.set(cacheKey, p);
    }

    return src;
}

function getEventStackIndex(feature: any): number {
    const idx = Number(feature?.get?.("eventStackIndex") ?? 0);
    return Number.isFinite(idx) ? idx : 0;
}

function getEventDisplacement(feature: any): [number, number] {
    const idx = getEventStackIndex(feature);
    if (idx <= 0) return [0, 0];

    // Horizontal fan; tune spacing as desired
    const stepPx = 12;

    // idx: 1 -> +1, 2 -> -1, 3 -> +2, 4 -> -2, ...
    const k = Math.ceil(idx / 2) * (idx % 2 === 0 ? -1 : 1);
    return [k * stepPx, 0];
}

function makeText(title: string, displacement: [number, number]): Text {
    return new Text({
        text: title || "",
        font: "12px system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        offsetX: 26 + (displacement?.[0] ?? 0),
        offsetY: (displacement?.[1] ?? 0),
        textAlign: "left",
        overflow: true,
        backgroundFill: new Fill({ color: "rgba(15,23,42,0.7)" }),
        padding: [2, 4, 2, 4],
        fill: new Fill({ color: "#f9fafb" }),
        stroke: new Stroke({ color: "rgba(15,23,42,0.9)", width: 3 }),
    });
}

function makeFallbackCircle(displacement: [number, number] = [0, 0], color?: string): CircleStyle {
    return new CircleStyle({
        radius: 12,
        fill: new Fill({ color: color ?? "rgba(239, 68, 68, 0.9)" }),
        stroke: new Stroke({ color: "rgba(15,23,42,0.9)", width: 2 }),
        displacement,
    });
}

function normalizedScaleForSrc(src: string, category: string): number {
    const TARGET_PX = 28;
    const MDI_BASE_SCALE = 1.2;

    const key = (category ?? "").toLowerCase().trim();
    const CATEGORY_SCALE: Record<string, number> = {
        generic: 1.0,
        battle: 1.0,
        airstrike: 1.0,
        artillery: 1.0,
        naval: 1.0,
        movement: 1.0,
        political: 1.0,
        civilian: 1.0,
        disaster: 1.0,
        intel: 1.0,
        cbrn: 1.0,
    };

    if (src.startsWith("data:image/svg+xml")) {
        // Heuristic: many MDI SVGs are authored at ~512px viewBox
        const assumedIntrinsic = 512;
        const downscaleTo24 = TARGET_PX / assumedIntrinsic; // 0.046875
        return MDI_BASE_SCALE * downscaleTo24 * (CATEGORY_SCALE[key] ?? 1);
    }

    return MDI_BASE_SCALE * (CATEGORY_SCALE[key] ?? 1);
}

function makeIconFromSrc(src: string, category: string, displacement: [number, number], color?: string): Icon {
    return new Icon({
        src,
        scale: normalizedScaleForSrc(src, category),
        anchor: [0.5, 1],
        anchorXUnits: "fraction",
        anchorYUnits: "fraction",
        crossOrigin: "anonymous",
        displacement,
        color: color ?? undefined,
    });
}

export function eventIconStyle(feature: FeatureLike): Style {
    const category = (feature.get("eventCategory") as string | undefined) ?? "generic";
    const title = (feature.get("eventTitle") as string | undefined) ?? "";
    const eventColor = (feature.get("eventColor") as string | undefined) ?? undefined;

    const displacement = getEventDisplacement(feature);
    const text = makeText(title, displacement);
    const idx = getEventStackIndex(feature);

    if (!category || category.toLowerCase().trim() === "generic") {
        const s = new Style({
            image: makeFallbackCircle(displacement, eventColor),
            text,
        });
        s.setZIndex(5000 - idx);
        return s;
    }

    let src = resolveEventIcon(category);

    if (!src || typeof src !== "string") {
        const s = new Style({
            image: makeFallbackCircle(displacement, eventColor),
            text,
        });
        s.setZIndex(5000 - idx);
        return s;
    }

    // If we have a color, attempt to pre-tint SVG data URIs so the color reliably applies.
    if (eventColor) {
        src = tintSvgDataUri(src, eventColor, feature);
    }

    const s = new Style({
        image: makeIconFromSrc(src, category, displacement, eventColor),
        text,
    });
    s.setZIndex(5000 - idx);
    return s;
}
