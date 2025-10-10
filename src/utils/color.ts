// src/utils/color.ts
export function normalizeHex(input: string): string | null {
	const raw = input.trim().replace(/^#/, '').toLowerCase();
	if (!/^[0-9a-f]{3}$|^[0-9a-f]{6}$/.test(raw)) return null;
	const six = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw;
	return `#${six}`;
}
