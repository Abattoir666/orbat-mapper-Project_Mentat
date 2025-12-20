// src/modules/scenarioeditor/Leaders/rankAssets.ts

export interface RankAssetResolverOptions {
    /**
     * Resolve insignia IDs against a remote base URL.
     * Example: "https://cdn.example.com/orbat/ranks"
     */
    remoteBaseUrl?: string;

    /**
     * Resolve insignia IDs against a local static base path (served from /public).
     * Example: "/ranks"
     */
    localBasePath?: string;

    /**
     * If the imageId has no extension, append this.
     */
    defaultExt?: "png" | "svg" | "webp";
}

const DEFAULTS: Required<RankAssetResolverOptions> = {
    remoteBaseUrl: "",
    localBasePath: "/ranks",
    defaultExt: "svg",
};

/**
 * Resolve an insignia imageId (e.g. "us_army/o3_cpt") to a URL.
 *
 * Today: resolve to /public assets (localBasePath).
 * Later: point remoteBaseUrl at a CDN, or swap to scenario-bundle asset resolution.
 */
export function resolveInsigniaUrl(
    imageId?: string,
    opts?: RankAssetResolverOptions,
): string | undefined {
    if (!imageId) return undefined;

    const o = { ...DEFAULTS, ...(opts || {}) };

    const hasExt = /\.[a-zA-Z0-9]+$/.test(imageId);
    const file = hasExt ? imageId : `${imageId}.${o.defaultExt}`;

    if (o.remoteBaseUrl) {
        return `${trimSlashes(o.remoteBaseUrl)}/${trimSlashes(file)}`;
    }

    return `${trimSlashes(o.localBasePath)}/${trimSlashes(file)}`;
}

function trimSlashes(s: string): string {
    return s.replace(/^\/+|\/+$/g, "");
}
