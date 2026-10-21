export const IMPORTED_THEMES_KEY = 'agentscope-imported-themes-v1';
export const MAX_IMPORTED_THEMES = 20;
export const MAX_SAVED_THEME_LENGTH = 2 * 1024 * 1024;

export type ImportedTheme = {
	id: string;
	code: string;
	title: string;
	prodLine: string;
	variables: Record<string, string>;
};
export type ImportedThemes = { version: 1; themes: ImportedTheme[]; activeId: string | null };
export type ThemeErrorCode =
	| 'invalidTheme' | 'invalidArchive' | 'tooLarge' | 'unsupportedFile'
	| 'unsupportedBrowser' | 'tooManyThemes' | 'storageUnavailable';

export class ThemeImportError extends Error {
	code: ThemeErrorCode;
	constructor(code: ThemeErrorCode) {
		super(code);
		this.code = code;
	}
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function label(value: unknown, fallback: string) {
	return typeof value === 'string' && value.trim()
		// eslint-disable-next-line no-control-regex -- Strip control characters from untrusted labels.
		? value.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120)
		: fallback;
}

export function createImportedTheme(data: unknown, meta: Record<string, unknown>): ImportedTheme {
	if (!isRecord(data) || Object.keys(data).length > 1024) throw new ThemeImportError('invalidTheme');
	const variables: Record<string, string> = {};
	for (const [key, value] of Object.entries(data)) {
		if (!/^--(?:jui|ui|ncell)-[a-zA-Z0-9_-]+$/.test(key)) continue;
		// Only declarations are supported. Never inject rules, URLs, or executable content.
		if (typeof value !== 'string' || value.length > 512 ||
			// eslint-disable-next-line no-control-regex -- Control characters are invalid in imported declarations.
			/[;{}<>\\@\u0000-\u001f\u007f]/.test(value) ||
			/(?:url|image|expression|attr|env)\s*\(|!\s*important/i.test(value)) {
			throw new ThemeImportError('invalidTheme');
		}
		variables[key] = value.trim();
	}
	const code = label(meta.code, 'theme');
	const prodLine = label(meta.prodLine, 'local');
	const theme = { id: `${prodLine}:${code}`, code, prodLine, title: label(meta.title, code), variables };
	if (!mapNrosTheme(theme)['--brand']) throw new ThemeImportError('invalidTheme');
	return theme;
}

// Resolve references before mapping, so imported values cannot depend on arbitrary
// host-page variables. Cycles and missing references fall back to the next token.
export function resolveThemeValue(variables: Record<string, string>, name: string): string | undefined {
	let remaining = 512;
	const resolve = (key: string, seen: Set<string>): string | undefined => {
		if (--remaining < 0 || seen.has(key) || seen.size > 32 || !Object.hasOwn(variables, key)) return;
		const next = new Set(seen).add(key);
		let unresolved = false;
		const result = variables[key].replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_, reference: string, fallback?: string) => {
			const resolved = resolve(reference, next) ?? fallback?.trim();
			if (!resolved) unresolved = true;
			return resolved ?? '';
		});
		return unresolved || result.length > 4096 || /var\(/i.test(result) ? undefined : result;
	};
	return resolve(name, new Set());
}

function supports(property: string, value: string) {
	if (typeof CSS !== 'undefined') return CSS.supports(property, value);
	// The non-DOM path is used for loading and testing theme data in Node.
	return property !== 'color' || /^(?:#[\da-f]{3,8}|[a-z]+|(?:rgba?|hsla?|oklch|oklab|lab|lch|color|color-mix)\(.+\))$/i.test(value);
}

export function mapNrosTheme(theme: ImportedTheme): Record<string, string> {
	const styles: Record<string, string> = {};
	const pick = (property: string, ...keys: string[]) => {
		for (const key of keys) {
			const value = resolveThemeValue(theme.variables, key);
			if (value && supports(property, value)) return value;
		}
	};
	const color = (target: string, ...keys: string[]) => {
		const value = pick('color', ...keys);
		if (value) styles[target] = value;
	};
	color('--brand', '--jui-color-primary-6', '--jui-color-primary', '--jui-button-primary-type-bg-color');
	color('--brand-strong', '--jui-color-primary-7', '--jui-color-primary-6', '--jui-color-primary');
	color('--primary', '--jui-button-primary-type-bg-color', '--jui-color-primary-6', '--jui-color-primary');
	color('--primary-foreground', '--jui-button-primary-type-color', '--jui-color-font-white-1');
	color('--brand-foreground', '--jui-color-font-white-1');
	color('--bg', '--ui-background', '--ui-bg-color', '--jui-color-gray-2');
	for (const target of ['--background', '--card', '--popover']) color(target, '--ui-bg-color', '--jui-color-gray-1');
	color('--foreground', '--jui-color-font-1');
	color('--secondary', '--jui-color-gray-3');
	color('--secondary-foreground', '--jui-color-font-2');
	color('--muted', '--jui-color-gray-3');
	color('--muted-foreground', '--jui-color-font-3');
	color('--accent', '--jui-color-primary-1');
	color('--accent-foreground', '--jui-color-primary-7', '--jui-color-primary-6', '--jui-color-primary');
	color('--destructive', '--jui-color-error-6', '--jui-color-error');
	for (const target of ['--border', '--input', '--sidebar-border']) color(target, '--jui-color-border', '--jui-color-gray-5');
	color('--sidebar', '--ui-menu-bg-color', '--ui-bg-color', '--jui-color-gray-1');
	// Transparent menus in NROS sit on its page surface, not on a built-in blue surface.
	if (styles['--sidebar'] === 'transparent') styles['--sidebar'] = styles['--background'] || '#fff';
	color('--sidebar-foreground', '--ui-menu-color', '--jui-color-font-1');
	color('--sidebar-accent', '--ui-menu-item-bg-color-selected', '--jui-color-primary-1');
	color('--sidebar-accent-foreground', '--ui-menu-item-color-selected', '--jui-color-primary-6');
	color('--text-secondary', '--jui-color-font-2');
	color('--text-tertiary', '--jui-color-font-3');
	color('--text-data', '--jui-color-font-3');
	color('--surface-muted', '--jui-color-gray-4');
	color('--row-hover', '--jui-table-row-bg-color-hover', '--jui-color-gray-4');
	color('--imported-table-header', '--jui-table-header-bg-color', '--jui-color-gray-4');
	color('--imported-table-header-text', '--jui-table-header-color', '--jui-color-font-1');
	color('--imported-button-hover', '--jui-button-primary-type-bg-color-hover', '--jui-color-primary-5');
	color('--imported-button-active', '--jui-button-primary-type-bg-color-active', '--jui-color-primary-7');
	color('--chart-2', '--jui-color-success-6', '--jui-color-success');
	color('--chart-3', '--jui-color-secondary-6', '--jui-color-secondary');
	color('--chart-4', '--jui-color-warn-6', '--jui-color-warn');
	color('--chart-5', '--jui-color-error-6', '--jui-color-error');
	color('--chart-positive', '--jui-color-success-6', '--jui-color-success');
	color('--chart-negative', '--jui-color-error-6', '--jui-color-error');
	const size = pick('font-size', '--jui-common-font-size');
	if (size && /^\d+(?:\.\d+)?px$/.test(size) && parseFloat(size) >= 12 && parseFloat(size) <= 24) styles['--imported-font-size'] = size;
	const font = pick('font-family', '--jui-common-font-family');
	if (font) styles['--app-font-sans'] = font;
	const radius = pick('border-radius', '--jui-common-r-4', '--ui-login-form-border-radius');
	if (radius && /^(?:0|\d+(?:\.\d+)?(?:px|em|rem))$/.test(radius)) {
		const pixels = parseFloat(radius) * (radius.endsWith('em') ? parseFloat(styles['--imported-font-size'] || '16') : 1);
		styles['--radius'] = `${Math.min(pixels, 32)}px`;
	}
	const shadow = pick('box-shadow', '--jui-common-shadow-1');
	if (shadow) styles['--panel-shadow'] = shadow;
	return styles;
}

export function importedThemeMode(theme: ImportedTheme): 'light' | 'dark' {
	const background = mapNrosTheme(theme)['--background'] || '#ffffff';
	const hex = background.match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
	const rgb = hex
		? (hex.length === 3 ? [...hex].map(v => v + v).join('') : hex).match(/../g)!.map(v => parseInt(v, 16))
		: background.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/)?.slice(1).map(Number);
	return rgb && rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722 < 128 ? 'dark' : 'light';
}

export function emptyImportedThemes(): ImportedThemes { return { version: 1, themes: [], activeId: null }; }

export function parseImportedThemes(raw: string | null): ImportedThemes {
	try {
		if (!raw || raw.length > MAX_SAVED_THEME_LENGTH) return emptyImportedThemes();
		const data: unknown = JSON.parse(raw);
		if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.themes) || data.themes.length > MAX_IMPORTED_THEMES) return emptyImportedThemes();
		const themes = data.themes.map(item => {
			if (!isRecord(item)) throw new ThemeImportError('invalidTheme');
			return createImportedTheme(item.variables, item);
		});
		return { version: 1, themes, activeId: themes.some(t => t.id === data.activeId) ? data.activeId as string : null };
	} catch { return emptyImportedThemes(); }
}

export function readImportedThemes(): ImportedThemes {
	try { return parseImportedThemes(localStorage.getItem(IMPORTED_THEMES_KEY)); }
	catch { return emptyImportedThemes(); }
}

export function mergeImportedThemes(current: ImportedThemes, incoming: ImportedTheme[]): ImportedThemes {
	const themes = new Map(current.themes.map(theme => [theme.id, theme]));
	for (const theme of incoming) themes.set(theme.id, theme);
	if (themes.size > MAX_IMPORTED_THEMES) throw new ThemeImportError('tooManyThemes');
	return { version: 1, themes: [...themes.values()], activeId: incoming[0]?.id ?? current.activeId };
}

let appliedKeys: string[] = [];
export function applyImportedTheme(theme?: ImportedTheme) {
	const root = document.documentElement;
	for (const key of appliedKeys) root.style.removeProperty(key);
	appliedKeys = [];
	delete root.dataset.importedTheme;
	if (!theme) return;
	const styles = mapNrosTheme(theme);
	for (const [key, value] of Object.entries(styles)) root.style.setProperty(key, value);
	appliedKeys = Object.keys(styles);
	root.dataset.importedTheme = theme.id;
}
