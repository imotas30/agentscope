import assert from 'node:assert/strict';
import test from 'node:test';
import { newSessionModelOverrides } from '../src/lib/new-session-config.ts';

const primary = { type: 'openai_credential', credential_id: 'fixture', model: 'primary', parameters: {} };
const fallback = { ...primary, model: 'fallback' };
const realtime = { ...primary, type: 'openai_realtime', model: 'voice' };
const fields = ['chat_model_config', 'fallback_chat_model_config', 'realtime_model_config'];
const configured = { chat_model_config: primary, fallback_chat_model_config: fallback, realtime_model_config: realtime };

test('inherited resolved models are omitted from a new-session request', () => {
	const config = { ...configured, inherited_fields: fields };
	const before = structuredClone(config);
	assert.deepEqual(newSessionModelOverrides(config), {});
	assert.deepEqual(config, before);
});

test('each field keeps its own inheritance while explicit choices survive', () => {
	for (const field of fields) {
		const expected = { ...configured };
		delete expected[field];
		assert.deepEqual(newSessionModelOverrides({ ...configured, inherited_fields: [field] }), expected);
	}
});

test('explicit null remains an override while inherited null stays omitted', () => {
	for (const field of fields) {
		assert.deepEqual(newSessionModelOverrides({ [field]: null, inherited_fields: [] }), { [field]: null });
		assert.deepEqual(newSessionModelOverrides({ [field]: null, inherited_fields: [field] }), {});
	}
});

test('legacy sessions keep their explicit choices and no seed leaves defaults to the server', () => {
	assert.deepEqual(newSessionModelOverrides(configured), configured);
	assert.deepEqual(newSessionModelOverrides({ ...configured, inherited_fields: [] }), configured);
	assert.deepEqual(newSessionModelOverrides(), {});
	assert.deepEqual(newSessionModelOverrides({}), {});
});

test('new chats do not copy unrelated session or permission settings', () => {
	assert.deepEqual(newSessionModelOverrides({ ...configured, inherited_fields: ['permission_mode'],
		workspace_id: 'old-workspace', name: 'old-name', permission_mode: 'bypass',
		tts_model_config: primary, knowledge_config: { knowledge_base_ids: ['private'] } }), configured);
});
