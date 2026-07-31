import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

function createClassList() {
  const values = new Set();
  return {
    add(...names) {
      names.forEach((name) => values.add(name));
    },
    remove(...names) {
      names.forEach((name) => values.delete(name));
    },
    contains(name) {
      return values.has(name);
    },
  };
}

function createMotionRoot() {
  return {
    classList: createClassList(),
    dataset: {},
    querySelectorAll() {
      return [];
    },
  };
}

function createFakeGsap() {
  const timelines = [];
  const calls = [];
  return {
    timelines,
    calls,
    timeline() {
      const timeline = {
        killed: false,
        from(targets) {
          calls.push({ method: 'from', targets });
          return this;
        },
        fromTo(targets) {
          calls.push({ method: 'fromTo', targets });
          return this;
        },
        to(targets) {
          calls.push({ method: 'to', targets });
          return this;
        },
        set(targets) {
          calls.push({ method: 'set', targets });
          return this;
        },
        kill() {
          this.killed = true;
        },
      };
      timelines.push(timeline);
      return timeline;
    },
  };
}

test('index loads local gsap before the workbench module', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');

  assert.match(html, /<script src="\.\/vendor\/gsap\.min\.js"><\/script>/);
  assert.ok(html.indexOf('vendor/gsap.min.js') < html.indexOf('workbench.js'));
  assert.doesNotMatch(html, /https?:\/\/[^"']*gsap/i);
});

test('starting motion twice kills the previous timeline', async () => {
  const { startWorkbenchMotion, stopWorkbenchMotion } = await import(
    '../workbench-motion.js'
  );
  const fakeGsap = createFakeGsap();
  const root = createMotionRoot();

  const first = startWorkbenchMotion(root, {
    gsap: fakeGsap,
    reducedMotion: false,
  });
  startWorkbenchMotion(root, { gsap: fakeGsap, reducedMotion: false });

  assert.equal(first.timeline.killed, true);
  stopWorkbenchMotion();
});

test('metric parser preserves prefix decimals and suffix', async () => {
  const { parseMetricText } = await import('../workbench-motion.js');

  assert.deepEqual(parseMetricText('+9.64%'), {
    prefix: '+',
    value: 9.64,
    decimals: 2,
    suffix: '%',
  });
  assert.deepEqual(parseMetricText('4,128 点 / 43 日'), {
    prefix: '',
    value: 4128,
    decimals: 0,
    suffix: ' 点 / 43 日',
  });
  assert.equal(parseMetricText('待验证'), null);
});

test('workbench schedules motion only after dashboard markup is rendered', async () => {
  const source = await readFile(new URL('../workbench.js', import.meta.url), 'utf8');

  assert.match(
    source,
    /import \{ scheduleWorkbenchMotion \} from ['"]\.\/workbench-motion\.js['"]/ 
  );
  const markupAssignment = source.indexOf('root.innerHTML = `');
  const motionSchedule = source.indexOf('scheduleWorkbenchMotion(root)');
  assert.ok(markupAssignment >= 0);
  assert.ok(motionSchedule > markupAssignment);
});

test('motion css includes reduced-motion final-state fallback', async () => {
  const css = await readFile(new URL('../workbench.css', import.meta.url), 'utf8');

  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation-duration:\s*0\.01ms/);
  assert.match(css, /\.recommendation-panel::after/);
  assert.match(css, /\.dashboard-metric:hover/);
});

test('motion timeline skips selectors that have no matching targets', async () => {
  const { startWorkbenchMotion, stopWorkbenchMotion } = await import(
    '../workbench-motion.js'
  );
  const fakeGsap = createFakeGsap();

  startWorkbenchMotion(createMotionRoot(), {
    gsap: fakeGsap,
    reducedMotion: false,
    fullSequence: true,
  });

  assert.equal(fakeGsap.calls.length, 0);
  stopWorkbenchMotion();
});
