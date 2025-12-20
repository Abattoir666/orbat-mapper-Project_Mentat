// src/modules/scenarioeditor/ExtendedScenarioEvents/eventIconRegistry.ts

// Helper: build an Iconify MDI URL
const mdi = (name: string) => `https://api.iconify.design/mdi:${name}.svg`;

// Accept either full URLs/data-URIs *or* Iconify-style shorthand ("mdi:sword" or "sword").
function coerceIconToSrc(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const s = value.trim();
    if (!s) return null;

    // Data URIs and absolute/relative URLs
    if (s.startsWith("data:image/")) return s;
    if (s.startsWith("http://") || s.startsWith("https://")) return s;
    if (s.startsWith("/")) return s;

    // Iconify shorthand
    if (s.startsWith("mdi:")) return `https://api.iconify.design/${s}.svg`;
    if (/^[a-z0-9-]+$/i.test(s)) return mdi(s);

    return null;
}

export type ScenarioEventCategory =
    | "generic"
    | "battle"
    | "airstrike"
    | "artillery"
    | "naval"
    | "movement"
    | "political"
    | "civilian"
    | "disaster"
    | "intel"
    | "cbrn";

type IconRegistry = Record<ScenarioEventCategory | "fallback", string>;

export const eventIconRegistry: IconRegistry = {
    fallback: mdi("map-marker"),

    generic: mdi("map-marker"),
    battle: mdi("crosshairs"),
    airstrike: mdi("airplane-military"),
    artillery: mdi("cannon"),
    naval: mdi("ship-wheel"),
    movement: mdi("arrow-right-bold"),
    political: mdi("flag-variant"),
    civilian: mdi("account-alert"),
    disaster: mdi("weather-hurricane"),
    intel: mdi("radar"),
    cbrn: mdi("biohazard"),
};

/**
 * Optional overrides: category -> icon URL or data URI.
 * Use this to replace specific icons (e.g., your base64 SVG).
 */
export const categoryIconOverrides: Partial<Record<string, string>> = {};

categoryIconOverrides.battle =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNiIgaGVpZ2h0PSIyNiIgdmlld0JveD0iMCAwIDI2IDI2Ij48ZyBmaWxsPSJjdXJyZW50Q29sb3IiPjxnIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIj48cGF0aCBkPSJNMTguODMzIDQuMzI4YTIgMiAwIDAgMSAyLjMzNCAyLjMyNWwtLjQ0MiAyLjQyM2EyIDIgMCAwIDEtLjU1MSAxLjA1M2wtNi4wOTMgNi4xMTZhMiAyIDAgMCAxLTIuODI5LjAwNWwtMS45OC0xLjk3MmEyIDIgMCAwIDEtLjAwNC0yLjgyOWw2LjA5My02LjExNWEyIDIgMCAwIDEgMS4wNS0uNTU1em0tLjA3NiA0LjM5bC40NDItMi40MjRsLTIuNDIyLjQ1MWwtNi4wOTMgNi4xMTZsMS45OCAxLjk3MnoiLz48cGF0aCBkPSJNMTAuNzc3IDE0Ljc0N2EuNzUuNzUgMCAwIDEtLjAwMi0xLjA2bDMuMzg0LTMuMzk3YS43NS43NSAwIDEgMSAxLjA2MyAxLjA1OWwtMy4zODQgMy4zOTZhLjc1Ljc1IDAgMCAxLTEuMDYuMDAyIi8+PHBhdGggZD0iTTYuMTg4IDExLjgyM2EyLjQ0IDIuNDQgMCAwIDEgMy40NDgtLjAwNmw0LjA3NiA0LjA2YTIuNDM4IDIuNDM4IDAgMCAxLTMuNDQyIDMuNDU1bC00LjA3Ni00LjA2YTIuNDQgMi40NCAwIDAgMS0uMDA2LTMuNDQ5bTIuMDM3IDEuNDFhLjQzOC40MzggMCAwIDAtLjYxOS42MjJsNC4wNzYgNC4wNmEuNDM4LjQzOCAwIDAgMCAuNjE4LS42MnoiLz48cGF0aCBkPSJNOC42NjIgMTYuMzEzTDUuOTg0IDE5bC42Mi42MThsMi42NzktMi42ODhsMS40MTcgMS40MTJsLTIuNjc5IDIuNjg4YTIgMiAwIDAgMS0yLjgyOC4wMDVsLS42MjEtLjYxOGEyIDIgMCAwIDEtLjAwNS0yLjgyOUw3LjI0NSAxNC45ek03LjE2NyA0LjMyOGEyIDIgMCAwIDAtMi4zMzMgMi4zMjVsLjQ0MSAyLjQyM2EyIDIgMCAwIDAgLjU1MSAxLjA1M2wzLjI5IDMuMzAybDEuNDE3LTEuNDEybC0zLjI5LTMuMzAybC0uNDQyLTIuNDIzbDIuNDIyLjQ1MWwzLjI5IDMuMzAybDEuNDE2LTEuNDEybC0zLjI5LTMuMzAxYTIgMiAwIDAgMC0xLjA1LS41NTV6bTEwLjYwOCA4LjkwNmEuNDM4LjQzOCAwIDAgMSAuNjE5LjYybC00LjA3NiA0LjA2MWEuNDQuNDQgMCAwIDEtLjYyIDBsLTEuNDE2IDEuNDFjLjk1Ljk1NSAyLjQ5NC45NTggMy40NDguMDA3bDQuMDc2LTQuMDZhMi40MzggMi40MzggMCAwIDAtMy40NDItMy40NTVsLTMuNDc5IDMuNDY1bDEuNDEyIDEuNDE3eiIvPjxwYXRoIGQ9Ik0xNy4zMzggMTYuMzEzTDIwLjAxNiAxOWwtLjYyLjYxOGwtMi42NzktMi42ODhsLTEuNDE3IDEuNDEybDIuNjc4IDIuNjg4YTIgMiAwIDAgMCAyLjgyOS4wMDVsLjYyMS0uNjE4YTIgMiAwIDAgMCAuMDA1LTIuODI5TDE4Ljc1NSAxNC45eiIvPjwvZz48cGF0aCBkPSJNNC4yOTMgNS43MDdhMSAxIDAgMCAxIDEuNDE0LTEuNDE0bDE2IDE2YTEgMSAwIDAgMS0xLjQxNCAxLjQxNHoiLz48cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik0xMyAyNGM2LjA3NSAwIDExLTQuOTI1IDExLTExUzE5LjA3NSAyIDEzIDJTMiA2LjkyNSAyIDEzczQuOTI1IDExIDExIDExbTAgMmM3LjE4IDAgMTMtNS44MiAxMy0xM1MyMC4xOCAwIDEzIDBTMCA1LjgyIDAgMTNzNS44MiAxMyAxMyAxMyIgY2xpcC1ydWxlPSJldmVub2RkIi8+PC9nPjwvc3ZnPg==";

categoryIconOverrides.artillery =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MTIiIGhlaWdodD0iNTEyIiB2aWV3Qm94PSIwIDAgNTEyIDUxMiI+PHBhdGggZmlsbD0iY3VycmVudENvbG9yIiBkPSJNNDA2LjQgNjcuMjVjLTIuMSAwLTQgLjgtNS43IDEuOWMtNC4zIDIuOS03LjYgOC40LS44IDE4LjZsNTMuNCA3OS44NWM2LjggMTAuMiAxMy4yIDkuMyAxNy41IDYuNGM0LjQtMi45IDcuNy04LjQuOS0xOC42bC01My41LTc5Ljg1Yy00LjItNi40LTguMy04LjQtMTEuOC04LjNNMzkyIDEwOC40bC0xNDEuMiA4OC41YzQuNiAxMi40IDEyLjEgMjYuMiAyMS4xIDM4LjhsMS44IDIuNGEyNCAyNCAwIDAgMSAzLjYtLjNhMjQgMjQgMCAwIDEgMjIuMiAxNWgyMS42bDEwOS4yLTg3LjJ6bS0xNTYuOCA5OC4zbC05OS4xIDYyLjJjNC4xIDE3LjMgMTEuNSAzMy42IDIxLjcgNDcuOWg1NC41di02NGg0Mi44YTI0IDI0IDAgMCAxIDMtNS40Yy0uMy0uNC0uNi0uOS0uOS0xLjNjLTktMTIuNi0xNi43LTI2LjEtMjItMzkuNG0tNC45IDY0LjF2NjRoLTY0djY0aC02NHY0NmgyMDkuMWMtNi45LTguNS0xMS4xLTE5LjMtMTEuMS0zMWMwLTIzLjkgMTcuMy00My45IDQwLTQ4LjJ2LTk0Ljh6bS0xMTAuMiA4LjFsLTM0LjIgMjEuNWMtMjUuNiAxOC4zLTEyLjMgNTguNCAxMS41NCA4MC40aDUwLjg2di00Ni42Yy0xMi45LTE2LjMtMjIuNi0zNS4xLTI4LjItNTUuM20zMDkuMiAzOS45Yy0xNy4yIDAtMzEgMTMuOC0zMSAzMWMwIDUuNiAxLjQgMTAuOCA0IDE1LjNjMTAuNyAxIDIwLjQgNS42IDI4IDEyLjVjNy02LjQgMTYtMTAuOCAyNS45LTEyLjNjMi42LTQuNSA0LjEtOS44IDQuMS0xNS41YzAtMTcuMi0xMy44LTMxLTMxLTMxTTY2LjY2IDM3MC45Yy0zLjYxIDQtOC4yNCA3LjgtMTMuNTcgMTFjLTExLjI2IDYuOC0yNS4xOSAxMS4xLTM1LjQxIDExLjRsLjU4IDE4YzE0LjMxLS41IDMwLjI5LTUuNiA0NC4xOC0xNGM1LjM4LTMuMyAxMC41LTcuMSAxNC45Ni0xMS41Yy00LTQuNi03LjYxLTkuNi0xMC43NC0xNC45bTI4Mi42NCAxMS45Yy0xNy4yIDAtMzEgMTMuOC0zMSAzMXMxMy44IDMxIDMxIDMxYzMuMiAwIDYuMi0uNSA5LTEuM2MtNi4yLTguMy0xMC0xOC42LTEwLTI5LjdzMy44LTIxLjQgMTAtMjkuN2MtMi44LS44LTUuOC0xLjMtOS0xLjNtNDggMGMtMTcuMiAwLTMxIDEzLjgtMzEgMzFzMTMuOCAzMSAzMSAzMXMzMS0xMy44IDMxLTMxcy0xMy44LTMxLTMxLTMxbTY2IDBjLTguNyAwLTE2LjUgMy41LTIyLjEgOS4yYzMuMiA2LjYgNS4xIDE0IDUuMSAyMS44cy0xLjkgMTUuMi01LjEgMjEuOGM1LjYgNS43IDEzLjQgOS4yIDIyLjEgOS4yYzE3LjIgMCAzMS0xMy44IDMxLTMxcy0xMy44LTMxLTMxLTMxIi8+PC9zdmc+";

categoryIconOverrides.airstrike =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MTIiIGhlaWdodD0iNTEyIiB2aWV3Qm94PSIwIDAgNTEyIDUxMiI+PHBhdGggZmlsbD0iY3VycmVudENvbG9yIiBkPSJtMjg3LjU4NiAxNS4yOTdsMy41MDQgMTEwLjk2M2wzMS41MzctMTEwLjk2M3ptLTk1Ljc4LjIzOGwtMS43NSAyMzYuMDQ3bC0xNzAuNTMzLTQzLjMzTDEzMC40ODYgMzc3LjY5bC04OC43Ny01LjE3NGwxMTQuNDMyIDExMi4zNTdsLTQ0LjQ2Ni03NS44NjdMMTg2Ljg5NiA0MTdsLTUxLjc0OC0xMDkuOTRsMTEwLjExNCA3OS45NTZsLTEyLjYzNS0xODUuMjNsLjAwMi4wMDNsNzUuMjEyIDE3MC41N2w3NS44MTYtODkuOTVsLTYuNjIgMTU0LjU4Mmw2MC4xNzMtMzkuOTc4bC0yMC4zODggNzkuNDg2bDc1Ljc1Ni0xNDIuNzg3bC03NS45MjQgMS45NEw0ODcuMzIgMTU1Ljg3bC0xMzEuNDAyIDczLjA4bC0xMi4yNjQtMTM5LjY5bC02NS40MSAxNDAuMzM2bC04Ni40MzUtMjE0LjA2aC0uMDAzek00NS41MDMgNDQuMDk1TDM5LjM1NSA3NS45NEwxNTQuMjg1IDIxOGguMDAybC03Ny42LTE2Ni44MzZsLTMxLjE4NS03LjA3em00MjIuMjcgMjQuNzc2bC0zMS4xODQgNy4wN2wtNDMuNzM4IDEwNy4zN2w4MS4wNjgtODIuNTlsLTYuMTQ3LTMxLjg1ek0yNzkuMjA4IDQwMy42MWMtNDAuMTc2IDAtNzIuNzA4IDMyLjUzNy03Mi43MDggNzIuNzFjMCA1LjcyNS42MzYgMTAuNzA2IDEuODg3IDE2LjA1YzcuMjUtMzIuNTQ1IDM2LjA5Ny01Ni42NTUgNzAuODItNTYuNjU1YzM0LjgyIDAgNjMuNjczIDIzLjk3IDcwLjgyIDU2LjY1NmMxLjIxOC01LjI3NyAxLjg4OC0xMC40MDQgMS44ODgtMTYuMDVjMC00MC4xNzUtMzIuNTM2LTcyLjcxLTcyLjcxLTcyLjcxeiIvPjwvc3ZnPg==";

function normalizeCategory(category: string | undefined | null): string {
    return (category ?? "").toString().toLowerCase().trim();
}

function isValidIconSrc(src: unknown): src is string {
    return !!coerceIconToSrc(src);
}

export function resolveEventIcon(category: string | undefined | null): string {
    const key = normalizeCategory(category) || "generic";

    // 1) override wins (including data: URIs)
    const override = categoryIconOverrides[key];
    const overrideSrc = coerceIconToSrc(override);
    if (overrideSrc) return overrideSrc;

    // 2) registry lookup
    const regKey = key as ScenarioEventCategory;
    const fromRegistry = (eventIconRegistry as any)[regKey] ?? eventIconRegistry.fallback;
    return coerceIconToSrc(fromRegistry) ?? eventIconRegistry.fallback;
}
