let activeMotion = null;

function prefersReducedMotion() {
  return Boolean(
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
}

export function stopWorkbenchMotion() {
  activeMotion?.kill?.();
  activeMotion = null;
}

export function startWorkbenchMotion(root, options = {}) {
  stopWorkbenchMotion();

  const gsap = options.gsap || globalThis.gsap;
  const reduced = options.reducedMotion ?? prefersReducedMotion();

  if (!root || !gsap || reduced) {
    root?.classList?.remove('is-motion-running');
    root?.classList?.add('motion-ready', 'motion-settled');
    return {
      reduced: Boolean(reduced),
      kill() {},
    };
  }

  root.classList.remove('motion-ready', 'motion-settled');
  root.classList.add('is-motion-running');

  const timeline = gsap.timeline({
    defaults: { ease: 'power3.out' },
    onComplete: () => {
      root.classList.remove('is-motion-running');
      root.classList.add('motion-ready', 'motion-settled');
    },
  });

  activeMotion = timeline;
  return {
    timeline,
    reduced: false,
    kill() {
      timeline.kill();
    },
  };
}
