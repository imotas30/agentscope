import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useId, useState, type ReactElement } from 'react';

import { ImportedThemes } from '@/components/appearance/ImportedThemes';
import { AgentScopeLogo } from '@/components/brand/AgentScopeLogo';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog';
import { usePalette } from '@/context/appearance';
import { useBranding } from '@/context/branding';
import { useTranslation } from '@/i18n/useI18n';
import { PALETTES } from '@/lib/appearance';
import { DEFAULT_BRANDING } from '@/lib/branding';

const modes = [
	{ value: 'light', Icon: Sun },
	{ value: 'dark', Icon: Moon },
	{ value: 'system', Icon: Monitor },
] as const;
const swatches = {
	blue: ['#2563eb', '#93c5fd', '#eff6ff'],
	teal: ['#0f766e', '#5eead4', '#f0fdfa'],
	violet: ['#7c3aed', '#c4b5fd', '#f5f3ff'],
};
const choiceClass =
	'flex h-full flex-col items-center gap-2 rounded-xl border bg-card p-2 text-center text-xs font-medium transition-colors sm:p-3 sm:text-sm peer-checked:border-primary peer-checked:bg-accent peer-checked:text-accent-foreground peer-checked:ring-1 peer-checked:ring-primary hover:border-primary/50 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-ring';

export function AppearanceControls() {
	const { theme, setTheme, forcedTheme } = useTheme();
	const { palette, setPalette, activeImportedTheme } = usePalette();
	const { data: branding = DEFAULT_BRANDING } = useBranding();
	const { t } = useTranslation();
	const id = useId();
	const [error, setError] = useState('');
	return (
		<div className="space-y-6">
			<fieldset className="space-y-3 disabled:opacity-50" disabled={!!activeImportedTheme}>
				<legend className="text-sm font-medium">{t('appearance.mode')}</legend>
				<div className="grid grid-cols-3 gap-2 sm:gap-3">
					{modes.map(({ value, Icon }) => (
						<label key={value} className="min-w-0 cursor-pointer">
							<input
								className="peer sr-only"
								type="radio"
								name={`${id}-mode`}
								value={value}
								checked={(forcedTheme || theme) === value}
								onChange={() => setTheme(value)}
							/>
							<span className={choiceClass}>
								<Icon className="my-1 size-5" aria-hidden="true" />
								{t(`appearance.${value}`)}
							</span>
						</label>
					))}
				</div>
			</fieldset>
			{activeImportedTheme && <p className="text-xs leading-5 text-muted-foreground">{t('appearance.importedModeHint')}</p>}
			<fieldset className="space-y-3">
				<legend className="text-sm font-medium">{t('appearance.palette')}</legend>
				<div className="grid grid-cols-3 gap-2 sm:gap-3">
					{PALETTES.map((value) => (
						<label key={value} className="min-w-0 cursor-pointer">
							<input
								className="peer sr-only"
								type="radio"
								name={`${id}-palette`}
								value={value}
								checked={!activeImportedTheme && palette === value}
								onChange={() => {
									setError('');
									try { setPalette(value); }
									catch { setError(t('appearance.importErrors.storageUnavailable')); }
								}}
							/>
							<span className={choiceClass}>
								<span className="my-1 flex -space-x-1" aria-hidden="true">
									{swatches[value].map((color) => (
										<span
											key={color}
											className="size-5 rounded-full ring-2 ring-card"
											style={{ backgroundColor: color }}
										/>
									))}
								</span>
								{t(`appearance.${value}`)}
							</span>
						</label>
					))}
				</div>
			</fieldset>
			{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
			<ImportedThemes />
			<div className="rounded-xl border bg-canvas p-4" aria-hidden="true">
				<div className="rounded-lg border bg-card p-4 shadow-panel">
					<div className="flex items-center gap-3">
						<AgentScopeLogo className="size-9" />
						<div className="min-w-0 flex-1">
							<div className="truncate text-sm font-semibold">{branding.browser_title}</div>
							<div className="mt-0.5 text-xs text-muted-foreground">
								{t('appearance.preview')}
							</div>
						</div>
						<Check className="size-4 shrink-0 text-primary" />
					</div>
					<div className="mt-4 flex items-center gap-3">
						<div className="h-2 flex-1 rounded-full bg-muted">
							<div className="h-full w-2/3 rounded-full bg-primary/75" />
						</div>
						<span className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-foreground">
							{activeImportedTheme?.title || t(`appearance.${palette}`)}
						</span>
					</div>
				</div>
			</div>
			<p className="text-xs leading-5 text-muted-foreground">
				{t('appearance.savedLocally')}
			</p>
		</div>
	);
}

export function AppearanceDialog({ children }: { children: ReactElement }) {
	const { t } = useTranslation();
	return (
		<Dialog>
			<DialogTrigger asChild>{children}</DialogTrigger>
			<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{t('appearance.title')}</DialogTitle>
					<DialogDescription>{t('appearance.description')}</DialogDescription>
				</DialogHeader>
				<AppearanceControls />
			</DialogContent>
		</Dialog>
	);
}
