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
  return {
    timelines,
    timeline() {
      const timeline = {
        killed: false,
        from() {
          return this;
        },
        fromTo() {
          return this;
        },
        to() {
          return this;
        },
        set() {
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
