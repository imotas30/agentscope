import { ThemeProvider } from 'next-themes';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { PaletteContext } from '@/context/appearance';
import {
	MODE_STORAGE_KEY,
	PALETTE_STORAGE_KEY,
	parsePalette,
	readPalette,
	type Palette,
} from '@/lib/appearance';
import {
	applyImportedTheme,
	IMPORTED_THEMES_KEY,
	importedThemeMode,
	MAX_SAVED_THEME_LENGTH,
	mergeImportedThemes,
	parseImportedThemes,
	readImportedThemes,
	ThemeImportError,
	type ImportedTheme,
	type ImportedThemes,
} from '@/lib/nros-theme';

export function AppearanceProvider({ children }: { children: ReactNode }) {
	const [palette, updatePalette] = useState(readPalette);
	const [imported, updateImported] = useState(readImportedThemes);
	const importedRef = useRef(imported);
	const activeImportedTheme = imported.themes.find(theme => theme.id === imported.activeId);

	useLayoutEffect(() => {
		document.documentElement.dataset.palette = palette;
	}, [palette]);
	useLayoutEffect(() => {
		applyImportedTheme(activeImportedTheme);
		return () => applyImportedTheme();
	}, [activeImportedTheme]);

	useEffect(() => {
		const synchronize = (event: StorageEvent) => {
			if (event.key === PALETTE_STORAGE_KEY || event.key === null) {
				updatePalette(parsePalette(event.newValue));
			}
			if (event.key === IMPORTED_THEMES_KEY || event.key === null) {
				const next = parseImportedThemes(event.newValue);
				importedRef.current = next;
				updateImported(next);
			}
		};
		window.addEventListener('storage', synchronize);
		return () => window.removeEventListener('storage', synchronize);
	}, []);

	const commitImported = (next: ImportedThemes) => {
		try {
			const serialized = JSON.stringify(next);
			if (serialized.length > MAX_SAVED_THEME_LENGTH) throw new ThemeImportError('storageUnavailable');
			localStorage.setItem(IMPORTED_THEMES_KEY, serialized);
		} catch {
			throw new ThemeImportError('storageUnavailable');
		}
		importedRef.current = next;
		updateImported(next);
	};
	const importThemes = (themes: ImportedTheme[]) => commitImported(mergeImportedThemes(importedRef.current, themes));
	const selectImportedTheme = (id: string) => {
		if (importedRef.current.themes.some(theme => theme.id === id)) commitImported({ ...importedRef.current, activeId: id });
	};
	const removeImportedTheme = (id: string) => {
		const current = importedRef.current;
		commitImported({ ...current, themes: current.themes.filter(theme => theme.id !== id), activeId: current.activeId === id ? null : current.activeId });
	};

	const setPalette = (value: Palette) => {
		if (importedRef.current.activeId) commitImported({ ...importedRef.current, activeId: null });
		updatePalette(value);
		try {
			localStorage.setItem(PALETTE_STORAGE_KEY, value);
		} catch {
			// The selected appearance still works when browser storage is unavailable.
		}
	};

	return (
		<ThemeProvider
			attribute="class"
			storageKey={MODE_STORAGE_KEY}
			defaultTheme="light"
			forcedTheme={activeImportedTheme ? importedThemeMode(activeImportedTheme) : undefined}
			enableSystem
			disableTransitionOnChange
		>
			<PaletteContext.Provider value={{ palette, setPalette, importedThemes: imported.themes, activeImportedTheme, importThemes, selectImportedTheme, removeImportedTheme }}>
				{children}
			</PaletteContext.Provider>
		</ThemeProvider>
	);
}
