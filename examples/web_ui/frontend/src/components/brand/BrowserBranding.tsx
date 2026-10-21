import { useEffect } from 'react';

import { useBranding } from '@/context/branding';
import { applyBrowserBranding } from '@/lib/branding';

export function BrowserBranding() {
	const { data } = useBranding();
	useEffect(() => {
		// Keep the initial or last successful title/icon during a server outage.
		if (data) applyBrowserBranding(data);
	}, [data]);
	return null;
}
