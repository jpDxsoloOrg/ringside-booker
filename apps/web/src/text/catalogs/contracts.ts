import { registerTextCatalog } from '../renderTemplatedText';
import type { TextCatalog } from '../renderTemplatedText';

/**
 * The contracts system's templated sentences: a rival's answer to a release request in its
 * Decision log (ECO4-05, docs/design/contracts.md#rival-rules). The engine's `releaseDecisionText`
 * says the same words for `aip.decisionLog`'s `text`; keep them in step. Importing this module
 * registers it.
 */
export const CONTRACTS_TEXT_CATALOG: TextCatalog = {
  'contracts.decision.release-granted': 'Let {name} go at their request ({reason})',
  'contracts.decision.release-refused': 'Refused to let {name} go ({reason})',
};

registerTextCatalog('contracts', CONTRACTS_TEXT_CATALOG);
