import type { AuthSession, AuthUser } from './auth-state';
import { client } from './client';

export const authApi = {
	me: () => client.get<AuthSession>('/auth/me', undefined, { silent: true, timeoutMs: 10_000 }),
	login: (username: string, password: string) =>
		client.post<AuthSession>('/auth/login', { username, password }, undefined, {
			silent: true,
			timeoutMs: 15_000,
		}),
	logout: () => client.post<void>('/auth/logout', undefined, undefined, { silent: true }),
	password: (current_password: string, password: string) =>
		client.post<void>('/auth/password', { current_password, password }, undefined, {
			silent: true,
		}),
};

export const usersApi = {
	list: (q: string, status: string, offset: number) =>
		client.get<{ items: AuthUser[]; total: number }>('/admin/users', {
			q,
			...(status ? { status } : {}),
			offset: String(offset),
			limit: '20',
		}),
	create: (data: {
		username: string;
		display_name: string;
		password: string;
		legacy_user_id?: string;
	}) => client.post<AuthUser>('/admin/users', data, undefined, { silent: true }),
	edit: (
		id: string,
		data: { username?: string; display_name?: string; status?: 'active' | 'disabled' },
	) =>
		client.patch<AuthUser>(`/admin/users/${encodeURIComponent(id)}`, data, undefined, {
			silent: true,
		}),
	reset: (id: string, password: string) =>
		client.post<void>(
			`/admin/users/${encodeURIComponent(id)}/reset-password`,
			{ password },
			undefined,
			{ silent: true },
		),
	delete: (id: string) => client.delete(`/admin/users/${encodeURIComponent(id)}`),
};
