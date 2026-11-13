/**
 * The rival desk's balance numbers. Each later rival feature (AIP1-03 onwards) adds its keys here.
 * See docs/design/rival-desk.md.
 */

import { defineTunables } from '../../core/tunables/define';
import { aiShortcutTunables } from './shortcuts';
import { cardValueTunables } from './cardValueTunables';
import { needsTunables } from './needsTunables';
import { styleTasteTunables } from './tasteTunables';

export const aipTunables = defineTunables({
  // The `ai.*` Rival rules shortcuts (AIP1-02), category `Rival rules`; see shortcuts.ts.
  ...aiShortcutTunables,
  ...styleTasteTunables(),
  ...cardValueTunables,
  ...needsTunables,
});
