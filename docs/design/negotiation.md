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
| Rules       | `validate.ts`                   | `validateOffer` / `checkOffer`: the reasons an offer may not be made (ECO5-04)             |
| Actions     | `submit.ts`, `bidders.ts`       | `submitOffer`, `answerCounter`, `withdrawNegotiation`, `competingBidders` (ECO5-04)        |
| Commands    | `commands.ts`                   | `contracts.makeOffer`, `.offerRenewal`, `.respondToCounter`, `.withdrawOffer` (ECO5-04)    |
| Queries     | `offersQueries.ts`              | `contracts.offers`, `contracts.negotiation` (ECO5-04)                                      |

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

One monthly figure for everything an offer holds (`formulas/contractValue.ts`,
`contractValue`), so a worker can weigh it against their own ask and against
other offers. Only terms the game actually honours add value: a clause nobody
enforces is worth nothing, and the Why? says so ("Creative control: not
enforced by the game yet, adds nothing"). In order:

| Step            | Rule                                                                                                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monthly wage    | the offer's wage                                                                                                                                                                                            |
| Appearance fees | + the fee × `contracts.value.appearancesPerMonth` (4), at most the appearance cap ÷ 12 when the offer caps appearances                                                                                      |
| Signing bonus   | + the bonus ÷ the contract's months ("Signing bonus spread over 24 months")                                                                                                                                 |
| Perks           | × (1 + each honoured perk's premium): iron-clad `contracts.value.perk.ironClad` 0.20, travel covered `…travelCovered` 0.03, no house shows `…noHouseShows` 0.05, creative control `…creativeControl` 0.10   |
| Revenue shares  | × (1 + each paid share in percent × `contracts.value.sharePerPercent` 0.02)                                                                                                                                 |
| Card position   | × (1 − `contracts.value.pushBelowPerStep` 0.10) for each step below the [expected push](workers.md#expected-push), × (1 + `contracts.value.pushAbovePerStep` 0.03) for each step above; crew are not pushed |
| Length          | × (1 − `contracts.value.lengthMismatchPerMonth` 0.005 × months away from the preferred length), at least `contracts.value.lengthFitMin` 0.85                                                                |
| Rounded         | to whole cents                                                                                                                                                                                              |

The value of the **ask** is the same formula over the ask itself (its money and
perks, at the push they expect and the length they prefer), so submitting the
ask unchanged is worth exactly 1.0 of it. The perk premiums are small on
purpose: a perk never makes a low offer attractive.

## Reaction

How the worker answers an offer (`formulas/offerReaction.ts`, a decision):
`accept`, `counter`, `reject`, `walkAway` or `refuse`; recorded at
`contracts.reaction` / `<negotiationId>:<round>` when the day runs (ECO5-05).
The first rule that matches decides:

| Rule                                                                                                | Reaction                                               |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| A refusal, or a role they will not take                                                             | `refuse` ("Won't sign")                                |
| The offer matches their last counter-offer (or betters only its money)                              | `accept` ("Matches their counter-offer")               |
| Offer value ÷ ask value ≥ `contracts.react.acceptRatio` (0.95)                                      | `accept` ("Likely to accept")                          |
| ≥ `contracts.react.counterRatio` (0.55) and patience left                                           | `counter` ("Will counter")                             |
| ≥ `contracts.react.walkAwayRatio` (0.45) and more patience than `contracts.patience.rejectCost` (1) | `reject` ("Will reject")                               |
| Otherwise                                                                                           | `walkAway`: "Out of patience" or "Far below their ask" |

Refusals, in order: an unhappy renewal (`ask.refusal`, "Won't renew while
unhappy here"); talks that are blocked ([eligibility](#eligibility)); a worker
still cooling off after walking away from this promotion ("Walked away from
talks with you; will talk again on May 3, 2026", from `cooldownUntil` on a
closed negotiation, which eligibility does not check); and a role
(`roles.ts`, `roleMismatch`): a wrestler with a wrestler rating of
`contracts.react.refuseCrewRoleRating` (50) or more offered any other job
("Wants to wrestle"), or anyone offered a role they do not hold, an occasional
wrestler counting as a wrestler ("Has never worked as a referee"). The booker's
job is not a role people hold, so anyone may be offered it.

Patience is the negotiation's (or the worker's [starting patience](#patience)
before talks open). Each offer that does not please them uses up some: a
counter one, a rejection `contracts.patience.rejectCost`, a walk-away or
refusal all of it (`patienceLeft`). A revision sent after a counter-offer
uses one more first ([Rounds](#rounds)). So `contracts.patience.base` 0 turns every
non-acceptance into a walk-away, and `counterRatio` equal to `acceptRatio`
removes the counter band.

**One evaluation** (`evaluate.ts`, `evaluateOffer`): the ask for the offer's
own kind and exclusivity, both contract values, the ratio, the reaction and the
patience left. The preview, the offer commands (ECO5-04) and the review
(ECO5-05) all call it, so the meter on the Negotiation Sheet always shows what
the worker does next (barring a changed ask or patience).

**Preview** `contracts.offerPreview { promotionId, personId, offer,
negotiationId?, renewalOf? }` → `{ offerValue, askValue, ratio, reaction, band,
label, patienceLeft, startPatience, reactionTrace, valueTrace, askValueTrace,
notes }`. It never rolls: a counter shows "They will meet you part of the way".
`notes` carries the plain reasons (a refusal, a kind or exclusive deal you may
not offer, a perk or share that adds nothing). Only the viewer's own
promotions, and only their own open talks with that worker; nothing about a
rival's offer leaves the engine.

Worked example: a worker asks $40,000 a month with a one-month signing bonus
on a 24-month deal, so the ask is worth $40,000 + $40,000 ÷ 24 = $41,666.67 a
month. Offer $24,000 with the same bonus: $24,000 + $1,666.67 = $25,666.67,
**0.616** of the ask → **Will counter**. At 50% of the wage the offer is worth
0.52 (Will reject); at 40%, 0.424 (Will walk away).

## Counter

The worker's counter-offer (`counter.ts`, `counterTermsFor`), recorded at
`contracts.counter` / `<negotiationId>:<round>`. They meet you part of the way,
a little less each round (`formulas/counterWage.ts`):

- concession = (`contracts.counter.concession` 0.30 + a roll from 0 to
  `contracts.counter.concessionSpread` 0.15 on `contracts.counter`) ×
  max(0, 1 − `contracts.counter.roundDecay` 0.25 × (round − 1)): 30–45% in the
  first round, half that in the third, nothing from the fifth;
- the monthly wage, the fee per appearance and the signing bonus each become
  ask − (ask − offer) × concession, rounded to $100 ($10 for a fee), never above
  the ask and never below the offer. One roll moves all three, so the counter
  hangs together ("Meets you 38% of the way");
- every perk they ask for that the offer leaves out is added (they only ask for
  [honoured perks](#enforced-terms));
- a card position below the one they expect is raised to it;
- a length more than `contracts.counter.lengthTolerance` (12) months off the
  one they prefer becomes the one they prefer;
- everything else (kind, exclusivity, brand, role, start, shares, cap) stays as
  offered.

Example: the $24,000 offer above, first round, a roll of 0.08: they meet you
38% of the way, $40,000 − $16,000 × 0.38 = $33,920 → **$33,900** a month.

The counter stays open for `contracts.counter.expiryDays` (7). Paying exactly
what they countered (or more money on the same terms) is accepted. The
`contracts.counter.stopSkip` gate (a skip stopping while a counter waits for
the player) is not built yet: whoever adds it must default it off until the
Negotiation Sheet (ECO5-06) can answer a counter from the day bar.

## Rounds

A negotiation goes back and forth in rounds. Round 1 is the first offer; each
offer the promotion sends after that (a revision, or accepting their counter)
starts the next round. The worker answers each offer when the day runs
(ECO5-05), so pressing Next Day is part of every negotiation.

- **One offer per reply.** While the worker has not answered (`submitted`) or
  is thinking it over (`awaitingReview`) the promotion cannot change the offer:
  `contracts.makeOffer` on a worker you are already talking to is refused with
  `contracts.alreadyNegotiating` ("You are already talking to them: open those
  talks to see where they stand"). After a counter-offer the promotion answers
  with `contracts.respondToCounter`; it can always take an open offer back
  with `contracts.withdrawOffer`.
- **A round costs one point of patience.** The worker's counter-offer uses
  the point when they make it ([Reaction](#reaction): a counter costs 1, a
  rejection `contracts.patience.rejectCost`); sending a revision in reply costs
  nothing more (owner decision, ECO5-05: counter reaction or revision, not
  both). So a worker starting with 3 patience counters three times before the
  next low offer makes them walk away. `evaluateOffer` weighs every offer with
  the negotiation's patience (`roundPatience`), so the preview of a revision,
  the revise command's preview and the reaction when the day runs all agree.
  Paying their counter-offer (or more money on the same terms) counts as
  accepting it.
- **Accepting their counter-offer** makes it the offer and sets
  `awaitingReview`: they decide on `reviewOn` = today +
  `contracts.review.delayDays` (2), so a rival's later bid can still win
  (ECO6). The sheet says "They'll decide on <date>".
- **Ending the talks** closes them as `withdrawn` (outcome `talksEnded`) with
  no cooldown: you can make a fresh offer straight away. Withdrawing is the
  same with outcome `withdrawn`.
- **History** keeps at most 12 rounds (`NEGOTIATION_HISTORY_MAX`); the
  promotion's oldest offers go first, so the worker's counter-offers stay.

## Commands

Everything a promotion does in a negotiation is a command, validated against
the world and logged with the controller that issued it (D-07). The work is in
plain functions that take the issuing controller, so a rival's hiring (ECO6)
and a second human's sealed intents (MP6) use exactly the same path as the
player; the commands add only validation and the command log.

| Command                      | Args                                  | Does                                                                                                               |
| ---------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `contracts.makeOffer`        | `{ promotionId, personId, offer }`    | `submitOffer`: opens talks; returns `{ negotiationId, preview }`                                                   |
| `contracts.offerRenewal`     | `{ employmentId, offer }`             | `submitOffer` with `renewalOf`: renewal talks on the live contract; same result                                    |
| `contracts.respondToCounter` | `{ negotiationId, response, offer? }` | `answerCounter`: `accept`, `revise` (needs `offer`) or `end`; returns `{ negotiationId, status, preview \| null }` |
| `contracts.withdrawOffer`    | `{ negotiationId }`                   | `withdrawNegotiation`: any open talks of yours become `withdrawn`; publishes `negotiation.closed`                  |

`preview` is `contracts.offerPreview`'s band and numbers for the offer as it
was recorded (`offerValue`, `askValue`, `ratio`, `reaction`, `band`, `label`,
`patienceLeft`), from the same `evaluateOffer` call, so the sheet can confirm
without another query and the numbers agree to the cent.

**Opening talks** (`submitOffer`). For a signing it creates the `offered`
employment the talks point at: `startsOn` = the offer's start (today when
null), never before [eligibility](#eligibility)'s `earliestStart`; `endsOn` =
`startsOn` + the length in months; role, push, brand (null when shared) and
terms from the offer; the person's default ring name, no gimmick, alignment
heel for a natural heel else face, morale 0. For a renewal only the
negotiation is created, pointing at the live contract. Both record the ask
(`contracts.ask` / `<negotiationId>:1`; a summary for a computer promotion)
and publish `negotiation.opened`. Every later offer (a revision or an accepted
counter) records the ask for its round and is mirrored on a signing's
`offered` employment (terms, dates, role, push, brand) in the same
transaction, so contract queries see the current offer. Ending or withdrawing
moves that employment `offered → withdrawn` with `endedOn` today. The
functions re-check the offer and throw `InvalidArgumentError` when the rules
refuse it, so a caller that resolves later (MP6) cannot record an offer the
rules refuse.

**The rules** (`validateOffer(read, tunables, input, issuedBy) → Reason[]`),
each a player-facing reason:

| Code                                                                          | When                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `contracts.notYourPromotion`                                                  | the issuer does not run the promotion (a human for their own, the computer for computer promotions: `controlsPromotion`)                                                                                                                               |
| `contracts.unavailable`                                                       | [eligibility](#eligibility)'s reasons ("Retired", "Under an exclusive contract with Crown Pro until …; talks can start on …"), "Already under contract with you: offer a renewal instead"                                                              |
| `contracts.cooldown`                                                          | "Walked away from talks: try again after <date>", from the latest running `cooldownUntil`                                                                                                                                                              |
| `contracts.alreadyNegotiating`                                                | open talks for the pair; the reason's subject is those talks                                                                                                                                                                                           |
| `contracts.kindNotAllowed`, `.exclusiveNotAllowed`                            | the reach reasons from the ask's `allowedKinds` and `exclusiveReasons` ("Written contracts need a reach of 35; yours is 12")                                                                                                                           |
| `contracts.badTerms` (with `field`)                                           | a monthly wage on a per-appearance deal, money below zero, longer than `contracts.offer.maxLengthMonths`, a start that has passed (unless it is the start already on the table), a cap of 0, a share the game does not pay                             |
| `contracts.badBrand`                                                          | a brand of another promotion, or one that is not running                                                                                                                                                                                               |
| `contracts.refusesRole` / `contracts.badRole`                                 | `roleMismatch`: "Wants to wrestle" / "Has never worked as a referee"                                                                                                                                                                                   |
| `contracts.badKindExtra`                                                      | the kind's `extraSchema` fails, or extra fields on a kind without one                                                                                                                                                                                  |
| `contracts.refusesRenewal`                                                    | "Won't renew while unhappy here" (the ask's `refusal`)                                                                                                                                                                                                 |
| `contracts.unknownContract`, `.notRenewable`, `.renewalNotOpen`               | renewals: the contract must be a signed or active one of yours, and talks open `contracts.renewal.windowDays` (180) before it ends ("Talks open 180 days before the contract ends (from May 4, 2027)"); an open-ended contract can be renewed any time |
| `contracts.notCountered`, `.offerRequired`, `.notOpen`, `.unknownNegotiation` | answering: only a `countered` negotiation, a revision needs an offer, closed talks cannot be withdrawn                                                                                                                                                 |

A refused command changes nothing and is logged as `rejected` with its codes.

**Queries.** `contracts.offers { promotionId, status?: 'open' | 'closed' |
'all' }` (default all; open first, then newest) → rows `{ negotiationId,
kind, personId, ringName, imageRef, status, round, patienceLeft,
startPatience, offerSummary { kind, exclusive, monthlyWage, perAppearanceFee,
signingBonus, lengthMonths }, counterSummary | null, counterExpiresOn,
reviewOn, closedOn, outcome { code, message, otherPromotionName } | null,
cooldownUntil, competingBidders, reactionTraceRef | null, reviewTraceRef |
null }`. `contracts.negotiation { negotiationId }` → the same row plus
`offer`, `lastCounter`, `history` (each round with a one-line `summary`, "$9,000
a month, 12 months, exclusive", and a `reactionLabel`) and `ask` (what they
ask now for the kind on the table, every number with its Why?). Both answer
only for the viewer's own promotions (`invalidArgs` otherwise).
`competingBidders(read, personId, exceptPromotionId)` gives the names of the
other promotions with open talks for the worker, sorted, and nothing else:
never their terms, rounds or amounts. With no rival hiring yet (ECO6) it only
ever names another human's promotion.

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
| `share.gateBp`       | EVT6's box office pays the share at every show (`boxOffice/enforcedTerms.ts`)  |
| `share.merchBp`      | EVT6's box office pays the share of the live merch                             |

Only honoured terms add [contract value](#contract-value), and workers only ask
for honoured perks. Each feature registers its own term through
`registerEnforcedTerm`, never by editing this system. Not honoured yet, so they
add nothing:

| Term                   | Waits for                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `perk.noHouseShows`    | a house-show booking check that holds (EVT2's card check only warns the player today; rival cards honour it) |
| `perk.creativeControl` | CRTV (creative control)                                                                                      |
| `share.broadcastBp`    | ECO2 (TV money)                                                                                              |

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

ECO5-04's actions publish `negotiation.opened` (opening talks) and
`negotiation.closed` (withdrawing or ending them). See also
[day-pipeline.md](day-pipeline.md#domain-events).

## Tunables

See [tunables.md](tunables.md#negotiation-tunables).
