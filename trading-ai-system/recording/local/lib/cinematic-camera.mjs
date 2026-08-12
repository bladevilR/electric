/**
 * Deterministic screen-camera math.
 *
 * The connected pan/zoom design is adapted from OpenScreen's video editor
 * (https://github.com/getopenscreen/openscreen), licensed under the MIT License.
 * This module is a clean-room, framework-free implementation for browser capture.
 */

export const MAX_CAMERA_SCALE = 1.9;

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
  if (!Array.isArray(raw.beats) || raw.beats.length === 0 || raw.beats.length > 3) {
    throw new Error(`${label}.beats 必须包含 1 到 3 个运镜节点`);
  }
  const exit = raw.exit;
  if (!EXIT_MODES.has(exit)) {
    throw new Error(`${label}.exit 必须是 connect 或 reset`);
  }
  let previousAt = -1;
  const beats = raw.beats.map((rawBeat, index) => {
    const beatLabel = `${label}.beats[${index}]`;
    if (!rawBeat || typeof rawBeat !== 'object' || Array.isArray(rawBeat)) {
      throw new Error(`${beatLabel} 必须是对象`);
    }
    const at = finiteNumber(rawBeat.at, `${beatLabel}.at`);
    if (at < 0 || at > 0.9) {
      throw new Error(`${beatLabel}.at 必须在 0 到 0.9 之间`);
    }
    if (at <= previousAt) {
      throw new Error(`${label}.beats 必须按 at 严格递增`);
    }
    previousAt = at;
    const scale = finiteNumber(rawBeat.scale, `${beatLabel}.scale`);
    if (scale < 1 || scale > MAX_CAMERA_SCALE) {
      throw new Error(`${beatLabel}.scale 必须在 1 到 ${MAX_CAMERA_SCALE} 之间`);
    }
    const durationMs = finiteNumber(rawBeat.durationMs, `${beatLabel}.durationMs`);
    if (!Number.isInteger(durationMs) || durationMs < 600 || durationMs > 1400) {
      throw new Error(`${beatLabel}.durationMs 必须是 600 到 1400 的整数毫秒`);
    }
    const motionBlur = finiteNumber(rawBeat.motionBlur ?? 0, `${beatLabel}.motionBlur`);
    if (motionBlur < 0 || motionBlur > 0.25) {
      throw new Error(`${beatLabel}.motionBlur 必须在 0 到 0.25 之间`);
    }
    return {
      at,
      scale,
      focus: normalizeFocus(rawBeat.focus, beatLabel),
      durationMs,
      motionBlur,
    };
  });
  return {
    beats,
    exit,
  };
}

function clean(value) {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

/**
 * Compute pan/zoom so the focus stays fully visible and centered in the
 * "safe" frame (above captions, below chapter chips). If the requested scale
 * would clamp the pan away from the focus, scale is reduced until the focus
 * can be held on-screen with padding — this prevents the empty white frames
 * and clipped numbers seen in earlier contest cuts.
 */
export function computeCameraTransform({
  viewportWidth,
  viewportHeight,
  focusRect,
  scale,
  safeTop = 72,
  safeBottom = 150,
  padding = 36,
}) {
  const width = finiteNumber(viewportWidth, 'viewportWidth');
  const height = finiteNumber(viewportHeight, 'viewportHeight');
  let zoom = finiteNumber(scale, 'scale');
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

  const safeHeight = Math.max(240, height - safeTop - safeBottom);
  const targetX = width / 2;
  const targetY = safeTop + safeHeight / 2;
  const focusX = rect.x + rect.width / 2;
  const focusY = rect.y + rect.height / 2;

  // Prefer not to over-zoom a large panel into a featureless crop.
  const maxZoomForFit = Math.max(
    1,
    Math.min(
      MAX_CAMERA_SCALE,
      (width - padding * 2) / rect.width,
      (safeHeight - padding) / rect.height
    )
  );
  zoom = Math.min(zoom, maxZoomForFit);

  const place = (level) => {
    const rawX = targetX - focusX * level;
    const rawY = targetY - focusY * level;
    return {
      scale: level,
      x: Math.min(0, Math.max(width - width * level, rawX)),
      y: Math.min(0, Math.max(height - height * level, rawY)),
    };
  };

  let transform = place(zoom);

  // If clamping moved the focus far from the safe center, ease scale down so
  // the subject stays readable instead of leaving a white void.
  for (let step = 0; step < 12; step += 1) {
    const screenFocusX = focusX * transform.scale + transform.x;
    const screenFocusY = focusY * transform.scale + transform.y;
    const dx = Math.abs(screenFocusX - targetX);
    const dy = Math.abs(screenFocusY - targetY);
    const halfW = (rect.width * transform.scale) / 2;
    const halfH = (rect.height * transform.scale) / 2;
    const fitsX =
      screenFocusX - halfW >= padding &&
      screenFocusX + halfW <= width - padding;
    const fitsY =
      screenFocusY - halfH >= safeTop + padding / 2 &&
      screenFocusY + halfH <= height - safeBottom - padding / 2;
    const centeredEnough = dx <= width * 0.12 && dy <= height * 0.14;
    if ((fitsX && fitsY) || centeredEnough || transform.scale <= 1.05) break;
    zoom = Math.max(1, transform.scale - 0.08);
    transform = place(zoom);
  }

  return {
    scale: clean(transform.scale),
    x: clean(transform.x),
    y: clean(transform.y),
  };
}

export function cameraTransformCss(transform) {
  return `translate3d(${clean(transform.x)}px, ${clean(transform.y)}px, 0) scale(${clean(transform.scale)})`;
}
