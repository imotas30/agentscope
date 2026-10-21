import { createContext, useContext } from 'react';

import type { Palette } from '@/lib/appearance';
import type { ImportedTheme } from '@/lib/nros-theme';

export const PaletteContext = createContext<{
	palette: Palette;
	setPalette: (palette: Palette) => void;
	importedThemes: ImportedTheme[];
	activeImportedTheme?: ImportedTheme;
	importThemes: (themes: ImportedTheme[]) => void;
	selectImportedTheme: (id: string) => void;
	removeImportedTheme: (id: string) => void;
} | null>(null);

export function usePalette() {
	const context = useContext(PaletteContext);
	if (!context) throw new Error('usePalette requires AppearanceProvider');
	return context;
}
