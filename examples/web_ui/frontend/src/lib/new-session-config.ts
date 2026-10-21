import type { CreateSessionRequest, SessionConfig } from '../api/types';

type ModelOverrides = Pick<
	CreateSessionRequest,
	'chat_model_config' | 'fallback_chat_model_config' | 'realtime_model_config'
>;
type SeedConfig = ModelOverrides & Pick<SessionConfig, 'inherited_fields'>;

/** Keep explicit model choices; omitted inherited fields follow Agent defaults. */
export function newSessionModelOverrides(config?: SeedConfig): ModelOverrides {
	if (!config) return {};
	const inherited = new Set(config.inherited_fields);
	const fields = ['chat_model_config', 'fallback_chat_model_config', 'realtime_model_config'] as const;
	return Object.fromEntries(fields
		.filter((field) => !inherited.has(field) && config[field] !== undefined)
		.map((field) => [field, config[field]])) as ModelOverrides;
}
