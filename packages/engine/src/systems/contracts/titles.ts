/**
 * `titlesHeldBy`: the titles a person holds right now.
 *
 * The contracts system reads it for the simple rival renewal's "holds a title" rule, the release
 * warning and the contract list chips (ECO4-02/04). Since CRTV1-01 it is the titles system's own
 * helper (`systems/titles/helpers/holders.ts`), re-exported here so contracts' imports stay put.
 */

export { titlesHeldBy } from '../titles/helpers/holders';
