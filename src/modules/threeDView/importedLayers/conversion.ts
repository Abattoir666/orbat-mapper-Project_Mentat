// src/modules/threeDView/importedLayers/conversion.ts
export type Imported2DLayer =
  | {
      id: string; type: "XYZLayer";
      url: string; attribution?: string; minLevel?: number; maxLevel?: number;
      geographic?: boolean; subdomains?: string[] | string;
      opacity?: number; isHidden?: boolean; title?: string;
    }
  | {
      id: string; type: "TileJSONLayer";
      // If you already resolved TileJSON -> template URL, set url; else keep tilejsonUrl.
      tilejsonUrl?: string;
      url?: string;
      attribution?: string; minLevel?: number; maxLevel?: number;
      geographic?: boolean; subdomains?: string[] | string;
      opacity?: number; isHidden?: boolean; title?: string;
    }
  | {
      id: string; type: "ImageLayer";
      /** geographic rectangle [west, south, east, north] in degrees */
      extent: [number, number, number, number];
      url: string;
      opacity?: number; isHidden?: boolean; title?: string;
    }
  | {
      id: string; type: "KMLLayer";
      url: string;
      extractStyles?: boolean;
      opacity?: number; isHidden?: boolean; title?: string;
    };

export type Imported2DLayerUI = {
  id: string;
  title?: string;
  type: Imported2DLayer["type"];
  alpha: number;
  on: boolean;
  layer: Imported2DLayer;
};

/** 
 * Convert a single raw 2D layer record into an Imported2DLayer, if possible.
 * You can “bend” geometries here later (e.g., densify, offset heights, reproject extents).
 */
export function toImported2D(raw: any): Imported2DLayer | null {
    const id = raw?.id ?? raw?.name ?? raw?.key ?? raw?.title;
    if (!id) return null;

    const t = String(raw?.type ?? raw?.layerType ?? raw?.layerSourceType ?? "");

    // XYZ-like raster
    if (t === "XYZLayer" || t === "xyz" || t === "XYZ" || raw?.sourceClass === "XYZ") {
        const url = raw?.url ?? raw?.sourceOptions?.url;
        if (!url) return null;
        return {
            id,
            type: "XYZLayer",
            url,
            attribution: raw?.attribution ?? raw?.attributions,
            minLevel: raw?.minLevel ?? raw?.sourceOptions?.minZoom,
            maxLevel: raw?.maxLevel ?? raw?.sourceOptions?.maxZoom,
            geographic: raw?.geographic ?? false,  // Web Mercator default for XYZ
            subdomains: raw?.subdomains,
            opacity: normAlpha(raw?.opacity),
            isHidden: !!raw?.isHidden,
            title: raw?.name ?? raw?.title ?? id,  // friendly label (your union allows 'title')
        };
    }

    // TileJSON
    if (t === "TileJSONLayer" || t === "tilejson" || raw?.sourceClass === "TileJSON") {
        const url = raw?.url ?? raw?.tilejsonUrl;
        return {
            id, type: "TileJSONLayer",
            url,
            tilejsonUrl: raw?.tilejsonUrl ?? (url && !/\{z\}.*\{x\}.*\{y\}/.test(url) ? url : undefined),
            attribution: raw?.attributions ?? raw?.attribution,
            minLevel: raw?.minLevel ?? raw?.sourceOptions?.minZoom ?? 0,
            maxLevel: raw?.maxLevel ?? raw?.sourceOptions?.maxZoom ?? 19,
            geographic: !!raw?.geographic,
            subdomains: raw?.subdomains,
            opacity: normAlpha(raw?.opacity),
            isHidden: !!raw?.isHidden,
            title: raw?.title ?? raw?.name ?? id,
        };
    }

    // Single georeferenced image (GeoImage)
    if (t === "ImageLayer" || t === "image" || raw?.sourceClass === "Image") {
        const extent = raw?.extent as [number, number, number, number];
        const url = raw?.url ?? raw?.sourceOptions?.url;
        if (!url || !validExtent(extent)) return null;
        return {
            id, type: "ImageLayer",
            extent,
            url,
            opacity: normAlpha(raw?.opacity),
            isHidden: !!raw?.isHidden,
            title: raw?.title ?? raw?.name ?? id,
        };
    }

    // KML
    if (t === "KMLLayer" || t === "kml" || raw?.sourceClass === "KML") {
        const url = raw?.url ?? raw?.sourceOptions?.url;
        if (!url) return null;
        return {
            id, type: "KMLLayer",
            url,
            extractStyles: !!raw?.extractStyles,
            opacity: normAlpha(raw?.opacity),
            isHidden: !!raw?.isHidden,
            title: raw?.title ?? raw?.name ?? id,
        };
    }

    return null;
}


/**
 * Main entry: read scenario’s 2D layers and produce UI rows.
 * Replace the `readScenarioLayers` implementation with your actual store access.
 */
export async function convertScenarioImportedLayers(scenario: any): Promise<Imported2DLayerUI[]> {
  const rawList = await readScenarioLayers(scenario); // ← customize this to your store
  const ui: Imported2DLayerUI[] = [];
  for (const r of rawList) {
    const layer = toImported2D(r);
    if (!layer) continue;
      ui.push({
          id: layer.id,
          title: (layer as any).title || layer.id,  // use the friendly title we set above
          type: layer.type,
          alpha: typeof (layer as any).opacity === "number" ? clamp01((layer as any).opacity) : 1,
          on: false,                                 // default OFF in the UI box
          layer,
      });
  }
  return ui;
}

/* ---------------- helpers you can tweak ---------------- */

function clamp01(n: any) { const x = Number(n); return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 1; }
function normAlpha(a: any) { return typeof a === "number" ? clamp01(a) : undefined; }
function validExtent(ext?: any): ext is [number, number, number, number] {
  return Array.isArray(ext) && ext.length === 4 && ext.every((v) => typeof v === "number" && Number.isFinite(v));
}

/**
 * Replace this with your actual scenario store read.
 * For example, if your Pinia store has: scenario.store.map.layers (array), return that.
 */
async function readScenarioLayers(scn: any): Promise<any[]> {
  // Try common places we’ve seen in your repo:
  const root = (scn?.store ?? scn) as any;

    // (A) If you maintain a list at root.state.mapLayers (IDs), map to objects
    const a = root?.state?.mapLayers;
    const mapMap = root?.state?.mapLayerMap;
    if (Array.isArray(a) && a.length) {
        if (mapMap && typeof mapMap === "object") {
            return a.map((id: any) => mapMap[id]).filter(Boolean);
        }
    }

  // (B) If there’s a getter/computed
  const b = root?.getMapLayers?.() ?? root?.mapLayers?.value ?? root?.mapLayers;
  if (Array.isArray(b) && b.length) return b;

  // (C) Fallback: empty (panel will show none)
  return [];
}
