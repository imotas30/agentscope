import { useQuery } from '@tanstack/react-query';
import { FileText, Plus, Save, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Field } from './fields';
import { managementApi, type ManagedAgent } from '@/api/agent-management';
import { DeleteDialog } from '@/components/dialog/DeleteDialog';
import { Button } from '@/components/ui/button';
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export function MemoryFiles({ agent, workspace }: { agent: ManagedAgent; workspace: string }) {
	const files = useQuery({
		queryKey: ['agent-memory', agent.user_id, agent.id, workspace],
		queryFn: () => managementApi.files(agent.user_id, agent.id, workspace),
		refetchOnWindowFocus: false,
	});
	const [edit, setEdit] = useState<{
		path: string;
		content: string;
		revision: string | null;
		fresh?: boolean;
	} | null>(null);
	const [clear, setClear] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const wid = files.data?.workspace_id ?? workspace;
	return (
		<section className="space-y-4 rounded-xl border p-5">
			<div className="flex flex-wrap gap-3 items-center justify-between">
				<div>
					<h3 className="font-medium">长期记忆内容</h3>
					<p className="mt-1 text-xs text-muted-foreground">
						管理记忆索引及主题文件，编辑时会检查会话运行状态。
					</p>
				</div>
				<div className="flex gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => {
							setError('');
							setEdit({
								path: 'Memory/topic.md',
								content: '',
								revision: null,
								fresh: true,
							});
						}}
					>
						<Plus className="size-3.5" />
						新建记忆
					</Button>
					<Button
						type="button"
						size="sm"
						variant="outline"
						disabled={!files.data?.files.length}
						onClick={() => setClear(true)}
					>
						清空
					</Button>
				</div>
			</div>
			{files.isPending && <p role="status">正在加载记忆…</p>}
			{files.error && (
				<p role="alert" className="text-sm text-destructive">
					{files.error.message}
				</p>
			)}
			{files.data && !files.data.files.length && (
				<Empty className="rounded-lg bg-muted/40 p-6">
					<EmptyDescription>
						暂无长期记忆。智能体运行后会逐步积累，也可以手动添加。
					</EmptyDescription>
				</Empty>
			)}
			<div className="divide-y">
				{files.data?.files.map((file) => (
					<Button
						variant="ghost"
						key={file.path}
						type="button"
						className="h-auto justify-start p-0 whitespace-normal flex w-full items-center gap-3 py-3 text-left text-sm hover:text-primary"
						disabled={busy}
						onClick={async () => {
							setBusy(true);
							setError('');
							try {
								setEdit({
									path: file.path,
									...(await managementApi.memory(
										agent.user_id,
										agent.id,
										wid,
										file.path,
									)),
								});
							} catch (err) {
								setError((err as Error).message);
							} finally {
								setBusy(false);
							}
						}}
					>
						<FileText className="size-4 shrink-0" />
						<span className="min-w-0 flex-1 break-all">{file.path}</span>
						<span className="text-xs text-muted-foreground">
							{Math.ceil(file.size / 1024)} KB
						</span>
					</Button>
				))}
			</div>
			{error && !edit && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
			<Dialog
				open={!!edit}
				onOpenChange={(open) => {
					if (!open && !busy) setEdit(null);
				}}
			>
				<DialogContent className="sm:max-w-3xl">
					<DialogHeader>
						<DialogTitle>{edit?.fresh ? '新建记忆' : '编辑记忆'}</DialogTitle>
						<DialogDescription>
							内容写入当前智能体工作空间，保存不会修改其他独立副本。
						</DialogDescription>
					</DialogHeader>
					{edit && (
						<div className="space-y-4">
							<Field label="文件路径">
								<Input
									value={edit.path}
									disabled={!edit.fresh || busy}
									onChange={(e) => setEdit({ ...edit, path: e.target.value })}
								/>
							</Field>
							<Textarea
								aria-label="记忆内容"
								value={edit.content}
								onChange={(e) => setEdit({ ...edit, content: e.target.value })}
								className="min-h-64 max-h-[50vh] font-mono text-sm"
							/>
							{error && (
								<p role="alert" className="text-sm text-destructive">
									{error}
								</p>
							)}
							<div className="flex justify-between gap-3">
								<Button
									type="button"
									variant="destructive"
									disabled={!edit.revision || busy}
									onClick={() => setDeleteOpen(true)}
								>
									<Trash2 className="size-4" />
									删除
								</Button>
								<Button
									type="button"
									disabled={busy}
									onClick={async () => {
										setBusy(true);
										setError('');
										try {
											await managementApi.writeMemory(
												agent.user_id,
												agent.id,
												wid,
												edit.path,
												edit.content,
												edit.revision,
											);
											setEdit(null);
											await files.refetch();
											toast.success('记忆已保存');
										} catch (err) {
											setError((err as Error).message);
										} finally {
											setBusy(false);
										}
									}}
								>
									<Save className="size-4" />
									{busy ? '正在保存…' : '保存记忆'}
								</Button>
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>
			<DeleteDialog
				open={deleteOpen}
				onOpenChange={setDeleteOpen}
				title="删除记忆文件？"
				description={edit?.path}
				confirmLabel="删除"
				onConfirm={async () => {
					if (!edit?.revision) return;
					setBusy(true);
					try {
						await managementApi.deleteMemory(
							agent.user_id,
							agent.id,
							wid,
							edit.path,
							edit.revision,
						);
						setEdit(null);
						await files.refetch();
						toast.success('记忆已删除');
					} finally {
						setBusy(false);
					}
				}}
			/>
			<Dialog
				open={clear}
				onOpenChange={(open) => {
					if (!busy) setClear(open);
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>清空长期记忆？</DialogTitle>
						<DialogDescription>
							将删除当前工作空间中的 {files.data?.files.length ?? 0}{' '}
							个记忆文件。关联同一工作空间的会话都会受到影响。
						</DialogDescription>
					</DialogHeader>
					<Button
						type="button"
						variant="destructive"
						disabled={busy}
						onClick={async () => {
							setBusy(true);
							try {
								await managementApi.clearMemory(agent.user_id, agent.id, wid);
								setClear(false);
								await files.refetch();
							} catch (err) {
								setError((err as Error).message);
							} finally {
								setBusy(false);
							}
						}}
					>
						确认清空
					</Button>
				</DialogContent>
			</Dialog>
		</section>
	);
}
