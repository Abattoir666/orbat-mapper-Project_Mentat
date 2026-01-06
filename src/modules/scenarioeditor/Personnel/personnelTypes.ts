export type PersonnelStatus = "Ok" | "WIA" | "KIA" | "POW" | "MIA";

export interface PersonnelRow {
	id: string;
	status: PersonnelStatus;
	rank: string;
	name: string;
	intakeDate: string;  // YYYY-MM-DD
	outtakeDate: string; // YYYY-MM-DD
}

export const STATUS_OPTIONS: PersonnelStatus[] = ["Ok", "WIA", "KIA", "POW", "MIA"];

// Compact in-cell glyphs (ASCII-only source via escapes)
export const STATUS_GLYPH: Record<PersonnelStatus, string> = {
	Ok: "\u2713",   // ✓
	WIA: "\u2695",  // ⚕
	KIA: "\u271D",  // ✝
	POW: "\u26D3",  // ⛓
	MIA: "\u2753",  // ❓
};