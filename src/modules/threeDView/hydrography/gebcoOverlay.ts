// src/modules/threeDView/hydrography/gebcoOverlay.ts

export const GEBCO_OVERLAY_ID = "bathboy_ocean_overlay";

// LAN tile template (Caddy -> MinIO). This is the path you confirmed working:
export const GEBCO_TILE_TEMPLATE =
    "http://192.168.1.164/bathboy/bathy_ocean_overlay_z0_9/tiles/{z}/{x}/{y}.png";

// Your server only serves z0..z9
export const GEBCO_TILE_MIN_LEVEL = 0;
export const GEBCO_TILE_MAX_LEVEL = 9;

// Deterministic health probe (should exist if the service is up)
export const GEBCO_TILE_HEALTH_URL =
    "http://192.168.1.164/bathboy/bathy_ocean_overlay_z0_9/tiles/0/0/0.png";

// UI defaults
export const GEBCO_DEFAULT_ALPHA = 0.65;
