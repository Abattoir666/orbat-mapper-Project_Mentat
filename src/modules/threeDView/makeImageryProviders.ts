// src/modules/threeDView/makeImageryProviders.ts
import {
    UrlTemplateImageryProvider,
    WebMercatorTilingScheme,
    OpenStreetMapImageryProvider,
    type ImageryProvider,
} from "cesium";

export type ImageryEntry = {
    key: string;
    label: string;
    create: () => ImageryProvider;
};

// Define your providers here
const providers: ImageryEntry[] = [
    {
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
        key: "esriWorldImagery",
        label: "Esri World Imagery",
        create: () =>
            new UrlTemplateImageryProvider({
                url:
                    "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
                maximumLevel: 19,
                tilingScheme: new WebMercatorTilingScheme(),
                credit:
                    "Tiles © Esri — Source: Esri, Earthstar Geographics, CNES/Airbus DS, USDA, USGS, AeroGRID, IGN, and the GIS User Community",
            }),
    },
];

// Convenience lookup
function getByKey(key: string): ImageryEntry {
    const e = providers.find((p) => p.key === key);
    if (!e) throw new Error(`[makeImageryProviders] Unknown imagery key: ${key}`);
    return e;
}

/**
 * The named export your components import.
 * Usage:
 *   const { providers, getByKey } = makeImageryProviders();
 */
export function makeImageryProviders() {
    return { providers, getByKey };
}

// Also export the array directly if someone prefers importing it.
export { providers };
export default makeImageryProviders;
