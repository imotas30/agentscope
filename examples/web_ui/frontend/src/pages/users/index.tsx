import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { usersApi } from '@/api/auth';
import type { AuthUser } from '@/api/auth-state';
import { Badge } from '@/components/ui/badge';
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
import { Label } from '@/components/ui/label';
import { SelectField, SelectOption } from '@/components/ui/select-field';
import {
	Table,
	TableHeader,
	TableBody,
	TableRow,
	TableHead,
	TableCell,
} from '@/components/ui/table';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/i18n/useI18n';

type Action = { mode: 'create' | 'edit' | 'reset' | 'delete' | 'toggle'; user?: AuthUser };

export function UsersPage() {
	const auth = useAuth();
	const { t } = useTranslation();
	const cache = useQueryClient();
	const [search, setSearch] = useState('');
	const [q, setQ] = useState('');
	const [status, setStatus] = useState('');
	const [offset, setOffset] = useState(0);
	const [action, setAction] = useState<Action | null>(null);
	const users = useQuery({
		queryKey: ['admin-users', q, status, offset],
		queryFn: () => usersApi.list(q, status, offset),
		enabled: auth?.user.role === 'admin',
	});
	if (auth?.user.role !== 'admin')
		return (
			<main className="p-8" role="alert">
				{t('auth.forbidden')}
			</main>
		);
	const date = (value: string | null) => (value ? new Date(value).toLocaleString() : '—');
	return (
		<main className="h-full overflow-auto p-6 md:p-10">
			<div className="mx-auto max-w-6xl space-y-6">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<h1 className="text-2xl font-semibold">{t('auth.usersTitle')}</h1>
						<p className="mt-2 text-sm text-muted-foreground">
							{t('auth.usersDescription')}
						</p>
					</div>
					<Button onClick={() => setAction({ mode: 'create' })}>
						<Plus className="size-4" />
						{t('auth.create')}
					</Button>
				</div>
				<form
					className="flex flex-wrap items-center gap-3"
					onSubmit={(e) => {
						e.preventDefault();
						setQ(search.trim());
						setOffset(0);
					}}
				>
					<Input
						aria-label={t('auth.search')}
						placeholder={t('auth.search')}
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						className="max-w-sm"
						maxLength={100}
					/>
					<SelectField
						aria-label={t('auth.status')}
						className="h-9 w-36 max-w-full"
						value={status}
						onValueChange={(nextValue) => {
							setStatus(nextValue);
							setOffset(0);
						}}
					>
						<SelectOption value="">{t('auth.allStatuses')}</SelectOption>
						{['active', 'disabled', 'deleted'].map((s) => (
							<SelectOption key={s} value={s}>
								{t(`auth.${s}`)}
							</SelectOption>
						))}
					</SelectField>
					<Button type="submit" variant="outline">
						<Search className="size-4" />
						{t('auth.searchButton')}
					</Button>
				</form>
				{users.isError ? (
					<div role="alert" className="space-y-3">
						<p className="text-destructive">{users.error.message}</p>
						<Button variant="outline" onClick={() => void users.refetch()}>
							{t('auth.retry')}
						</Button>
					</div>
				) : (
					<div className="rounded-xl border bg-card">
						<Table
							className="w-full text-left text-sm"
							containerProps={{
								role: 'region',
								'aria-label': t('auth.usersTitle'),
								tabIndex: 0,
							}}
						>
							<TableHeader className="border-b bg-muted/40">
								<TableRow>
									{[
										'username',
										'displayName',
										'role',
										'status',
										'createdAt',
										'lastLogin',
										'actions',
									].map((key) => (
										<TableHead
											className="whitespace-nowrap px-4 py-3 font-medium"
											key={key}
										>
											{t(`auth.${key}`)}
										</TableHead>
									))}
								</TableRow>
							</TableHeader>
							<TableBody>
								{users.isPending ? (
									<TableRow>
										<TableCell
											colSpan={7}
											className="p-8 text-center text-muted-foreground"
										>
											{t('auth.loading')}
										</TableCell>
									</TableRow>
								) : users.data?.items.length ? (
									users.data.items.map((user) => (
										<TableRow key={user.id} className="border-b last:border-0">
											<TableCell className="px-4 py-4 font-medium">
												{user.username}
											</TableCell>
											<TableCell className="px-4 py-4">
												{user.display_name || '—'}
											</TableCell>
											<TableCell className="px-4 py-4">
												{t(
													user.role === 'admin'
														? 'auth.admin'
														: 'auth.user',
												)}
											</TableCell>
											<TableCell className="px-4 py-4">
												<Badge
													variant={
														user.status === 'active'
															? 'secondary'
															: 'outline'
													}
												>
													{t(`auth.${user.status}`)}
												</Badge>
											</TableCell>
											<TableCell className="whitespace-nowrap px-4 py-4 text-muted-foreground">
												{date(user.created_at)}
											</TableCell>
											<TableCell className="whitespace-nowrap px-4 py-4 text-muted-foreground">
												{date(user.last_login_at)}
											</TableCell>
											<TableCell className="px-4 py-3">
												{user.role === 'admin' ? (
													<span className="whitespace-nowrap text-xs text-muted-foreground">
														{t('auth.configManaged')}
													</span>
												) : (
													user.status !== 'deleted' && (
														<div className="flex flex-wrap gap-1">
															<Button
																size="sm"
																variant="ghost"
																onClick={() =>
																	setAction({
																		mode: 'edit',
																		user,
																	})
																}
															>
																{t('auth.edit')}
															</Button>
															<Button
																size="sm"
																variant="ghost"
																onClick={() =>
																	setAction({
																		mode: 'reset',
																		user,
																	})
																}
															>
																{t('auth.reset')}
															</Button>
															<Button
																size="sm"
																variant="ghost"
																onClick={() =>
																	setAction({
																		mode: 'toggle',
																		user,
																	})
																}
															>
																{t(
																	user.status === 'active'
																		? 'auth.disable'
																		: 'auth.enable',
																)}
															</Button>
															<Button
																size="sm"
																variant="ghost"
																className="text-destructive"
																onClick={() =>
																	setAction({
																		mode: 'delete',
																		user,
																	})
																}
															>
																{t('auth.delete')}
															</Button>
														</div>
													)
												)}
											</TableCell>
										</TableRow>
									))
								) : (
									<TableRow>
										<TableCell
											colSpan={7}
											className="p-8 text-center text-muted-foreground"
										>
											{t('auth.empty')}
										</TableCell>
									</TableRow>
								)}
							</TableBody>
						</Table>
					</div>
				)}
				<div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
					<span>{t('auth.total', { count: users.data?.total ?? 0 })}</span>
					<div className="flex gap-2">
						<Button
							variant="outline"
							disabled={offset === 0 || users.isFetching}
							onClick={() => setOffset((v) => Math.max(0, v - 20))}
						>
							{t('auth.previous')}
						</Button>
						<Button
							variant="outline"
							disabled={offset + 20 >= (users.data?.total ?? 0) || users.isFetching}
							onClick={() => setOffset((v) => v + 20)}
						>
							{t('auth.next')}
						</Button>
					</div>
				</div>
				{action && (
					<UserDialog
						key={`${action.mode}:${action.user?.id ?? 'new'}`}
						action={action}
						close={() => setAction(null)}
						saved={() => {
							setAction(null);
							if (
								action.mode === 'delete' &&
								users.data?.items.length === 1 &&
								offset
							)
								setOffset((v) => Math.max(0, v - 20));
							void cache.invalidateQueries({ queryKey: ['admin-users'] });
							toast.success(t('auth.saved'));
						}}
					/>
				)}
			</div>
		</main>
	);
}

function UserDialog({
	action,
	close,
	saved,
}: {
	action: Action;
	close: () => void;
	saved: () => void;
}) {
	const { t } = useTranslation();
	const [username, setUsername] = useState(action.user?.username ?? '');
	const [displayName, setDisplayName] = useState(action.user?.display_name ?? '');
	const [password, setPassword] = useState('');
	const [confirm, setConfirm] = useState('');
	const [legacyId, setLegacyId] = useState('');
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const credentials = action.mode === 'create' || action.mode === 'reset';
	const title =
		action.mode === 'toggle'
			? t(action.user?.status === 'active' ? 'auth.disable' : 'auth.enable')
			: t(`auth.${action.mode}`);
	async function submit(event: React.FormEvent) {
		event.preventDefault();
		setError('');
		if (credentials && password !== confirm) {
			setError(t('auth.passwordMismatch'));
			return;
		}
		setBusy(true);
		try {
			switch (action.mode) {
				case 'create':
					await usersApi.create({
						username: username.trim(),
						display_name: displayName.trim(),
						password,
						...(legacyId.trim() ? { legacy_user_id: legacyId.trim() } : {}),
					});
					break;
				case 'edit':
					await usersApi.edit(action.user!.id, {
						username: username.trim(),
						display_name: displayName.trim(),
					});
					break;
				case 'reset':
					await usersApi.reset(action.user!.id, password);
					break;
				case 'delete':
					await usersApi.delete(action.user!.id);
					break;
				case 'toggle':
					await usersApi.edit(action.user!.id, {
						status: action.user!.status === 'active' ? 'disabled' : 'active',
					});
					break;
			}
			saved();
		} catch (e) {
			setError(e instanceof Error ? e.message : t('auth.failed'));
		} finally {
			setBusy(false);
		}
	}
	return (
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open && !busy) close();
			}}
		>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
				<DialogHeader>
					<DialogTitle>
						{title}
						{action.user ? ` · ${action.user.username}` : ''}
					</DialogTitle>
					<DialogDescription>
						{t(
							action.mode === 'delete'
								? 'auth.deleteHint'
								: action.mode === 'toggle'
									? 'auth.toggleHint'
									: credentials
										? 'auth.passwordHint'
										: 'auth.editHint',
						)}
					</DialogDescription>
				</DialogHeader>
				<form className="space-y-4" onSubmit={submit}>
					{(action.mode === 'create' || action.mode === 'edit') && (
						<>
							<div className="space-y-2">
								<Label htmlFor="user-username">{t('auth.username')}</Label>
								<Input
									id="user-username"
									value={username}
									onChange={(e) => setUsername(e.target.value)}
									required
									maxLength={64}
									autoComplete="off"
								/>
								<p className="text-xs text-muted-foreground">
									{t('auth.usernameHint')}
								</p>
							</div>
							<div className="space-y-2">
								<Label htmlFor="user-display">{t('auth.displayName')}</Label>
								<Input
									id="user-display"
									value={displayName}
									onChange={(e) => setDisplayName(e.target.value)}
									maxLength={100}
								/>
							</div>
						</>
					)}
					{credentials && (
						<>
							<div className="space-y-2">
								<Label htmlFor="user-password">{t('auth.newPassword')}</Label>
								<Input
									id="user-password"
									type="password"
									autoComplete="new-password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									required
									minLength={8}
									maxLength={128}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="user-confirm">{t('auth.confirmPassword')}</Label>
								<Input
									id="user-confirm"
									type="password"
									autoComplete="new-password"
									value={confirm}
									onChange={(e) => setConfirm(e.target.value)}
									required
									minLength={8}
									maxLength={128}
								/>
							</div>
						</>
					)}
					{action.mode === 'create' && (
						<Disclosure
							className="rounded-md border p-3 text-sm"
							summary={<>{t('auth.legacy')}</>}
							summaryClassName="cursor-pointer"
						>
							<div className="mt-3 space-y-2">
								<Label htmlFor="legacy-id">{t('auth.legacyId')}</Label>
								<Input
									id="legacy-id"
									value={legacyId}
									onChange={(e) => setLegacyId(e.target.value)}
									maxLength={128}
								/>
								<p className="text-xs text-muted-foreground">
									{t('auth.legacyHint')}
								</p>
							</div>
						</Disclosure>
					)}
					{error && (
						<p role="alert" className="text-sm text-destructive">
							{error}
						</p>
					)}
					<div className="flex justify-end gap-2">
						<Button type="button" variant="outline" onClick={close} disabled={busy}>
							{t('auth.cancel')}
						</Button>
						<Button
							type="submit"
							variant={action.mode === 'delete' ? 'destructive' : 'default'}
							disabled={busy}
						>
							{busy ? t('auth.saving') : title}
						</Button>
					</div>
				</form>
			</DialogContent>
		</Dialog>
	);
}
