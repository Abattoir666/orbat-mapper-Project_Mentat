// src/modules/threeDView/hydrography/gebcoOverlay.ts

export const GEBCO_OVERLAY_ID = "hydro_gebco_latest";

// Your confirmed working service base:
export const GEBCO_TILE_BASE_URL = "http://192.168.1.164:80";

// MapProxy “split” route that you confirmed returns 200:
export const GEBCO_TILE_TEMPLATE =
	"https://s3.analyticacamillus.org/bathboy/bathy_ocean_overlay_z0_9/tiles/{z}/{x}/{y}.png";


// A deterministic health probe (fast, cheap). z=0 always exists if service is up.
export const GEBCO_TILE_HEALTH_URL =
	`${GEBCO_TILE_BASE_URL}/tiles/gebco_latest/webmercator/0/0/0.png`;

// UI defaults
export const GEBCO_DEFAULT_ALPHA = 0.65; // tweak to taste