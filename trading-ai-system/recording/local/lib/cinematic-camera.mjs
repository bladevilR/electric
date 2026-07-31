/**
 * Deterministic screen-camera math.
 *
 * The connected pan/zoom design is adapted from OpenScreen's video editor
 * (https://github.com/getopenscreen/openscreen), licensed under the MIT License.
 * This module is a clean-room, framework-free implementation for browser capture.
 */

export const MAX_CAMERA_SCALE = 1.26;

const LOCATOR_TYPES = new Set(['css', 'text']);
const EXIT_MODES = new Set(['connect', 'reset']);

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} 必须是有限数字`);
  return number;
}

function normalizeFocus(focus, label) {
  if (!Array.isArray(focus) || focus.length === 0) {
    throw new Error(`${label}.focus 至少需要一个定位器`);
  }
  return focus.map((locator, index) => {
    if (!locator || typeof locator !== 'object' || Array.isArray(locator)) {
      throw new Error(`${label}.focus[${index}] 必须是对象`);
    }
    if (!LOCATOR_TYPES.has(locator.type)) {
      throw new Error(`${label}.focus[${index}].type 不受支持`);
    }
    if (typeof locator.value !== 'string' || !locator.value.trim()) {
      throw new Error(`${label}.focus[${index}].value 必须是非空文本`);
    }
    return {
      type: locator.type,
      value: locator.value.trim(),
      exact: locator.exact === true,
    };
  });
}

export function normalizeCameraSpec(raw, label = 'camera') {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${label} 必须是对象`);
  }
  const scale = finiteNumber(raw.scale, `${label}.scale`);
  if (scale < 1 || scale > MAX_CAMERA_SCALE) {
    throw new Error(`${label}.scale 必须在 1 到 ${MAX_CAMERA_SCALE} 之间`);
  }
  const enterMs = finiteNumber(raw.enterMs, `${label}.enterMs`);
  if (!Number.isInteger(enterMs) || enterMs < 750 || enterMs > 1100) {
    throw new Error(`${label}.enterMs 必须是 750 到 1100 的整数毫秒`);
  }
  const exit = raw.exit;
  if (!EXIT_MODES.has(exit)) {
    throw new Error(`${label}.exit 必须是 connect 或 reset`);
  }
  const motionBlur = finiteNumber(raw.motionBlur ?? 0, `${label}.motionBlur`);
  if (motionBlur < 0 || motionBlur > 0.25) {
    throw new Error(`${label}.motionBlur 必须在 0 到 0.25 之间`);
  }
  return {
    scale,
    focus: normalizeFocus(raw.focus, label),
    enterMs,
    exit,
    motionBlur,
  };
}

export function computeCameraTransform({
  viewportWidth,
  viewportHeight,
  focusRect,
  scale,
}) {
  const width = finiteNumber(viewportWidth, 'viewportWidth');
  const height = finiteNumber(viewportHeight, 'viewportHeight');
  const zoom = finiteNumber(scale, 'scale');
  if (width <= 0 || height <= 0) throw new Error('视口尺寸必须大于零');
  if (zoom < 1 || zoom > MAX_CAMERA_SCALE) {
    throw new Error(`scale 必须在 1 到 ${MAX_CAMERA_SCALE} 之间`);
  }
  if (!focusRect || typeof focusRect !== 'object') {
    throw new Error('focusRect 必须是对象');
  }
  const rect = {
    x: finiteNumber(focusRect.x, 'focusRect.x'),
    y: finiteNumber(focusRect.y, 'focusRect.y'),
    width: finiteNumber(focusRect.width, 'focusRect.width'),
    height: finiteNumber(focusRect.height, 'focusRect.height'),
  };
  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error('focusRect 必须具有可见尺寸');
  }
  const focusX = rect.x + rect.width / 2;
  const focusY = rect.y + rect.height / 2;
  const rawX = width / 2 - focusX * zoom;
  const rawY = height / 2 - focusY * zoom;
  return {
    scale: zoom,
    x: Math.min(0, Math.max(width - width * zoom, rawX)),
    y: Math.min(0, Math.max(height - height * zoom, rawY)),
  };
}

function clean(value) {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function cameraTransformCss(transform) {
  return `translate3d(${clean(transform.x)}px, ${clean(transform.y)}px, 0) scale(${clean(transform.scale)})`;
}
