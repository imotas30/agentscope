export const MODE_STORAGE_KEY = 'agentscope-color-mode';
export const PALETTE_STORAGE_KEY = 'agentscope-color-palette';
export const PALETTES = ['blue', 'teal', 'violet'] as const;
export type Palette = (typeof PALETTES)[number];

export function parsePalette(value: string | null): Palette {
	return PALETTES.includes(value as Palette) ? (value as Palette) : 'blue';
}

export function readPalette(): Palette {
	try {
		return parsePalette(localStorage.getItem(PALETTE_STORAGE_KEY));
	} catch {
		return 'blue';
	}
}
