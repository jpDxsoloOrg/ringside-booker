# Negotiation

The negotiation system (`packages/engine/src/systems/negotiation/`, bundle id
`negotiation`) is how a worker and a promotion agree a contract: the promotion
makes an offer, the worker reacts (accepts, counters, rejects, walks away or
refuses to talk), and an acceptable offer is decided on a short review. Before
ECO5 a contract could only appear through the new-game generator.

ECO5-01 lays the ground the rest of ECO5 builds on. Nothing is visible yet:
the player first sees negotiations in ECO5-06. The later tickets fill in the
sections marked below.

The names keep the `contracts.` area the catalog fixed (`contracts.makeOffer`,
`contracts.reviewOffers`, `contracts.renewal.*`, stream `contracts.counter`),
next to ECO4's `contracts.lifecycle` ([contracts.md](contracts.md)). The
bundle has its own id so ECO4's files are not edited.

| Piece       | Where                           | What it does                                                                               |
| ----------- | ------------------------------- | ------------------------------------------------------------------------------------------ |
| Offer       | `offer.ts`                      | `OfferSchema`: the one shape every controller submits                                      |
| Table       | `model/entities/negotiation.ts` | the `negotiations` table, its statuses, reactions and invariants                           |
| Tunables    | `tunables.ts`                   | the pace, the offer limits and the reach thresholds, category `Contracts`                  |
| Streams     | `streams.ts`                    | `contracts.counter` (counter-offer concessions) and `contracts.review` (review tie-breaks) |
| Events      | `events.ts`                     | `negotiation.opened`, `.countered`, `.walkedAway`, `.closed` and `contract.signed`         |
| Trace kinds | `traceKinds.ts`                 | `contracts.ask`, `.reaction`, `.counter`, `.review`, `.signingBonus`                       |
| Registries  | `registries.ts`, `builtins.ts`  | offer kinds, enforced terms, ask and patience modifiers                                    |
| Formula     | `formulas/reachGate.ts`         | `reachShortfall`: why a promotion's reach is too low for written or exclusive contracts    |

## Why negotiations live beside employments

The `employments` table already has the lifecycle a deal needs:
`offered → signed → active`, with `declined` and `withdrawn` as the ways an
offer ends (`EMPLOYMENT_TRANSITIONS` in `model/entities/employment.ts`). The
foundation journal said to revisit it "if negotiation needs states in between,
such as a counter-offer". It does, but rather than add statuses to
`employments`, the back and forth lives in its own table: one `negotiations`
row per conversation between a worker and a promotion, holding the current
offer, the worker's last counter-offer, the patience left, the rounds so far
and any walk-away cooldown.

So the employment row stays what the foundation promised: an offer is
`offered`, a deal is `signed`, and nothing in between can pay a wage. ECO4's
lifecycle and the `employments.unreachableState` invariant are untouched.

- A **signing** points at the `offered` employment ECO5-04 creates for it.
- A **renewal** points at the live (`signed` or `active`) contract and changes
  it in place when it is signed, because `oneContractPerPromotion` allows one
  signed-or-active row per worker and promotion.

The table's fields are in [data-model.md](data-model.md#negotiations-negotiations-neg_).

## Who may negotiate

Any controller (D-07): the player, a rival promotion (ECO6) and, in
multiplayer, a second human (MP6) all submit the same offer through the same
commands. Nothing in the system assumes the offer comes from the player.

Terms and rival offers are private. A player query only shows negotiations of
the player's own promotions; a rival's offer to a worker the player also wants
is never shown, only its result (the worker signs elsewhere, outcome
`otherPromotionId`).

## The offer

`OfferSchema` (`offer.ts`) is the shape every offer and every counter-offer
takes:

| Field          | Type                                                 | Notes                                                                            |
| -------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| `terms`        | `ContractTermsSchema`                                | ECO4's contract terms, reused (not copied): kind, exclusive, wage, fee, bonus... |
| `startsOn`     | date or null                                         | the first day under contract; null = as soon as possible                         |
| `lengthMonths` | integer 1..120                                       | capped lower by `contracts.offer.maxLengthMonths`                                |
| `brand`        | `{ kind: 'brand', brandId }` or `{ kind: 'shared' }` | BRW8 adds `{ kind: 'auto' }` (append-only)                                       |
| `role`         | `EmploymentRoleSchema`                               |                                                                                  |
| `push`         | `PushSchema`                                         | the card position promised                                                       |
| `extra`        | record of strings and numbers, at most 8 keys        | a later contract kind's own fields (ECO11, ECO12), checked by its `extraSchema`  |

No term is declared twice: everything a signed contract holds comes from the
employment schemas.

## Statuses

| Status           | Open | Meaning                                                                         |
| ---------------- | ---- | ------------------------------------------------------------------------------- |
| `submitted`      | yes  | the worker has an offer to react to                                             |
| `countered`      | yes  | the worker made a counter-offer; it lapses after `contracts.counter.expiryDays` |
| `awaitingReview` | yes  | the offer is good enough; the worker decides on `reviewOn`                      |
| `signed`         | no   | the worker signed                                                               |
| `declined`       | no   | the worker said no (or signed elsewhere: `outcome.otherPromotionId`)            |
| `walkedAway`     | no   | the worker ran out of patience; no new talks before `cooldownUntil`             |
| `withdrawn`      | no   | the promotion took the offer back                                               |
| `lapsed`         | no   | a counter-offer went unanswered past its expiry                                 |

At most one negotiation per worker and promotion is open at a time
(`oneOpenPerPersonPromotion`). Closed rows stay: that is how a walk-away
cooldown (`contracts.walkAway.cooldownDays`, 30 days) is remembered. Closed
rows older than `contracts.history.closedKeepDays` and past their cooldown are
pruned.

## Market value

What a worker is worth on the open market. Filled by ECO5-02.

## Asking terms

What the worker asks for, built from the market value and the registered ask
modifiers; recorded at `contracts.ask` / `<negotiationId>:<round>` when an
offer is submitted. Filled by ECO5-02.

## Patience

How many rounds that do not please the worker they will sit through (0 to 10),
with the registered patience modifiers. Filled by ECO5-03.

## Contract value

How the worker weighs an offer against their asking terms. Filled by ECO5-03.

## Reaction

How the worker answers an offer: `accept`, `counter`, `reject`, `walkAway` or
`refuse`; recorded at `contracts.reaction` / `<negotiationId>:<round>`.
Filled by ECO5-03.

## Counter

The worker's counter-offer, its concessions rolled on `contracts.counter`;
recorded at `contracts.counter` / `<negotiationId>:<round>`. It stays open for
`contracts.counter.expiryDays` (7) and, with `contracts.counter.stopSkip` on,
stops a skip while it waits for the player. Filled by ECO5-03.

## Review

Once an offer is good enough the worker takes `contracts.review.delayDays` (2)
to decide, so rival offers can arrive; ties break on `contracts.review`. The
decision is recorded at `contracts.review` / `<negotiationId>:review`, the
signing bonus at `contracts.signingBonus` / `<negotiationId>:review`. Filled by
ECO5-05.

## Renewals

A renewal can be offered from `contracts.renewal.windowDays` (180) before a
contract ends. ECO5-05 replaces ECO4's temporary automatic renewal of the
player's contracts (`contracts.autoRenewPlayer`). Filled by ECO5-05.

## Offer kinds

`registerOfferKind` lists the contract kinds a promotion may offer:

- `key`: a contract kind; `label`; `order` (lower first, then key);
- `available(read, promotionId, personId, date, tunables)`: the reasons this
  promotion may not offer it today, shown to the player as they are;
- optional `askMultiplier` (scales the asking terms), `extraSchema` (checks the
  offer's `extra`) and `onSigned` (runs inside the signing step).

Built in:

| Key             | Available when                                                                                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `written`       | the promotion's [reach](finances.md#reach-and-size) is at least `contracts.kind.writtenMinReach` (35; 0 = anyone) |
| `perAppearance` | always                                                                                                            |

A promotion below the threshold reads "Written contracts need a reach of 35;
yours is 12" (reach rounded down). Exclusive deals have the same gate on
`contracts.kind.exclusiveMinReach` (`exclusiveContractShortfall`). The
defaults put the default world's Local promotions below and the Regional ones
above; ECO5-02's calibration re-checks this. ECO11 (development deals) and
ECO12 (tours) register their own kinds.

## Enforced terms

`registerEnforcedTerm({ term, label, enforcedBy })` records which perks and
revenue shares the game actually honours, so the offer screen can say when a
term is only words on paper (`isTermEnforced`). Terms: `perk.ironClad`,
`perk.travelCovered`, `perk.noHouseShows`, `perk.creativeControl`,
`share.gateBp`, `share.merchBp`, `share.broadcastBp`.

| Term                 | Honoured by                                                                    |
| -------------------- | ------------------------------------------------------------------------------ |
| `perk.travelCovered` | ECO1's show costs                                                              |
| `perk.ironClad`      | ECO4's severance (doubled) and walk-outs (an iron-clad worker never walks out) |

## Ask and patience modifiers

`registerAskModifier` and `registerPatienceModifier` take
`{ id, order, label, compute(read, personId, promotionId, date, tunables) }`,
where `compute` returns a traced number or null when it does not apply. They
apply in order, then by id. SOC4's rapport is the first user.

## Events

| Event                    | Payload                                                                          |
| ------------------------ | -------------------------------------------------------------------------------- |
| `negotiation.opened`     | `negotiationId`, `personId`, `promotionId`, `kind`                               |
| `negotiation.countered`  | `negotiationId`, `personId`, `promotionId`, `round`                              |
| `negotiation.walkedAway` | `negotiationId`, `personId`, `promotionId`, `cooldownUntil`                      |
| `negotiation.closed`     | `negotiationId`, `personId`, `promotionId`, `status`, `outcomeCode`              |
| `contract.signed`        | `employmentId`, `personId`, `promotionId`, `brandId`, `renewal`, `negotiationId` |

Nothing publishes them in ECO5-01. See also
[day-pipeline.md](day-pipeline.md#domain-events).

## Tunables

See [tunables.md](tunables.md#negotiation-tunables).
