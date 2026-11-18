import type { Msg } from '@agentscope-ai/agentscope/message';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Streamdown, defaultRemarkPlugins } from 'streamdown';

import { remarkFinancialTables } from './financial-table-alignment.ts';
import { presentReply } from './reply-presentation.ts';

export type ConversationSection = {
	title: string;
	body: string;
};

/** Final assistant answers only. Questions, thinking, steps, and tool output stay out. */
export function conversationSections(messages: Msg[]): ConversationSection[] {
	const sections: ConversationSection[] = [];
	for (const message of messages) {
		if (message.role !== 'assistant') continue;
		const body = presentReply(message)
			.answer.filter((block) => block.type === 'text')
			.map((block) => block.text.trim())
			.filter(Boolean)
			.join('\n\n');
		if (!body) continue;
		sections.push({
			title: message.name?.trim() || '回答',
			body,
		});
	}
	return sections;
}

export function conversationHasExportableText(messages: Msg[]): boolean {
	return conversationSections(messages).length > 0;
}

function htmlDocument(value: string): boolean {
	const trimmed = value.trim();
	return /^<!doctype html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed);
}

function htmlBody(value: string): string {
	const body = value.match(/<body[^>]*>([\s\S]*)<\/body>/i);
	return body?.[1]?.trim() || value.trim();
}

/** The same static Markdown pipeline the chat uses, so the file shows the formatted answer. */
export function renderAnswerMarkup(markdown: string): string {
	const source = markdown.trim();
	if (!source) return '';
	if (htmlDocument(source)) return htmlBody(source);
	return renderToStaticMarkup(
		React.createElement(
			Streamdown,
			{
				mode: 'static',
				controls: false,
				remarkPlugins: [...Object.values(defaultRemarkPlugins), remarkFinancialTables],
				components: {
					strong: ({ children }) => React.createElement('strong', null, children),
					em: ({ children }) => React.createElement('em', null, children),
				},
			},
			source,
		),
	);
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;');
}

function safeFileName(title: string): string {
	const cleaned = title.replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim() || '对话';
	return cleaned.slice(0, 80);
}

/** Word-compatible HTML document of one conversation. */
export function conversationDocumentHtml(messages: Msg[], title: string): string {
	const heading = title.trim() || '对话';
	const sections = conversationSections(messages);
	const body = sections
		.map(
			(section) =>
				`<section><h2>${escapeHtml(section.title)}</h2>${renderAnswerMarkup(section.body)}</section>`,
		)
		.join('');
	const exportedAt = new Date().toLocaleString('zh-CN', { hour12: false });
	return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(heading)}</title>
<style>
body { font-family: "Microsoft YaHei", SimSun, sans-serif; line-height: 1.6; }
h1 { font-size: 22px; }
h2 { font-size: 16px; margin-top: 1.4em; }
p, li { line-height: 1.6; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid #d0d0d0; padding: 6px 8px; vertical-align: top; }
th { background: #f3f3f3; }
pre { white-space: pre-wrap; background: #f6f6f6; padding: 8px; }
img { max-width: 100%; }
</style>
</head>
<body>
<h1>${escapeHtml(heading)}</h1>
<p>导出时间：${escapeHtml(exportedAt)}</p>
${body || '<p>本次对话没有可导出的回答。</p>'}
</body>
</html>`;
}

export function downloadConversationDocument(messages: Msg[], title?: string | null): void {
	const heading = title?.trim() || '对话';
	const html = conversationDocumentHtml(messages, heading);
	const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = `${safeFileName(heading)}.doc`;
	link.rel = 'noopener';
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}
