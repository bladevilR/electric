import { normalizeCameraSpec } from '../local/lib/cinematic-camera.mjs';

const COMPETITION_LIMIT_MS = 300_000;
const ALLOWED_ACTIONS = new Set(['show', 'click', 'scroll']);
const ALLOWED_LOCATORS = new Set(['css', 'text']);
const ALLOWED_READY_STATES = new Set(['visible', 'hidden']);
const DANGEROUS_CLICK_PATTERN =
  /data-primary-action|submit|trade|transaction|execute|password|credential|ukey.?pin|申报提交|提交申报|自动交易|立即下单/i;

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 必须是对象`);
  }
  return value;
}

function requireText(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} 必须是非空文本`);
  }
  return value.trim();
}

function requireMilliseconds(value, label, { allowZero = false } = {}) {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${label} 必须是${allowZero ? '非负' : '正'}整数毫秒`);
  }
  return value;
}

function normalizeLocators(locators, label) {
  if (!Array.isArray(locators) || locators.length === 0) {
    throw new Error(`${label} 至少需要一个定位器`);
  }
  return locators.map((rawLocator, index) => {
    const locator = requireObject(rawLocator, `${label}[${index}]`);
    const type = requireText(locator.type, `${label}[${index}].type`);
    if (!ALLOWED_LOCATORS.has(type)) {
      throw new Error(`${label}[${index}] 不支持定位器类型 ${type}`);
    }
    return {
      type,
      value: requireText(locator.value, `${label}[${index}].value`),
      exact: locator.exact === true,
    };
  });
}

function normalizeStep(rawStep, index) {
  const step = requireObject(rawStep, `steps[${index}]`);
  const id = requireText(step.id, `steps[${index}].id`);
  const action = requireObject(step.action, `${id}.action`);
  const actionType = requireText(action.type, `${id}.action.type`);
  if (!ALLOWED_ACTIONS.has(actionType)) {
    throw new Error(`${id}.action.type 不支持 ${actionType}`);
  }
  const actionLocators = normalizeLocators(action.locators, `${id}.action.locators`);
  if (
    actionType === 'click' &&
    actionLocators.some((locator) => DANGEROUS_CLICK_PATTERN.test(locator.value))
  ) {
    const blocked = actionLocators.find((locator) =>
      DANGEROUS_CLICK_PATTERN.test(locator.value)
    );
    throw new Error(`禁止自动点击危险动作：${blocked.value}`);
  }

  const ready = requireObject(step.ready, `${id}.ready`);
  const readyState = requireText(ready.state, `${id}.ready.state`);
  if (!ALLOWED_READY_STATES.has(readyState)) {
    throw new Error(`${id}.ready.state 不支持 ${readyState}`);
  }

  return {
    id,
    title: requireText(step.title, `${id}.title`),
    narration: requireText(step.narration, `${id}.narration`),
    narrationChapter:
      typeof step.narrationChapter === 'string' && step.narrationChapter.trim()
        ? step.narrationChapter.trim()
        : `chapter-${id}`,
    chapter: typeof step.chapter === 'string' ? step.chapter.trim() : '',
    camera: normalizeCameraSpec(step.camera, `${id}.camera`),
    action: {
      type: actionType,
      locators: actionLocators,
      align: ['start', 'center', 'end'].includes(action.align)
        ? action.align
        : 'center',
    },
    ready: {
      state: readyState,
      locators: normalizeLocators(ready.locators, `${id}.ready.locators`),
    },
    networkIdleMs: requireMilliseconds(
      step.networkIdleMs,
      `${id}.networkIdleMs`,
      { allowZero: true }
    ),
    holdMs: requireMilliseconds(step.holdMs, `${id}.holdMs`),
    timeoutMs: requireMilliseconds(step.timeoutMs, `${id}.timeoutMs`),
  };
}

export function validateDemoPlan(rawPlan) {
  const plan = requireObject(rawPlan, 'plan');
  if (plan.version !== 1) {
    throw new Error('plan.version 必须为 1');
  }
  const maxDurationMs = requireMilliseconds(
    plan.maxDurationMs,
    'maxDurationMs'
  );
  if (maxDurationMs >= COMPETITION_LIMIT_MS) {
    throw new Error('最大时长必须严格小于比赛 5 分钟限制');
  }
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    throw new Error('steps 至少需要一个分镜');
  }

  const steps = plan.steps.map(normalizeStep);
  const ids = new Set();
  for (const step of steps) {
    if (ids.has(step.id)) {
      throw new Error(`分镜 id 重复：${step.id}`);
    }
    ids.add(step.id);
  }
  const totalHoldMs = steps.reduce((sum, step) => sum + step.holdMs, 0);
  if (totalHoldMs >= maxDurationMs || totalHoldMs >= COMPETITION_LIMIT_MS) {
    throw new Error(
      `展示时长预算 ${totalHoldMs}ms 已达到或超过最大录制时长`
    );
  }

  return {
    version: 1,
    title: requireText(plan.title, 'title'),
    url: requireText(plan.url, 'url'),
    intro: plan.intro || null,
    outro: plan.outro || null,
    maxDurationMs,
    totalHoldMs,
    steps,
  };
}

function srtTimestamp(value) {
  const totalMs = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1_000);
  const milliseconds = totalMs % 1_000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function buildTtsAssets(rawPlan, timeline) {
  const plan = validateDemoPlan(rawPlan);
  const actualSteps = new Map(
    Array.isArray(timeline?.steps)
      ? timeline.steps.map((step) => [step.id, step])
      : []
  );
  const segments = plan.steps
    .map((step) => ({ step, actual: actualSteps.get(step.id) }))
    .filter(
      ({ actual }) =>
        actual?.status === 'completed' &&
        Number.isFinite(actual.startMs) &&
        Number.isFinite(actual.endMs) &&
        actual.endMs > actual.startMs
    );

  const script = segments
    .map(
      ({ step }, index) =>
        `${String(index + 1).padStart(2, '0')} ${step.title}\n${step.narration}`
    )
    .join('\n\n');

  const srt = segments
    .map(
      ({ step, actual }, index) =>
        `${index + 1}\n${srtTimestamp(actual.startMs)} --> ${srtTimestamp(actual.endMs)}\n${step.narration}`
    )
    .join('\n\n');

  const ssmlBody = segments
    .map(({ step, actual }, index) => {
      const previous = index === 0 ? 0 : segments[index - 1].actual.endMs;
      const pauseMs = Math.max(0, Math.round(actual.startMs - previous));
      const pause = pauseMs > 0 ? `<break time="${pauseMs}ms"/>` : '';
      return `${pause}<p>${escapeXml(step.narration)}</p>`;
    })
    .join('');

  return {
    script: script ? `${script}\n` : '',
    srt: srt ? `${srt}\n` : '',
    ssml:
      `<speak version="1.0" xml:lang="zh-CN">` +
      `<voice name="zh-CN-XiaoxiaoNeural">${ssmlBody}</voice>` +
      `</speak>\n`,
    segmentCount: segments.length,
  };
}
