// src/modules/scenarioeditor/doctrinalToe/targetPicker/doctrinalTargetTypes.ts
import type { EntityId } from "@/types/base";

export interface DoctrinalUnitIndexRow {
	id: EntityId;
	name: string;
	shortName?: string;
	unitNumber?: string;

	// Symbology
	sidc?: string;
	/** Per-unit milsymbol overrides (frame/icon/fill colors etc.) */
	symbolOptions?: Record<string, any>;

	// These help filtering when you have thousands of entries.
	sideId?: EntityId;
	sideName?: string;

	groupId?: EntityId;
	groupName?: string;

	parentId?: EntityId;

	// Optional indexing helpers (used by buildDoctrinalUnitIndex)
	depth?: number;
	path?: string;
	tags?: string[];
}
