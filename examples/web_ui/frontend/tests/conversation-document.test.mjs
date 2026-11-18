import assert from 'node:assert/strict';
import test from 'node:test';

import {
	conversationDocumentHtml,
	conversationHasExportableText,
	conversationSections,
	renderAnswerMarkup,
} from '../src/lib/conversation-document.ts';

function message(role, content, extra = {}) {
	return {
		id: extra.id ?? role,
		name: extra.name ?? (role === 'user' ? '用户' : '预算助手'),
		role,
		content,
		metadata: extra.metadata ?? {},
		created_at: '2026-11-18T00:00:00Z',
		finished_reason: extra.finished_reason,
	};
}

const messages = [
	message('user', [{ type: 'text', id: 'q', text: '收入是多少？' }]),
	message('assistant', [
		{ type: 'thinking', id: 'think', thinking: '先查表' },
		{ type: 'text', id: 'step', text: '我先核对收入科目。' },
		{ type: 'tool_call', id: 'call', name: 'query', input: '{}', state: 'finished' },
		{ type: 'tool_result', id: 'call', name: 'query', state: 'success', output: '明细表已生成' },
		{ type: 'text', id: 'answer', text: '本年收入为 120 万。' },
	], {
		metadata: { presentation: { answer_block_ids: ['answer'] } },
		finished_reason: 'completed',
	}),
];

test('document export keeps only the final answer', () => {
	assert.equal(conversationHasExportableText(messages), true);
	assert.deepEqual(conversationSections(messages), [
		{ title: '预算助手', body: '本年收入为 120 万。' },
	]);
});

test('conversation document renders markdown and escapes raw html', () => {
	const rendered = renderAnswerMarkup('## 收入\n\n**120 万**\n\n| 科目 | 金额 |\n| --- | --- |\n| 收入 | 120 |');
	assert.match(rendered, /<h2[^>]*>收入<\/h2>/);
	assert.match(rendered, /<strong>120 万<\/strong>/);
	assert.match(rendered, /<table[\s>]/);
	assert.doesNotMatch(rendered, /## 收入|\*\*120 万\*\*|Copy table/);

	const html = conversationDocumentHtml(
		[
			message('assistant', [{ type: 'text', id: 'a', text: '<script>alert(1)</script>' }], {
				finished_reason: 'completed',
			}),
		],
		'预算/分析',
	);
	assert.match(html, /<h1>预算\/分析<\/h1>/);
	assert.doesNotMatch(html, /<script|alert\(1\)/);
});

test('questions and reasoning alone are not exportable', () => {
	assert.equal(conversationHasExportableText([]), false);
	assert.equal(
		conversationHasExportableText([
			message('user', [{ type: 'text', id: 'q', text: '收入是多少？' }]),
			message('assistant', [{ type: 'thinking', id: 'think', thinking: '内部推理' }]),
		]),
		false,
	);
});
