import { COMPETITION_MODEL } from './competition-agent.mjs';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const OFFICIAL_UPLOAD_FILES = Object.freeze(['information.json', 'traces-dynamic.json', 'traces.json']);

function attrs(list = []) { return Object.fromEntries(list.map((item) => [item.key, item.value?.stringValue ?? item.value?.intValue ?? item.value?.boolValue])); }
function spans(document) { return (document.resourceSpans || []).flatMap((resource) => (resource.scopeSpans || []).flatMap((scope) => scope.spans || [])).map((span) => ({ ...span, values: attrs(span.attributes) })); }
function parseInput(value) {
  const messages = JSON.parse(value || '[]');
  return messages.flatMap((message) => message.parts || []).map((part) => part.content || '').filter(Boolean).join('\n');
}

export function buildCompetitionInformation(document, { endpoint }) {
  const all = spans(document);
  const root = all.find((item) => !item.parentSpanId && item.values['gen_ai.operation.name'] === 'invoke_agent');
  if (!root) throw new Error('静态 Trace 缺少 invoke_agent 根 Span');
  const tool = all.find((item) => item.traceId === root.traceId && item.values['gen_ai.operation.name'] === 'execute_tool');
  const memoryCreate = all.find((item) => item.values['gen_ai.operation.name'] === 'create_memory');
  const memorySearch = all.find((item) => item.values['gen_ai.operation.name'] === 'search_memory');
  if (!tool || !memoryCreate || !memorySearch) throw new Error('静态 Trace 缺少工具或记忆证据');
  const memoryFields = ['gen_ai.conversation.id', 'gen_ai.memory.store.id', 'gen_ai.memory.records'];
  if (memoryFields.some((field) => !memoryCreate.values[field] || memoryCreate.values[field] !== memorySearch.values[field])) {
    throw new Error('静态 Trace 的记忆链路不一致：create/search 必须共享 conversation、store 和 record');
  }
  const instruction = parseInput(root.values['gen_ai.input.messages']);
  return {
    business_intent_examples: [{ case_id: 'C1-electricity-analysis', instruction, expected_result: {
      required_fields: ['status', 'summary', 'data_source', 'price_windows', 'data_gaps', 'human_review'],
      expected_values: {
        status: '必须反映真实数据门禁状态，数据不足时不得写成已就绪', summary: '必须明确说明是仓库样例数据的只读分析',
        data_source: '必须等于 repository_sample', price_windows: '必须包含 low 和 high 点位数组',
        data_gaps: '必须是实际缺失证据数组', human_review: '必须声明 human_decision_only、auto_submit=false、executable=false',
      },
    } }],
    inference_task_examples: [{ case_id: 'C2-sample-safety-gate', instruction, scenario_facts: { data_source: 'repository_sample', auto_submit: false },
      business_rules: [
        { rule_id: 'R1', condition: 'data_source == repository_sample', conclusion: 'must_disclose_sample = true' },
        { rule_id: 'R2', condition: 'readiness != decision_support_ready', conclusion: 'must_not_claim_executable = true' },
      ], expected_inference: { required_facts: ['data_source', 'auto_submit'], applicable_rules: ['R1', 'R2'], expected_conclusion: '仅输出样例数据的只读分析和人工复核清单，不生成可执行交易或真实收益结论' } }],
    task_log_evidence_examples: [{ submission_task_id: 'E1-electricity-analysis', trace_id: root.traceId, task_description: instruction,
      declared_stages: [
        { stage_name: '接收并解析任务', stage_evidence_span_ids: [root.spanId] },
        { stage_name: '读取电力分析上下文', stage_evidence_span_ids: [tool.spanId] },
        { stage_name: '应用数据和人工决策门禁并返回结果', stage_evidence_span_ids: [root.spanId] },
      ], deliverable_reference: 'gen_ai.output.messages', deliverable_hash: `sha256:${createHash('sha256').update(String(root.values['gen_ai.output.messages'] || '')).digest('hex')}`,
      process_handoff_evidence: [{ source_span_id: tool.spanId, used_by_span_id: root.spanId, description: '工具读取的策略、数据缺口和就绪状态用于根 Span 最终答复' }] }],
    tool_skill_examples: [{ tool_or_skill_name: 'load_trading_analysis_context', aliases: [], purpose: '读取指定交易日的价格信号、数据缺口、策略建议和人工决策就绪状态', parameter_mode: 'structured', input_parameters: [{ name: 'date', type: 'string', required: true }], success_return_type: 'object', failure_return_form: { type: 'http_error', description: '领域上下文在工具执行前加载失败时返回 OpenAI-compatible HTTP 错误；不伪造工具返回或成功 Span' } }],
    memory_capability_examples: [{ memory_name: '会话分析偏好', memory_description: '在显式会话标识内记住非敏感的分析展示偏好，并在后续分析中使用', memory_source_field_paths: ['gen_ai.memory.records', 'gen_ai.conversation.id'], memory_use_field_paths: ['gen_ai.memory.records', 'gen_ai.output.messages'], memory_link_field_paths: ['gen_ai.conversation.id', 'gen_ai.memory.store.id'], success_description: `create_memory Span ${memoryCreate.spanId} 形成偏好，search_memory Span ${memorySearch.spanId} 在同会话中取回并应用` }],
    api: { protocol: 'openai_chat_completions', endpoint, model: COMPETITION_MODEL, authentication: { method: 'none' }, request_template: {}, response_mapping: { output_text_path: 'choices.0.message.content' }, trace_mapping: { trace_id_header: 'traceparent', trace_id_response_path: 'trace_id' } },
  };
}

export function reconcileDynamicTraces(report, document) {
  if (report?.summary?.total !== 3 || report?.summary?.succeeded !== 3 || report?.summary?.failed !== 0 || report.tests?.length !== 3) throw new Error('动态评测必须 3/3 成功');
  if (report.tests.some((item) => item.status !== 'succeeded' || item.http_status !== 200)) throw new Error('动态评测逐条结果必须全部成功且 HTTP 200');
  const expectedTraceIds = report.tests.map((item) => item.trace_id).filter(Boolean).sort();
  if (expectedTraceIds.length !== 3 || new Set(expectedTraceIds).size !== 3) throw new Error('动态评测的 3 个 Trace ID 必须非空且唯一');
  const actualTraceIds = spans(document).filter((item) => !item.parentSpanId).map((item) => item.traceId).sort();
  const missing = expectedTraceIds.filter((id) => !actualTraceIds.includes(id));
  const unexpected = actualTraceIds.filter((id) => !expectedTraceIds.includes(id));
  if (missing.length || unexpected.length || actualTraceIds.length !== 3) throw new Error(`动态 Trace 对账失败：missing=${missing.join(',')} unexpected=${unexpected.join(',')}`);
  return { ok: true, expectedTraceIds, actualTraceIds, missing, unexpected };
}

export async function assertExactUploadInventory(directory) {
  const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  const actual = entries.map((item) => item.name);
  if (JSON.stringify(actual) !== JSON.stringify(OFFICIAL_UPLOAD_FILES) || entries.some((item) => !item.isFile())) {
    const described = entries.map((item) => `${item.name}${item.isFile() ? '' : `(${item.isDirectory() ? '目录' : '非普通文件'})`}`);
    throw new Error(`正式上传目录必须精确包含三个普通文件 ${OFFICIAL_UPLOAD_FILES.join('、')}；实际为 ${described.join('、') || '空'}`);
  }
  return actual;
}

export async function assertSafeSubmissionContent(directory) {
  const findings = [];
  const documents = [];
  const patterns = [
    ['凭证占位符 YOUR_TOKEN', /YOUR_TOKEN/i],
    ['示例域名 example.com', /example\.com/i],
    ['私钥正文', /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/i],
    ['疑似 OpenAI 密钥', /\bsk-[A-Za-z0-9_-]{12,}\b/],
    ['未完成占位符', /\b(?:TODO|TBD|FIXME)\b/i],
    ['模板变量占位符', /\$\{[^}]+\}|\{\{[^}]+\}\}|<YOUR[_A-Z0-9-]*>/i],
    ['Bearer 凭证', /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i],
    ['Cookie 凭证', /\bCookie\s*:\s*\S+/i],
  ];
  for (const name of OFFICIAL_UPLOAD_FILES) {
    const text = await readFile(path.join(directory, name), 'utf8');
    let document;
    try { document = JSON.parse(text); } catch (error) { throw new Error(`${name} 不是合法 JSON：${error.message}`); }
    documents.push({ name, document, text });
    for (const [label, pattern] of patterns) {
      if (pattern.test(text)) findings.push(`${name}: ${label}`);
    }
  }
  const sensitiveKeys = new Set(['authorization', 'password', 'passwd', 'token', 'accesstoken', 'apikey', 'secret', 'cookie', 'privatekey']);
  const walk = (value, file, currentPath = '$') => {
    if (Array.isArray(value)) return value.forEach((item, index) => walk(item, file, `${currentPath}[${index}]`));
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (sensitiveKeys.has(normalized) && item !== null && item !== '' && item !== false) findings.push(`${file}: 敏感字段 ${currentPath}.${key}`);
      walk(item, file, `${currentPath}.${key}`);
    }
  };
  documents.forEach(({ name, document }) => walk(document, name));
  const sample = documents.some(({ text }) => text.includes('repository_sample'));
  if (sample) {
    const positiveKeys = new Set(['productionready', 'executable', 'autosubmit', 'realizedsavingsclaimed']);
    const findClaims = (value, file, currentPath = '$') => {
      if (Array.isArray(value)) return value.forEach((item, index) => findClaims(item, file, `${currentPath}[${index}]`));
      if (!value || typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) {
        const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (positiveKeys.has(normalized) && item === true) findings.push(`${file}: 样例数据不得声明 ${currentPath}.${key}=true`);
        findClaims(item, file, `${currentPath}.${key}`);
      }
    };
    documents.forEach(({ name, document, text }) => {
      findClaims(document, name);
      if (/已自动(?:下单|申报)|已实现(?:真实)?收益|生产环境已就绪/.test(text)) findings.push(`${name}: 样例数据包含生产或已实现收益声明`);
    });
  }
  if (findings.length) throw new Error(`正式材料包含占位符或敏感内容：${findings.join('；')}`);
  return { ok: true, findings: [] };
}

export function assertOfficialTraceValidationReport(report) {
  if (!report || report.valid !== true || report.input_format_valid !== true || report.genai_fields_valid !== true || report.evaluation_compatible !== true || report.trace_integrity_valid !== true || report.error_count !== 0) {
    throw new Error('官方 Trace 校验报告未通过完整成功语义门禁');
  }
  return report;
}

export function assertOfficialInformationValidationReport(report) {
  if (!report || report.verdict !== '可提交' || report.status !== 'pass' || report.summary?.error_count !== 0) {
    throw new Error('官方 information 校验报告未通过完整成功语义门禁');
  }
  return report;
}

export function buildDataProvenance({ sourcePath, dataSource }) {
  const sample = dataSource === 'repository_sample';
  return {
    data_source: dataSource,
    source_path: sourcePath,
    is_repository_sample: sample,
    production_ready: false,
    executable_trading_output: false,
    realized_savings_claimed: false,
    human_review_required: true,
    statement: sample
      ? '本次材料基于仓库样例数据，仅用于竞赛能力与日志格式评测；不代表真实生产数据、可执行交易指令或已实现收益。'
      : '本次材料用于竞赛能力与日志格式评测；任何业务执行仍须人工复核。',
  };
}

async function sha256(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

export async function buildSha256Manifest(directory) {
  const result = {};
  for (const name of OFFICIAL_UPLOAD_FILES) result[name] = await sha256(path.join(directory, name));
  return result;
}

export async function verifySha256Manifest(directory, manifest) {
  const mismatches = [];
  for (const name of OFFICIAL_UPLOAD_FILES) {
    const actual = await sha256(path.join(directory, name));
    if (manifest?.[name] !== actual) mismatches.push({ file: name, expected: manifest?.[name] || null, actual });
  }
  return { ok: mismatches.length === 0, mismatches };
}
