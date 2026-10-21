import test from 'node:test';
import assert from 'node:assert/strict';
import {modelDiagnostics,replyErrorKey} from '../src/lib/reply-diagnostics.ts';
const diagnostics={callId:'a'.repeat(32),phase:'stream',failureKind:'protocol',elapsedMs:100,attempt:1};
test('stream interruption, timeout and HTTP failures remain distinct',()=>{
  assert.equal(replyErrorKey({type:'connection',diagnostics}),'connection_stream');
  assert.equal(replyErrorKey({type:'connection',diagnostics:{...diagnostics,failureKind:'timeout'}}),'connection_timeout');
  assert.equal(replyErrorKey({type:'connection',diagnostics:{...diagnostics,phase:'request'}}),'connection_protocol');
  assert.equal(replyErrorKey({type:'invalid_request',diagnostics}),'invalid_request');
});
test('diagnostics expose only validated correlation data',()=>{
  assert.deepEqual(modelDiagnostics({diagnostics:{...diagnostics,request:'private'}}),diagnostics);
  assert.equal(modelDiagnostics({diagnostics:{...diagnostics,elapsedMs:NaN}}),null);
  assert.equal(modelDiagnostics({diagnostics:{...diagnostics,callId:'untrusted'}}),null);
  assert.equal(replyErrorKey({type:'connection'}),'connection');
});

test('bounded completion failures show their actionable reason instead of an internal-error label', async () => {
  const { createInstance } = await import('i18next');
  const { readFileSync } = await import('node:fs');
  const translations = JSON.parse(readFileSync(new URL('../src/i18n/locales/zh.json', import.meta.url), 'utf8'));
  const i18n = createInstance();
  await i18n.init({ lng: 'zh', resources: { zh: { translation: translations } } });
  const error = { type: 'completion_check', message: '分析尚未通过完成检查。未完成项：来源核验未完成。' };
  assert.equal(i18n.t(`messageBubble.error.${replyErrorKey(error)}`, { defaultValue: error.message }), error.message);
  assert.notEqual(i18n.t('messageBubble.error.internal'), error.message);
});
