import assert from 'node:assert/strict';
import test from 'node:test';
import { finalAnalysisDeliveries, latestAnalysisRevisions, registeredAnalyses } from '../src/lib/analysis-deliveries.ts';
import { applyReplyPresentation, presentReply } from '../src/lib/reply-presentation.ts';

const id = 'ana_0123456789abcdef0123456789abcdef';
const path = `./analysis/${id}/revisions/4/analysis.json`;
const analysisRef = `${id}:4`;
const delivery = { type: 'workspace_analysis', registered: true, analysisRef, path };
const response = { analysisRef, publicationState: 'PUBLISHED', delivery };
const call = { type: 'tool_call', id: 'publish', name: 'AnalysisPublish', state: 'finished', input: { analysisRef } };
const result = { type: 'tool_result', id: 'publish', name: 'AnalysisPublish', state: 'success', metadata: { process_summary: { kind: 'analysis', id } }, output: [{ type: 'text', text: JSON.stringify(response) }] };
const message = (content = [call, result], extra = {}) => ({ role: 'assistant', content, ...extra });
const output = (value) => ({ ...result, output: [{ type: 'text', text: JSON.stringify(value) }] });
const expected = [{ analysisRef, path }];
const rejected = { type: 'hint', source: JSON.stringify({ label: 'System', sublabel: 'Completion check' }), hint: '修正' };

function publication(analysisId, revision, callId) {
  const ref = `${analysisId}:${revision}`, target = `./analysis/${analysisId}/revisions/${revision}/analysis.json`;
  return [
    { ...call, id: callId, input: JSON.stringify({ analysisRef: ref }) },
    { ...result, id: callId, metadata: { process_summary: { kind: 'analysis', id: analysisId } },
      output: [{ type: 'text', text: JSON.stringify({ analysisRef: ref, publicationState: 'PUBLISHED',
        delivery: { ...delivery, analysisRef: ref, path: target } }) }] },
  ];
}

test('a successful receipt supplies the card without a model link, live and after reload', () => {
  for (const tail of [[], [{ type: 'text', text: '[查看结果](./analysis/ana_misspelled/revisions/4/analysis.json)' }]]) {
    const m = message([call, result, ...tail]); const before = structuredClone(m);
    assert.deepEqual(registeredAnalyses(m), expected);
    assert.deepEqual(registeredAnalyses(JSON.parse(JSON.stringify({ ...m, finished_at: '2026-10-13' }))), expected);
    assert.deepEqual(m, before);
  }
});

test('duplicate receipts register one card while distinct actual deliveries survive', () => {
  assert.deepEqual(registeredAnalyses(message([call, result, result])), expected);
  const nextRef = `${id}:5`, nextPath = path.replace('/4/', '/5/');
  const nextCall = { ...call, id: 'next', input: JSON.stringify({ analysisRef: nextRef }) };
  const nextResult = { ...output({ ...response, analysisRef: nextRef, delivery: { ...delivery, analysisRef: nextRef, path: nextPath } }), id: 'next' };
  assert.deepEqual(registeredAnalyses(message([call, result, nextCall, nextResult])), [...expected, { analysisRef: nextRef, path: nextPath }]);
});

test('automatic revision shows only the latest card and retains all paths to suppress repeated model links', () => {
  const m = message([
    ...publication(id, 5, 'draft'),
    { type: 'text', id: 'draft-link', text: `[查看结果](./analysis/${id}/revisions/5/analysis.json)` },
    { type: 'hint', source: JSON.stringify({ label: 'System', sublabel: 'Completion check' }), hint: '修正' },
    ...publication(id, 6, 'final'),
    { type: 'text', id: 'final-link', text: `[查看结果](./analysis/${id}/revisions/6/analysis.json)` },
  ]);
  const before = structuredClone(m);
  for (const value of [m, JSON.parse(JSON.stringify({ ...m, finished_at: '2026-10-21' }))]) {
    const deliveries = registeredAnalyses(value);
    assert.deepEqual(latestAnalysisRevisions(deliveries), [
      { analysisRef: `${id}:6`, path: `./analysis/${id}/revisions/6/analysis.json` },
    ]);
    assert.deepEqual(deliveries.map((item) => item.path), [5, 6].map((revision) => `./analysis/${id}/revisions/${revision}/analysis.json`));
  }
  assert.deepEqual(m, before);
});

test('late old delivery inspections and repeated receipts cannot downgrade the final revision', () => {
  const inspect = { ...call, id: 'inspect-old', name: 'AnalysisInspect', input: { section: 'delivery', analysisRef } };
  const inspectResult = { ...output(delivery), id: 'inspect-old', name: 'AnalysisInspect' };
  const deliveries = registeredAnalyses(message([
    ...publication(id, 9, 'nine'), ...publication(id, 10, 'ten'),
    ...publication(id, 9, 'replay'), inspect, inspectResult,
  ]));
  const before = structuredClone(deliveries);
  assert.deepEqual(latestAnalysisRevisions(deliveries), [
    { analysisRef: `${id}:10`, path: `./analysis/${id}/revisions/10/analysis.json` },
  ]);
  assert.deepEqual(deliveries, before);
});

test('distinct analyses and separate replies retain their own cards', () => {
  const otherId = 'ana_fedcba9876543210fedcba9876543210';
  const m = message([...publication(id, 5, 'first'), ...publication(otherId, 1, 'other'), ...publication(id, 6, 'revised')]);
  assert.deepEqual(latestAnalysisRevisions(registeredAnalyses(m)).map((item) => item.analysisRef), [`${id}:6`, `${otherId}:1`]);
  assert.deepEqual(latestAnalysisRevisions(registeredAnalyses(message())), expected);
});

test('an unsuccessful newer revision does not replace the last successful delivery', () => {
  const [newCall, newResult] = publication(id, 5, 'new');
  for (const changed of [{ ...newResult, state: 'error' }, { ...newResult, state: 'running' }]) {
    assert.deepEqual(latestAnalysisRevisions(registeredAnalyses(message([call, result, newCall, changed]))), expected);
  }
  assert.deepEqual(latestAnalysisRevisions([]), []);
});

test('rejected publication is hidden during correction and after failed/interrupted reloads', () => {
  for (const reason of [null, 'error', 'interrupted', 'exceed_max_iters', 'completed']) {
    const m = message([call, result, rejected, { type: 'text', id: 'answer', text: '修正未完成' }], { finished_reason: reason });
    assert.deepEqual(finalAnalysisDeliveries(m), []);
    assert.deepEqual(finalAnalysisDeliveries(JSON.parse(JSON.stringify(m))), []);
    assert.deepEqual(registeredAnalyses(m), expected, 'Keep receipts for history and Markdown link suppression');
    assert.ok(presentReply(m).process.includes(result));
  }
});

test('a terminal incomplete verdict hides publication even without a revision hint', () => {
  for (const status of ['INCOMPLETE', 'BLOCKED']) {
    const m = message([call, result], { finished_reason: 'completed', metadata: { analysisCompletion: { status, analysisRef } } });
    assert.deepEqual(finalAnalysisDeliveries(m), []);
  }
});

test('text-only correction can approve the same published artifact, live and after reload', () => {
  const m = message([call, result, rejected, { type: 'text', id: 'final', text: '已纠正措辞' }], { id: 'reply', finished_reason: 'completed' });
  const completion = { status: 'READY', analysisRef, semanticReview: 'PASS' };
  applyReplyPresentation(m, { type: 'REPLY_END', reply_id: 'reply', metadata: { analysisCompletion: completion } });
  assert.deepEqual(finalAnalysisDeliveries(m), expected);
  assert.deepEqual(finalAnalysisDeliveries(JSON.parse(JSON.stringify(m))), expected);
  assert.deepEqual(m.metadata.analysisCompletion, completion);
});

test('only the final approved revision is presented and new repair receipts wait for approval', () => {
  const other = 'ana_fedcba9876543210fedcba9876543210';
  const m = message([call, result, rejected, ...publication(id, 5, 'repair'), ...publication(other, 1, 'other')]);
  assert.deepEqual(finalAnalysisDeliveries(m), []);
  m.finished_reason = 'completed';
  m.metadata = { analysisCompletion: { status: 'READY', analysisRef: `${id}:5`, semanticReview: 'PASS' } };
  assert.deepEqual(finalAnalysisDeliveries(m).map(d => d.analysisRef), [`${id}:5`]);
  m.content.push(...publication(id, 6, 'unreviewed'));
  assert.deepEqual(finalAnalysisDeliveries(m).map(d => d.analysisRef), [`${id}:5`], 'Largest revision is not necessarily approved');
});

test('partial approved results survive but missing receipts, failed reviews and stale passes do not', () => {
  for (const status of ['READY', 'PARTIAL']) {
    const m = message([call, result, rejected], { finished_reason: 'completed', metadata: { analysisCompletion: { status, analysisRef, semanticReview: 'PASS' } } });
    assert.deepEqual(finalAnalysisDeliveries(m), expected);
    for (const reason of [null, 'error', 'interrupted', 'exceed_max_iters']) {
      assert.deepEqual(finalAnalysisDeliveries({ ...m, finished_reason: reason }), []);
    }
    for (const semanticReview of [undefined, 'REVISE', 'UNAVAILABLE']) {
      assert.deepEqual(finalAnalysisDeliveries({ ...m, metadata: { analysisCompletion: { status, analysisRef, semanticReview } } }), []);
    }
    assert.deepEqual(finalAnalysisDeliveries({ ...m, content: [] }), [], 'A verdict cannot fabricate a delivery');
  }
});

test('conversations without completion protocol retain deduplication and distinct results', () => {
  const other = 'ana_fedcba9876543210fedcba9876543210';
  const m = message([...publication(id, 4, 'old'), ...publication(id, 5, 'latest'), ...publication(other, 1, 'other')]);
  const before = structuredClone(m);
  assert.deepEqual(finalAnalysisDeliveries(m).map(d => d.analysisRef), [`${id}:5`, `${other}:1`]);
  assert.deepEqual(m, before);
});

test('preview, failed, incomplete and unregistered results cannot publish cards', () => {
  for (const changed of [
    { ...result, state: 'error' }, { ...result, state: 'running' },
    output({ ...response, previewOnly: true }), output({ ...response, publicationState: 'DRAFT' }),
    output({ ...response, error: { code: 'FAILED' } }),
    output({ ...response, delivery: { ...delivery, registered: false } }),
    { ...result, output: [{ type: 'text', text: '{' }] },
    { ...result, output: JSON.stringify(response) },
    { ...result, output: [{ type: 'text', text: `[查看结果](${path})` }] },
  ]) assert.deepEqual(registeredAnalyses(message([call, changed])), []);
  assert.deepEqual(registeredAnalyses(message([{ ...call, input: { analysisRef, previewOnly: true } }, result])), []);
});

test('only paired built-in tool calls with analysis metadata supply cards', () => {
  assert.deepEqual(registeredAnalyses(message([result])), []);
  assert.deepEqual(registeredAnalyses(message([call, { ...result, metadata: {} }])), []);
  assert.deepEqual(registeredAnalyses(message(undefined, { role: 'user' })), []);
  for (const name of ['Read', 'mcp__external__AnalysisPublish', 'AnalysisBuild']) {
    assert.deepEqual(registeredAnalyses(message([{ ...call, name }, { ...result, name }])), []);
  }
  assert.deepEqual(registeredAnalyses(message([call, { ...result, name: 'Read' }])), []);
});

test('canonical path, revision and analysis identity must agree', () => {
  for (const changed of [
    { ...delivery, path: path.replace('/4/', '/04/') }, { ...delivery, path: 'https://other.invalid/' + path },
    { ...delivery, path: path + '?x=1' }, { ...delivery, path: path.replace(id, 'ana_short') },
    { ...delivery, analysisRef: `${id}:5` }, { ...delivery, type: 'tool_markdown' },
  ]) assert.deepEqual(registeredAnalyses(message([call, output({ ...response, delivery: changed })])), []);
  assert.deepEqual(registeredAnalyses(message([call, output({ ...response, analysisRef: `${id}:5` })])), []);
  assert.deepEqual(registeredAnalyses(message([{ ...call, input: { analysisRef: `${id}:5` } }, result])), []);
  assert.deepEqual(registeredAnalyses(message([call, { ...result, metadata: { process_summary: { kind: 'analysis', id: 'another' } } }])), []);
});

test('an explicit delivery inspection can restore the card but ordinary inspection cannot', () => {
  const inspectCall = { ...call, name: 'AnalysisInspect', input: JSON.stringify({ section: 'delivery', analysisRef }) };
  const inspectResult = { ...output(delivery), name: 'AnalysisInspect' };
  assert.deepEqual(registeredAnalyses(message([inspectCall, inspectResult])), expected);
  assert.deepEqual(registeredAnalyses(message([{ ...inspectCall, input: { section: 'facts' } }, inspectResult])), []);
  assert.deepEqual(registeredAnalyses(message([{ ...inspectCall, input: { section: 'delivery', analysisRef: `${id}:5` } }, inspectResult])), []);
});
