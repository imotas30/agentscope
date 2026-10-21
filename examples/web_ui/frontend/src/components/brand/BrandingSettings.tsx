import { useRef, useState } from 'react';

import { ApiError } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/AuthContext';
import { saveBranding, useBranding } from '@/context/branding';
import { useTranslation } from '@/i18n/useI18n';
import {
	DEFAULT_BRANDING,
	getBrandingLogoUrl,
	LOGO_MIME_TYPES,
	MAX_LOGO_BYTES,
	type BrandingSettings as Settings,
} from '@/lib/branding';

export function BrandingSettings() {
	const auth = useAuth();
	const { t } = useTranslation();
	// Ordinary users do not mount any of the editing controls.
	if (auth?.user.role !== 'admin') return null;
	return (
		<section
			className="rounded-xl border bg-card p-4 shadow-panel sm:p-6"
			aria-labelledby="branding-heading"
		>
			<h2 id="branding-heading" className="font-semibold">
				{t('branding.heading')}
			</h2>
			<p className="mb-6 mt-2 text-sm text-muted-foreground">
				{t('branding.description')}
			</p>
			<BrandingForm />
		</section>
	);
}

function BrandingForm() {
	const { t } = useTranslation();
	const branding = useBranding();
	const [draft, setDraft] = useState<Settings | null>(null);
	const [busy, setBusy] = useState(false);
	const [reading, setReading] = useState(false);
	const [error, setError] = useState('');
	const [saved, setSaved] = useState(false);
	const fileInput = useRef<HTMLInputElement>(null);
	const values = draft ?? branding.data;

	function edit(patch: Partial<Settings>) {
		setDraft({ ...(values ?? DEFAULT_BRANDING), ...patch });
		setSaved(false);
		setError('');
	}

	async function chooseLogo(file: File | undefined) {
		if (!file) return;
		setSaved(false);
		setError('');
		if (file.size > MAX_LOGO_BYTES || !file.size) {
			setError(t('branding.tooLarge'));
			return;
		}
		if (!LOGO_MIME_TYPES.includes(file.type)) {
			setError(t('branding.invalidImage'));
			return;
		}
		setReading(true);
		const url = URL.createObjectURL(file);
		try {
			const image = new Image();
			image.src = url;
			await image.decode();
			const dataUrl = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(reader.result as string);
				reader.onerror = () => reject(reader.error);
				reader.readAsDataURL(file);
			});
			edit({ logo_data_url: dataUrl });
		} catch {
			setError(t('branding.invalidImage'));
		} finally {
			URL.revokeObjectURL(url);
			setReading(false);
		}
	}

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		if (!values || busy || reading) return;
		const title = values.browser_title.trim();
		if (!title || title.length > 80) {
			setError(t('branding.invalidTitle'));
			return;
		}
		setBusy(true);
		setError('');
		setSaved(false);
		try {
			await saveBranding({ ...values, browser_title: title });
			setDraft(null);
			if (fileInput.current) fileInput.current.value = '';
			setSaved(true);
		} catch {
			setError(t('branding.saveFailed'));
		} finally {
			setBusy(false);
		}
	}

	if (!values) {
		const backendOutdated =
			branding.error instanceof ApiError && [401, 404].includes(branding.error.status);
		return branding.isError ? (
			<div role="alert" className="space-y-3">
				<p className="text-sm text-destructive">
					{t(backendOutdated ? 'branding.backendOutdated' : 'branding.loadFailed')}
				</p>
				<Button variant="outline" onClick={() => void branding.refetch()}>
					{t('auth.retry')}
				</Button>
			</div>
		) : (
			<p role="status" className="text-sm text-muted-foreground">{t('auth.loading')}</p>
		);
	}

	return (
		<form className="space-y-4" onSubmit={submit}>
			<fieldset disabled={busy || reading} className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="browser-title">{t('branding.browserTitle')}</Label>
					<Input
						id="browser-title"
						value={values.browser_title}
						maxLength={80}
						required
						onChange={(event) => edit({ browser_title: event.target.value })}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="browser-logo">{t('branding.logo')}</Label>
					<Input
						ref={fileInput}
						id="browser-logo"
						type="file"
						accept={LOGO_MIME_TYPES.join(',')}
						aria-describedby="browser-logo-hint"
						onChange={(event) => {
							const file = event.target.files?.[0];
							event.target.value = '';
							void chooseLogo(file);
						}}
					/>
					<p id="browser-logo-hint" className="text-xs text-muted-foreground">
						{t('branding.logoHint')}
					</p>
				</div>
				<div className="space-y-2">
					<p className="text-sm font-medium">{t('branding.preview')}</p>
					<div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-4 py-3">
						<img
							src={getBrandingLogoUrl(values)}
							alt=""
							className="size-6 shrink-0 object-contain"
						/>
						<span className="truncate text-sm">{values.browser_title || '—'}</span>
					</div>
				</div>
				<div className="flex flex-wrap gap-3">
					<Button type="submit" disabled={!draft}>
						{t(busy ? 'auth.saving' : 'branding.save')}
					</Button>
					<Button type="button" variant="outline" onClick={() => edit(DEFAULT_BRANDING)}>
						{t('branding.reset')}
					</Button>
					{draft && (
						<Button type="button" variant="ghost" onClick={() => {
							setDraft(null);
							setError('');
							setSaved(false);
						}}>
							{t('auth.cancel')}
						</Button>
					)}
				</div>
			</fieldset>
			{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
			{saved && <p role="status" className="text-sm text-muted-foreground">{t('branding.saved')}</p>}
		</form>
	);
}
