export interface BrandingSettings {
	browser_title: string;
	logo_data_url: string | null;
}

export const DEFAULT_BRANDING: BrandingSettings = {
	browser_title: 'BudgetOntology',
	logo_data_url: null,
};
export const DEFAULT_LOGO_URL = '/agentscope.svg?v=collaboration';
export const MAX_LOGO_BYTES = 512 * 1024;
export const LOGO_MIME_TYPES = [
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/x-icon',
	'image/vnd.microsoft.icon',
];

export function getBrandingLogoUrl(settings: BrandingSettings = DEFAULT_BRANDING) {
	return settings.logo_data_url || DEFAULT_LOGO_URL;
}

export function applyBrowserBranding(settings: BrandingSettings, target: Document = document) {
	target.title = settings.browser_title;
	let icon = target.querySelector<HTMLLinkElement>('link[rel="icon"]');
	if (!icon) {
		icon = target.createElement('link');
		icon.rel = 'icon';
		target.head.appendChild(icon);
	}
	icon.type = settings.logo_data_url?.split(';', 1)[0].slice(5) || 'image/svg+xml';
	icon.href = getBrandingLogoUrl(settings);
}
