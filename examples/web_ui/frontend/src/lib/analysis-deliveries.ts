import type { Msg } from '@agentscope-ai/agentscope/message';

import { isCompletionRevision } from './reply-presentation.ts';
import { analysisPath } from './workspace-analysis.ts';

export type RegisteredAnalysis = { analysisRef: string; path: string };
const object = (value: unknown): Record<string, unknown> | null =>
	typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;

function jsonObject(value: unknown): Record<string, unknown> | null {
	if (typeof value !== 'string') return object(value);
	try { return object(JSON.parse(value)); } catch { return null; }
}

/** Actual delivery receipts, independent of whether the model repeats their links. */
export function registeredAnalyses(message: Msg): RegisteredAnalysis[] {
	if (message.role !== 'assistant') return [];
	const calls = new Map(message.content.filter((block) => block.type === 'tool_call').map((block) => [block.id, block]));
	const delivered = new Map<string, RegisteredAnalysis>();
	for (const block of message.content) {
		if (block.type !== 'tool_result' || block.state !== 'success') continue;
		const call = calls.get(block.id);
		if (!call || call.name !== block.name || !['AnalysisPublish', 'AnalysisInspect'].includes(call.name)) continue;
		const input = jsonObject(call.input);
		if (call.name === 'AnalysisPublish' && input?.previewOnly === true) continue;
		if (call.name === 'AnalysisInspect' && input?.section !== 'delivery') continue;
		const summary = object(object(block.metadata)?.process_summary);
		if (summary?.kind !== 'analysis') continue;
		// Only the paired built-in tool's structured receipt can register a card.
		// Ordinary tool text, model links and preview/error responses cannot.
		if (!Array.isArray(block.output) || block.output.length !== 1 || block.output[0].type !== 'text') continue;
		const response = jsonObject(block.output[0].text);
		if (!response || response.error || response.previewOnly === true) continue;
		if (call.name === 'AnalysisPublish' && response.publicationState !== 'PUBLISHED') continue;
		const delivery = object(response.delivery ?? response);
		if (delivery?.type !== 'workspace_analysis' || delivery.registered !== true || typeof delivery.path !== 'string') continue;
		const path = analysisPath(delivery.path);
		if (!path) continue;
		const [, id, revision] = /^\.\/analysis\/(ana_[0-9a-f]{32})\/revisions\/([1-9][0-9]{0,8})\/analysis\.json$/.exec(path)!;
		const analysisRef = `${id}:${revision}`;
		if (delivery.analysisRef !== analysisRef || summary.id !== id) continue;
		if (input?.analysisRef !== analysisRef || (call.name === 'AnalysisPublish' && response.analysisRef !== analysisRef)) continue;
		delivered.set(path, { analysisRef, path });
	}
	return [...delivered.values()];
}

/** One final card per analysis in this reply; keep the full receipt list for link suppression. */
export function latestAnalysisRevisions(deliveries: readonly RegisteredAnalysis[]): RegisteredAnalysis[] {
	const latest = new Map<string, RegisteredAnalysis>();
	for (const delivery of deliveries) {
		// registeredAnalyses already validated the identity, revision and path.
		const [id, revision] = delivery.analysisRef.split(':');
		const previous = latest.get(id);
		if (!previous || Number(revision) > Number(previous.analysisRef.split(':')[1])) {
			latest.set(id, delivery);
		}
	}
	return [...latest.values()];
}

/** Final cards follow the host's completion verdict, not publication alone. */
export function finalAnalysisDeliveries(
	message: Msg,
	deliveries: readonly RegisteredAnalysis[] = registeredAnalyses(message),
): RegisteredAnalysis[] {
	const completion = object(object(message.metadata)?.analysisCompletion);
	if (completion?.status === 'READY' || completion?.status === 'PARTIAL') {
		// A text-only correction can approve the same published version. Do not
		// require a new receipt after the correction hint, or prefer a larger
		// revision that the final check did not approve.
		return message.finished_reason === 'completed' && completion.semanticReview === 'PASS'
			? deliveries.filter((item) => item.analysisRef === completion.analysisRef)
			: [];
	}
	if (completion?.status === 'INCOMPLETE' || completion?.status === 'BLOCKED' ||
		message.content.some(isCompletionRevision)) return [];
	// Preserve old conversations and independent deliveries without this
	// host protocol. A rejection hint alone is never evidence of approval.
	return latestAnalysisRevisions(deliveries);
}
