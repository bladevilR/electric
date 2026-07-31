let activeMotion = null;
let scheduledFrame = null;

const metricNumberFormatter = new Intl.NumberFormat('zh-CN', {
  useGrouping: true,
});

function prefersReducedMotion() {
  return Boolean(
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

export function stopWorkbenchMotion() {
  if (scheduledFrame !== null && globalThis.cancelAnimationFrame) {
    globalThis.cancelAnimationFrame(scheduledFrame);
  }
  scheduledFrame = null;
  activeMotion?.kill?.();
  activeMotion = null;
}

export function parseMetricText(text) {
  const match = String(text || '').trim().match(/^(.*?)(\d[\d,]*(?:\.\d+)?)(.*)$/);
  if (!match) return null;

  const rawNumber = match[2].replaceAll(',', '');
  const value = Number(rawNumber);
  if (!Number.isFinite(value)) return null;

  return {
    prefix: match[1],
    value,
    decimals: rawNumber.includes('.') ? rawNumber.split('.')[1].length : 0,
    suffix: match[3],
  };
}

export function formatMetricValue(parts, value) {
  const number = metricNumberFormatter.format(
    Number(Number(value).toFixed(parts.decimals))
  );
  const normalized = parts.decimals
    ? Number(value).toLocaleString('zh-CN', {
        minimumFractionDigits: parts.decimals,
        maximumFractionDigits: parts.decimals,
      })
    : number;
  return `${parts.prefix}${normalized}${parts.suffix}`;
}

function elements(root, selector) {
  return Array.from(root?.querySelectorAll?.(selector) || []);
}

function animateFrom(timeline, targets, vars, position) {
  if (targets.length) {
    timeline.from(targets, vars, position);
  }
  return timeline;
}

function settleRoot(root) {
  root?.classList?.remove('is-motion-running');
  root?.classList?.add('motion-ready', 'motion-settled');
}

function animateMetric(timeline, element, position) {
  const parts = parseMetricText(element.textContent);
  if (!parts) return;

  const finalText = element.textContent;
  const state = { value: 0 };
  element.setAttribute?.('aria-label', finalText);
  element.textContent = formatMetricValue(parts, 0);
  timeline.to(
    state,
    {
      value: parts.value,
      duration: 1.05,
      ease: 'power2.out',
      onUpdate: () => {
        element.textContent = formatMetricValue(parts, state.value);
      },
      onComplete: () => {
        element.textContent = finalText;
      },
    },
    position
  );
}

function animateCurvePath(timeline, path, position, duration) {
  const length = Number(path.getTotalLength?.());
  if (!Number.isFinite(length) || length <= 0) return;

  timeline.set(
    path,
    {
      strokeDasharray: length,
      strokeDashoffset: length,
    },
    position
  );
  timeline.to(
    path,
    {
      strokeDashoffset: 0,
      duration,
      ease: 'power2.inOut',
      onComplete: () => {
        path.style.strokeDasharray = '';
        path.style.strokeDashoffset = '';
      },
    },
    position
  );
}

export function startWorkbenchMotion(root, options = {}) {
  stopWorkbenchMotion();

  const gsap = options.gsap || globalThis.gsap;
  const reduced = options.reducedMotion ?? prefersReducedMotion();

  if (!root || !gsap || reduced) {
    settleRoot(root);
    return {
      reduced: Boolean(reduced),
      kill() {},
    };
  }

  root.classList.remove('motion-ready', 'motion-settled');
  root.classList.add('is-motion-running');
  const fullSequence = options.fullSequence ?? root.dataset.motionPlayed !== 'true';

  const timeline = gsap.timeline({
    defaults: { ease: 'power3.out' },
    onComplete: () => {
      settleRoot(root);
    },
  });

  if (!fullSequence) {
    animateFrom(
      timeline,
      elements(root, '.dashboard-primary-grid'),
      {
        y: 8,
        opacity: 0,
        duration: 0.32,
      }
    );
    animateFrom(
      timeline,
      elements(root, '.dashboard-metric strong, .recommendation-impact strong'),
      { y: 5, opacity: 0, duration: 0.24, stagger: 0.025 },
      '<+0.04'
    );
  } else {
    animateFrom(
      timeline,
      elements(root, '.dashboard-sidebar'),
      {
        x: -18,
        opacity: 0,
        duration: 0.45,
      }
    );
    animateFrom(
      timeline,
      elements(root, '.dashboard-hero-copy > *'),
      { y: 18, opacity: 0, duration: 0.42, stagger: 0.08 },
      0.16
    );
    animateFrom(
      timeline,
      elements(root, '.dashboard-progress li'),
      { x: 12, opacity: 0, duration: 0.38, stagger: 0.08 },
      0.28
    );
    animateFrom(
      timeline,
      elements(root, '.dashboard-metric'),
      { y: 20, opacity: 0, duration: 0.46, stagger: 0.08 },
      0.48
    );
    animateFrom(
      timeline,
      elements(root, '.declaration-curve-panel'),
      { y: 18, opacity: 0, duration: 0.5 },
      0.72
    );
    animateFrom(
      timeline,
      elements(root, '.recommendation-panel'),
      { x: 18, opacity: 0, duration: 0.5 },
      0.82
    );
    animateFrom(
      timeline,
      elements(root, '.curve-area'),
      { opacity: 0, duration: 0.7 },
      0.98
    );
    animateFrom(
      timeline,
      elements(root, '.curve-dot'),
      {
        scale: 0,
        opacity: 0,
        transformOrigin: 'center',
        duration: 0.34,
        stagger: 0.035,
        ease: 'back.out(1.8)',
      },
      1.34
    );
    animateFrom(
      timeline,
      elements(root, '.recommendation-windows i b'),
      {
        scaleX: 0,
        transformOrigin: 'left center',
        duration: 0.5,
        stagger: 0.06,
      },
      1.42
    );
    animateFrom(
      timeline,
      elements(root, '.optimization-flow li'),
      { y: 10, opacity: 0, duration: 0.34, stagger: 0.07 },
      1.72
    );

    elements(root, '.dashboard-metric strong').forEach((element, index) => {
      animateMetric(timeline, element, 0.62 + index * 0.08);
    });

    const baselinePath = elements(root, '.curve-baseline')[0];
    const recommendedPath = elements(root, '.curve-recommended')[0];
    if (baselinePath) animateCurvePath(timeline, baselinePath, 0.88, 1.22);
    if (recommendedPath) animateCurvePath(timeline, recommendedPath, 1.06, 1.28);
  }

  activeMotion = timeline;
  return {
    timeline,
    reduced: false,
    kill() {
      timeline.kill();
    },
  };
}

export function scheduleWorkbenchMotion(root, options = {}) {
  if (!root) return null;
  if (scheduledFrame !== null && globalThis.cancelAnimationFrame) {
    globalThis.cancelAnimationFrame(scheduledFrame);
  }

  const run = () => {
    scheduledFrame = null;
    const fullSequence = root.dataset.motionPlayed !== 'true';
    root.dataset.motionPlayed = 'true';
    startWorkbenchMotion(root, { ...options, fullSequence });
  };

  if (globalThis.requestAnimationFrame) {
    scheduledFrame = globalThis.requestAnimationFrame(run);
    return scheduledFrame;
  }
  run();
  return null;
}
