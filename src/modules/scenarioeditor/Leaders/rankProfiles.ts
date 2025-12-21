// src/modules/scenarioeditor/Leaders/rankProfiles.ts

import type { GradeType } from "./rankGrades";

export interface RankDisplay {
    /** Abbreviated/short code, e.g. "CPT" */
    code: string;
    /** Full name, e.g. "Captain" */
    name: string;
    /** Optional insignia image identifier to resolve via rankAssets.ts */
    insigniaImageId?: string;
}

export interface RankProfile {
    id: string; // e.g. "US_ARMY"
    label: string; // e.g. "United States — Army"
    description?: string;
    /** Map canonical grade keys (e.g. "O-3") to display properties */
    map: Record<string, RankDisplay>;
    /** Optional ordering preference for grouped UIs */
    typeOrder?: GradeType[];
}

/**
 * Start small. Add more profiles over time without touching the grade catalog.
 * You can safely ship partial maps: UI can fall back to showing grade key.
 */
export const RANK_PROFILES: Record<string, RankProfile> = {
    NONE: {
        id: "NONE",
        label: "(Grade only)",
        description: "Show only O/W/E grade; no service-specific names/insignia.",
        map: {},
        typeOrder: ["O", "W", "E"],
    },

    US_ARMY: {
        id: "US_ARMY",
        label: "United States — Army",
        description: "US Army ranks mapped from O/W/E grades.",
        map: {
            // Officers
            "O-1": { code: "2LT", name: "Second Lieutenant", insigniaImageId: "us_army/o1_2lt" },
            "O-2": { code: "1LT", name: "First Lieutenant", insigniaImageId: "us_army/o2_1lt" },
            "O-3": { code: "CPT", name: "Captain", insigniaImageId: "us_army/o3_cpt" },
            "O-4": { code: "MAJ", name: "Major", insigniaImageId: "us_army/o4_maj" },
            "O-5": { code: "LTC", name: "Lieutenant Colonel", insigniaImageId: "us_army/o5_ltc" },
            "O-6": { code: "COL", name: "Colonel", insigniaImageId: "us_army/o6_col" },
            "O-7": { code: "BG", name: "Brigadier General", insigniaImageId: "us_army/o7_bg" },
            "O-8": { code: "MG", name: "Major General", insigniaImageId: "us_army/o8_mg" },
            "O-9": { code: "LTG", name: "Lieutenant General", insigniaImageId: "us_army/o9_ltg" },
            "O-10": { code: "GEN", name: "General", insigniaImageId: "us_army/o10_gen" },

            // Warrant (examples; expand as you like)
            "W-1": { code: "WO1", name: "Warrant Officer 1", insigniaImageId: "us_army/w1_wo1" },
            "W-2": { code: "CW2", name: "Chief Warrant Officer 2", insigniaImageId: "us_army/w2_cw2" },
            "W-3": { code: "CW3", name: "Chief Warrant Officer 3", insigniaImageId: "us_army/w3_cw3" },
            "W-4": { code: "CW4", name: "Chief Warrant Officer 4", insigniaImageId: "us_army/w4_cw4" },
            "W-5": { code: "CW5", name: "Chief Warrant Officer 5", insigniaImageId: "us_army/w5_cw5" },

            // Enlisted (examples; expand as you like)
            "E-1": { code: "PVT", name: "Private", insigniaImageId: "us_army/e1_pvt" },
            "E-2": { code: "PV2", name: "Private Second Class", insigniaImageId: "us_army/e2_pv2" },
            "E-3": { code: "PFC", name: "Private First Class", insigniaImageId: "us_army/e3_pfc" },
            "E-4": { code: "SPC", name: "Specialist", insigniaImageId: "us_army/e4_spc" },
            "E-5": { code: "SGT", name: "Sergeant", insigniaImageId: "us_army/e5_sgt" },
            "E-6": { code: "SSG", name: "Staff Sergeant", insigniaImageId: "us_army/e6_ssg" },
            "E-7": { code: "SFC", name: "Sergeant First Class", insigniaImageId: "us_army/e7_sfc" },
            "E-8": { code: "MSG", name: "Master Sergeant", insigniaImageId: "us_army/e8_msg" },
            "E-9": { code: "SGM", name: "Sergeant Major", insigniaImageId: "us_army/e9_sgm" },
        },
        typeOrder: ["O", "W", "E"],
    },
};

export function listProfiles(): RankProfile[] {
    // Stable ordering: NONE first, then alphabetical by label.
    const vals = Object.values(RANK_PROFILES);
    return vals.sort((a, b) => {
        if (a.id === "NONE") return -1;
        if (b.id === "NONE") return 1;
        return a.label.localeCompare(b.label);
    });
}

export function getProfile(profileId?: string): RankProfile | undefined {
    if (!profileId) return undefined;
    return RANK_PROFILES[profileId];
}

export function displayForGrade(profileId: string | undefined, gradeKey: string): RankDisplay | undefined {
    const prof = getProfile(profileId);
    if (!prof) return undefined;
    return prof.map[gradeKey];
}
