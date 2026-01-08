// src/symbology/underbars/toeUnderbarColor.ts

// Single source of truth for the TO&E/S underbar color ramp.
// Mirrors the logic currently embedded in geoUnitLayers_toeUnderbar.ts,
// using the same CSS variables (status palette) for consistency across map + UI.

export type StatusBarPalette = {
    destroyed: string;
    damaged: string;
    fullyCapable: string;
    fullToCapacity: string;
};

type Rgb = { r: number; g: number; b: number };

function clamp(n: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, n));
}

function lerp(a: number, b: number, t: number) {
    return a + (b - a) * t;
}

function lerpRgb(a: Rgb, b: Rgb, t: number): Rgb {
    return {
        r: Math.round(lerp(a.r, b.r, t)),
        g: Math.round(lerp(a.g, b.g, t)),
        b: Math.round(lerp(a.b, b.b, t)),
    };
}

export function cssToRgb(input: string): Rgb | null {
    const s = (input || "").trim();

    // #RRGGBB
    const hex = /^#([0-9a-f]{6})$/i.exec(s);
    if (hex) {
        const v = parseInt(hex[1], 16);
        return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
    }

    // rgb(12, 34, 56)
    const rgbComma = /^rgb\(\s*(\d+)\s*[ ,]\s*(\d+)\s*[ ,]\s*(\d+)\s*\)$/i.exec(s);
    if (rgbComma) return { r: +rgbComma[1], g: +rgbComma[2], b: +rgbComma[3] };

    // rgb(12 34 56)  (Tailwind style)
    const rgbSpace = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\)$/i.exec(s);
    if (rgbSpace) return { r: +rgbSpace[1], g: +rgbSpace[2], b: +rgbSpace[3] };

    return null;
}

/**
 * Reads your existing status palette from CSS variables.
 * Safe fallback values are provided if called in non-browser contexts or if vars are missing.
 */
export function getStatusBarPalette(): StatusBarPalette {
    // Defaults match your geo file’s fallbacks.
    const fallback: StatusBarPalette = {
        destroyed: "rgb(185 28 28)",
        damaged: "rgb(245 158 11)",
        fullyCapable: "rgb(16 185 129)",
        fullToCapacity: "rgb(59 130 246)",
    };

    try {
        if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return fallback;

        const cs = getComputedStyle(document.documentElement);
        return {
            destroyed: cs.getPropertyValue("--status-present-destroyed").trim() || fallback.destroyed,
            damaged: cs.getPropertyValue("--status-present-damaged").trim() || fallback.damaged,
            fullyCapable: cs.getPropertyValue("--status-present-fullycapable").trim() || fallback.fullyCapable,
            fullToCapacity: cs.getPropertyValue("--status-present-fulltocapacity").trim() || fallback.fullToCapacity,
        };
    } catch {
        return fallback;
    }
}

/**
 * Piecewise color interpolation:
 *   0%   -> destroyed
 *   50%  -> damaged
 *   100% -> fully capable
 *   150% -> full to capacity
 *   >150 -> clamp to full to capacity
 *
 * Returns: "rgb(r g b)" (Tailwind-style RGB string), matching your map implementation.
 */
export function toePctToCssColor(pctRaw: number, palette?: StatusBarPalette): string {
    const pct = Number.isFinite(pctRaw) ? pctRaw : 0;
    const pal = palette ?? getStatusBarPalette();

    const c0 = cssToRgb(pal.destroyed) ?? { r: 185, g: 28, b: 28 };
    const c50 = cssToRgb(pal.damaged) ?? { r: 245, g: 158, b: 11 };
    const c100 = cssToRgb(pal.fullyCapable) ?? { r: 16, g: 185, b: 129 };
    const c150 = cssToRgb(pal.fullToCapacity) ?? { r: 59, g: 130, b: 246 };

    let out: Rgb;
    if (pct <= 50) {
        out = lerpRgb(c0, c50, clamp(pct / 50, 0, 1));
    } else if (pct <= 100) {
        out = lerpRgb(c50, c100, clamp((pct - 50) / 50, 0, 1));
    } else if (pct <= 150) {
        out = lerpRgb(c100, c150, clamp((pct - 100) / 50, 0, 1));
    } else {
        out = c150;
    }

    return `rgb(${out.r} ${out.g} ${out.b})`;
}
