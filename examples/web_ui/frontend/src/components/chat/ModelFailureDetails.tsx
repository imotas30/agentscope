import { Disclosure } from '@/components/ui/disclosure';
import { useTranslation } from '@/i18n/useI18n';
import { modelDiagnostics } from '@/lib/reply-diagnostics';
export function ModelFailureDetails({ error }: { error: unknown }) {
	const { t } = useTranslation();
	const detail = modelDiagnostics(error);
	if (!detail) return null;
	return (
		<Disclosure
			className="mt-2 text-xs"
			summary={<>{t('messageBubble.error.diagnosticDetails')}</>}
			summaryClassName="cursor-pointer"
		>
			<p className="mt-1 break-all">
				{t('messageBubble.error.diagnosticId')}: {detail.callId}
			</p>
			<p>
				{t(`messageBubble.error.phase_${detail.phase}`)} · {detail.elapsedMs} ms ·{' '}
				{t('messageBubble.error.attempt')} {detail.attempt}
			</p>
		</Disclosure>
	);
}
