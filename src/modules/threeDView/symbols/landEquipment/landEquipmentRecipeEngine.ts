// landEquipmentRecipeEngine.ts
// Lightweight, implementation-oriented parser + layout helper for Symbol Set 15 "primitiveRecipe" strings.
// Designed to be used from globeAdapter.ts (Cesium Entities) but kept Cesium-free for unit testing.
//
// Coordinate conventions used by this engine (matches globeAdapter comments):
// - Local axes are ENU (east, north, up) relative to the unit's anchor.
// - For dimensional tokens written as "LxWxH":
//     L = length (north/south), W = width (east/west), H = height (up).
//   This maps naturally onto Cesium box dimensions as:
//     dimensions.x = W, dimensions.y = L, dimensions.z = H.
//
// IMPORTANT: This is a *layout helper*, not a full CAD system.
// It intentionally produces "blocky but readable" silhouettes and tolerates unknown options gracefully.

export type RecipePrimitiveKind =
  | "box"
  | "cylinder"
  | "cone"
  | "sphere"
  | "capsule"
  | "triangularPrism";

export type RecipePriority = "P1" | "P2" | "P3";
export type RecipeConfidence = "high" | "med" | "low";

export type LandEquipShapeOverride = {
  entityCode: string;
  entityTypeCode: string;
  entitySubtypeCode: string; // "*" allowed
  proposedShapeType: string;
  primitiveRecipe: string;
  orientationAssumption: string;
  anchorAltitude: string;
  labelOffset: [number, number, number];
  removeLegacySidcPedestal: boolean;
  confidence: RecipeConfidence;
  priority: RecipePriority;
  notes?: string | null;
};

export type TokenMap = Record<string, string>;

export type CompiledInstance = {
  // One concrete primitive instance to render.
  kind: RecipePrimitiveKind;

  // Dimensions / parameters after token substitution
  // Box / triangularPrism:
  L?: number; W?: number; H?: number;

  // Cylinder / cone / capsule:
  r?: number;
  h?: number;

  // Sphere:
  radius?: number;

  // Layout (ENU meters) relative to the unit anchor *center* (not bottom)
  east: number;
  north: number;
  up: number;

  // Orientation hints (renderer may ignore or partially implement)
  axis?: "vertical" | "longitudinal";
  tiltDeg?: number;

  // Debug / trace
  source?: string;
};

type ParsedTerm = {
  kind: RecipePrimitiveKind;
  count: number;
  tokenOrLiteral: string | null;
  kv: Record<string, string>;
  raw: string;
};

type Dims = { L: number; W: number; H: number };
type Bounds = { halfW: number; halfL: number; halfH: number };

function splitTopLevelPlus(expr: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i];
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "+" && depth === 0) {
      const t = cur.trim();
      if (t) parts.push(t);
      cur = "";
      continue;
    }
    cur += ch;
  }
  const tail = cur.trim();
  if (tail) parts.push(tail);
  return parts;
}

function parseCountPrefix(term: string): { count: number; rest: string } {
  const m = term.trim().match(/^(\d+)\s*x\s*(.+)$/i);
  if (!m) return { count: 1, rest: term.trim() };
  return { count: Math.max(1, parseInt(m[1], 10) || 1), rest: m[2].trim() };
}

function parseCall(term: string): { kind: RecipePrimitiveKind; args: string } | null {
  const m = term.match(/^([a-zA-Z_]+)\s*\((.*)\)\s*$/);
  if (!m) return null;
  const kind = m[1] as RecipePrimitiveKind;
  const args = m[2] ?? "";
  return { kind, args };
}

function splitArgs(argStr: string): string[] {
  // Comma split that ignores commas inside nested parentheses (we don't use nesting, but keep safe).
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < argStr.length; i += 1) {
    const ch = argStr[i];
    if (ch === "(") depth += 1;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      const t = cur.trim();
      if (t) out.push(t);
      cur = "";
      continue;
    }
    cur += ch;
  }
  const tail = cur.trim();
  if (tail) out.push(tail);
  return out;
}

function parseDimsLWH(s: string): Dims | null {
  const m = s.trim().match(/^([0-9.]+)\s*x\s*([0-9.]+)\s*x\s*([0-9.]+)\s*$/i);
  if (!m) return null;
  const L = parseFloat(m[1]);
  const W = parseFloat(m[2]);
  const H = parseFloat(m[3]);
  if (![L, W, H].every((v) => Number.isFinite(v) && v > 0)) return null;
  return { L, W, H };
}

function parseRadiusHeightToken(s: string): { r?: number; h?: number } {
  const kv: Record<string, string> = {};
  for (const a of splitArgs(s)) {
    const mm = a.match(/^([a-zA-Z_]+)\s*=\s*(.+)$/);
    if (mm) kv[mm[1]] = mm[2];
  }
  const r = kv.r != null ? parseFloat(kv.r) : undefined;
  const h = kv.h != null ? parseFloat(kv.h) : undefined;
  return {
    r: typeof r === "number" && Number.isFinite(r) ? r : undefined,
    h: typeof h === "number" && Number.isFinite(h) ? h : undefined,
  };
}

function boundsFor(kind: RecipePrimitiveKind, dims?: Dims, r?: number, h?: number, radius?: number): Bounds {
  if (kind === "box" || kind === "triangularPrism") {
    const L = dims?.L ?? 1;
    const W = dims?.W ?? 1;
    const H = dims?.H ?? 1;
    return { halfW: W / 2, halfL: L / 2, halfH: H / 2 };
  }
  if (kind === "sphere") {
    const rr = radius ?? r ?? 0.5;
    return { halfW: rr, halfL: rr, halfH: rr };
  }
  // cylinder/cone/capsule:
  const rr = r ?? 0.5;
  const hh = h ?? 1.0;
  return { halfW: rr, halfL: rr, halfH: hh / 2 };
}

function parseOffsetPlusMinusY(s: string): number | null {
  const m = s.trim().match(/^(?:±|\+\/-)\s*([0-9.]+)\s*y$/i);
  if (!m) return null;
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? v : null;
}

function layoutForOffsetMacro(
  macro: string,
  body: Bounds,
  part: Bounds,
  instanceIndex: number,
  instanceCount: number,
  spread?: string | undefined,
): { east: number; north: number; up: number }[] {
  const m = macro.trim();

  // Special ±Ny macro: mirrored left/right placements.
  const pm = parseOffsetPlusMinusY(m);
  if (pm != null) {
    const sign = (instanceIndex % 2 === 0) ? -1 : 1;
    return [{ east: sign * pm, north: 0, up: -(body.halfH + part.halfH) }];
  }

  // Wheel/axle layouts
  const wheelUp = -(body.halfH + part.halfH);
  if (m === "corners") {
    const pts = [
      { east: -body.halfW, north: -body.halfL, up: wheelUp },
      { east: body.halfW, north: -body.halfL, up: wheelUp },
      { east: -body.halfW, north: body.halfL, up: wheelUp },
      { east: body.halfW, north: body.halfL, up: wheelUp },
    ];
    return [pts[instanceIndex % pts.length]];
  }

  if (m === "corners+mid") {
    // If asked for 6, behave like 3axles; otherwise corners.
    if (instanceCount >= 6) {
      const ax = [-0.35, 0, 0.35].map((t) => t * body.halfL * 2);
      const side = (instanceIndex % 2 === 0) ? -body.halfW : body.halfW;
      const a = Math.floor(instanceIndex / 2) % ax.length;
      return [{ east: side, north: ax[a], up: wheelUp }];
    }
    return layoutForOffsetMacro("corners", body, part, instanceIndex, instanceCount, spread);
  }

  if (m === "3axles") {
    const ax = [-0.38, 0, 0.38].map((t) => t * body.halfL * 2);
    const side = (instanceIndex % 2 === 0) ? -body.halfW : body.halfW;
    const a = Math.floor(instanceIndex / 2) % ax.length;
    return [{ east: side, north: ax[a], up: wheelUp }];
  }

  if (m === "semi-axles") {
    // 5 axles across the combined semi silhouette.
    const ax = [-0.45, -0.15, 0.15, 0.35, 0.55].map((t) => t * body.halfL * 2);
    const side = (instanceIndex % 2 === 0) ? -body.halfW : body.halfW;
    const a = Math.floor(instanceIndex / 2) % ax.length;
    return [{ east: side, north: ax[a], up: wheelUp }];
  }

  if (m === "bogies") {
    const ax = [-0.35, 0.35].map((t) => t * body.halfL * 2);
    const side = (instanceIndex % 2 === 0) ? -body.halfW : body.halfW;
    const a = Math.floor(instanceIndex / 2) % ax.length;
    return [{ east: side, north: ax[a], up: wheelUp }];
  }

  if (m === "ends") {
    const ax = [-0.42, 0.42].map((t) => t * body.halfL * 2);
    const a = instanceIndex % ax.length;
    return [{ east: 0, north: ax[a], up: wheelUp }];
  }

  if (m === "sides") {
    const side = (instanceIndex % 2 === 0) ? -body.halfW : body.halfW;
    return [{ east: side, north: 0, up: 0 }];
  }

  // Simple anchor macros
  const base: Record<string, { east: number; north: number; up: number }> = {
    center: { east: 0, north: 0, up: 0 },
    mid: { east: 0, north: 0, up: 0 },
    front: { east: 0, north: body.halfL + part.halfL * 0.25, up: 0 },
    rear: { east: 0, north: -(body.halfL + part.halfL * 0.25), up: 0 },
    left: { east: -(body.halfW + part.halfW * 0.25), north: 0, up: 0 },
    right: { east: body.halfW + part.halfW * 0.25, north: 0, up: 0 },
    top: { east: 0, north: 0, up: body.halfH + part.halfH * 0.25 },
    bottom: { east: 0, north: 0, up: -(body.halfH + part.halfH * 0.25) },
    under: { east: 0, north: 0, up: -(body.halfH + part.halfH) },
    "top-front": { east: 0, north: body.halfL, up: body.halfH },
    "top-mid": { east: 0, north: 0, up: body.halfH },
    "top-rear": { east: 0, north: -body.halfL, up: body.halfH },
    "rear-top": { east: 0, north: -body.halfL, up: body.halfH },
    "bottom-front": { east: 0, north: body.halfL, up: -body.halfH },
    "top-center": { east: 0, north: 0, up: body.halfH },
    side: { east: body.halfW * ((instanceIndex % 2 === 0) ? -1 : 1), north: 0, up: 0 },
  };

  // Spread modifiers
  if (spread) {
    const sp = spread.trim();
    if (sp === "tri") {
      const d = Math.max(0.2, body.halfW * 0.35);
      const pts = [
        { east: -d, north: -d * 0.15, up: 0 },
        { east: 0, north: d * 0.2, up: 0 },
        { east: d, north: -d * 0.15, up: 0 },
      ];
      const a = base[m] ?? base.center;
      const p = pts[instanceIndex % pts.length];
      return [{ east: a.east + p.east, north: a.north + p.north, up: a.up + p.up }];
    }
    const pm2 = parseOffsetPlusMinusY(sp);
    if (pm2 != null) {
      const sign = (instanceIndex % 2 === 0) ? -1 : 1;
      const a = base[m] ?? base.center;
      return [{ east: a.east + sign * pm2, north: a.north, up: a.up }];
    }
    if (sp === "even") {
      // Evenly distribute along north axis across ~80% of the body length.
      const t = instanceCount <= 1 ? 0.5 : instanceIndex / (instanceCount - 1);
      const north = (t - 0.5) * (body.halfL * 2 * 0.8);
      const a = base[m] ?? base.center;
      return [{ east: a.east, north: a.north + north, up: a.up }];
    }
    if (sp === "radial") {
      const r0 = Math.max(0.25, body.halfW * 0.45);
      const ang = (instanceIndex / Math.max(1, instanceCount)) * Math.PI * 2;
      const a = base[m] ?? base.center;
      return [{ east: a.east + Math.cos(ang) * r0, north: a.north + Math.sin(ang) * r0, up: a.up }];
    }
  }

  const a = base[m] ?? base.center;
  return [a];
}

export function parsePrimitiveRecipe(recipe: string): ParsedTerm[] {
  const cleaned = recipe
    .replace(/#.*$/g, "")     // strip inline comments
    .replace(/\s+/g, " ")
    .trim();

  const terms = splitTopLevelPlus(cleaned);
  const out: ParsedTerm[] = [];

  for (const t0 of terms) {
    const { count, rest } = parseCountPrefix(t0);
    const call = parseCall(rest);
    if (!call) continue;

    const args = splitArgs(call.args);
    const tokenOrLiteral = args.length > 0 ? args[0].trim() : null;
    const kv: Record<string, string> = {};

    // Remaining args as key=value pairs (also allow first arg to be key=value)
    for (const a of args.slice(1)) {
      const m = a.match(/^([a-zA-Z_]+)\s*=\s*(.+)$/);
      if (m) kv[m[1]] = m[2];
    }
    if (tokenOrLiteral && tokenOrLiteral.includes("=")) {
      // first arg is also kv list
      const rh = parseRadiusHeightToken(tokenOrLiteral);
      if (rh.r != null) kv.r = String(rh.r);
      if (rh.h != null) kv.h = String(rh.h);
    }

    out.push({ kind: call.kind, count, tokenOrLiteral, kv, raw: rest });
  }

  return out;
}

function resolveDimsOrParams(kind: RecipePrimitiveKind, tokenOrLiteral: string | null, tokens: TokenMap): {
  dims?: Dims;
  r?: number;
  h?: number;
  radius?: number;
} {
  if (!tokenOrLiteral) return {};
  const tl = tokenOrLiteral.trim();
  const fromDims = parseDimsLWH(tl);
  if (fromDims) return { dims: fromDims };

  const tokenVal = tokens[tl];
  const src = tokenVal ?? tl;

  // Box/prism dims
  const d = parseDimsLWH(src);
  if (d) return { dims: d };

  // Param tokens (r=...,h=...)
  const rh = parseRadiusHeightToken(src);
  if (kind === "sphere") {
    const rr = rh.r ?? rh.h;
    if (rr != null) return { radius: rr };
  }
  return { r: rh.r, h: rh.h };
}

function getOptionNumber(kv: Record<string, string>, key: string): number | undefined {
  const v = kv[key];
  if (v == null) return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}

export function compileRecipeToInstances(
  recipe: string,
  tokens: TokenMap,
): { instances: CompiledInstance[]; bodyBounds: Bounds } {
  const parsed = parsePrimitiveRecipe(recipe);
  const instances: CompiledInstance[] = [];

  // Determine "body" from first box / triangularPrism term; fallback to unit cube.
  let bodyDims: Dims | undefined;
  for (const t of parsed) {
    if (t.kind === "box" || t.kind === "triangularPrism") {
      const rp = resolveDimsOrParams(t.kind, t.tokenOrLiteral, tokens);
      if (rp.dims) { bodyDims = rp.dims; break; }
    }
  }
  if (!bodyDims) bodyDims = { L: 4, W: 2, H: 2 };
  const bodyBounds = boundsFor("box", bodyDims);

  // Track a simple "chain" anchor for arm-like sequences.
  let lastAnchor = { east: 0, north: 0, up: 0 };
  let lastBounds: Bounds = bodyBounds;

  for (const term of parsed) {
    const rp = resolveDimsOrParams(term.kind, term.tokenOrLiteral, tokens);
    const dims = rp.dims;
    const r = term.kind === "sphere" ? undefined : (rp.r ?? getOptionNumber(term.kv, "r"));
    const h = term.kind === "sphere" ? undefined : (rp.h ?? getOptionNumber(term.kv, "h"));
    const radius = term.kind === "sphere" ? (rp.radius ?? getOptionNumber(term.kv, "r") ?? getOptionNumber(term.kv, "h")) : undefined;

    const tiltDeg = getOptionNumber(term.kv, "tilt");
    const raise = getOptionNumber(term.kv, "raise") ?? 0;
    const drop = getOptionNumber(term.kv, "drop") ?? 0;
    const offset = term.kv.offset?.trim() ?? "center";
    const spread = term.kv.spread?.trim();
    const stack = term.kv.stack?.trim();
    const axis = (term.kv.axis?.trim() === "longitudinal") ? "longitudinal" : "vertical";

    const partBounds = boundsFor(term.kind, dims, r, h, radius);

    for (let i = 0; i < term.count; i += 1) {
      let enuList = layoutForOffsetMacro(offset, bodyBounds, partBounds, i, term.count, spread);

      // Handle "arm-end"/"arm-tip" as relative to last anchor (simple chain).
      if (offset === "arm-end" || offset === "arm-tip") {
        const step = Math.max(0.5, lastBounds.halfL);
        const dz = offset === "arm-tip" ? partBounds.halfH * 0.2 : 0;
        enuList = [{
          east: lastAnchor.east,
          north: lastAnchor.north + step,
          up: lastAnchor.up + dz,
        }];
      }

      for (const enu of enuList) {
        const up = enu.up + raise - drop;

        instances.push({
          kind: term.kind,
          L: dims?.L,
          W: dims?.W,
          H: dims?.H,
          r,
          h,
          radius,
          east: enu.east,
          north: enu.north,
          up,
          axis,
          tiltDeg,
          source: term.raw,
        });

        // Update chain anchor opportunistically when we place arm segments.
        if (offset === "rear-top" || offset === "arm-end" || offset === "arm-tip") {
          lastAnchor = { east: enu.east, north: enu.north, up };
          lastBounds = partBounds;
        }

        // Stack logic: if term.count>1 and stack=vertical, bump each instance.
        if (stack === "vertical") {
          // apply extra up per instance (small gap)
          lastAnchor = { east: enu.east, north: enu.north, up: up + (i + 1) * (partBounds.halfH * 2 * 0.9) };
        }
      }
    }
  }

  return { instances, bodyBounds };
}

export function findBestOverrideRow(
  rows: LandEquipShapeOverride[],
  entityCode: string,
  entityTypeCode: string,
  entitySubtypeCode: string | undefined,
): LandEquipShapeOverride | undefined {
  const ec = entityCode?.toString().padStart(2, "0");
  const etc = entityTypeCode?.toString().padStart(2, "0");
  const estc = (entitySubtypeCode ?? "*").toString().padStart(2, "0");

  // Prefer exact subtype match, then wildcard subtype, then type-level wildcard rows.
  const exact = rows.find(r => r.entityCode === ec && r.entityTypeCode === etc && r.entitySubtypeCode === estc);
  if (exact) return exact;
  const wildcardSub = rows.find(r => r.entityCode === ec && r.entityTypeCode === etc && r.entitySubtypeCode === "*");
  if (wildcardSub) return wildcardSub;

  // Fallback: any entityCode-wide wildcard type
  const wildcardType = rows.find(r => r.entityCode === ec && r.entityTypeCode === "*" && r.entitySubtypeCode === "*");
  return wildcardType;
}




