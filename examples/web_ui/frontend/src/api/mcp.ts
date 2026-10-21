import { resourceClient } from './client';
import type { MCPClient, MCPDetail, MCPView, UpdateMCPRequest } from './types';

/**
 * The user's own library of installed MCPs, which is where a hub install
 * lands. Separate from `workspaceApi`, which manages what one session's
 * workspace actually holds.
 */
export function createMCPApi(owner?: string) {
const client = resourceClient(owner);
return {
	list: () => client.get<MCPView[]>('/mcp'),
	get: (mcpId: string) => client.get<MCPDetail>(`/mcp/${encodeURIComponent(mcpId)}`, undefined, { silent: true }),
	create: (body: { client: MCPClient; description?: string; version?: string }) =>
		client.post<MCPView>('/mcp', body, undefined, { silent: true }),

	/**
	 * Renames, enables/disables, or re-keys it. Changing `values` is a
	 * re-render from the saved Hub template without upgrading its version.
	 */
	update: (mcpId: string, body: UpdateMCPRequest, options?: { silent?: boolean }) =>
		client.patch<MCPView>(`/mcp/${encodeURIComponent(mcpId)}`, body, undefined, options),
	upgrade: (mcpId: string) => client.post<MCPView>(`/mcp/${encodeURIComponent(mcpId)}/upgrade`),

	/**
	 * Removes it from the library. Workspaces that already hold this MCP keep
	 * their declarations; new runs exclude the uninstalled resource ID.
	 */
	remove: (mcpId: string) => client.delete(`/mcp/${encodeURIComponent(mcpId)}`),
};
}

export const mcpApi = createMCPApi();
