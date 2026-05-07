import test from 'node:test';
import assert from 'node:assert/strict';

import { buildJspecSpaUrl, getTargetsByIds } from './target-url.mjs';

test('buildJspecSpaUrl converts a JSPEC route fragment to an app URL', () => {
  assert.equal(
    buildJspecSpaUrl('/pxf-js-outer-deferrableload/dayElectricity'),
    'https://www.jspec.com.cn/pxf-js-outer-deferrableload/#/pxf-js-outer-deferrableload/dayElectricity'
  );
});

test('getTargetsByIds returns targets in requested order', () => {
  const targets = getTargetsByIds(['settle_day', 'actual_load_96']);

  assert.deepEqual(
    targets.map((target) => target.id),
    ['settle_day', 'actual_load_96']
  );
  assert.equal(targets[0].name, '日结算查询');
});

test('getTargetsByIds rejects unknown target ids', () => {
  assert.throws(
    () => getTargetsByIds(['missing_target']),
    /Unknown JSPEC target id: missing_target/
  );
});
