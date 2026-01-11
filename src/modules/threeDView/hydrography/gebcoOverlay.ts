// src/modules/threeDView/hydrography/gebcoOverlay.ts

export const GEBCO_OVERLAY_ID = "hydro_gebco_latest";

// Your confirmed working service base:
export const GEBCO_TILE_BASE_URL = "http://192.168.1.164:18080";

// MapProxy “split” route that you confirmed returns 200:
export const GEBCO_TILE_TEMPLATE =
	`${GEBCO_TILE_BASE_URL}/tiles/gebco_latest/webmercator/{z}/{x}/{y}.png`;

// A deterministic health probe (fast, cheap). z=0 always exists if service is up.
export const GEBCO_TILE_HEALTH_URL =
	`${GEBCO_TILE_BASE_URL}/tiles/gebco_latest/webmercator/0/0/0.png`;

// UI defaults
export const GEBCO_DEFAULT_ALPHA = 0.65; // tweak to taste