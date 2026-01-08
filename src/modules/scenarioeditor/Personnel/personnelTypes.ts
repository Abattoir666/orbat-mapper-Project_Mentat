export type PersonnelStatus = "Ok" | "WIA" | "KIA" | "POW" | "MIA";

/**
 * Legacy, mutually-exclusive status segments (kept for backward compatibility).
 * New work should prefer flag segments (see PersonnelFlag / PersonnelFlagsSegment).
 */
export interface PersonnelStatusSegment {
    /** Inclusive start date (YYYY-MM-DD). Empty => unbounded past. */
    start: string;
    /** Exclusive end date (YYYY-MM-DD). Empty => open-ended. */
    end: string;
    status: PersonnelStatus;
}

/** Canonical personnel grade ref used for sorting leaders/officers. */
export interface PersonnelGradeRef {
    gradeType: "O" | "W" | "E";
    gradeNumber: number;
}

/**
 * New, checkbox-style personnel flags.
 *
 * Rules:
 * - Flags are NOT mutually exclusive (WIA/POW/MIA can coexist), except:
 * - KIA is TERMINAL: if KIA is true at time T, InRolls must be false at T and thereafter,
 *   and no later time may flip any flag back on unless the user edits history before the KIA start.
 */
export type PersonnelFlag = "InRolls" | "WIA" | "KIA" | "POW" | "MIA";
export type PersonnelFlags = Record<PersonnelFlag, boolean>;

export interface PersonnelFlagsSegment {
    /** Inclusive start date (YYYY-MM-DD). Empty => unbounded past. */
    start: string;
    /** Exclusive end date (YYYY-MM-DD). Empty => open-ended. */
    end: string;
    /**
     * Full snapshot (not a patch). This keeps lookup O(segments) and avoids merge ambiguity.
     * UI edits should compute the current flags at the scenario date, mutate, then write a new snapshot segment.
     */
    flags: PersonnelFlags;
}

/**
 * A personnel row is intentionally "spreadsheet friendly":
 * the first 5 fields map 1:1 to a TSV/CSV row (legacy view).
 *
 * Optional metadata fields are used for:
 * - summary ordering (leaders at top by rank)
 * - time-sensitive status on the TO&E/S ticker
 */
export interface PersonnelRow {
    id: string;

    /** Legacy / fallback status (used when statusHistory is empty). */
    status: PersonnelStatus;

    rank: string;
    name: string;

    /** YYYY-MM-DD. Empty => unknown. */
    intakeDate: string;

    /** YYYY-MM-DD. Empty => unknown. */
    outtakeDate: string;

    /** Optional: leaders float to the top in summaries. */
    isLeader?: boolean;

    /** Optional: used to sort leaders by rank. */
    grade?: PersonnelGradeRef;

    /** Optional: legacy time-sensitive status segments (mutually exclusive). */
    statusHistory?: PersonnelStatusSegment[];

    /**
     * Optional: new time-sensitive flag segments (checkbox model).
     * If present, this is the source of truth for status/flags over time.
     */
    flagsHistory?: PersonnelFlagsSegment[];
}

export const STATUS_OPTIONS: PersonnelStatus[] = ["Ok", "WIA", "KIA", "POW", "MIA"];

/**
 * Compact glyphs for *summary* views only.
 * Keep popout/editing with full words for copy/paste with Excel.
 * (Escapes keep the source ASCII.)
 */
export const STATUS_GLYPH: Record<PersonnelStatus, string> = {
    Ok: "\u2713", // ✓
    WIA: "\u2695", // ⚕
    KIA: "\u271D", // ✝
    POW: "\u26D3", // ⛓
    MIA: "\u2753", // ❓
};

export const FLAG_OPTIONS: PersonnelFlag[] = ["InRolls", "WIA", "KIA", "POW", "MIA"];

/** ASCII-safe label for UI (use these instead of raw enum values when you want nicer display). */
export const FLAG_LABEL: Record<PersonnelFlag, string> = {
    InRolls: "In-Rolls",
    WIA: "WIA",
    KIA: "KIA",
    POW: "POW",
    MIA: "MIA",
};

export function normStr(v: unknown): string {
    return typeof v === "string" ? v.trim() : "";
}

export function normStatus(v: unknown): PersonnelStatus {
    const s = normStr(v);
    if ((STATUS_OPTIONS as string[]).includes(s)) return s as PersonnelStatus;

    const u = s.toUpperCase();
    if (u === "OK" || u === "IN-ROLLS" || u === "INROLLS" || u === "IN ROLLS") return "Ok";
    if (u === "WIA") return "WIA";
    if (u === "KIA") return "KIA";
    if (u === "POW") return "POW";
    if (u === "MIA") return "MIA";
    return "Ok";
}

export function parseYmdToUtcMs(ymd: string): number | null {
    const s = normStr(ymd);
    if (!s) return null;

    // Expect YYYY-MM-DD
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;

    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;

    // UTC midnight
    const ms = Date.UTC(y, mo - 1, d, 0, 0, 0, 0);
    return Number.isFinite(ms) ? ms : null;
}

function clampStatusSegments(segs: PersonnelStatusSegment[]): PersonnelStatusSegment[] {
    return (Array.isArray(segs) ? segs : [])
        .map((s) => ({
            start: normStr(s.start),
            end: normStr(s.end),
            status: normStatus(s.status),
        }))
        .filter((s) => !!s.status)
        .sort((a, b) => (parseYmdToUtcMs(a.start) ?? -1e30) - (parseYmdToUtcMs(b.start) ?? -1e30));
}

function defaultFlags(): PersonnelFlags {
    return { InRolls: true, WIA: false, KIA: false, POW: false, MIA: false };
}

export function normalizeFlags(flags: Partial<PersonnelFlags> | null | undefined): PersonnelFlags {
    const f = flags ?? {};
    const out: PersonnelFlags = {
        InRolls: !!(f as any).InRolls,
        WIA: !!(f as any).WIA,
        KIA: !!(f as any).KIA,
        POW: !!(f as any).POW,
        MIA: !!(f as any).MIA,
    };

    // Terminal rule: KIA forces InRolls false and clears other non-terminal "in-unit" flags.
    if (out.KIA) {
        out.InRolls = false;
        out.WIA = false;
        out.POW = false;
        out.MIA = false;
    }

    // If not in rolls, in-unit flags should not be true.
    if (!out.InRolls) {
        out.WIA = false;
        out.POW = false;
        out.MIA = false;
        // out.KIA can remain true.
    }

    return out;
}

function clampFlagsSegments(segs: PersonnelFlagsSegment[]): PersonnelFlagsSegment[] {
    return (Array.isArray(segs) ? segs : [])
        .map((s) => ({
            start: normStr(s.start),
            end: normStr(s.end),
            flags: normalizeFlags((s as any).flags),
        }))
        .sort((a, b) => (parseYmdToUtcMs(a.start) ?? -1e30) - (parseYmdToUtcMs(b.start) ?? -1e30));
}

function flagsFromLegacyStatus(st: PersonnelStatus): PersonnelFlags {
    switch (st) {
        case "WIA":
            return normalizeFlags({ InRolls: true, WIA: true });
        case "POW":
            return normalizeFlags({ InRolls: true, POW: true });
        case "MIA":
            return normalizeFlags({ InRolls: true, MIA: true });
        case "KIA":
            return normalizeFlags({ KIA: true, InRolls: false });
        case "Ok":
        default:
            return normalizeFlags({ InRolls: true });
    }
}

/**
 * Normalize/clean a personnel row. This is intentionally permissive:
 * it will accept legacy rows (statusHistory) and/or new rows (flagsHistory).
 */
export function normalizePersonnelRow(row: unknown): PersonnelRow {
    const r: any = row && typeof row === "object" ? (row as any) : {};

    const statusHistory = Array.isArray(r.statusHistory)
        ? clampStatusSegments(
            r.statusHistory.map((seg: any) => ({
                start: normStr(seg?.start),
                end: normStr(seg?.end),
                status: normStatus(seg?.status),
            })),
        )
        : undefined;

    const flagsHistory = Array.isArray(r.flagsHistory)
        ? clampFlagsSegments(
            r.flagsHistory.map((seg: any) => ({
                start: normStr(seg?.start),
                end: normStr(seg?.end),
                flags: normalizeFlags(seg?.flags),
            })),
        )
        : undefined;

    const grade =
        r.grade && typeof r.grade === "object"
            ? {
                gradeType:
                    r.grade.gradeType === "O" || r.grade.gradeType === "W" || r.grade.gradeType === "E"
                        ? r.grade.gradeType
                        : undefined,
                gradeNumber: typeof r.grade.gradeNumber === "number" ? r.grade.gradeNumber : undefined,
            }
            : undefined;

    return {
        id: normStr(r.id),
        status: normStatus(r.status),
        rank: normStr(r.rank),
        name: normStr(r.name),
        intakeDate: normStr(r.intakeDate),
        outtakeDate: normStr(r.outtakeDate),
        isLeader: !!r.isLeader,
        grade: grade?.gradeType && typeof grade.gradeNumber === "number" ? (grade as any) : undefined,
        statusHistory: statusHistory?.length ? statusHistory : undefined,
        flagsHistory: flagsHistory?.length ? flagsHistory : undefined,
    };
}

/**
 * Returns row.status unless a matching statusHistory segment exists.
 * Segment rules:
 * - start inclusive
 * - end exclusive (if provided)
 * - empty start => unbounded past
 * - empty end => open-ended
 */
export function statusAtTimeMs(row: PersonnelRow, tMs: number): PersonnelStatus {
    const segs = Array.isArray(row.statusHistory) ? clampStatusSegments(row.statusHistory) : [];
    if (!segs.length) return normStatus(row.status);

    for (let i = segs.length - 1; i >= 0; i--) {
        const seg = segs[i];
        const startMs = parseYmdToUtcMs(seg.start);
        const endMs = parseYmdToUtcMs(seg.end);

        const afterStart = startMs === null ? true : tMs >= startMs;
        const beforeEnd = endMs === null ? true : tMs < endMs;

        if (afterStart && beforeEnd) return seg.status;
    }

    return normStatus(row.status);
}

/**
 * New: Get flags at a given time.
 * Precedence:
 * 1) flagsHistory (if present and non-empty)
 * 2) legacy statusHistory/status mapping
 * Additionally, if intake/outtake suggests inactive and KIA is not set, InRolls is forced false.
 */
export function flagsAtTimeMs(row: PersonnelRow, tMs: number): PersonnelFlags {
    const segs = Array.isArray(row.flagsHistory) ? clampFlagsSegments(row.flagsHistory) : [];

    let out: PersonnelFlags | null = null;

    if (segs.length) {
        for (let i = segs.length - 1; i >= 0; i--) {
            const seg = segs[i];
            const startMs = parseYmdToUtcMs(seg.start);
            const endMs = parseYmdToUtcMs(seg.end);

            const afterStart = startMs === null ? true : tMs >= startMs;
            const beforeEnd = endMs === null ? true : tMs < endMs;

            if (afterStart && beforeEnd) {
                out = normalizeFlags(seg.flags);
                break;
            }
        }
    }

    if (!out) {
        // Derive from legacy status at time.
        out = flagsFromLegacyStatus(statusAtTimeMs(row, tMs));
    }

    // Apply intake/outtake gating (if KIA isn't set).
    if (!out.KIA && !isActiveAtTimeMs(row, tMs)) {
        out = normalizeFlags({ ...out, InRolls: false });
    }

    return out;
}

/**
 * New: Convenience for UI. Returns true if KIA is effective at time.
 */
export function isKiaAtTimeMs(row: PersonnelRow, tMs: number): boolean {
    return !!flagsAtTimeMs(row, tMs).KIA;
}

/**
 * New: Derive a single legacy status label from flags (for existing UI paths).
 * This keeps current components working while you migrate to checkbox columns.
 *
 * Interpretation:
 * - If KIA => "KIA"
 * - Else if POW => "POW"
 * - Else if MIA => "MIA"
 * - Else if WIA => "WIA"
 * - Else => "Ok"
 */
export function statusFromFlags(flags: PersonnelFlags): PersonnelStatus {
    if (flags.KIA) return "KIA";
    if (flags.POW) return "POW";
    if (flags.MIA) return "MIA";
    if (flags.WIA) return "WIA";
    return "Ok";
}

/**
 * Legacy helper: Set a mutually-exclusive status effective at a given date (YYYY-MM-DD).
 * This updates statusHistory and legacy status.
 */
export function setStatusAtDate(row: PersonnelRow, date: string, nextStatus: PersonnelStatus): PersonnelRow {
    const next = normStatus(nextStatus);
    const segs = Array.isArray(row.statusHistory) ? clampStatusSegments(row.statusHistory) : [];

    const dateMs = parseYmdToUtcMs(date);
    if (!dateMs) {
        return { ...row, status: next };
    }

    const out: PersonnelStatusSegment[] = [];
    for (const seg of segs) {
        const startMs = parseYmdToUtcMs(seg.start);
        const endMs = parseYmdToUtcMs(seg.end);

        const overlaps = (startMs === null || dateMs >= startMs) && (endMs === null || dateMs < endMs);

        if (overlaps) {
            // Close at date (exclusive end)
            if (!seg.end || (endMs !== null && endMs > dateMs)) out.push({ ...seg, end: date });
            else out.push(seg);
        } else out.push(seg);
    }

    out.push({ start: date, end: "", status: next });

    return {
        ...row,
        status: next,
        statusHistory: clampStatusSegments(out),
    };
}

/**
 * New: Set a FULL flags snapshot effective at a given date (YYYY-MM-DD), enforcing KIA terminal semantics.
 *
 * Behavior:
 * - closes any overlapping segment at date (end = date)
 * - inserts a new open-ended segment starting at date
 * - if KIA is true in the new snapshot, all later segments are removed (terminal)
 */
export function setFlagsAtDate(row: PersonnelRow, date: string, nextFlags: Partial<PersonnelFlags>): PersonnelRow {
    const dateKey = normStr(date);
    const dateMs = parseYmdToUtcMs(dateKey);
    if (!dateMs) return row;

    const segs = Array.isArray(row.flagsHistory) ? clampFlagsSegments(row.flagsHistory) : [];

    // Base flags at date (so UI can pass a partial patch if desired).
    const base = flagsAtTimeMs(row, dateMs);
    const merged = normalizeFlags({ ...base, ...(nextFlags as any) });

    const out: PersonnelFlagsSegment[] = [];

    for (const seg of segs) {
        const startMs = parseYmdToUtcMs(seg.start);
        const endMs = parseYmdToUtcMs(seg.end);

        const overlaps = (startMs === null || dateMs >= startMs) && (endMs === null || dateMs < endMs);

        if (overlaps) {
            // Close at date (exclusive end)
            if (!seg.end || (endMs !== null && endMs > dateMs)) out.push({ ...seg, end: dateKey });
            else out.push(seg);
        } else out.push(seg);
    }

    // If KIA is set here, terminal: drop any segments that start after dateKey.
    const terminal = merged.KIA === true;

    out.push({ start: dateKey, end: "", flags: merged });

    const cleaned = clampFlagsSegments(out).filter((s) => {
        if (!terminal) return true;
        const sStartMs = parseYmdToUtcMs(s.start);
        return sStartMs === null ? true : sStartMs <= dateMs;
    });

    return {
        ...row,
        flagsHistory: cleaned.length ? cleaned : undefined,
        // Keep legacy status aligned for older code paths.
        status: statusFromFlags(merged),
    };
}

/**
 * New: Apply a single-flag toggle at a date (used for checkbox columns).
 * This is a thin wrapper around setFlagsAtDate.
 */
export function setFlagAtDate(row: PersonnelRow, date: string, flag: PersonnelFlag, value: boolean): PersonnelRow {
    const patch: any = {};
    patch[flag] = !!value;
    return setFlagsAtDate(row, date, patch);
}

/**
 * Active window based on intake/outtake (legacy).
 * You will likely remove these fields when you migrate to InRolls-only.
 */
export function isActiveAtTimeMs(row: PersonnelRow, tMs: number): boolean {
    const inMs = parseYmdToUtcMs(row.intakeDate);
    const outMs = parseYmdToUtcMs(row.outtakeDate);

    if (inMs !== null && tMs < inMs) return false;
    if (outMs !== null && tMs >= outMs) return false;
    return true;
}

export function leaderSortKey(row: PersonnelRow): number {
    // Larger = higher priority
    if (!row.isLeader || !row.grade) return -1;
    const typeWeight = row.grade.gradeType === "O" ? 300 : row.grade.gradeType === "W" ? 200 : 100;
    return typeWeight * 100 + (Number(row.grade.gradeNumber) || 0);
}

/**
 * Generic grade-based sort key for ANY personnel row (leaders and non-leaders).
 *
 * Ordering (descending):
 * O-12 .. O-1, then W-6 .. W-1, then E-12 .. E-1.
 *
 * Returns -1 when no grade can be determined.
 */
export function gradeSortKey(row: PersonnelRow): number {
    const g = row.grade ?? inferGradeFromText(row.rank);
    if (!g) return -1;

    const typeWeight = g.gradeType === "O" ? 300 : g.gradeType === "W" ? 200 : 100;
    const n = Number(g.gradeNumber) || 0;
    return typeWeight * 100 + n;
}

/** Stable, in-place sort by grade descending. Keeps original relative order for equal grades. */
export function sortRowsByGradeDescInPlace(rows: PersonnelRow[]): void {
    const decorated = rows.map((r, i) => ({ r, i, k: gradeSortKey(r) }));
    decorated.sort((a, b) => {
        if (a.k !== b.k) return b.k - a.k; // desc
        return a.i - b.i; // stable
    });
    rows.length = 0;
    for (const d of decorated) rows.push(d.r);
}

function inferGradeFromText(rankText: string | undefined | null): PersonnelGradeRef | undefined {
    const s = (rankText || "").trim().toUpperCase();
    if (!s) return undefined;

    // Accept patterns like "O-3", "O3", "W-1", "E-6", with optional whitespace.
    const m = s.match(/\b([OWE])\s*[- ]?\s*(\d{1,2})\b/);
    if (!m) return undefined;

    const gradeType = m[1] as any;
    const num = Number(m[2]);
    if (!Number.isFinite(num)) return undefined;

    return { gradeType, gradeNumber: num };
}
