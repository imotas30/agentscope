import { createImportedTheme, isRecord, MAX_IMPORTED_THEMES, ThemeImportError, type ImportedTheme } from './nros-theme.ts';

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 8 * 1024 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });

function json(bytes: Uint8Array): unknown {
	try { return JSON.parse(decoder.decode(bytes)); }
	catch { throw new ThemeImportError('invalidTheme'); }
}

function safePath(path: string) {
	path = path.replace(/^\.\//, '').replace(/\/$/, '');
	// eslint-disable-next-line no-control-regex -- Reject null bytes in archive paths.
	if (!path || path.startsWith('/') || /[\\:\u0000]/.test(path) || path.split('/').some(p => p === '..' || p === '.')) throw new ThemeImportError('invalidArchive');
	return path;
}

// Read tar entries in memory only. No archive paths are written to the filesystem.
export function readThemeTar(bytes: Uint8Array): Map<string, Uint8Array> {
	if (bytes.length > MAX_EXPANDED_BYTES) throw new ThemeImportError('tooLarge');
	const files = new Map<string, Uint8Array>();
	const paths = new Set<string>();
	const text = (start: number, length: number) => decoder.decode(bytes.subarray(start, start + length)).replace(/\0.*$/s, '').trim();
	let offset = 0;
	while (offset + 512 <= bytes.length) {
		const header = bytes.subarray(offset, offset + 512);
		if (header.every(byte => byte === 0)) return files;
		if (paths.size >= 256) throw new ThemeImportError('tooLarge');
		const sizeText = text(offset + 124, 12);
		const checksumText = text(offset + 148, 8);
		if (!/^[0-7]+$/.test(sizeText) || !/^[0-7]+$/.test(checksumText)) throw new ThemeImportError('invalidArchive');
		const size = parseInt(sizeText, 8);
		const checksum = header.reduce((sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte), 0);
		if (checksum !== parseInt(checksumText, 8) || offset + 512 + size > bytes.length) throw new ThemeImportError('invalidArchive');
		const prefix = text(offset + 345, 155);
		const path = safePath(`${prefix ? `${prefix}/` : ''}${text(offset, 100)}`);
		if (paths.has(path)) throw new ThemeImportError('invalidArchive');
		paths.add(path);
		const type = text(offset + 156, 1);
		if (type === '' || type === '0') files.set(path, bytes.subarray(offset + 512, offset + 512 + size));
		else if (!['5', 'x', 'g'].includes(type)) throw new ThemeImportError('invalidArchive');
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	throw new ThemeImportError('invalidArchive');
}

async function decompress(file: Blob) {
	if (typeof DecompressionStream === 'undefined') throw new ThemeImportError('unsupportedBrowser');
	const reader = file.stream().pipeThrough(new DecompressionStream('gzip')).getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) break;
			size += chunk.value.byteLength;
			if (size > MAX_EXPANDED_BYTES) {
				await reader.cancel();
				throw new ThemeImportError('tooLarge');
			}
			chunks.push(chunk.value);
		}
	} catch (error) {
		if (error instanceof ThemeImportError) throw error;
		throw new ThemeImportError('invalidArchive');
	} finally { reader.releaseLock(); }
	const result = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
	return result;
}

export async function importThemePackage(file: File): Promise<ImportedTheme[]> {
	if (file.size > MAX_FILE_BYTES) throw new ThemeImportError('tooLarge');
	if (/\.json$/i.test(file.name)) {
		const data = json(new Uint8Array(await file.arrayBuffer()));
		const code = file.name.replace(/\.json$/i, '');
		return [isRecord(data) && isRecord(data.jsonConfig)
			? createImportedTheme(data.jsonConfig, data)
			: createImportedTheme(data, { code, title: code })];
	}
	if (!/\.(?:tgz|tar\.gz)$/i.test(file.name)) throw new ThemeImportError('unsupportedFile');
	let files: Map<string, Uint8Array>;
	try { files = readThemeTar(await decompress(file)); }
	catch (error) {
		if (error instanceof ThemeImportError) throw error;
		throw new ThemeImportError('invalidArchive');
	}
	const metaPaths = [...files.keys()].filter(path => /^(?:package\/)?v3\/meta\.json$/.test(path));
	if (metaPaths.length !== 1) throw new ThemeImportError('invalidArchive');
	const metaPath = metaPaths[0];
	const meta = json(files.get(metaPath)!);
	if (!isRecord(meta) || !Array.isArray(meta.themes) || !meta.themes.length) throw new ThemeImportError('invalidTheme');
	if (meta.themes.length > MAX_IMPORTED_THEMES) throw new ThemeImportError('tooManyThemes');
	const base = metaPath.slice(0, -'meta.json'.length);
	const themes = meta.themes.map(item => {
		if (!isRecord(item) || typeof item.code !== 'string') throw new ThemeImportError('invalidTheme');
		const filename = typeof item.file === 'string' ? item.file : `${item.code}.json`;
		if (!/^[^/\\]+\.json$/i.test(filename) || safePath(filename) !== filename) throw new ThemeImportError('invalidArchive');
		const bytes = files.get(base + filename);
		if (!bytes) throw new ThemeImportError('invalidArchive');
		return createImportedTheme(json(bytes), item);
	});
	if (new Set(themes.map(t => t.id)).size !== themes.length) throw new ThemeImportError('invalidTheme');
	return themes;
}
