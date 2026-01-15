// src/modules/threeDView/makeImageryProviders.ts
import {
    UrlTemplateImageryProvider,
    WebMercatorTilingScheme,
    GeographicTilingScheme,
    type ImageryProvider,
} from "cesium";

/** One of:
 *  - Static provider (code-defined) -> use `create()`
 *  - Template provider (from mapConfig.json) -> use `template` fields with setBaseLayerTemplate(...)
 */
export type ImageryEntry =
    | {
        kind: "static";
        key: string;          // e.g., "osmXYZ"
        label: string;        // dropdown label
        create: () => ImageryProvider;
    }
    | {
        kind: "template";
        key: string;          // e.g., "cfg:osm" or "cfg:GoogleSat"
        label: string;        // dropdown label
        template: {
            url: string;
            minLevel?: number;
            maxLevel?: number;
            geographic?: boolean;          // true => GeographicTilingScheme, else WebMercator
            subdomains?: string[] | string;
            attribution?: string;          // "credit"
        };
    };

/* ───────────────────────── Static providers (always available) ───────────────────────── */

const staticProviders: ImageryEntry[] = [
    {
        kind: "static",
        key: "osmXYZ",
        label: "OpenStreetMap (XYZ Tiles)",
        create: () =>
            new UrlTemplateImageryProvider({
                url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
                maximumLevel: 19,
                tilingScheme: new WebMercatorTilingScheme(),
                credit: "© OpenStreetMap contributors",
            }),
    },
    {
        kind: "static",
        key: "esriWorldImagery",
        label: "Esri World Imagery",
        create: () =>
            new UrlTemplateImageryProvider({
                url: "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
                maximumLevel: 19,
                tilingScheme: new WebMercatorTilingScheme(),
                credit:
                    "Tiles © Esri — Source: Esri, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, and the GIS User Community",
            }),
    },
];

/* ─────────────────────── mapConfig.json → template providers ───────────────────────
   Expected minimal structure (align with your 2D config):
   [
     {
       "title": "OSM",
       "name": "osm",
       "layerType": "baselayer",
       "url": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
       "minLevel": 0,
       "maxLevel": 19,
       "projection": "WebMercator",  // or "Geographic" / "EPSG:4326"
       "subdomains": "abc",          // or ["a","b","c"]
       "attribution": "© OpenStreetMap"
     },
     ...
   ]
*/

type MapConfigLayer = {
    title?: string;
    name?: string;
    layerType?: string; // "baselayer" for base layers
    url?: string;
    minLevel?: number;
    maxLevel?: number;
    projection?: string;     // "Geographic", "EPSG:4326", "WebMercator", etc.
    tilingScheme?: string;   // sometimes used instead of projection
    subdomains?: string | string[];
    attribution?: string;
};

let cachedTemplateProviders: ImageryEntry[] | null = null;

async function loadMapConfigTemplateProviders(): Promise<ImageryEntry[]> {
    if (cachedTemplateProviders) return cachedTemplateProviders;

    try {
        const res = await fetch("public//config/mapConfig.json");
        const layers = (await res.json()) as MapConfigLayer[] | { layers?: MapConfigLayer[] };

        const arr: MapConfigLayer[] = Array.isArray(layers)
            ? layers
            : Array.isArray((layers as any)?.layers)
                ? (layers as any).layers
                : [];

        const templates: ImageryEntry[] = arr
            .filter((l) => (l.layerType || "").toLowerCase() === "baselayer" && l.url)
            .map((l) => {
                const keyName = (l.name || l.title || l.url || "layer").toString().trim();
                const key = `cfg:${keyName}`; // namespace config-driven keys
                const label = l.title || l.name || keyName;

                // heuristic: treat "Geographic"/"EPSG:4326" as geographic tiling scheme
                const proj = (l.projection || l.tilingScheme || "").toLowerCase();
                const geographic =
                    proj.includes("geographic") || proj.includes("4326") || proj.includes("epsg:4326");

                return {
                    kind: "template" as const,
                    key,
                    label,
                    template: {
                        url: l.url!,
                        minLevel: l.minLevel,
                        maxLevel: l.maxLevel,
                        geographic,
                        subdomains: l.subdomains,
                        attribution: l.attribution,
                    },
                };
            });

        cachedTemplateProviders = templates;
        return templates;
    } catch (e) {
        console.warn("[makeImageryProviders] Failed to load mapConfig.json:", e);
        cachedTemplateProviders = [];
        return [];
    }
}

/* ───────────────────────────── Public API (UI + Adapter) ───────────────────────────── */

export async function listImageryOptions(): Promise<ImageryEntry[]> {
    const dynamic = await loadMapConfigTemplateProviders();
    // UI can render this as one dropdown; entries declare whether they're "static" or "template"
    return [...staticProviders, ...dynamic];
}

/** For static-only lookups (used by adapter.setBaseLayer) */
export function getStaticByKey(key: string): Extract<ImageryEntry, { kind: "static" }> | undefined {
    return staticProviders.find((p) => p.kind === "static" && p.key === key) as any;
}

/** For any key (static or config), returns the entry and indicates how to use it. */
export async function getAnyByKey(
    key: string
): Promise<ImageryEntry | undefined> {
    const s = getStaticByKey(key);
    if (s) return s;
    const all = await listImageryOptions();
    return all.find((p) => p.key === key);
}

/** Backwards-compatible factory mirroring your previous shape */
export function makeImageryProviders() {
    return {
        providers: staticProviders, // keep exposing the static list for legacy code
        getByKey: (key: string) => {
            const e = getStaticByKey(key);
            if (!e) throw new Error(`[makeImageryProviders] Unknown *static* imagery key: ${key}`);
            return e;
        },
    };
}

// Direct export of static array (legacy)
export { staticProviders as providers };
export default makeImageryProviders;
