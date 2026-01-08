import type { UnitPersonnel } from "@/types/scenarioModels";

export type DoctrinalMatchRule = {
	/**
	 * SIDC prefix match. If any prefix matches unit.sidc.startsWith(prefix),
	 * the template is considered a match candidate.
	 */
	sidcPrefix?: string[];

	/**
	 * Optional regex strings tested against unit.name (case-insensitive).
	 * Stored as strings to keep the library serializable.
	 */
	nameRegex?: string[];

	/**
	 * Optional tags for future use (e.g., unit.properties.tags or unit.tags).
	 */
	tags?: string[];
};

export interface DoctrinalToeTemplate {
	/** Stable ID in your library */
	key: string;

	/** Human label */
	name: string;

	/** Matching rules for bulk apply */
	match: DoctrinalMatchRule;

	/** Doctrinal baseline payload */
	personnel: UnitPersonnel[];

	/** Optional provenance */
	source?: string;
}

/** Persisted library wrapper (versioned for future migrations). */
export interface DoctrinalToeLibraryFile {
	version: 1;
	templates: DoctrinalToeTemplate[];
}
