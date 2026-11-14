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
| Formulas    | `formulas/marketValue.ts` …     | market value, asking wage, fee and starting patience (ECO5-02)                             |
| Composer    | `asking.ts`, `eligibility.ts`   | `askingTermsFor` and `negotiationEligibility` (ECO5-02)                                    |
| Queries     | `queries.ts`                    | `contracts.askingTerms`, `contracts.freeAgents` (ECO5-02)                                  |

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

What a worker is worth on the open market, in cents a month, before any
promotion is named (`formulas/marketValue.ts`, `marketValue`). It is a smooth
formula, not a table of bands: one more point of popularity or skill never
makes the wage jump.

1. **Popularity index** `Pi = (1 − b) × peak + b × world`, where `peak` is the
   worker's popularity in their **best country** and `world` their world-wide
   popularity (WRK1's [roll-up](geography.md#popularity-roll-up)), and `b` is
   `contracts.value.breadthWeight` (0.3). The best country, not the best
   continent: a continent is a population-weighted mean, so Tessen's main
   eventers, 56 in Japan, read 8 across Asia and would be worth less than
   Altura's lower card.
2. **Popularity part**: `contracts.value.popScale` ($300,000) ×
   (Pi ÷ 100) ^ `contracts.value.popExponent` (2).
3. **Skill part**: `contracts.value.skillScale` ($15,000) × (rating ÷ 100) ^
   `contracts.value.skillExponent` (2), the rating being the worker's
   [role rating](workers.md#role-ratings) in the role they would be hired for.
4. **Star merchandise**: monthly merchandise sales ×
   `contracts.value.merchShare` (0.25). Merchandise is not tracked yet (ECO2),
   so the Why? shows "Star merchandise: not tracked yet" as a check that did
   not apply.
5. Plus **Base** `contracts.value.floor` ($1,000), then × the **role factor**
   `contracts.value.roleFactor.<role>`: wrestler 1, booker 0.8, manager and
   presenter 0.6, announcer and producer 0.5, referee 0.35. Rounded to cents.

Every `^` is a `power` step whose exponent is the tunable, so the Why? shows
the curve. Worked example: a wrestler with peak 72, world 31 and rating 68
has `Pi = 59.7`, a popularity part of $106,922.70, a skill part of $6,936 and
the $1,000 base: **$114,858.70** a month.

## Asking terms

What the worker asks one promotion for (`asking.ts`, `askingTermsFor`), each
number with its Why?. The Negotiation Sheet shows it through
`contracts.askingTerms`; ECO5-03 records it at `contracts.ask` /
`<negotiationId>:<round>` when an offer is submitted.

**Monthly wage** (`formulas/askingWage.ts`), from the market value, in order:

| Step                        | Factor or limit                                                                                                                                                                                                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Your reach 82               | × `contracts.ask.reachFloor` (0.25) + (1 − 0.25) × reach ÷ 100: a promotion nobody has heard of gets a quarter                                                                                                                                                                                                                                   |
| Your public image           | × 1 − `contracts.ask.prestigeDiscount` (0.15) × prestige ÷ 100; the discount × `contracts.ask.legacyPrestigeMultiplier` (2) for a worker who cares about their legacy; never below 0                                                                                                                                                             |
| Ego premium                 | × (1 + premium): egotist `contracts.ask.egotistPremium` 0.10, in it for the money `contracts.ask.moneyPremium` 0.10, star presence (charisma or presence ≥ `contracts.ask.starPresence` 80) `contracts.ask.starPremium` 0.10, selfless − `contracts.ask.selflessDiscount` 0.05; at most `contracts.ask.premiumCap` 0.30 (0 removes the premiums) |
| Exclusive contract          | × (1 + `contracts.ask.exclusivePremium` 0.10)                                                                                                                                                                                                                                                                                                    |
| Under contract elsewhere    | × (1 + `contracts.ask.underContractPremium` 0.10): a rival's wage is private, so this stands in for it                                                                                                                                                                                                                                           |
| Renewals                    | see [Renewals](#renewals)                                                                                                                                                                                                                                                                                                                        |
| Modifiers                   | × each registered ask modifier, then the offer kind's `askMultiplier`                                                                                                                                                                                                                                                                            |
| Most a wrestler asks for    | at most `contracts.ask.cap.<role>`: wrestler $400,000, booker $80,000, manager, presenter and announcer $60,000, producer $40,000, referee $20,000                                                                                                                                                                                               |
| Asks are quoted in hundreds | rounded to the nearest $100                                                                                                                                                                                                                                                                                                                      |
| Current deal                | at least their current monthly wage **with this promotion** ("Won't take less than their current deal with you"), after the rounding so it holds to the cent. Never a rival's: that would leak a private term through the Why?                                                                                                                   |

Worked example: the $114,858.70 wrestler above, at a promotion with reach 82
and public image 60, no ego, asks $114,858.70 × 0.865 × 0.91 = **$90,400** a
month; **$99,500** for an exclusive contract.

**Fee per appearance** (`formulas/askingFee.ts`): the monthly ask ×
`contracts.ask.perAppearanceShare` (0.3), at least `contracts.ask.minFee`
($50), at most `contracts.ask.maxFee` ($20,000), rounded to $10, and at least
the fee of their current per-appearance deal with you.

The rest of the ask:

| Field                   | Rule                                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signingBonus`          | the monthly ask × `contracts.ask.signingBonusMonths` (1) for a written deal; 0 per appearance                                                                                                                                         |
| `perks`                 | only perks the game honours ([enforced terms](#enforced-terms)): travel covered when the worker lives in another country than your home region's; no house shows from `contracts.ask.noHouseShowsAge` (45) once that perk is enforced |
| `appearanceCap`         | `contracts.ask.veteranAppearanceCap` (24 a year) from age `contracts.ask.veteranAge` (45) with popularity `contracts.ask.veteranPeakPop` (80) or more; else none                                                                      |
| `preferredLengthMonths` | `contracts.ask.lengthMonths` (24); a journeyman `contracts.ask.lengthMonths.journeyman` (12); a loyal worker `contracts.ask.lengthMonths.loyal` (36)                                                                                  |
| `expectedPush`          | WRK1's [expected push](workers.md#expected-push) at this promotion                                                                                                                                                                    |
| `allowedKinds`          | every registered [offer kind](#offer-kinds), allowed or with its reasons; `bestKind` is the first allowed one                                                                                                                         |
| `exclusiveAllowed`      | `contracts.kind.exclusiveMinReach`, with the reasons when not                                                                                                                                                                         |
| `startPatience`         | see [Patience](#patience)                                                                                                                                                                                                             |
| `refusal`               | see [Renewals](#renewals)                                                                                                                                                                                                             |

Left out of a request, the kind is the current deal's on a renewal, else the
best kind; exclusive is the current deal's on a renewal, else yes for a
written deal when exclusives are allowed.

## Patience

How many offers that do not please them a worker sits through
(`formulas/startPatience.ts`): `contracts.patience.base` (3), − 1 for an
egotist (`contracts.patience.egotist`), + 1 for a professional
(`contracts.patience.professional`), − 1 on a renewal below the unhappy line
(`contracts.patience.unhappyPenalty`), plus each registered patience modifier;
kept within 0 and `contracts.patience.max` (5) and rounded down. 0 means no
counter-offers at all. ECO5-03 spends it.

## Eligibility

Who a promotion may talk to and from when (`eligibility.ts`,
`negotiationEligibility`, shared with ECO5-04's offer command). The first rule
that matches decides:

| Situation                | When                                                                                                                                                           | Earliest start        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `unavailable`            | retired, deceased, out of the business, or not debuted yet                                                                                                     | today                 |
| `yours`                  | a signed or active contract with this promotion (a renewal, not a signing)                                                                                     | today                 |
| `underContract`          | a signed exclusive deal elsewhere that has not started, or an active one with more than `contracts.offer.approachWindowDays` (30) left or no end date. Blocked | the day after it ends |
| `endingSoonElsewhere`    | an exclusive deal elsewhere ends within the approach window                                                                                                    | the day after it ends |
| `perAppearanceElsewhere` | only non-exclusive deals elsewhere                                                                                                                             | today                 |
| `freeAgent`              | no live contract                                                                                                                                               | today                 |

Only public facts of another promotion's deal are read: that it exists,
whether it is exclusive and when it ends.

## Free agents

`contracts.freeAgents { promotionId, role?, gender?, situation?, search? }`
lists the workers the promotion may approach: free agents, per-appearance
workers elsewhere and exclusive workers inside the approach window
(`situation: 'freeAgent'` keeps only the first). Each row has the public
facts (ring name, roles, age, style, best-country popularity, rating and
grade, the other promotion's name and end date), the ask as plain numbers
(`askMonthly` when written deals are allowed, `askPerAppearance`), `bestKind`,
the walk-away `cooldownUntil`, your `openNegotiationId` and the names of other
promotions talking to them now (never their terms). Sorted by market value,
highest first. The Why? of one row comes from `contracts.askingTerms`, which
gives the same numbers (tested). Offer kinds whose answer is the same for
every worker (`samePerWorker`) are asked once per list: about 15 ms for the
default world's 74 rows.

Both queries answer only for the viewer's own promotions (`invalidArgs`
otherwise, the omniscient viewer included). Rival wages, morale and hidden
development never appear.

## Calibration

`test/systems/negotiation/calibration.test.ts` (slow suite) checks the asks
against the default world's placeholder wages
([default-world.md#contracts](default-world.md#contracts)): the median ask of
Altura's main eventers is within half to double their wage, every Altura
wrestler asks less than the wrestler cap, Hardpan may only offer per-appearance
deals and Altura written and exclusive ones. Medians at the start of the
default world, wage → ask for the same kind of deal, before the current-deal
floor:

| Altura      |    Wage |     Ask | Ratio |
| ----------- | ------: | ------: | ----: |
| Main event  | $60,000 | $47,800 |  0.80 |
| Upper card  | $30,000 | $30,000 |  1.00 |
| Mid card    | $15,000 | $16,800 |  1.12 |
| Lower card  |  $8,000 |  $8,900 |  1.11 |
| Enhancement |  $4,000 |  $3,600 |  0.90 |

National promotions ask 1.4 to 2.3 times their placeholders, regional ones
about twice (their placeholder wages are small), local per-appearance fees 0.5
to 1.1 times. When the owner finds asks too high or too low, change the
tunables, not the formulas.

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

What a renewal asks (ECO5-02):

- **Unhappy here**: morale below `contracts.renewal.unhappyMorale` (−20) ×
  (1 + `contracts.renewal.unhappyPremiumPerPoint` (0.01) × points below the
  line): "Morale −45: unhappy here" asks 25% more. It also costs a point of
  patience.
- **Loyal to you**: a loyal worker asks × (1 −
  `contracts.ask.loyalRenewalDiscount` (0.10)).
- **Refusal**: at or below `contracts.renewal.refuseMorale` (−60) the worker
  will not renew at all: `refusal = { code: 'contracts.refusesRenewal',
message: "Won't renew while unhappy here" }`, with the decision
  ("Willing to renew") naming the tunable in `renewalDecision`.
- **Already written**: a written deal renewed at a promotion that may still
  offer written deals may only be renewed as written ("Already on a written
  deal with you").
- The ask never drops below the current deal (see the asking wage's last
  step). WRK8 moves morale; until then every default-world contract is at 0.

## Offer kinds

`registerOfferKind` lists the contract kinds a promotion may offer:

- `key`: a contract kind; `label`; `order` (lower first, then key);
- `available(read, promotionId, personId, date, tunables)`: the reasons this
  promotion may not offer it today, shown to the player as they are;
- optional `askMultiplier` (scales the asking terms), `extraSchema` (checks the
  offer's `extra`) and `onSigned` (runs inside the signing step).
- optional `samePerWorker: true` when `available` never depends on the person,
  so a list asks it once per promotion (both built-ins set it).

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
