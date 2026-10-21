import assert from 'node:assert/strict';
import test from 'node:test';
import { applyReplyPresentation, pendingCalls, presentReply } from '../src/lib/reply-presentation.ts';

const text = (id, value = id) => ({ type: 'text', id, text: value });
const thought = (id) => ({ type: 'thinking', id, thinking: 'detail' });
const call = (id, state = 'finished') => ({ type: 'tool_call', id, name: 'Read', state, input: '{}' });
const result = (id, metadata = {}) => ({ type: 'tool_result', id, name: 'Read', state: 'success', output: [], metadata });
const message = (content, extra = {}) => ({ id: 'reply', role: 'assistant', metadata: {}, content, ...extra });
const ids = (blocks) => blocks.map((block) => block.id);

test('server selection preserves all final paragraphs and hides progress after the last tool', () => {
	const value = message([text('progress'), call('tool'), result('tool'), text('checking'), text('answer-1'), text('answer-2')], {
		metadata: { presentation: { answer_block_ids: ['answer-1', 'answer-2'] } },
	});
	const before = structuredClone(value);
	assert.deepEqual(ids(presentReply(value).answer), ['answer-1', 'answer-2']);
	assert.deepEqual(ids(presentReply(value).steps), ['progress', 'checking']);
	assert.deepEqual(value, before);
});

test('streaming and saved unclassified replies retain the complete answer tail', () => {
	const value = message([thought('t1'), text('progress'), call('c'), result('c'), thought('t2'), text('a1'), text('a2')]);
	assert.deepEqual(ids(presentReply(value).answer), ['a1', 'a2']);
	assert.equal(presentReply(value).toolCount, 1);
	assert.equal(presentReply(value).thinkingCount, 2);
});

test('explicit empty final output does not promote a progress sentence to an answer', () => {
	const value = message([text('still-working')], { metadata: { presentation: { answer_block_ids: [] } } });
	assert.deepEqual(presentReply(value).answer, []);
});

test('images and delivered report/analysis cards survive later tool calls', () => {
	const value = message([
		text('report', '[报告](./reports/example.html)'),
		text('analysis', `[图表](./analysis/ana_${'a'.repeat(32)}/revisions/1/analysis.json)`),
		{ type: 'data', id: 'image', source: { type: 'url', url: './image.png', media_type: 'image/png' } },
		call('later'), result('later'), text('answer'),
	], { metadata: { presentation: { answer_block_ids: ['answer'] } } });
	assert.deepEqual(ids(presentReply(value).answer), ['report', 'analysis', 'image', 'answer']);
});

test('completion revision hides rejected prose and cards while preserving process history', () => {
	const draft = text('old', `错误结论 [结果](./analysis/ana_${'a'.repeat(32)}/revisions/1/analysis.json)`);
	const hint = { type: 'hint', id: 'review', source: JSON.stringify({ label: 'System', sublabel: 'Completion check' }), hint: '修正' };
	const value = message([draft, hint, text('corrected', '[结果](./reports/corrected.html)')], {
		metadata: { presentation: { answer_block_ids: ['old', 'corrected'] } },
	});
	const before = structuredClone(value);
	assert.deepEqual(ids(presentReply(value).answer), ['corrected']);
	assert.deepEqual(ids(presentReply(value).process), ['old', 'review']);
	assert.deepEqual(value, before);
});

test('text-only streaming correction resets the draft but unrelated hints do not', () => {
	const hint = { type: 'hint', id: 'review', source: JSON.stringify({ label: 'System', sublabel: 'Completion check' }), hint: '修正' };
	assert.deepEqual(ids(presentReply(message([text('old'), hint])).answer), []);
	assert.deepEqual(ids(presentReply(message([text('old'), hint, text('new')])).answer), ['new']);
	assert.deepEqual(ids(presentReply(message([text('old'), {...hint, source:'unrelated'}, text('new')])).answer), ['old', 'new']);
});

test('tool output cannot become a user-facing report card', () => {
	const value = message([call('c'), { ...result('c'), output: [text('link', '[报告](./reports/example.html)')] }]);
	assert.deepEqual(presentReply(value).answer, []);
});

test('calls, replayed results and thoughts are counted once by ID', () => {
	const value = message([call('c'), result('c'), result('c'), thought('t'), thought('t'), result('orphan')]);
	assert.equal(presentReply(value).toolCount, 2);
	assert.equal(presentReply(value).thinkingCount, 1);
});

test('pending confirmations/external execution ignore resolved stale call states', () => {
	const value = message([call('resolved', 'asking'), result('resolved'), call('ask', 'asking'), call('external', 'submitted')]);
	assert.deepEqual(ids(pendingCalls(value)), ['ask', 'external']);
	assert.equal(presentReply(value).pending, 'confirmation');
	assert.equal(presentReply(message([call('external', 'submitted')])).pending, 'external');
	assert.deepEqual(pendingCalls(message([call('stale', 'asking')], { finished_at: '2026-10-13T10:00:00Z', finished_reason: 'error' })), []);
});

test('errors and interruptions keep partial output even if thinking resumes after it', () => {
	for (const finished_reason of ['error', 'interrupted']) {
		const value = message([call('c'), result('c'), text('partial'), thought('unfinished')], { finished_reason });
		assert.deepEqual(ids(presentReply(value).answer), ['partial']);
	}
});

test('report retries do not inflate counts; failed results do not claim success', () => {
	const meta = { process_summary: { kind: 'report', id: 'export-1', topicCount: 3 } };
	const value = message([result('one', meta), result('retry', meta), { ...result('failed', {
		process_summary: { kind: 'report', id: 'export-2', topicCount: 9 },
	}), state: 'error' }]);
	assert.equal(presentReply(value).reportCount, 1);
	assert.equal(presentReply(value).topicCount, 3);
});

test('multiple reports do not add potentially overlapping topic counts', () => {
	const value = message(['a', 'b'].map((id) => result(id, { process_summary: { kind: 'report', id, topicCount: 3 } })));
	assert.equal(presentReply(value).reportCount, 2);
	assert.equal(presentReply(value).topicCount, 0);
});

test('terminal event metadata survives live assembly and a history round trip', () => {
	const value = message([text('p'), text('a')]);
	applyReplyPresentation(value, { type: 'REPLY_END', reply_id: 'reply', metadata: { presentation: { answer_block_ids: ['a'] } } });
	assert.deepEqual(ids(presentReply(JSON.parse(JSON.stringify(value))).answer), ['a']);
	applyReplyPresentation(value, { type: 'REPLY_END', reply_id: 'another-reply', metadata: { presentation: { answer_block_ids: [] } } });
	assert.deepEqual(ids(presentReply(value).answer), ['a']);
});

test('completion verdict is carried independently of presentation and scoped to its reply', () => {
	const value = message([text('answer')], { metadata: { keep: true } });
	const metadata = { analysisCompletion: { status: 'INCOMPLETE', analysisRef: 'fixture:1', semanticReview: 'REVISE' } };
	applyReplyPresentation(value, { type: 'REPLY_END', reply_id: 'another', metadata });
	assert.deepEqual(value.metadata, { keep: true });
	applyReplyPresentation(value, { type: 'TEXT', reply_id: 'reply', metadata });
	assert.deepEqual(value.metadata, { keep: true });
	applyReplyPresentation(value, { type: 'REPLY_END', reply_id: 'reply', metadata });
	metadata.analysisCompletion.status = 'READY';
	assert.equal(value.metadata.analysisCompletion.status, 'INCOMPLETE', 'Keep a detached terminal snapshot');
	assert.deepEqual(JSON.parse(JSON.stringify(value)).metadata, { keep: true, analysisCompletion: { status: 'INCOMPLETE', analysisRef: 'fixture:1', semanticReview: 'REVISE' } });
});

test('terminal metadata preserves arbitrary middleware values and replaces whole verdicts', () => {
	const value = message([], { metadata: { keep: true, extensionReview: { oldRef: 'old' } } });
	const metadata = { extensionReview: { status: 'incomplete', references: ['source'] } };
	applyReplyPresentation(value, { type: 'REPLY_END', reply_id: 'reply', metadata });
	metadata.extensionReview.references.push('later mutation');
	assert.deepEqual(value.metadata, { keep: true, extensionReview: { status: 'incomplete', references: ['source'] } });
	applyReplyPresentation(value, { type: 'REPLY_END', reply_id: 'reply', metadata: { extensionReview: null } });
	assert.deepEqual(value.metadata, { keep: true, extensionReview: null });
});

test('missing and malformed metadata degrade to readable output', () => {
	for (const metadata of [null, {}, { presentation: { answer_block_ids: [1] } }]) {
		assert.deepEqual(ids(presentReply(message([text('answer')], { metadata })).answer), ['answer']);
	}
});

test('plain replies need no summary; questions and separate turns are unchanged', () => {
	assert.equal(presentReply(message([text('answer')])).process.length, 0);
	assert.deepEqual(ids(presentReply(message([text('question')], { role: 'user' })).answer), ['question']);
	presentReply(message([call('one'), result('one')]));
	assert.equal(presentReply(message([text('next-answer')])).toolCount, 0);
});
