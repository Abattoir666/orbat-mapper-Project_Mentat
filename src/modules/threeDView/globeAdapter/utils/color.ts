import { Color } from "cesium";
import type { UnitRenderable } from "../types";

export function safeCssColor(css?: string, fallback: Color = Color.WHITE): Color {
    try {
        if (!css || !css.trim()) return fallback;
        return Color.fromCssColorString(css.trim());
    } catch {
        return fallback;
    }
}

export function extractGroupFill(u: UnitRenderable): string | undefined {
    return u.symbolOptions?.iconFillColor || u.symbolOptions?.fillColor;
}

export function normalizeHex(c?: string): string | undefined {
    if (!c) return;
    try {
        const col = Color.fromCssColorString(c);
        const r = Math.round(col.red * 255).toString(16).padStart(2, "0");
        const g = Math.round(col.green * 255).toString(16).padStart(2, "0");
        const b = Math.round(col.blue * 255).toString(16).padStart(2, "0");
        return `#${r}${g}${b}`;
    } catch {
        return;
    }
}

export function stripFillParams(url: string): string {
    return url
        .replace(/([?&])(fill|fc)=[^&]*/gi, "$1")
        .replace(/[?&](&|$)/, "$1");
}

export function withSymbolColor(url?: string, hex?: string): string | undefined {
    if (!url || !hex) return url;
    if (url.startsWith("data:")) return url;

    const cleaned = stripFillParams(url);
    const enc = encodeURIComponent(hex);
    const hasQ = cleaned.includes("?");
    return `${cleaned}${hasQ ? "&" : "?"}fill=${enc}&fc=${enc}`;
}
