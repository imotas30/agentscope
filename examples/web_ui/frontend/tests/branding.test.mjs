import assert from 'node:assert/strict';
import test from 'node:test';

import { applyBrowserBranding, DEFAULT_BRANDING, DEFAULT_LOGO_URL, getBrandingLogoUrl } from '../src/lib/branding.ts';

function browserDocument(withIcon = true) {
	const icons = withIcon ? [{ rel: 'icon', href: '/old.svg', type: 'image/svg+xml' }] : [];
	return {
		title: 'Old title',
		querySelector: () => icons[0] ?? null,
		createElement: () => ({}),
		head: { appendChild: (icon) => icons.push(icon) },
		icons,
	};
}

test('saved settings update the existing tab icon and title, including literal text', () => {
	const target = browserDocument();
	const icon = target.icons[0];
	applyBrowserBranding({
		browser_title: '预算 <Portal> & 工作台',
		logo_data_url: 'data:image/webp;base64,V0VCUA==',
	}, target);
	assert.equal(target.title, '预算 <Portal> & 工作台');
	assert.equal(target.icons.length, 1);
	assert.equal(target.icons[0], icon);
	assert.equal(icon.type, 'image/webp');
	assert.equal(icon.href, 'data:image/webp;base64,V0VCUA==');
});

test('reset restores the original AgentScope logo and SVG MIME after a custom icon', () => {
	const target = browserDocument();
	applyBrowserBranding({
		browser_title: 'Custom',
		logo_data_url: 'data:image/x-icon;base64,AAABAA==',
	}, target);
	applyBrowserBranding(DEFAULT_BRANDING, target);
	assert.equal(target.title, 'BudgetOntology');
	assert.equal(target.icons[0].href, DEFAULT_LOGO_URL);
	assert.equal(target.icons[0].type, 'image/svg+xml');
});

test('a missing favicon link is created only once across config updates', () => {
	const target = browserDocument(false);
	applyBrowserBranding(DEFAULT_BRANDING, target);
	applyBrowserBranding({ ...DEFAULT_BRANDING, browser_title: 'Updated' }, target);
	assert.equal(target.icons.length, 1);
	assert.equal(target.icons[0].rel, 'icon');
	assert.equal(target.title, 'Updated');
});

test('page logos and the favicon resolve the same uploaded and default image', () => {
	const target = browserDocument();
	const custom = { browser_title: 'Company', logo_data_url: 'data:image/png;base64,iVBORw0KGgo=' };
	for (const settings of [custom, DEFAULT_BRANDING]) {
		applyBrowserBranding(settings, target);
		assert.equal(target.icons[0].href, getBrandingLogoUrl(settings));
	}
	assert.equal(getBrandingLogoUrl(), DEFAULT_LOGO_URL);
});
