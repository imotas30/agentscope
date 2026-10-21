import { useBranding } from '@/context/branding';
import { DEFAULT_BRANDING, getBrandingLogoUrl } from '@/lib/branding';
import { cn } from '@/lib/utils';

export function AgentScopeLogo({ className }: { className?: string }) {
	const { data = DEFAULT_BRANDING } = useBranding();
	return (
		<img
			src={getBrandingLogoUrl(data)}
			alt={data.browser_title}
			data-slot="brand-logo"
			className={cn('size-8 shrink-0 object-contain', className)}
		/>
	);
}
