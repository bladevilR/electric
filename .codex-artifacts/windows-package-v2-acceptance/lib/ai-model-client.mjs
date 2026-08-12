const DEFAULT_MODEL = 'kimi-k2.6';
const DEFAULT_TIMEOUT_MS = 12000;

function cleanString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function normalizeBaseUrl(value) {
  const base = cleanString(value);
  if (!base) {
    return '';
  }
  const trimmed = base.replace(/\/+$/, '');
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`;
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function numericRows(rows = [], field) {
  return rows.map((row) => numberOrNull(row[field])).filter((value) => value !== null);
}

function summarizePrices(rows = []) {
  const prices = numericRows(rows, 'realTimeAvgPrice');
  if (!prices.length) {
    return { count: 0 };
  }
  return {
    count: prices.length,
    min: Math.min(...prices),
    max: Math.max(...prices),
    avg: prices.reduce((sum, value) => sum + value, 0) / prices.length,
  };
}

function stripError(error) {
  return cleanString(error?.message || error).replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***');
}

export function buildModelConfig(env = process.env) {
  const baseUrl = normalizeBaseUrl(
    env.OPENAI_BASE_URL || env.OPENAI_COMPATIBLE_BASE_URL || env.KIMI_BASE_URL
  );
  const model = cleanString(env.OPENAI_MODEL || env.KIMI_MODEL) || DEFAULT_MODEL;
  const hasApiKey = Boolean(cleanString(env.OPENAI_API_KEY || env.KIMI_API_KEY));

  return {
    provider: 'openai_compatible',
    baseUrl,
    model,
    configured: Boolean(baseUrl && hasApiKey && model),
    hasApiKey,
  };
}

export function buildStrategyModelPrompt({ dataset = {}, date = '', advice = {}, suggestions = [] } = {}) {
  const rows = Array.isArray(dataset.rows) ? dataset.rows.filter((row) => !date || row.date === date) : [];
  const prices = summarizePrices(rows);
  const completeness = dataset.quality?.fieldCompleteness || {};
  const compactSuggestions = suggestions.slice(0, 6).map((item) => ({
    type: item.type,
    title: item.title,
    points: item.points,
    action: item.action,
    executable: item.executable,
    blockingReasons: item.blockingReasons,
  }));

  return [
    '你是江苏电力现货交易的本地决策辅助模型。',
    '只输出观察建议和需要人工复核的风险点，不生成自动下单指令。',
    '不要要求读取登录凭据、浏览器会话、UKey、证书、PIN 或绕过人工确认。',
    '',
    `交易日：${date || '未指定'}`,
    `实时均价统计：${JSON.stringify(prices)}`,
    `字段完整性：${JSON.stringify({
      realTimeAvgPrice: completeness.realTimeAvgPrice || 0,
      actualKwh: completeness.actualKwh || 0,
      settleAmount: completeness.settleAmount || 0,
    })}`,
    `本地策略状态：${JSON.stringify({ adviceStatus: advice.status, suggestions: compactSuggestions })}`,
    '',
    '请用中文给出：1. 价格窗口判断；2. 预测负荷/持仓/交易限额还缺什么；3. 人工确认前的安全边界。',
  ].join('\n');
}

export async function requestStrategyModelPrediction(options = {}) {
  const env = options.env || process.env;
  const config = buildModelConfig(env);
  if (!config.configured) {
    return {
      status: 'disabled',
      ...config,
      reason: 'OpenAI-compatible model settings are not configured.',
    };
  }

  const apiKey = cleanString(env.OPENAI_API_KEY || env.KIMI_API_KEY);
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(env.OPENAI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));

  try {
    const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        max_tokens: 900,
        messages: [
          {
            role: 'system',
            content: '你是电力交易辅助分析模型。必须保持人工确认边界，不输出自动提交交易的指令。',
          },
          {
            role: 'user',
            content: buildStrategyModelPrompt(options),
          },
        ],
      }),
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return {
        status: 'error',
        ...config,
        error: `Model HTTP ${response.status}`,
      };
    }

    const payload = await response.json();
    return {
      status: 'ready',
      provider: config.provider,
      baseUrl: config.baseUrl,
      model: config.model,
      configured: true,
      hasApiKey: true,
      content: cleanString(payload.choices?.[0]?.message?.content),
      usage: payload.usage || null,
    };
  } catch (error) {
    clearTimeout(timeout);
    return {
      status: 'error',
      ...config,
      error: stripError(error),
    };
  }
}
