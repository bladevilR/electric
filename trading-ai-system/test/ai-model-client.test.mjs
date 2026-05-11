import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildModelConfig,
  requestStrategyModelPrediction,
} from '../lib/ai-model-client.mjs';

test('buildModelConfig normalizes OpenAI-compatible Kimi settings without leaking the key', () => {
  const config = buildModelConfig({
    OPENAI_BASE_URL: 'https://kimi.a7m.com.cn',
    OPENAI_API_KEY: 'sk-local-secret',
    OPENAI_MODEL: 'kimi-k2.6',
  });

  assert.equal(config.provider, 'openai_compatible');
  assert.equal(config.baseUrl, 'https://kimi.a7m.com.cn/v1');
  assert.equal(config.model, 'kimi-k2.6');
  assert.equal(config.configured, true);
  assert.equal(config.hasApiKey, true);
  assert.doesNotMatch(JSON.stringify(config), /sk-local-secret/);
});

test('requestStrategyModelPrediction posts a bounded strategy prompt to the configured model', async () => {
  const calls = [];
  const result = await requestStrategyModelPrediction({
    env: {
      OPENAI_BASE_URL: 'https://kimi.a7m.com.cn/v1',
      OPENAI_API_KEY: 'sk-local-secret',
      OPENAI_MODEL: 'kimi-k2.6',
    },
    dataset: {
      rows: [
        { date: '2026-05-07', pointIndex: 1, timePoint: '00:15', realTimeAvgPrice: 280 },
      ],
      quality: { fieldCompleteness: { realTimeAvgPrice: 1, actualKwh: 0 } },
    },
    date: '2026-05-07',
    advice: { status: 'observation_ready' },
    suggestions: [{ title: '低价窗口补足', type: 'low_price' }],
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '建议先观察低价窗口，等待人工确认。' } }],
          usage: { prompt_tokens: 10, completion_tokens: 8 },
        }),
      };
    },
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.model, 'kimi-k2.6');
  assert.equal(result.content, '建议先观察低价窗口，等待人工确认。');
  assert.equal(calls[0].url, 'https://kimi.a7m.com.cn/v1/chat/completions');
  assert.equal(calls[0].options.headers.authorization, 'Bearer sk-local-secret');
  assert.doesNotMatch(
    calls[0].options.body,
    /actualLoadRaw|document\.cookie|localStorage|sessionStorage|authorization|api_key/i
  );
});
