// src/utils/parseGeoQuery.ts
export type ParsedGeo = { lon: number; lat: number; zoom?: number; impliedZoom?: number };

function clampLat(lat: number) { return Math.max(-90, Math.min(90, lat)); }
function wrapLon(lon: number) { return ((((lon + 180) % 360) + 360) % 360) - 180; }

// Count decimals in a numeric token like "38.8977"
function decimalsIn(token: string): number {
    const m = token.trim().match(/[-+]?\d+(?:\.(\d+))?/);
    return m?.[1]?.length ?? 0;
}

// Map a "precision score" to an OpenLayers-ish zoom.
// Tweak to taste; these are good defaults.
function precisionToZoom(score: number): number {
    // 0: degrees only (~100km), 1: 0.1°, 2: 0.01°, 3: 0.001°, 4: 0.0001°, 5+: finer
    if (score <= 0) return 6;   // country/region
    if (score === 1) return 8;  // metro
    if (score === 2) return 10; // city
    if (score === 3) return 12; // town/streets
    if (score === 4) return 14; // blocks
    if (score === 5) return 16; // buildings
    return 17;                  // entrances
}

// ---- hemisphere helpers (decimal with optional degree symbol) ----
const DEG_SYM = "(?:°|º|˚)?";

function parseLatDecHem(token: string): { val: number, prec: number } | null {
    // number first, hemisphere after: "38.8977° N"
    let m = token.match(new RegExp(`^\\s*([-+]?\\d+(?:\\.\\d+)?)\\s*${DEG_SYM}\\s*([NS])\\s*$`, "i"));
    if (m) {
        const d = Math.abs(Number(m[1]));
        const hemi = m[2].toUpperCase();
        return { val: hemi === "S" ? -d : d, prec: decimalsIn(m[1]) };
    }
    // hemisphere first, number after: "N 38.8977°"
    m = token.match(new RegExp(`^\\s*([NS])\\s*([-+]?\\d+(?:\\.\\d+)?)\\s*${DEG_SYM}\\s*$`, "i"));
    if (m) {
        const hemi = m[1].toUpperCase();
        const d = Math.abs(Number(m[2]));
        return { val: hemi === "S" ? -d : d, prec: decimalsIn(m[2]) };
    }
    return null;
}

function parseLonDecHem(token: string): { val: number, prec: number } | null {
    // number first, hemisphere after: "77.0365° W"
    let m = token.match(new RegExp(`^\\s*([-+]?\\d+(?:\\.\\d+)?)\\s*${DEG_SYM}\\s*([EW])\\s*$`, "i"));
    if (m) {
        const d = Math.abs(Number(m[1]));
        const hemi = m[2].toUpperCase();
        return { val: hemi === "W" ? -d : d, prec: decimalsIn(m[1]) };
    }
    // hemisphere first, number after: "W 77.0365°"
    m = token.match(new RegExp(`^\\s*([EW])\\s*([-+]?\\d+(?:\\.\\d+)?)\\s*${DEG_SYM}\\s*$`, "i"));
    if (m) {
        const hemi = m[1].toUpperCase();
        const d = Math.abs(Number(m[2]));
        return { val: hemi === "W" ? -d : d, prec: decimalsIn(m[2]) };
    }
    return null;
}

function parseDecHemPair(a: string, b: string): { lat?: number; lon?: number; score?: number } | null {
    const A_L = parseLatDecHem(a);
    const A_O = parseLonDecHem(a);
    const B_L = parseLatDecHem(b);
    const B_O = parseLonDecHem(b);

    if (A_L && B_O) return { lat: A_L.val, lon: B_O.val, score: Math.max(A_L.prec, B_O.prec) };
    if (A_O && B_L) return { lat: B_L.val, lon: A_O.val, score: Math.max(A_O.prec, B_L.prec) };
    return null;
}

// Recover hemisphere pair from space-only input: "N 38.89° W 77.03°"
function parseHemisphereTokens(tokens: string[]): { lat?: number; lon?: number; score?: number } | null {
    let lat: number | null = null, lon: number | null = null;
    let pLat = 0, pLon = 0;
    for (const t of tokens) {
        if (lat == null) {
            const asLat = parseLatDecHem(t);
            if (asLat) { lat = asLat.val; pLat = Math.max(pLat, asLat.prec); continue; }
        }
        if (lon == null) {
            const asLon = parseLonDecHem(t);
            if (asLon) { lon = asLon.val; pLon = Math.max(pLon, asLon.prec); continue; }
        }
    }
    if (lat != null && lon != null) return { lat, lon, score: Math.max(pLat, pLon) };
    return null;
}

// ---- main parser (now returns impliedZoom) ----
export function parseGeoQuery(raw: string): ParsedGeo | null {
    if (!raw) return null;

    // strip leading mode char like '@', '>' if present
    const s = raw.trim().replace(/^[>@#?]/, "");
    const [coordPart, zoomPart] = s.split("@");
    const zoom = zoomPart ? Number(zoomPart.trim()) : undefined;

    // 1) Prefer comma/semicolon split into two sides
    const sides = coordPart.split(/[;,]/).map((x) => x.trim()).filter(Boolean);

    if (sides.length === 2) {
        // a) hemisphere/degree tokens on each side
        const hem = parseDecHemPair(sides[0], sides[1]);
        if (hem?.lat != null && hem?.lon != null) {
            return {
                lon: wrapLon(hem.lon),
                lat: clampLat(hem.lat),
                zoom,
                impliedZoom: precisionToZoom(hem.score ?? 0),
            };
        }

        // b) plain decimals on each side
        const daS = sides[0], dbS = sides[1];
        const da = Number(daS), db = Number(dbS);
        if (Number.isFinite(da) && Number.isFinite(db)) {
            let lat: number, lon: number;
            // Heuristic: if |first|<=90 & |second|<=180, assume lat,lon; else lon,lat
            if (Math.abs(da) <= 90 && Math.abs(db) <= 180) { lat = da; lon = db; }
            else { lon = da; lat = db; }
            // precision score = max decimal places of the two numbers
            const score = Math.max(decimalsIn(daS), decimalsIn(dbS));
            return { lon: wrapLon(lon), lat: clampLat(lat), zoom, impliedZoom: precisionToZoom(score) };
        }
    }

    // 2) No comma/semicolon: try space-only inputs
    const tokens = coordPart.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);

    // a) hemisphere tokens anywhere
    const hemRecovered = parseHemisphereTokens(tokens);
    if (hemRecovered?.lat != null && hemRecovered?.lon != null) {
        return {
            lon: wrapLon(hemRecovered.lon!),
            lat: clampLat(hemRecovered.lat!),
            zoom,
            impliedZoom: precisionToZoom(hemRecovered.score ?? 0),
        };
    }

    // b) plain decimal pair: "38.8977 -77.0365"
    if (tokens.length === 2) {
        const aS = tokens[0], bS = tokens[1];
        const da = Number(aS), db = Number(bS);
        if (Number.isFinite(da) && Number.isFinite(db)) {
            let lat: number, lon: number;
            if (Math.abs(da) <= 90 && Math.abs(db) <= 180) { lat = da; lon = db; }
            else { lon = da; lat = db; }
            const score = Math.max(decimalsIn(aS), decimalsIn(bS));
            return { lon: wrapLon(lon), lat: clampLat(lat), zoom, impliedZoom: precisionToZoom(score) };
        }
    }

    return null;
}