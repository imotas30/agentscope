import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { gzipSync } from 'node:zlib';

import {
	applyImportedTheme, createImportedTheme, emptyImportedThemes, importedThemeMode,
	mapNrosTheme, mergeImportedThemes, parseImportedThemes, resolveThemeValue,
} from '../src/lib/nros-theme.ts';
import { importThemePackage, readThemeTar } from '../src/lib/theme-package.ts';

const fixture = readFileSync(new URL('./fixtures/nros-low-code.tgz', import.meta.url));
const file = (content, name = 'theme.tgz') => new File([content], name);
const errorCode = code => error => error.code === code;
const minimal = { '--jui-color-primary': '#123456', '--jui-color-font-1': '#1a1a20' };

function tar(entries) {
	const blocks = [];
	for (const [name, value, type = '0'] of entries) {
		const data = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
		const header = Buffer.alloc(512);
		header.write(name);
		header.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
		header.fill(32, 148, 156);
		header.write(type, 156);
		header.write('ustar\0', 257);
		const sum = header.reduce((sum, byte) => sum + byte, 0);
		header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
		blocks.push(header, data, Buffer.alloc((512 - data.length % 512) % 512));
	}
	return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}

function packageWith(themes, extra = []) {
	return gzipSync(tar([
		['package/v3/meta.json', { themes: themes.map(([code]) => ({ code, title: code })) }],
		...themes.map(([code, data]) => [`package/v3/${code}.json`, data]),
		...extra,
	]));
}

test('the supplied NROS package imports all 306 variables with its original name', async () => {
	const [theme] = await importThemePackage(file(fixture));
	assert.equal(theme.title, '低代码');
	assert.equal(theme.id, 'local:low-code');
	assert.equal(Object.keys(theme.variables).length, 306);
	const styles = mapNrosTheme(theme);
	assert.equal(styles['--primary'], '#3e5bf2');
	assert.equal(styles['--primary-foreground'], '#ffffff');
	assert.equal(styles['--bg'], '#F9FBFD');
	assert.equal(styles['--foreground'], '#1a1a20');
	assert.equal(styles['--border'], '#d9d9d9');
	assert.equal(styles['--sidebar'], '#ffffff');
	assert.equal(styles['--sidebar-accent'], '#f0f5ff');
	assert.equal(styles['--imported-font-size'], '14px');
	assert.ok(Math.abs(parseFloat(styles['--radius']) - 4) < 0.01);
	assert.equal(styles['--imported-table-header'], '#f0f0f0');
	assert.ok(Object.values(styles).every(value => !value.includes('var(')));
	assert.equal(importedThemeMode(theme), 'light');
});

test('both JSON and multi-theme V3 packages are supported', async () => {
	const themes = await importThemePackage(file(packageWith([['one', minimal], ['two', minimal]]), 'themes.tar.gz'));
	assert.deepEqual(themes.map(theme => theme.code), ['one', 'two']);
	assert.equal((await importThemePackage(file(JSON.stringify(minimal), 'custom.json')))[0].title, 'custom');
	assert.equal((await importThemePackage(file(JSON.stringify({ code: 'named', title: 'Named', jsonConfig: minimal }), 'custom.json')))[0].title, 'Named');
});

test('reimport updates only the matching theme and persistence round-trips', async () => {
	const themes = await importThemePackage(file(packageWith([['one', minimal], ['two', minimal]])));
	let state = mergeImportedThemes(emptyImportedThemes(), themes);
	const updated = createImportedTheme({ ...minimal, '--jui-color-primary': '#abcdef' }, { code: 'one', title: 'Updated' });
	state = mergeImportedThemes(state, [updated]);
	assert.equal(state.themes.length, 2);
	assert.equal(state.themes[0].title, 'Updated');
	assert.equal(state.themes[1].title, 'two');
	assert.equal(state.activeId, 'local:one');
	assert.deepEqual(parseImportedThemes(JSON.stringify(state)), state);
	assert.equal(parseImportedThemes(JSON.stringify({ ...state, activeId: 'missing' })).activeId, null);
});

test('corrupt or unsafe saved data falls back to built-in appearance', () => {
	for (const raw of ['garbage', 'null', '{}', '{"version":9,"themes":[]}', JSON.stringify({ version: 1, themes: [{ variables: { '--jui-color-primary': 'url(https://example.com)' } }], activeId: 'x' })]) {
		assert.deepEqual(parseImportedThemes(raw), emptyImportedThemes());
	}
});

test('CSS references resolve with fallbacks; cyclic and missing references cannot leak into the host', () => {
	const values = { '--jui-a': 'var(--jui-b)', '--jui-b': 'var(--jui-a)', '--jui-c': 'var(--missing, #fff)' };
	assert.equal(resolveThemeValue(values, '--jui-a'), undefined);
	assert.equal(resolveThemeValue(values, '--jui-c'), '#fff');
	assert.equal(resolveThemeValue(values, '--missing'), undefined);
	assert.throws(() => createImportedTheme({ '--jui-color-primary': 'var(--jui-color-primary)' }, {}), errorCode('invalidTheme'));
});

test('URLs and CSS injection are rejected, including in otherwise unused theme variables', async () => {
	for (const value of ['red; color: blue', 'url(https://example.com/a)', 'uRl (https://example.com/a)', '<style>', 'red !important', 'r\\65 d', 'expression(alert(1))']) {
		await assert.rejects(importThemePackage(file(JSON.stringify({ ...minimal, '--ui-background': value }), 'unsafe.json')), errorCode('invalidTheme'));
	}
});

test('bad metadata, missing files, duplicate codes, and malformed JSON are rejected atomically', async () => {
	for (const content of [gzipSync(tar([])), gzipSync(tar([['package/v3/meta.json', { themes: [{ code: 'missing' }] }]])), packageWith([['same', minimal], ['same', minimal]])]) {
		await assert.rejects(importThemePackage(file(content)));
	}
	await assert.rejects(importThemePackage(file('{broken', 'theme.json')), errorCode('invalidTheme'));
	await assert.rejects(importThemePackage(file(JSON.stringify({ color: 'red' }), 'theme.json')), errorCode('invalidTheme'));
});

test('path traversal, links, invalid checksums, and truncated tar files are rejected', () => {
	for (const name of ['../outside.json', '/absolute.json', 'C:/file.json', 'package/../../escape.json']) {
		assert.throws(() => readThemeTar(tar([[name, minimal]])), errorCode('invalidArchive'));
	}
	assert.throws(() => readThemeTar(tar([['link', '', '2']])), errorCode('invalidArchive'));
	const corrupt = tar([['package/v3/theme.json', minimal]]);
	corrupt[0] ^= 1;
	assert.throws(() => readThemeTar(corrupt), errorCode('invalidArchive'));
	assert.throws(() => readThemeTar(tar([['test', minimal]]).subarray(0, 515)), errorCode('invalidArchive'));
});

test('compressed, expanded, and saved-theme limits are enforced', async () => {
	await assert.rejects(importThemePackage(file(Buffer.alloc(2 * 1024 * 1024 + 1))), errorCode('tooLarge'));
	await assert.rejects(importThemePackage(file(gzipSync(Buffer.alloc(9 * 1024 * 1024)))), errorCode('tooLarge'));
	const themes = Array.from({ length: 20 }, (_, i) => createImportedTheme(minimal, { code: `theme-${i}` }));
	const state = mergeImportedThemes(emptyImportedThemes(), themes);
	assert.throws(() => mergeImportedThemes(state, [createImportedTheme(minimal, { code: 'extra' })]), errorCode('tooManyThemes'));
});

test('unsupported file types and corrupt gzip have readable error categories', async () => {
	await assert.rejects(importThemePackage(file('test', 'theme.zip')), errorCode('unsupportedFile'));
	await assert.rejects(importThemePackage(file('test')), errorCode('invalidArchive'));
});

test('switching or removing an imported theme clears only its own style overrides', async () => {
	const properties = new Map([['--unrelated', 'keep']]);
	const previous = globalThis.document;
	globalThis.document = { documentElement: { dataset: {}, style: {
		setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key),
	} } };
	try {
		const [theme] = await importThemePackage(file(fixture));
		applyImportedTheme(theme);
		assert.equal(properties.get('--primary'), '#3e5bf2');
		applyImportedTheme(createImportedTheme(minimal, { code: 'minimal' }));
		assert.equal(properties.has('--app-font-sans'), false);
		applyImportedTheme();
		assert.deepEqual([...properties], [['--unrelated', 'keep']]);
		assert.equal(globalThis.document.documentElement.dataset.importedTheme, undefined);
	} finally { globalThis.document = previous; }
});
