/**
 * Write validation for worlds built by the test support.
 *
 * Test worlds parse every write with its schema (`validateWrites: 'always'`), so a test can never
 * pass against a row the game could not store. A test that needs raw speed can switch it off for
 * itself; `test/support/setup.ts` switches it back on before the next test.
 */

import type { ValidateMode } from '../../src/model/tx';

let currentMode: ValidateMode = 'always';

/** The `validateWrites` mode the next test world is created with. */
export function testWriteValidation(): ValidateMode {
  return currentMode;
}

/** Sets the `validateWrites` mode for test worlds created from now on. */
export function setTestWriteValidation(mode: ValidateMode): void {
  currentMode = mode;
}
