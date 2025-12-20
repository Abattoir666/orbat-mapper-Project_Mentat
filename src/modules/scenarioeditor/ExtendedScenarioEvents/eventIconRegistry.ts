// src/modules/scenarioeditor/ExtendedScenarioEvents/eventIconRegistry.ts

// Helper: build an Iconify MDI URL
const mdi = (name: string) => `https://api.iconify.design/mdi:${name}.svg`;

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
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48cGF0aCBmaWxsPSJjdXJyZW50Q29sb3IiIGQ9Im0xOS4wNSAyMS42bC0yLjkyNS0yLjlsLTEuNSAxLjVxLS4yNzUuMjc1LS43LjI3NXQtLjctLjI3NXEtLjU3NS0uNTc1LS41NzUtMS40MjV0LjU3NS0xLjQyNWw0LjIyNS00LjIyNXEuNTc1LS41NzUgMS40MjUtLjU3NXQxLjQyNS41NzVxLjI3NS4yNzUuMjc1Ljd0LS4yNzUuN2wtMS41IDEuNWwyLjkgMi45MjVxLjMuMy4zLjd0LS4zLjdsLTEuMjUgMS4yNXEtLjMuMy0uNy4zdC0uNy0uM00yMS43IDYuMkwxMC42NSAxNy4yNWwuMTI1LjFxLjU3NS41NzUuNTc1IDEuNDI1dC0uNTc1IDEuNDI1cS0uMjc1LjI3NS0uNy4yNzV0LS43LS4yNzVsLTEuNS0xLjVsLTIuOTI1IDIuOXEtLjMuMy0uNy4zdC0uNy0uM0wyLjMgMjAuMzVxLS4zLS4zLS4zLS43dC4zLS43bDIuOS0yLjkyNWwtMS41LTEuNXEtLjI3NS0uMjc1LS4yNzUtLjd0LjI3NS0uN3EuNTc1LS41NzUgMS40MjUtLjU3NXQxLjQyNS41NzVsLjEuMTI1TDE3LjQyNSAyLjQ3NXEuMjc1LS4yNzUuNjM4LS40MjV0Ljc2Mi0uMTVIMjFxLjQyNSAwIC43MTMuMjg4VDIyIDIuOXYyLjU3NXEwIC4yLS4wNzUuMzg4VDIxLjcgNi4yTTYuMjI1IDEwLjEyNWwtMy42NS0zLjY1UTIuMyA2LjIgMi4xNSA1LjgzOFQyIDUuMDc1VjIuOXEwLS40MjUuMjg4LS43MTJUMyAxLjloMi4xNzVxLjQgMCAuNzYzLjE1dC42MzcuNDI1bDMuNjUgMy42NXEuMy4zLjMuNzEzdC0uMy43MTJMNy42NSAxMC4xMjVxLS4zLjMtLjcxMi4zdC0uNzEzLS4zIi8+PC9zdmc+"; // <-- your full string

categoryIconOverrides.artillery = 
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MTIiIGhlaWdodD0iNTEyIiB2aWV3Qm94PSIwIDAgNTEyIDUxMiI+PHBhdGggZmlsbD0iY3VycmVudENvbG9yIiBkPSJNNDA2LjQgNjcuMjVjLTIuMSAwLTQgLjgtNS43IDEuOWMtNC4zIDIuOS03LjYgOC40LS44IDE4LjZsNTMuNCA3OS44NWM2LjggMTAuMiAxMy4yIDkuMyAxNy41IDYuNGM0LjQtMi45IDcuNy04LjQuOS0xOC42bC01My41LTc5Ljg1Yy00LjItNi40LTguMy04LjQtMTEuOC04LjNNMzkyIDEwOC40bC0xNDEuMiA4OC41YzQuNiAxMi40IDEyLjEgMjYuMiAyMS4xIDM4LjhsMS44IDIuNGEyNCAyNCAwIDAgMSAzLjYtLjNhMjQgMjQgMCAwIDEgMjIuMiAxNWgyMS42bDEwOS4yLTg3LjJ6bS0xNTYuOCA5OC4zbC05OS4xIDYyLjJjNC4xIDE3LjMgMTEuNSAzMy42IDIxLjcgNDcuOWg1NC41di02NGg0Mi44YTI0IDI0IDAgMCAxIDMtNS40Yy0uMy0uNC0uNi0uOS0uOS0xLjNjLTktMTIuNi0xNi43LTI2LjEtMjItMzkuNG0tNC45IDY0LjF2NjRoLTY0djY0aC02NHY0NmgyMDkuMWMtNi45LTguNS0xMS4xLTE5LjMtMTEuMS0zMWMwLTIzLjkgMTcuMy00My45IDQwLTQ4LjJ2LTk0Ljh6bS0xMTAuMiA4LjFsLTM0LjIgMjEuNWMtMjUuNiAxOC4zLTEyLjMgNTguNCAxMS41NCA4MC40aDUwLjg2di00Ni42Yy0xMi45LTE2LjMtMjIuNi0zNS4xLTI4LjItNTUuM20zMDkuMiAzOS45Yy0xNy4yIDAtMzEgMTMuOC0zMSAzMWMwIDUuNiAxLjQgMTAuOCA0IDE1LjNjMTAuNyAxIDIwLjQgNS42IDI4IDEyLjVjNy02LjQgMTYtMTAuOCAyNS45LTEyLjNjMi42LTQuNSA0LjEtOS44IDQuMS0xNS41YzAtMTcuMi0xMy44LTMxLTMxLTMxTTY2LjY2IDM3MC45Yy0zLjYxIDQtOC4yNCA3LjgtMTMuNTcgMTFjLTExLjI2IDYuOC0yNS4xOSAxMS4xLTM1LjQxIDExLjRsLjU4IDE4YzE0LjMxLS41IDMwLjI5LTUuNiA0NC4xOC0xNGM1LjM4LTMuMyAxMC41LTcuMSAxNC45Ni0xMS41Yy00LTQuNi03LjYxLTkuNi0xMC43NC0xNC45bTI4Mi42NCAxMS45Yy0xNy4yIDAtMzEgMTMuOC0zMSAzMXMxMy44IDMxIDMxIDMxYzMuMiAwIDYuMi0uNSA5LTEuM2MtNi4yLTguMy0xMC0xOC42LTEwLTI5LjdzMy44LTIxLjQgMTAtMjkuN2MtMi44LS44LTUuOC0xLjMtOS0xLjNtNDggMGMtMTcuMiAwLTMxIDEzLjgtMzEgMzFzMTMuOCAzMSAzMSAzMXMzMS0xMy44IDMxLTMxcy0xMy44LTMxLTMxLTMxbTY2IDBjLTguNyAwLTE2LjUgMy41LTIyLjEgOS4yYzMuMiA2LjYgNS4xIDE0IDUuMSAyMS44cy0xLjkgMTUuMi01LjEgMjEuOGM1LjYgNS43IDEzLjQgOS4yIDIyLjEgOS4yYzE3LjIgMCAzMS0xMy44IDMxLTMxcy0xMy44LTMxLTMxLTMxIi8+PC9zdmc+"

categoryIconOverrides.airstrike =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MTIiIGhlaWdodD0iNTEyIiB2aWV3Qm94PSIwIDAgNTEyIDUxMiI+PHBhdGggZmlsbD0iY3VycmVudENvbG9yIiBkPSJtMjg3LjU4NiAxNS4yOTdsMy41MDQgMTEwLjk2M2wzMS41MzctMTEwLjk2M3ptLTk1Ljc4LjIzOGwtMS43NSAyMzYuMDQ3bC0xNzAuNTMzLTQzLjMzTDEzMC40ODYgMzc3LjY5bC04OC43Ny01LjE3NGwxMTQuNDMyIDExMi4zNTdsLTQ0LjQ2Ni03NS44NjdMMTg2Ljg5NiA0MTdsLTUxLjc0OC0xMDkuOTRsMTEwLjExNCA3OS45NTZsLTEyLjYzNS0xODUuMjNsLjAwMi4wMDNsNzUuMjEyIDE3MC41N2w3NS44MTYtODkuOTVsLTYuNjIgMTU0LjU4Mmw2MC4xNzMtMzkuOTc4bC0yMC4zODggNzkuNDg2bDc1Ljc1Ni0xNDIuNzg3bC03NS45MjQgMS45NEw0ODcuMzIgMTU1Ljg3bC0xMzEuNDAyIDczLjA4bC0xMi4yNjQtMTM5LjY5bC02NS40MSAxNDAuMzM2bC04Ni40MzUtMjE0LjA2aC0uMDAzek00NS41MDMgNDQuMDk1TDM5LjM1NSA3NS45NEwxNTQuMjg1IDIxOGguMDAybC03Ny42LTE2Ni44MzZsLTMxLjE4NS03LjA3em00MjIuMjcgMjQuNzc2bC0zMS4xODQgNy4wN2wtNDMuNzM4IDEwNy4zN2w4MS4wNjgtODIuNTlsLTYuMTQ3LTMxLjg1ek0yNzkuMjA4IDQwMy42MWMtNDAuMTc2IDAtNzIuNzA4IDMyLjUzNy03Mi43MDggNzIuNzFjMCA1LjcyNS42MzYgMTAuNzA2IDEuODg3IDE2LjA1YzcuMjUtMzIuNTQ1IDM2LjA5Ny01Ni42NTUgNzAuODItNTYuNjU1YzM0LjgyIDAgNjMuNjczIDIzLjk3IDcwLjgyIDU2LjY1NmMxLjIxOC01LjI3NyAxLjg4OC0xMC40MDQgMS44ODgtMTYuMDVjMC00MC4xNzUtMzIuNTM2LTcyLjcxLTcyLjcxLTcyLjcxeiIvPjwvc3ZnPg=="

function normalizeCategory(category: string | undefined | null): string {
    return (category ?? "").toString().toLowerCase().trim();
}

function isValidIconSrc(src: unknown): src is string {
    if (typeof src !== "string") return false;
    if (!src.length) return false;

    // Accept data URIs and normal URLs
    if (src.startsWith("data:image/")) return true;
    if (src.startsWith("http://") || src.startsWith("https://")) return true;
    if (src.startsWith("/")) return true;

    return false;
}

export function resolveEventIcon(category: string | undefined | null): string {
    const key = normalizeCategory(category) || "generic";

    // 1) override wins (including data: URIs)
    const override = categoryIconOverrides[key];
    if (isValidIconSrc(override)) return override;

    // 2) registry lookup
    const regKey = key as ScenarioEventCategory;
    const fromRegistry = (eventIconRegistry as any)[regKey] ?? eventIconRegistry.fallback;

    return isValidIconSrc(fromRegistry) ? fromRegistry : eventIconRegistry.fallback;
}
