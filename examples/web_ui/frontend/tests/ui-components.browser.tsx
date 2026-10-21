/* eslint-disable react-refresh/only-export-components -- Standalone browser regression entry point. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { agentApi } from '@/api/agent';
import { managementApi, type ManagedAgent, type ResourceCatalog } from '@/api/agent-management';
import { usersApi } from '@/api/auth';
import { setAuth } from '@/api/auth-state';
import { modelApi } from '@/api/model';
import type { ChatModelConfig, ModelCard } from '@/api/types';
import { AnalysisTables } from '@/components/chat/analysis/AnalysisTables';
import { DeleteDialog } from '@/components/dialog/DeleteDialog';
import { AutocompleteInput } from '@/components/ui/autocomplete-input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Disclosure } from '@/components/ui/disclosure';
import { SelectField, SelectOption } from '@/components/ui/select-field';
import { TooltipProvider } from '@/components/ui/tooltip';
import i18n from '@/i18n';
import type { AnalysisTable } from '@/lib/workspace-analysis';
import { AgentEditorPage } from '@/pages/agents';
import { CopyAgentDialog } from '@/pages/agents/CopyAgentDialog';
import { JsonField, ModelField } from '@/pages/agents/fields';
import { MemoryFiles } from '@/pages/agents/MemoryFiles';
import { UsersPage } from '@/pages/users';
import '@/index.css';

const container = document.querySelector<HTMLDivElement>('#harness')!;
const summary = document.querySelector<HTMLElement>('#summary')!;
const results = document.querySelector<HTMLOListElement>('#results')!;
const run = document.querySelector<HTMLButtonElement>('#run')!;
let root: ReturnType<typeof createRoot> | undefined;
let cache: QueryClient;
let router: ReturnType<typeof createMemoryRouter> | undefined;
let unexpectedRequests: string[] = [];
// Test fixtures must never send edits to a running backend.
window.fetch = async (input) => {
	unexpectedRequests.push(String(input));
	throw new Error(`未替换的业务请求：${String(input)}`);
};
const assert = (condition: unknown, message: string) => {
	if (!condition) throw new Error(message);
};
const until = async (predicate: () => unknown, message = '等待界面更新超时') => {
	for (let index = 0; index < 150; index++) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(message);
};
const isVisible = (element: Element | null) =>
	!!element?.getClientRects().length && getComputedStyle(element).visibility !== 'hidden';
const byText = <T extends HTMLElement>(
	selector: string,
	text: string,
	scope: ParentNode = document,
) => {
	const element = [...scope.querySelectorAll<T>(selector)].find(
		(node) => isVisible(node) && node.textContent?.trim() === text,
	);
	assert(element, `找不到可见控件：${text}`);
	return element!;
};
const click = (text: string, scope?: ParentNode) =>
	byText<HTMLButtonElement>('button', text, scope).click();
const key = (element: Element, value: string, extra: KeyboardEventInit = {}) => {
	element.dispatchEvent(
		new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: value, ...extra }),
	);
};
const type = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
	const prototype =
		element instanceof HTMLTextAreaElement
			? HTMLTextAreaElement.prototype
			: HTMLInputElement.prototype;
	Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
	element.dispatchEvent(new Event('input', { bubbles: true }));
};
const choose = async (trigger: HTMLElement, text: string) => {
	trigger.focus();
	key(trigger, 'ArrowDown');
	await until(() => isVisible(document.querySelector('[role="listbox"]')));
	const option = byText<HTMLElement>('[role="option"]', text);
	option.focus();
	key(option, 'Enter');
	await until(() => !isVisible(document.querySelector('[role="listbox"]')));
};
function reset() {
	if (root) flushSync(() => root!.unmount());
	router?.dispose();
	router = undefined;
	cache?.clear();
	cache = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
	root = createRoot(container);
	unexpectedRequests = [];
}
function render(content: ReactNode) {
	flushSync(() =>
		root!.render(
			<QueryClientProvider client={cache}>
				<TooltipProvider delayDuration={0}>{content}</TooltipProvider>
			</QueryClientProvider>,
		),
	);
}
const owner = { id: 'fixture-user', username: 'wx', display_name: '测试用户', status: 'active' };
const defaultModel: ChatModelConfig = {
	type: 'openai',
	credential_id: 'deepseek',
	model: 'deepseek-v4-flash',
	parameters: { max_tokens: 65536, thinking: true, reasoning_effort: 'high' },
};
const agent: ManagedAgent = {
	id: 'fixture-agent',
	user_id: owner.id,
	revision: 'fixture-revision',
	editable: true,
	created_at: '',
	updated_at: '',
	data: {
		id: 'fixture-agent',
		name: '本体测试1011',
		description: '',
		system_prompt: '测试系统提示词',
		chat_config: { context_config: {}, react_config: {}, invite_config: {} },
		resource_config: { skills: {}, mcps: {} },
		workspace_id: 'fixture-workspace',
		defaults: {
			chat_model_config: defaultModel,
			fallback_chat_model_config: defaultModel,
			tts_model_config: null,
			realtime_model_config: null,
			knowledge_config: null,
			permission_mode: 'default',
		},
	},
};
const catalog: ResourceCatalog = {
	skills: [],
	mcps: [],
	knowledge_bases: [],
	credentials: [
		{ id: 'deepseek', name: 'DeepSeek', type: 'openai', editable: true },
		{ id: 'other', name: '另一个服务', type: 'openai', editable: true },
	],
};
const models: ModelCard[] = ['deepseek-v4-flash', 'deepseek-v4-pro'].map((name) => ({
	type: 'chat_model',
	name,
	label: name,
	status: 'active',
	deprecated_at: null,
	input_types: ['text'],
	output_types: ['text'],
	context_size: 131072,
	output_size: 65536,
	parameters_overrides: {},
	parameter_schema: {
		type: 'object',
		properties: {
			max_tokens: { type: 'integer', title: 'Max Tokens' },
			thinking: { type: 'boolean', title: 'Thinking' },
			reasoning_effort: {
				type: 'string',
				title: 'Reasoning Effort',
				enum: ['low', 'medium', 'high'],
			},
		},
	},
}));
function setupApis() {
	setAuth({
		user: {
			...owner,
			role: 'admin',
			status: 'active',
			created_at: '',
			updated_at: '',
			last_login_at: null,
		},
		csrf_token: 'fixture-only',
	});
	agentApi.getSchema = async () => ({ schema: { type: 'object', properties: {} } });
	managementApi.list = async () => ({ agents: [agent], users: [owner], admin: true, total: 1 });
	managementApi.detail = async () => ({ agent, sessions: [] });
	managementApi.resources = async () => catalog;
	managementApi.files = async () => ({
		workspace_id: 'fixture-workspace',
		files: [{ path: 'Memory/test.md', size: 16 }],
	});
	managementApi.memory = async () => ({ content: '记忆原文', revision: 'memory-r1' });
	modelApi.list = async () => ({ models, total: models.length });
}
function renderAgent() {
	router = createMemoryRouter([{ path: '/agents/:agentId', element: <AgentEditorPage /> }], {
		initialEntries: ['/agents/fixture-agent'],
	});
	render(<RouterProvider router={router} />);
}
function SelectHarness({ disabled = false }: { disabled?: boolean }) {
	const [value, setValue] = useState('deepseek');
	return (
		<fieldset disabled={disabled}>
			<SelectField aria-label="测试资源" value={value} onValueChange={setValue}>
				<SelectOption value="">不配置</SelectOption>
				<SelectOption value="deepseek">DeepSeek</SelectOption>
				<SelectOption value="option:">特殊 ID</SelectOption>
			</SelectField>
			<output>{JSON.stringify(value)}</output>
		</fieldset>
	);
}
function AutocompleteHarness({ inDialog = false }: { inDialog?: boolean }) {
	const [value, setValue] = useState('');
	const [open, setOpen] = useState(true);
	const field = (
		<AutocompleteInput
			aria-label="模型候选"
			value={value}
			onValueChange={setValue}
			options={[
				{ value: 'flash', label: 'Flash' },
				{ value: 'pro', label: 'Pro' },
			]}
			emptyText="可继续输入自定义名称"
		/>
	);
	return inDialog ? (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogContent>
				<DialogTitle>选择模型</DialogTitle>
				<DialogDescription>测试对话框内候选选择</DialogDescription>
				{field}
			</DialogContent>
		</Dialog>
	) : (
		field
	);
}
const tests: [string, () => Promise<void>][] = [
	[
		'用户列表状态筛选更新数据并重置分页，筛选框保持紧凑布局',
		async () => {
			const requests: [string, string, number][] = [];
			usersApi.list = async (q, status, offset) => {
				requests.push([q, status, offset]);
				return {
					items: [
						{
							...owner,
							display_name: '筛选测试用户',
							role: 'user',
							status: status === 'disabled' ? 'disabled' : 'active',
							created_at: '',
							updated_at: '',
							last_login_at: null,
						},
					],
					total: 30,
				};
			};
			render(<UsersPage />);
			await until(() => container.textContent?.includes('筛选测试用户'));
			click(i18n.t('auth.next'), container);
			await until(() => requests.some((request) => request[2] === 20));
			const trigger = container.querySelector<HTMLElement>('[role="combobox"]')!;
			assert(trigger.getBoundingClientRect().width <= 160, '状态筛选不应扩展为整行宽度');
			assert(trigger.getBoundingClientRect().height === 36, '筛选框高度应遵循调用方设置');
			await choose(trigger, i18n.t('auth.disabled'));
			await until(() =>
				requests.some((request) => request[1] === 'disabled' && request[2] === 0),
			);
			assert(
				container.querySelector('[role="region"]')?.getAttribute('tabindex') === '0',
				'用户表格应支持键盘横向滚动',
			);
		},
	],
	[
		'资源下拉支持“不配置”和特殊 ID，键盘选择后恢复焦点',
		async () => {
			render(<SelectHarness />);
			const trigger = container.querySelector<HTMLElement>('[role="combobox"]')!;
			await choose(trigger, '不配置');
			assert(container.querySelector('output')?.textContent === '""', '空选项应返回空字符串');
			assert(document.activeElement === trigger, '选中后焦点应返回触发按钮');
			await choose(trigger, '特殊 ID');
			assert(
				container.querySelector('output')?.textContent === '"option:"',
				'ID 不应与空选项编码冲突',
			);
		},
	],
	[
		'禁用表单不能打开资源下拉',
		async () => {
			render(<SelectHarness disabled />);
			const trigger = container.querySelector<HTMLButtonElement>('[role="combobox"]')!;
			assert(trigger.matches(':disabled'), '字段集禁用必须传递到实际按钮');
			trigger.click();
			assert(!document.querySelector('[role="listbox"]'), '禁用控件不能展开');
		},
	],
	[
		'复选框初始部分选中显示横线，点击后全选并显示勾选',
		async () => {
			render(<Checkbox aria-label="默认部分选中" defaultChecked="indeterminate" />);
			const checkbox = container.querySelector<HTMLButtonElement>('[role="checkbox"]')!;
			assert(checkbox.getAttribute('aria-checked') === 'mixed', '默认部分选中应传递给读屏');
			assert(isVisible(checkbox.querySelector('.lucide-minus')), '默认部分选中应显示横线');
			checkbox.click();
			await until(() => checkbox.getAttribute('aria-checked') === 'true');
			assert(
				isVisible(checkbox.querySelector('.lucide-check')) &&
					!isVisible(checkbox.querySelector('.lucide-minus')),
				'勾选与部分选中图标应切换',
			);
		},
	],
	[
		'模型候选支持方向键、确认、自由输入和中文组合输入',
		async () => {
			render(<AutocompleteHarness />);
			const input = container.querySelector<HTMLInputElement>('input')!;
			input.focus();
			key(input, 'ArrowDown');
			await until(() => input.getAttribute('aria-activedescendant'));
			key(input, 'Enter');
			await until(() => input.value === 'flash');
			type(input, '自定义服务模型');
			await until(
				() =>
					input.value === '自定义服务模型' &&
					input.getAttribute('aria-expanded') === 'true',
			);
			key(input, 'Enter', { isComposing: true });
			assert(input.getAttribute('aria-expanded') === 'true', '输入法确认不应关闭候选');
			key(input, 'Escape');
			await until(() => input.getAttribute('aria-expanded') === 'false');
			assert(input.value === '自定义服务模型', '取消候选不应删除自定义名称');
			key(input, 'ArrowUp');
			await until(() => input.getAttribute('aria-activedescendant'));
			key(input, 'Enter');
			await until(() => input.value === 'pro');
		},
	],
	[
		'弹窗内按 Escape 只关闭模型候选，随后可关闭弹窗',
		async () => {
			render(<AutocompleteHarness inDialog />);
			const input = document.querySelector<HTMLInputElement>('input[aria-label="模型候选"]')!;
			input.focus();
			key(input, 'ArrowDown');
			await until(() => isVisible(document.querySelector('[role="listbox"]')));
			key(input, 'Escape');
			await until(() => !isVisible(document.querySelector('[role="listbox"]')));
			assert(isVisible(document.querySelector('[role="dialog"]')), '不应同时关闭编辑弹窗');
			key(input, 'Escape');
			await until(() => !isVisible(document.querySelector('[role="dialog"]')));
		},
	],
	[
		'真实模型配置保留自定义名称，切换服务时清空旧模型参数',
		async () => {
			let latest: ChatModelConfig | null = defaultModel;
			function ModelHarness() {
				const [value, setValue] = useState(latest);
				return (
					<ModelField
						label="主模型"
						catalog={catalog}
						value={value}
						onChange={(next) => {
							latest = next;
							setValue(next);
						}}
					/>
				);
			}
			render(<ModelHarness />);
			await until(() => container.textContent?.includes('Max Tokens'));
			const input = container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
			type(input, 'custom/model');
			await until(() => latest?.model === 'custom/model');
			key(input, 'Escape');
			await choose(
				container.querySelector<HTMLElement>('button[role="combobox"]')!,
				'另一个服务',
			);
			assert(
				latest?.credential_id === 'other' && latest.model === '',
				'切换服务应重置模型名称',
			);
			assert(JSON.stringify(latest?.parameters) === '{}', '新服务不应继承旧参数');
			await choose(
				container.querySelector<HTMLElement>('button[role="combobox"]')!,
				'不配置',
			);
			assert(
				latest === null && !container.querySelector('input'),
				'不配置应清空整个模型配置',
			);
		},
	],
	[
		'折叠高级参数后再次打开，未完成的 JSON 草稿仍保留',
		async () => {
			render(
				<Disclosure defaultOpen summary="高级参数">
					<JsonField label="参数 JSON" value={{}} onChange={() => {}} />
				</Disclosure>,
			);
			const textarea = container.querySelector('textarea')!;
			type(textarea, '{"未写完":');
			await until(() => textarea.validity.customError);
			click('高级参数', container);
			await until(() => !isVisible(textarea));
			click('高级参数', container);
			await until(() => isVisible(textarea));
			assert(
				textarea.value === '{"未写完":' && textarea.validity.customError,
				'折叠不能丢失无效草稿',
			);
		},
	],
	[
		'智能体标签页支持键盘切换，隐藏页草稿和校验均保留',
		async () => {
			renderAgent();
			await until(() => container.querySelector('[role="tab"]'), '智能体配置页未加载');
			const tabList = container.querySelector<HTMLElement>('[role="tablist"]')!;
			assert(
				tabList.scrollHeight <= tabList.clientHeight + 1,
				'标签栏高度不能裁切文本或出现纵向滚动',
			);
			const basic = byText<HTMLElement>('[role="tab"]', '基础信息', container);
			basic.focus();
			key(basic, 'ArrowRight');
			await until(
				() =>
					container.querySelector('[data-agent-tab="ai"]')?.getAttribute('hidden') ===
					null,
				'方向键未切换到 AI 标签',
			);
			const ai = container.querySelector<HTMLElement>('[data-agent-tab="ai"]')!;
			assert(isVisible(ai), 'AI 面板应显示');
			byText<HTMLButtonElement>('button', '高级模型参数', ai).click();
			const json = ai.querySelector('textarea')!;
			await until(() => isVisible(json), '高级参数未展开');
			type(json, '{broken');
			await until(() => json.validity.customError);
			byText<HTMLButtonElement>('button', '高级模型参数', ai).click();
			await until(() => !isVisible(json));
			const name = container.querySelector<HTMLInputElement>('[aria-label="智能体名称"]')!;
			key(basic, 'Enter');
			await until(() => isVisible(name), '基础信息页未显示');
			type(name, '保留名称草稿');
			await until(() => name.value === '保留名称草稿');
			const form = container.querySelector('form')!;
			form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
			await until(() => isVisible(ai), '校验失败未切换回 AI 页');
			await until(
				() => isVisible(json) && document.activeElement === json,
				'校验失败应展开参数并聚焦具体字段',
			);
			assert(json.value === '{broken', '切换标签不能重建无效 JSON 草稿');
			assert(name.value === '保留名称草稿', '切换标签不能重置名称');
			assert(container.querySelectorAll('[role="tab"]').length === 8, '所有配置页应保留');
		},
	],
	[
		'复制资源支持部分选中、全选和全部取消',
		async () => {
			managementApi.preview = async () => ({
				agent,
				defaults: agent.data.defaults!,
				sessions: [],
				workspace_id: 'fixture-workspace',
				skills: [
					{ id: 'a', name: '技能甲', available: true },
					{ id: 'b', name: '技能乙', available: true },
				],
				mcps: [],
				ai: [],
				knowledge_bases: [],
				memory: [],
				files: [],
				file_error: null,
			});
			render(
				<CopyAgentDialog
					agent={agent}
					users={[owner]}
					admin
					onClose={() => {}}
					onCopied={() => {}}
				/>,
			);
			await until(() => document.querySelector('[role="checkbox"]'));
			click('选择具体资源');
			await until(() =>
				[...document.querySelectorAll('label')].some(
					(node) => node.textContent === '技能甲' && isVisible(node),
				),
			);
			const first = document.querySelector<HTMLButtonElement>(
				`#${CSS.escape(byText('label', '技能甲').getAttribute('for')!)}`,
			)!;
			first.click();
			await until(() => document.querySelector('[role="checkbox"][aria-checked="mixed"]'));
			const all = document.querySelector<HTMLButtonElement>(
				'[role="checkbox"][aria-checked="mixed"]',
			)!;
			all.click();
			await until(() => first.getAttribute('aria-checked') === 'true');
			assert(all.getAttribute('aria-checked') === 'true', '部分选中点击后应全选');
			all.click();
			await until(() => first.getAttribute('aria-checked') === 'false');
			assert(all.getAttribute('aria-checked') === 'false', '全选点击后应全部取消');
		},
	],
	[
		'删除确认支持取消、请求期间锁定、失败提示与重试',
		async () => {
			let calls = 0;
			let rejectRequest: (reason: Error) => void = () => {};
			function DeleteHarness() {
				const [open, setOpen] = useState(true);
				return (
					<>
						<Button onClick={() => setOpen(true)}>重新打开</Button>
						<DeleteDialog
							open={open}
							onOpenChange={setOpen}
							title="测试删除"
							description="固定测试数据"
							confirmLabel="确认删除"
							onConfirm={async () => {
								calls++;
								if (calls === 1)
									await new Promise<void>((_, reject) => {
										rejectRequest = reject;
									});
							}}
						/>
					</>
				);
			}
			render(<DeleteHarness />);
			click('取消');
			await until(() => !isVisible(document.querySelector('[role="dialog"]')));
			assert(calls === 0, '取消不得发起删除');
			click('重新打开', container);
			await until(() => isVisible(document.querySelector('[role="dialog"]')));
			click('确认删除');
			await until(() => byText<HTMLButtonElement>('button', '确认删除').disabled);
			assert(byText<HTMLButtonElement>('button', '取消').disabled, '请求期间禁止取消');
			key(document.activeElement!, 'Escape');
			assert(isVisible(document.querySelector('[role="dialog"]')), '请求期间应保持确认框');
			rejectRequest(new Error('模拟版本冲突'));
			await until(() =>
				document.querySelector('[role="alert"]')?.textContent?.includes('模拟版本冲突'),
			);
			click('确认删除');
			await until(() => !isVisible(document.querySelector('[role="dialog"]')));
			assert(calls === 2, '失败后应允许重试一次');
		},
	],
	[
		'记忆文件删除经站内确认，取消保留编辑内容，成功携带版本号',
		async () => {
			let deleted: unknown[] = [];
			managementApi.deleteMemory = async (...args) => {
				deleted = args;
				return undefined;
			};
			render(<MemoryFiles agent={agent} workspace="fixture-workspace" />);
			await until(() => container.textContent?.includes('Memory/test.md'));
			const fileButton = [...container.querySelectorAll('button')].find((button) =>
				button.textContent?.includes('Memory/test.md'),
			)!;
			fileButton.click();
			await until(() => document.querySelector('textarea[aria-label="记忆内容"]'));
			const textarea = document.querySelector<HTMLTextAreaElement>(
				'textarea[aria-label="记忆内容"]',
			)!;
			type(textarea, '未保存的记忆');
			click('删除');
			await until(() => document.querySelectorAll('[role="dialog"]').length === 2);
			click('取消');
			await until(() => document.querySelectorAll('[role="dialog"]').length === 1);
			assert(
				deleted.length === 0 && textarea.value === '未保存的记忆',
				'取消不能修改文件或丢弃编辑草稿',
			);
			click('删除');
			await until(() => document.querySelectorAll('[role="dialog"]').length === 2);
			const confirm = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(
				(node) => node.textContent?.includes('删除记忆文件？'),
			)!;
			click('删除', confirm);
			await until(() => !isVisible(document.querySelector('[role="dialog"]')));
			assert(
				JSON.stringify(deleted) ===
					JSON.stringify([
						owner.id,
						agent.id,
						'fixture-workspace',
						'Memory/test.md',
						'memory-r1',
					]),
				'删除必须携带完整作用域及原版本号',
			);
		},
	],
	[
		'分析表格排序、翻页和每页条数切换保持一致',
		async () => {
			const table: AnalysisTable = {
				viewId: 'v',
				tableKey: 't',
				title: '测试分析表',
				kind: 'values',
				collapsed: false,
				pageSize: 2,
				columns: [{ key: 'value', label: '数值', unit: '' }],
				rows: [3, 1, 5, 2, 4].map((value) => ({
					memberKey: `${value}`,
					label: `对象${value}`,
					cells: {
						value: {
							rowKey: `${value}`,
							memberKey: `${value}`,
							valueRef: '',
							label: '',
							measure: '',
							exact: `${value}`,
							display: `${value}`,
							unit: '',
							state: '已取得',
						},
					},
				})),
			};
			render(<AnalysisTables tables={[table]} />);
			const first = () => container.querySelector('tbody tr th')?.textContent;
			assert(first() === '对象3', '初始顺序应是发布顺序');
			container.querySelector<HTMLButtonElement>('thead button')!.click();
			await until(() => first() === '对象5');
			assert(
				container.querySelector('[aria-sort]')?.getAttribute('aria-sort') === 'descending',
				'读屏排序状态应更新',
			);
			click(i18n.t('analysis.next'), container);
			await until(() => first() === '对象3');
			await choose(container.querySelector<HTMLElement>('[role="combobox"]')!, '12');
			assert(
				first() === '对象5' && container.querySelectorAll('tbody tr').length === 5,
				'改变每页数量应回到首屏并保留排序',
			);
			assert(
				container.querySelector('[role="region"]')?.getAttribute('tabindex') === '0',
				'横向滚动表格需要键盘入口',
			);
		},
	],
	[
		'禁用按钮的提示可通过键盘访问',
		async () => {
			render(
				<div style={{ width: 300 }}>
					<Button className="w-full" disabled tooltip="请先选择资源">
						复制
					</Button>
					<Button size="icon" tooltip="删除文件">
						<svg aria-hidden="true" />
					</Button>
				</div>,
			);
			container.querySelector<HTMLElement>('[tabindex="0"]')!.focus();
			await until(
				() => document.querySelector('[role="tooltip"]')?.textContent === '请先选择资源',
			);
			assert(container.querySelector('button')?.disabled, '提示可访问不应解除按钮禁用');
			assert(
				container.querySelector('button')!.getBoundingClientRect().width === 300,
				'禁用提示包装不能改变全宽按钮布局',
			);
			assert(
				container.querySelector('button[aria-label="删除文件"]'),
				'图标按钮应保留可访问名称',
			);
		},
	],
];

run.addEventListener('click', async () => {
	run.disabled = true;
	results.replaceChildren();
	summary.textContent = '测试中';
	await i18n.changeLanguage('zh');
	let passed = 0;
	for (const [name, test] of tests) {
		reset();
		setupApis();
		const row = document.createElement('li');
		try {
			await test();
			assert(
				!unexpectedRequests.length,
				`出现未替换的请求：${unexpectedRequests.join(', ')}`,
			);
			row.textContent = `通过：${name}`;
			passed++;
		} catch (error) {
			row.textContent = `失败：${name} — ${String(error)}`;
			row.className = 'text-destructive';
		} finally {
			flushSync(() => root!.unmount());
			root = undefined;
			router?.dispose();
			router = undefined;
			cache.clear();
		}
		results.append(row);
	}
	summary.textContent = `${passed}/${tests.length} 项通过`;
	run.disabled = false;
});
document.querySelector('#preview')!.addEventListener('click', async () => {
	reset();
	setupApis();
	await i18n.changeLanguage('zh');
	renderAgent();
});
document
	.querySelector('#theme')!
	.addEventListener('click', () => document.documentElement.classList.toggle('dark'));
document.querySelector('#width')!.addEventListener('click', () => {
	container.style.maxWidth = container.style.maxWidth ? '' : '390px';
});
