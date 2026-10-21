import { ApiError, apiUrl, client } from './client';
import type { BrandingSettings } from '@/lib/branding';

export const brandingApi = {
	get: async (signal: AbortSignal): Promise<BrandingSettings> => {
		// Public branding survives login/logout and does not use the auth abort signal.
		const response = await fetch(apiUrl('/branding'), {
			credentials: 'omit',
			cache: 'no-store',
			signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
		});
		if (!response.ok) throw new ApiError(response.status, 'Could not load site branding.');
		return response.json();
	},
	save: async (settings: BrandingSettings): Promise<BrandingSettings> => {
		const response = await client.stream('/admin/branding', {
			method: 'PUT',
			body: settings,
			silent: true,
			timeoutMs: 15_000,
		});
		return response.json();
	},
};
