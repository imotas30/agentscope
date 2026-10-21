import { QueryClient, useQuery } from '@tanstack/react-query';

import { brandingApi } from '@/api/branding';
import type { BrandingSettings } from '@/lib/branding';

// Public configuration must remain mounted when the private auth cache is cleared.
const cache = new QueryClient();
const queryKey = ['browser-branding'];

export function useBranding() {
	return useQuery(
		{
			queryKey,
			queryFn: ({ signal }) => brandingApi.get(signal),
			staleTime: 30_000,
			refetchInterval: 60_000,
			refetchOnWindowFocus: 'always',
			retry: 1,
		},
		cache,
	);
}

export async function saveBranding(settings: BrandingSettings) {
	const saved = await brandingApi.save(settings);
	await cache.cancelQueries({ queryKey });
	cache.setQueryData(queryKey, saved);
	return saved;
}
