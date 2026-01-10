import type { Position } from "geojson";

export type SurfaceHeightSampler = (lon: number, lat: number) => Promise<number | undefined>;

export function altOf(pos: Position | null | undefined): number | undefined {
	if (!pos) return undefined;
	const z = (pos as any)[2];
	return typeof z === "number" && Number.isFinite(z) ? z : undefined;
}

export function hasExplicitAlt(pos: Position | null | undefined): boolean {
	return altOf(pos) !== undefined;
}

export function formatAltIndicatorFromAlt(alt?: number): string {
	if (alt === undefined) return "SFC";
	const m = Math.round(Math.abs(alt));
	if (alt > 0) return `? ${m} m`;
	if (alt < 0) return `? ${m} m`;
	return "0 m";
}

export function lonLatKey(lon: number, lat: number): string {
	return `${lon.toFixed(6)},${lat.toFixed(6)}`;
}
