// src/modules/scenarioeditor/Leaders/rankGrades.ts

export type GradeType = "O" | "W" | "E";

/**
 * Canonical, service-agnostic grade for a leader.
 * This is what you should persist in scenario JSON for interoperability.
 */
export interface RankGrade {
    gradeType: GradeType; // Officer / Warrant / Enlisted
    gradeNumber: number; // 1..N
}

/**
 * UI + indexing metadata for a grade.
 */
export interface GradeDef extends RankGrade {
    key: string; // e.g. "O-3"
    index: number; // stable ordering key
    label: string; // e.g. "O-3"
    groupLabel: string; // e.g. "Officers"
}

type Bounds = { min: number; max: number; groupLabel: string };

/**
 * Initial catalog (~30 total):
 *  - Officers: O-1..O-12 (12)
 *  - Warrant:  W-1..W-6  (6)
 *  - Enlisted: E-1..E-12 (12)
 * Total = 30
 */
export const GRADE_BOUNDS: Record<GradeType, Bounds> = {
    O: { min: 1, max: 12, groupLabel: "Officers" },
    W: { min: 1, max: 6, groupLabel: "Warrant" },
    E: { min: 1, max: 12, groupLabel: "Enlisted" },
};

export const DEFAULT_GRADE: RankGrade = { gradeType: "O", gradeNumber: 1 };

export const ALL_GRADES: GradeDef[] = buildGrades(GRADE_BOUNDS);

export function gradeKey(g: RankGrade): string {
    return `${g.gradeType}-${g.gradeNumber}`;
}

export function parseGradeKey(key: string): RankGrade | undefined {
    const m = /^([OWE])-(\d+)$/.exec(key.trim().toUpperCase());
    if (!m) return undefined;
    const gradeType = m[1] as GradeType;
    const gradeNumber = Number(m[2]);
    if (!Number.isFinite(gradeNumber) || gradeNumber <= 0) return undefined;
    return { gradeType, gradeNumber };
}

export function normalizeGrade(input: unknown): RankGrade {
    // Accept:
    //  - { gradeType, gradeNumber }
    //  - "O-3" strings (best-effort)
    //  - undefined/null
    if (typeof input === "string") {
        const parsed = parseGradeKey(input);
        return parsed ? clampGrade(parsed) : { ...DEFAULT_GRADE };
    }

    if (input && typeof input === "object") {
        const obj = input as any;
        const gradeType: GradeType =
            obj.gradeType === "O" || obj.gradeType === "W" || obj.gradeType === "E"
                ? obj.gradeType
                : DEFAULT_GRADE.gradeType;

        const gradeNumber = Number(obj.gradeNumber);
        if (!Number.isFinite(gradeNumber)) return { ...DEFAULT_GRADE };

        return clampGrade({ gradeType, gradeNumber });
    }

    return { ...DEFAULT_GRADE };
}

export function clampGrade(g: RankGrade): RankGrade {
    const bounds = GRADE_BOUNDS[g.gradeType];
    const n = Math.min(Math.max(Math.trunc(g.gradeNumber), bounds.min), bounds.max);
    return { gradeType: g.gradeType, gradeNumber: n };
}

export function gradesByType(gradeType: GradeType): GradeDef[] {
    return ALL_GRADES.filter((g) => g.gradeType === gradeType);
}

export function findGradeDef(g: RankGrade): GradeDef | undefined {
    const k = gradeKey(g);
    return ALL_GRADES.find((x) => x.key === k);
}

function buildGrades(config: Record<GradeType, Bounds>): GradeDef[] {
    const order: GradeType[] = ["O", "W", "E"]; // change if you prefer
    let idx = 0;
    const out: GradeDef[] = [];

    for (const t of order) {
        const { min, max, groupLabel } = config[t];
        for (let n = min; n <= max; n++) {
            const key = `${t}-${n}`;
            out.push({
                gradeType: t,
                gradeNumber: n,
                key,
                index: idx++,
                label: key,
                groupLabel,
            });
        }
    }

    return out;
}
