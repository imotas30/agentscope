import { useQuery } from '@tanstack/react-query';
import { Copy, Loader2 } from 'lucide-react';
import { useState } from 'react';

import { Check, Field } from './fields';
import {
	managementApi,
	type ManagedAgent,
	type Owner,
	type CopyPreview,
	type CopyOptions,
	type CopyItem,
} from '@/api/agent-management';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Disclosure } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/input';
import { SelectField, SelectOption } from '@/components/ui/select-field';

export function CopyAgentDialog({
	agent,
	users,
	admin,
	onClose,
	onCopied,
}: {
	agent: ManagedAgent;
	users: Owner[];
	admin: boolean;
	onClose: () => void;
	onCopied: (agent: ManagedAgent) => void;
}) {
	const [session, setSession] = useState('');
	const [workspace, setWorkspace] = useState('');
	const preview = useQuery({
		queryKey: ['agent-copy-preview', agent.user_id, agent.id, session, workspace],
		queryFn: () =>
			managementApi.preview(agent.user_id, agent.id, {
				...(session ? { source_session_id: session } : {}),
				...(workspace ? { workspace_id: workspace } : {}),
			}),
		refetchOnWindowFocus: false,
	});
	const [busy, setBusy] = useState(false);
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy) onClose();
			}}
		>
			<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>复制智能体</DialogTitle>
					<DialogDescription>
						选择配置和资源，为「{agent.data.name}」创建副本。
					</DialogDescription>
				</DialogHeader>
				{preview.isPending && <p role="status">正在读取资源和工作空间…</p>}
				{preview.error && (
					<p role="alert" className="text-destructive">
						{preview.error.message}
					</p>
				)}
				{preview.data && (
					<CopyForm
						key={`${session}:${workspace}`}
						preview={preview.data}
						users={users}
						admin={admin}
						sourceSession={session}
						setSession={setSession}
						setWorkspace={setWorkspace}
						busy={busy}
						setBusy={setBusy}
						onCopied={onCopied}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

function CopyForm({
	preview,
	users,
	admin,
	sourceSession,
	setSession,
	setWorkspace,
	busy,
	setBusy,
	onCopied,
}: {
	preview: CopyPreview;
	users: Owner[];
	admin: boolean;
	sourceSession: string;
	setSession: (v: string) => void;
	setWorkspace: (v: string) => void;
	busy: boolean;
	setBusy: (v: boolean) => void;
	onCopied: (agent: ManagedAgent) => void;
}) {
	const agent = preview.agent;
	const workspaceIds = [
		...new Set(
			[agent.data.workspace_id, ...preview.sessions.map((s) => s.workspace_id)].filter(
				(id): id is string => !!id,
			),
		),
	];
	const [options, setOptions] = useState<CopyOptions>(() => ({
		name: `${agent.data.name}-副本`,
		request_id: crypto.randomUUID(),
		revision: agent.revision,
		target_user_id: agent.user_id,
		source_session_id: sourceSession || undefined,
		workspace_id: preview.workspace_id,
		skills: preview.skills.map((r) => r.id),
		mcps: preview.mcps.map((r) => r.id),
		ai_fields: preview.ai.map((r) => r.id),
		knowledge_base_ids: preview.knowledge_bases.map((r) => r.id),
		skill_mode: 'link',
		mcp_mode: 'link',
		ai_mode: 'link',
		memory: false,
		files: [],
	}));
	const [error, setError] = useState('');
	const [review, setReview] = useState(false);
	const crossOwner = options.target_user_id !== agent.user_id;
	const change = <K extends keyof CopyOptions>(key: K, value: CopyOptions[K]) => {
		setReview(false);
		setOptions((v) => ({ ...v, [key]: value }));
	};
	const invalid =
		preview.skills.some((r) => options.skills.includes(r.id) && !r.available) ||
		preview.mcps.some((r) => options.mcps.includes(r.id) && !r.available) ||
		preview.ai.some((r) => options.ai_fields.includes(r.id) && !r.available) ||
		preview.knowledge_bases.some(
			(r) => options.knowledge_base_ids.includes(r.id) && !r.available,
		);
	const group = (
		title: string,
		rows: CopyItem[],
		key: 'skills' | 'mcps' | 'ai_fields' | 'knowledge_base_ids',
		mode?: 'skill_mode' | 'mcp_mode' | 'ai_mode',
	) => (
		<section className="rounded-xl border p-4 space-y-3">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Check
					label={`${title}（${options[key].length}/${rows.length}）`}
					checked={
						rows.length > 0 && rows.every((row) => options[key].includes(row.id))
							? true
							: rows.some((row) => options[key].includes(row.id))
								? 'indeterminate'
								: false
					}
					disabled={!rows.length}
					onChange={(yes) => change(key, yes ? rows.map((r) => r.id) : [])}
				/>
				{mode && rows.length > 0 && (
					<SelectField
						aria-label={`${title}复制方式`}
						className="!w-auto"
						value={crossOwner ? 'copy' : options[mode]}
						disabled={crossOwner || !options[key].length}
						onValueChange={(nextValue) => change(mode, nextValue as 'copy' | 'link')}
					>
						<SelectOption value="link">沿用现有资源</SelectOption>
						<SelectOption value="copy">创建独立副本</SelectOption>
					</SelectField>
				)}
			</div>
			{rows.length ? (
				<Disclosure
					summary={<>选择具体资源</>}
					summaryClassName="cursor-pointer text-xs text-muted-foreground"
				>
					<div className="mt-3 space-y-3">
						{rows.map((row) => (
							<div key={row.id} className="flex items-center justify-between gap-3">
								<Check
									label={`${row.name}${row.version ? ` · ${row.version}` : ''}${row.enabled === false ? ' · 已停用' : ''}`}
									checked={options[key].includes(row.id)}
									onChange={(yes) =>
										change(
											key,
											yes
												? [...options[key], row.id]
												: options[key].filter((id) => id !== row.id),
										)
									}
								/>
								{!row.available && (
									<span className="text-xs text-destructive">
										资源失效，请取消勾选
									</span>
								)}
							</div>
						))}
					</div>
				</Disclosure>
			) : (
				<p className="text-xs text-muted-foreground">未关联{title}</p>
			)}
		</section>
	);
	return (
		<form
			className="space-y-4"
			onSubmit={async (e) => {
				e.preventDefault();
				setError('');
				if (!review) {
					setReview(true);
					return;
				}
				setBusy(true);
				try {
					onCopied(await managementApi.copy(agent.user_id, agent.id, options));
				} catch (err) {
					setError((err as Error).message);
				} finally {
					setBusy(false);
				}
			}}
		>
			<fieldset disabled={busy} className="space-y-4">
				<Field label="新智能体名称">
					<Input
						required
						maxLength={100}
						value={options.name}
						onChange={(e) => change('name', e.target.value)}
					/>
				</Field>
				{admin && (
					<Field label="所属用户">
						<SelectField
							value={options.target_user_id}
							onValueChange={(nextValue) => {
								const target = nextValue;
								setOptions((v) => ({
									...v,
									target_user_id: target,
									knowledge_base_ids:
										target === agent.user_id
											? preview.knowledge_bases.map((r) => r.id)
											: [],
								}));
								setReview(false);
							}}
						>
							{users
								.filter((u) => u.status === 'active')
								.map((u) => (
									<SelectOption value={u.id} key={u.id}>
										{u.display_name || u.username}（{u.username}）
									</SelectOption>
								))}
						</SelectField>
					</Field>
				)}
				{crossOwner && (
					<p className="rounded-lg bg-primary/8 p-3 text-xs leading-5">
						跨用户复制将为目标用户创建所选 Skill、MCP 和 AI 资源的独立配置。外部服务及
						API 额度仍由原账号提供。知识库需要在复制后重新关联。
					</p>
				)}
				{!!preview.sessions.length && (
					<Field label="模型和知识库配置来源">
						<SelectField
							value={sourceSession}
							onValueChange={(nextValue) => setSession(nextValue)}
						>
							<SelectOption value="">智能体默认配置</SelectOption>
							{preview.sessions.map((s) => (
								<SelectOption key={s.id} value={s.id}>
									会话：{s.name}
								</SelectOption>
							))}
						</SelectField>
					</Field>
				)}
				{!agent.data.defaults && !sourceSession && (
					<p className="text-sm text-amber-600 dark:text-amber-400">
						此智能体尚未设置默认模型，可从已有会话选择配置来源。
					</p>
				)}
				<p className="text-xs text-muted-foreground">
					基础信息、提示词、行为权限和记忆策略会复制；每个副本使用新的智能体和工作空间。
				</p>
				{group('Skill', preview.skills, 'skills', 'skill_mode')}
				{group('MCP', preview.mcps, 'mcps', 'mcp_mode')}
				{group('AI 资源', preview.ai, 'ai_fields', 'ai_mode')}
				{!crossOwner && group('知识库关联', preview.knowledge_bases, 'knowledge_base_ids')}
				{workspaceIds.length > 1 && (
					<Field label="文件和记忆来源工作空间">
						<SelectField
							value={preview.workspace_id ?? ''}
							onValueChange={(nextValue) => setWorkspace(nextValue)}
						>
							<SelectOption value="">请选择来源</SelectOption>
							{workspaceIds.map((id) => (
								<SelectOption key={id} value={id}>
									{preview.sessions.find((s) => s.workspace_id === id)?.name ||
										'默认工作空间'}{' '}
									· {id.slice(0, 8)}
								</SelectOption>
							))}
						</SelectField>
					</Field>
				)}
				{preview.file_error && (
					<p role="alert" className="text-sm text-amber-600 dark:text-amber-400">
						{preview.file_error}
					</p>
				)}
				<section className="space-y-3 rounded-xl border p-4">
					<Check
						label={`长期记忆内容（${preview.memory.length} 个文件）`}
						checked={options.memory}
						disabled={!!preview.file_error}
						onChange={(v) => change('memory', v)}
					/>
					<p className="text-xs text-muted-foreground">
						勾选后复制到独立工作空间；不勾选则从空记忆开始。
					</p>
				</section>
				<section className="space-y-3 rounded-xl border p-4">
					<Check
						label={`工作空间业务文件（${options.files.length}/${preview.files.length}）`}
						checked={
							preview.files.length > 0 &&
							preview.files.every((file) => options.files.includes(file.path))
								? true
								: preview.files.some((file) => options.files.includes(file.path))
									? 'indeterminate'
									: false
						}
						disabled={!!preview.file_error || !preview.files.length}
						onChange={(v) => change('files', v ? preview.files.map((f) => f.path) : [])}
					/>
					{!!preview.files.length && (
						<Disclosure
							summary={<>选择文件</>}
							summaryClassName="text-xs cursor-pointer text-muted-foreground"
						>
							<div className="mt-3 max-h-40 overflow-auto space-y-3">
								{preview.files.map((f) => (
									<Check
										key={f.path}
										label={`${f.path} · ${Math.ceil(f.size / 1024)} KB`}
										checked={options.files.includes(f.path)}
										onChange={(yes) =>
											change(
												'files',
												yes
													? [...options.files, f.path]
													: options.files.filter((p) => p !== f.path),
											)
										}
									/>
								))}
							</div>
						</Disclosure>
					)}
				</section>
				{review && (
					<div
						className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm leading-7"
						role="status"
					>
						将创建「{options.name}」，包含 {options.skills.length} 个 Skill、
						{options.mcps.length} 个 MCP、{options.ai_fields.length} 项模型配置、
						{options.knowledge_base_ids.length} 个知识库关联；
						{options.memory ? '复制长期记忆' : '记忆内容为空'}，复制{' '}
						{options.files.length} 个业务文件。历史对话、运行状态和自动任务不复制。
					</div>
				)}
				{error && (
					<p role="alert" className="text-destructive text-sm">
						{error}
					</p>
				)}
				<Button
					type="submit"
					className="w-full"
					disabled={busy || invalid || !options.name.trim()}
				>
					{busy ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<Copy className="size-4" />
					)}
					{busy ? '正在复制资源和文件…' : review ? '确认并创建副本' : '预览复制结果'}
				</Button>
			</fieldset>
		</form>
	);
}
