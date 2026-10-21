"""One owner context for capture, analysis tools and protocol guidance."""

import asyncio
import json

from agentscope.middleware import MiddlewareBase
from agentscope.message import Msg, HintBlock
from agentscope.event import ReplyEndEvent, HintBlockEvent
from agentscope.types import ReplyFinishedReason, ErrorInfo, ErrorType
from agentscope.tool import ToolChoice

from .capture import ReceiptCapture
from .service import AnalysisService
from .tools import AnalysisTask, AnalysisBuild, AnalysisInspect, AnalysisPublish, AnalysisRenderReport, AnalysisFollowUp, QueryResultRead
from .capture import leased_mcp_origin
from .models import AnalysisError, digest
from .actions import readonly_capability
from .turn_completion import (TurnCompletion, current_turn, candidate_text, review_answer,
    review_query_answer, query_evidence, issue, REVIEW_PROMPT, QUERY_REVIEW_PROMPT)


class AnalysisMiddleware(MiddlewareBase):
    def __init__(self, store, owner, resource_ids, authorize, rules=None, number_formats=None, skill_versions=None, delivery=None, actions_enabled=False, finding_rules=None, sources=None):
        self.capture = ReceiptCapture(store, owner, frozenset(resource_ids), authorize, number_formats, sources)
        self.service = AnalysisService(store, owner, authorize, rules, skill_versions, delivery, actions_enabled, finding_rules, sources=sources)
        self.capture.action_ref_provider = lambda: self.service.actions.active_ref
        self.service.turn = None
        self.answer_reviewer = review_answer
        self.query_reviewer = review_query_answer

    async def on_reply(self, agent, input_kwargs, next_handler):
        runtime = self.service.actions
        terminal_error = None
        if agent is not None and hasattr(getattr(agent, 'state', None), 'middle_context'):
            saved = current_turn(agent.state, input_kwargs.get('inputs'))
            self.service.turn = TurnCompletion(self.service, saved) if saved else None
        if self.service.actions_enabled:
            await self.service.authorize()
            runtime.store.recover_action_runs(runtime.owner)
            inputs = input_kwargs.get("inputs")
            messages = inputs if isinstance(inputs, list) else [inputs]
            users = [m for m in messages if isinstance(m, Msg) and m.role == "user"]
            runtime.user_text = "\n".join(b.text for m in users for b in m.content if getattr(b, "type", None) == "text")
            runtime.turn_ref = digest([m.id for m in users]) if users and all(b.type == "text" for m in users for b in m.content) else None

            async def capabilities():
                available = await agent.toolkit._get_available_tools([g.name for g in agent.toolkit.tool_groups])
                found = []
                for registration in available.values():
                    tool = registration.tool
                    origin = leased_mcp_origin(tool, self.capture.resource_ids)
                    capability = readonly_capability(tool, origin, self.capture.sources)
                    if capability:
                        found.append(capability)
                return found
            runtime.capability_provider = capabilities
        try:
            async for event in next_handler(**input_kwargs):
                if isinstance(event, ReplyEndEvent) and self.service.turn is not None:
                    if event.finished_reason == ReplyFinishedReason.COMPLETED:
                        status = await self._check_end(agent)
                        self.service.turn.state['lastCheck'] = status
                        event.metadata['analysisCompletion'] = {k: v for k, v in status.items() if k in ('status', 'analysisRef', 'semanticReview')}
                        if status['status'] == 'INCOMPLETE':
                            saved = self.service.turn.state
                            if saved['nudges'] >= 3 or agent.state.cur_iter >= agent.react_config.max_iters:
                                event.finished_reason = ReplyFinishedReason.ERROR
                                event.error = ErrorInfo(type=ErrorType.COMPLETION_CHECK, message='答复尚未通过完成检查，已停止本次自动补做。未完成项：' + '；'.join(i['message'] for i in status['issues'])[:1600])
                                terminal_error = event.error
                            else:
                                saved['nudges'] += 1
                                instruction = '<system-reminder>本轮尚未完成。这是宿主内部检查，不是用户的新问题。核对以下问题与实际来源，局部修正后直接回应原始用户请求，不复述内部登记、文件检查或修订过程，不称“你指出”。保持本轮类型与目标：DIRECT 仍用普通查询答复，不新增分析或报告；ANALYSIS/REPORT 不得降级绕过。不删减目标，不因措辞润色扩大取数或分析范围。工具参数错误先读协议修正；真实外部障碍可用 AnalysisTask(blocked) 引用失败调用并说明。\n' + json.dumps(status, ensure_ascii=False) + '</system-reminder>'
                                hint = HintBlock(hint=instruction, source=json.dumps({'label': 'System', 'sublabel': 'Completion check'}))
                                agent.state.append_context(agent.name, [hint])
                                yield HintBlockEvent(reply_id=agent.state.reply_id, block_id=hint.id, source=hint.source, hint=instruction)
                                continue
                    else:
                        # Interrupted/error/limited replies have no final approval.
                        # Persist the same terminal verdict as the stream, rather
                        # than reusing a check from an earlier candidate/resume.
                        status = {'status': 'INCOMPLETE', 'reason': (
                            'ITERATION_LIMIT' if event.finished_reason == ReplyFinishedReason.EXCEED_MAX_ITERS
                            else str(event.finished_reason))}
                        if self.service.turn.state.get('analysisRef'):
                            status['analysisRef'] = self.service.turn.state['analysisRef']
                        self.service.turn.state['lastCheck'] = status
                        event.metadata['analysisCompletion'] = status.copy()
                if isinstance(event, Msg) and self.service.turn is not None:
                    if terminal_error is not None:
                        event.finished_reason, event.error = ReplyFinishedReason.ERROR, terminal_error
                    checked = self.service.turn.state.get('lastCheck')
                    if checked:
                        event.metadata['analysisCompletion'] = {k: v for k, v in checked.items() if k in ('status', 'analysisRef', 'semanticReview', 'reason')}
                    # The candidate Msg was assembled before the independent
                    # review; retain that review's actual token usage too.
                    event.usage = agent._get_reply_usage()
                reason = str(getattr(event, "finished_reason", ""))
                if reason == "interrupted":
                    runtime.finish("CANCELLED", "USER_OR_HOST_INTERRUPTED")
                elif reason == "error":
                    runtime.finish("FAILED", "HOST_REPLY_FAILED")
                yield event
        except (asyncio.CancelledError, GeneratorExit):
            runtime.finish("CANCELLED", "USER_OR_HOST_INTERRUPTED")
            raise
        except Exception:
            runtime.finish("FAILED", "HOST_REPLY_FAILED")
            raise
        finally:
            runtime.finish()

    async def _check_end(self, agent):
        turn = self.service.turn
        await self.service.authorize()
        status = turn.check()
        if status['status'] not in ('DIRECT', 'READY', 'PARTIAL'):
            return status
        if status['status'] == 'DIRECT':
            try:
                artifact = query_evidence(turn)
            except AnalysisError as exc:
                return {**status, 'status': 'INCOMPLETE', 'semanticReview': 'UNAVAILABLE',
                        'issues': [issue(exc.code, str(exc))]}
            if artifact is None:
                return status
            reviewer, prompt = self.query_reviewer, QUERY_REVIEW_PROMPT
            from .models import json_values
            evidence_key = digest(json_values(artifact))
        else:
            artifact = self.service.store.get_analysis(self.service.owner, status['analysisRef'])
            reviewer, prompt = self.answer_reviewer, REVIEW_PROMPT
            evidence_key = status['analysisRef']
        answer = candidate_text(agent)
        key = digest([evidence_key, answer, prompt])
        cached = next((r for r in turn.state['reviews'] if r['key'] == key), None)
        if cached is None:
            try:
                verdict = await reviewer(agent, turn, artifact, answer)
                from jsonschema import validate
                from .turn_completion import REVIEW_SCHEMA
                validate(verdict, REVIEW_SCHEMA)
                cached = {'key': key, 'analysisRef': status.get('analysisRef'), 'issues': verdict['issues']}
                turn.state['reviews'] = [*turn.state['reviews'][-7:], cached]
            except asyncio.CancelledError:
                raise
            except AnalysisError as exc:
                return {**status, 'status': 'INCOMPLETE', 'semanticReview': 'UNAVAILABLE',
                        'issues': [issue(exc.code, str(exc))]}
            except Exception as exc:
                # A failed review never becomes a successful or cached verdict.
                return {**status, 'status': 'INCOMPLETE', 'semanticReview': 'UNAVAILABLE',
                        'issues': [issue('REVIEW_UNAVAILABLE', '本轮证据审查未完成；再次检查或如实说明受阻，不能宣称自审通过。', errorType=type(exc).__name__)]}
        if cached['issues']:
            return {**status, 'status': 'INCOMPLETE', 'semanticReview': 'REVISE', 'issues': cached['issues']}
        return {**status, 'semanticReview': 'PASS'}

    async def on_reasoning(self, agent, input_kwargs, next_handler):
        turn = self.service.turn
        if turn is not None and not turn.state.get('mode'):
            if not turn.state.get('declarationHint'):
                agent.state.append_context(agent.name, [HintBlock(hint='先调用 AnalysisTask 声明当前用户的任务类型与目标。DIRECT 用于普通查询、排序、简单统计、一般答复或必要澄清；ANALYSIS 用于明确的分析请求；REPORT 用于明确的报告请求。只依据本轮意图和上下文选择，不因负值、公式、层级或工具可用就升级任务。')])
                turn.state['declarationHint'] = True
            # Filtering with auto also works for providers that reject a named
            # forced tool while reasoning is enabled. The end guard still
            # rejects a text-only reply without a declaration.
            input_kwargs = {**input_kwargs, 'tool_choice': ToolChoice(mode='auto', tools=['AnalysisTask'])}
        async for event in next_handler(**input_kwargs):
            yield event

    async def on_check_permission(self, agent, input_kwargs, next_handler):
        decision = await next_handler(**input_kwargs)
        if self.service.actions.active_ref and str(decision.behavior).lower().split(".")[-1] == "deny":
            self.service.actions.finish("FAILED", "SOURCE_PERMISSION_DENIED")
        return decision

    async def on_acting(self, agent, input_kwargs, next_handler):
        async for event in self.capture.run(agent, input_kwargs, next_handler):
            if self.service.turn is not None:
                self.service.turn.observe(input_kwargs['tool_call'], event)
            yield event

    async def list_tools(self):
        result = [AnalysisTask(self.service), QueryResultRead(self.service), AnalysisBuild(self.service), AnalysisInspect(self.service), AnalysisPublish(self.service)]
        if self.service.actions_enabled:
            result.append(AnalysisFollowUp(self.service))
        if self.service.delivery is not None and self.service.delivery.allow_reports:
            result.append(AnalysisRenderReport(self.service))
        return result

    async def on_system_prompt(self, agent, current_prompt):
        prompt = current_prompt + "\n\n统一结果宿主协议 v1：能力由宿主配置提供，Skill 指导何时使用，Skill 名称不决定工具装配。已授权且登记适配器的来源完整响应自动保存；预算 v2 原生接入，其他 MCP 的正常调用不受分析适配影响。大回执以 captured_query_result 返回摘要及 omitted 路径，QueryResultRead 可直接只读当前会话原回执，无需构建分析；读取分页不代替来源完整性。普通查询、筛选、排序和简单统计默认直接用文字或普通 Markdown 表格答复，不加载报告流程，不调用 AnalysisBuild/AnalysisPublish；排序用 SortRecords，计算用 Calculate。仅在用户要求分析、图表、结构化卡片或报告时使用相应 Skill 与构建发布能力。AnalysisInspect 提供会话索引，AnalysisBuild/AnalysisPublish 保存并展示模型明确选择的范围。发布只有 delivery.registered=true 才原样使用 delivery.markdown，不自行改链接。"
        prompt += '\n每个真实用户轮先用 AnalysisTask 声明 DIRECT/ANALYSIS/REPORT 及本轮目标；这是任务登记，不是业务分析。分析须有明确 workPlan、实际执行结果和适用的来源核验；结束前宿主检查并在遗漏时要求继续。不能通过直接文字结束绕过任务。AnalysisTask(status) 可读取当前缺项。公式、层级及其他方法按问题和来源选择，无默认业务检查清单。完成检查还会基于实际事实、计算、页面文字与最终答复审查证据边界；该审查不等于视觉验收或语义正确性的保证。查询、分析和报告均保留来源原值；单位缺失时单位显示为空，不添加“未注明”或“来源未提供单位”等说明，用户明确问单位时才解释；不推定货币、数量级或擅自换算。'
        prompt += '\n查询与分析的对象范围必须由用户条件和实际来源字段、关系确定；不能仅凭名称、编号或标签样式排除成员、改变层级或另造对象类型。要求全部成员时保留来源枚举的完整集合；后续筛选应逐个按实际值或来源字段判定，不继承历史助手无依据的分类。来源无法确认某种业务归属时如实保留不确定性，不把它解释为已证明不在范围内。分析构建有对应完整枚举来源时声明 scope.population；仅移动到 referenceMembers 不会改变用户要求覆盖的范围。'
        prompt += '\n结论必须与实际证据相称：数值相等或相关不直接证明构成、贡献或因果；比例和调整幅度不直接证明可控性或实施难度。条件测算明确保持不变项，百分比始终说明真实分母，不把一个指标的比率说成另一个指标的变化幅度。没有依据时保留数值比较和待核实边界，不补造原因或扩大业务调查。'
        if self.service.delivery is not None and self.service.delivery.allow_reports:
            prompt += "\n已启用独立报告能力：需要报告且已选择相关 Skill 时读取 report-generation，先确定用户所指的完整范围；综合多轮内容先按其 report-scope 指引汇集查询及分析主题，构建、发布覆盖这些主题的结果，再调用 AnalysisRenderReport。报告可以来自查询结果或分析结果，固定 analysisRef 只标识已发布的结构化结果；不要求为了出报告先开展分析。按已选报告 Skill 或用户要求编写 HTML，通过 document.bindings 绑定真实数值；预览发布后冻结页面，卡片与报告导出复用同一内容及登记入口。"
        if self.service.actions_enabled:
            prompt += "\n已启用分析追问能力：带行动引用的真实用户追问已选择 data-analysis 时先读其 actions-and-follow-up，再调用 AnalysisFollowUp；分析方法和行动选择遵循该 Skill。"
        return prompt
