import { Check, LoaderCircle, Trash2, Upload } from 'lucide-react';
import { useId, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { usePalette } from '@/context/appearance';
import { useTranslation } from '@/i18n/useI18n';
import { mapNrosTheme, ThemeImportError } from '@/lib/nros-theme';
import { importThemePackage } from '@/lib/theme-package';

export function ImportedThemes() {
	const {
		importedThemes,
		activeImportedTheme,
		importThemes,
		selectImportedTheme,
		removeImportedTheme,
	} = usePalette();
	const { t } = useTranslation();
	const input = useRef<HTMLInputElement>(null);
	const id = useId();
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const [status, setStatus] = useState('');
	const fail = (error: unknown) =>
		setError(
			t(
				`appearance.importErrors.${error instanceof ThemeImportError ? error.code : 'invalidTheme'}`,
			),
		);
	const act = (action: () => void) => {
		setError('');
		setStatus('');
		try {
			action();
		} catch (error) {
			fail(error);
		}
	};
	const upload = async (file?: File) => {
		if (!file) return;
		setBusy(true);
		setError('');
		setStatus('');
		try {
			const themes = await importThemePackage(file);
			importThemes(themes);
			setStatus(t('appearance.importSuccess', { count: themes.length }));
		} catch (error) {
			fail(error);
		} finally {
			setBusy(false);
		}
	};
	return (
		<section className="space-y-3" aria-labelledby={`${id}-title`}>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 id={`${id}-title`} className="text-sm font-medium">
					{t('appearance.importedThemes')}
				</h3>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={busy}
					onClick={() => input.current?.click()}
				>
					{busy ? <LoaderCircle className="animate-spin" /> : <Upload />}
					{t(busy ? 'appearance.importing' : 'appearance.importTheme')}
				</Button>
				<input
					ref={input}
					type="file"
					className="hidden"
					accept=".tgz,.tar.gz,.json"
					aria-label={t('appearance.importTheme')}
					disabled={busy}
					onChange={(event) => {
						const file = event.target.files?.[0];
						event.target.value = '';
						void upload(file);
					}}
				/>
			</div>
			<p className="text-xs leading-5 text-muted-foreground">{t('appearance.importHint')}</p>
			{importedThemes.length > 0 && (
				<div className="space-y-2">
					{importedThemes.map((theme) => {
						const styles = mapNrosTheme(theme);
						const active = theme.id === activeImportedTheme?.id;
						return (
							<div
								key={theme.id}
								className="flex items-center gap-2 rounded-lg border p-2"
							>
								<Button
									variant="ghost"
									type="button"
									className="h-auto justify-start p-0 whitespace-normal flex min-w-0 flex-1 items-center gap-3 rounded-md p-1 text-left outline-ring focus-visible:outline-2"
									aria-pressed={active}
									onClick={() => act(() => selectImportedTheme(theme.id))}
								>
									<span className="flex shrink-0 -space-x-1" aria-hidden="true">
										{[
											styles['--primary'],
											styles['--accent'],
											styles['--bg'],
										].map((color, i) => (
											<span
												key={i}
												className="size-5 rounded-full border ring-1 ring-card"
												style={{ backgroundColor: color || '#f3f4f6' }}
											/>
										))}
									</span>
									<span className="min-w-0 flex-1 break-words text-sm">
										{theme.title}
									</span>
									{active && (
										<Check
											className="size-4 shrink-0 text-primary"
											aria-hidden="true"
										/>
									)}
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									aria-label={t('appearance.removeTheme', { name: theme.title })}
									onClick={() => act(() => removeImportedTheme(theme.id))}
								>
									<Trash2 />
								</Button>
							</div>
						);
					})}
				</div>
			)}
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
			{status && (
				<p role="status" className="text-xs text-muted-foreground">
					{status}
				</p>
			)}
		</section>
	);
}
