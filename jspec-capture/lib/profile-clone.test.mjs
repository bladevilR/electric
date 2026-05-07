import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { buildCloneLayout } from './profile-clone.mjs';

test('buildCloneLayout maps a source profile to a reusable Default clone', () => {
  const layout = buildCloneLayout({
    sourceUserDataDir: 'C:/Users/R/AppData/Local/Google/Chrome/User Data',
    profileName: 'Profile 4',
    cloneRoot: 'E:/electric/jspec-capture/work/clone-1',
  });

  assert.equal(
    layout.sourceProfileDir,
    path.join('C:/Users/R/AppData/Local/Google/Chrome/User Data', 'Profile 4')
  );
  assert.equal(
    layout.cloneDefaultDir,
    path.join('E:/electric/jspec-capture/work/clone-1', 'Default')
  );
  assert.equal(
    layout.cloneLocalState,
    path.join('E:/electric/jspec-capture/work/clone-1', 'Local State')
  );
});
