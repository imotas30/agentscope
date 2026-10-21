import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

import { MODE_STORAGE_KEY, PALETTE_STORAGE_KEY } from '../src/lib/appearance.ts';

// Exercise the actual pre-paint entry point: a second system listener here would
// override a user's manual choice after React's theme provider has mounted.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bootstrap = html.match(/<script id="appearance-bootstrap">([\s\S]*?)<\/script>/)?.[1];
assert.ok(bootstrap, 'The first-paint appearance script must be present');

function firstPaint({ mode, palette, systemDark = false, blockedStorage = false } = {}) {
	const storage = new Map();
	if (mode !== undefined) storage.set(MODE_STORAGE_KEY, mode);
	if (palette !== undefined) storage.set(PALETTE_STORAGE_KEY, palette);
	const classes = new Set();
	const root = {
		classList: {
			toggle: (name, enabled) => (enabled ? classes.add(name) : classes.delete(name)),
		},
		dataset: {},
		style: {},
	};
	let listeners = 0;
	runInNewContext(bootstrap, {
		document: { documentElement: root },
		localStorage: {
			getItem: (key) => {
				if (blockedStorage) throw new Error('Storage unavailable');
				return storage.get(key) ?? null;
			},
			removeItem: (key) => storage.delete(key),
		},
		window: {
			matchMedia: () => ({ matches: systemDark, addEventListener: () => listeners++ }),
		},
	});
	return {
		dark: classes.has('dark'),
		palette: root.dataset.palette,
		scheme: root.style.colorScheme,
		storage,
		listeners,
	};
}

test('first visit uses light blue even when the operating system is dark', () => {
	const result = firstPaint({ systemDark: true });
	assert.equal(result.dark, false);
	assert.equal(result.scheme, 'light');
	assert.equal(result.palette, 'blue');
});

test('saved manual modes override either operating system preference before paint', () => {
	for (const mode of ['light', 'dark']) {
		for (const systemDark of [false, true]) {
			const result = firstPaint({ mode, systemDark });
			assert.equal(result.dark, mode === 'dark');
			assert.equal(result.scheme, mode);
		}
	}
});

test('system mode resolves the operating system preference before paint', () => {
	for (const systemDark of [false, true]) {
		const result = firstPaint({ mode: 'system', systemDark });
		assert.equal(result.dark, systemDark);
		assert.equal(result.scheme, systemDark ? 'dark' : 'light');
	}
});

test('all saved palettes survive a reload independently of display mode', () => {
	for (const palette of ['blue', 'teal', 'violet']) {
		for (const mode of ['light', 'dark', 'system']) {
			assert.equal(firstPaint({ palette, mode }).palette, palette);
		}
	}
});

test('corrupt saved values recover to defaults before the provider reads them', () => {
	const result = firstPaint({ mode: 'invalid mode', palette: 'unknown', systemDark: true });
	assert.equal(result.dark, false);
	assert.equal(result.palette, 'blue');
	assert.equal(result.storage.has(MODE_STORAGE_KEY), false);
});

test('unavailable browser storage does not prevent the first render', () => {
	const result = firstPaint({ blockedStorage: true, systemDark: true });
	assert.equal(result.dark, false);
	assert.equal(result.palette, 'blue');
});

test('the bootstrap leaves runtime system changes to the theme provider', () => {
	assert.equal(firstPaint({ mode: 'system' }).listeners, 0);
});
