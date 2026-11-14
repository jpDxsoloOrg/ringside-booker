# Contracts

The contracts system (`packages/engine/src/systems/contracts/`) moves every
contract in the world along its lifecycle over time: signed deals start on
their start date, active deals end on their end date, and every ending goes
through one door. It also keeps the per-contract state the later contract
features need (expiry notices, the unhappy clock, release requests and how a
contract ended).

ECO4-01 built the lifecycle, the `endEmployment` door, the contract events,
the `contractConcerns` table and the simple rival renewal. ECO4-02 added
severance, releases, the contract queries, the "expiring soon" stop and a
temporary automatic renewal of the player's contracts. ECO4-03 added unhappy
workers, release requests, refusals and walk-outs. ECO4-04 (the live
Contracts screen) and ECO4-05 fill in their sections below.

Rival contracts are private: no query for the player shows a rival's terms,
morale or concern rows, and the traces of rival renewals and rival severance
are stored as summaries only.

| Piece       | Where                                                        | What it does                                                                                             |
| ----------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Tunables    | `tunables.ts`                                                | The simple rival renewal's numbers, category `Contracts`                                                 |
| Streams     | `streams.ts`                                                 | `contracts.ai-renewal` (rival renewals) and `contracts.walkout` (walk-out rolls)                         |
| Events      | `events.ts`                                                  | `contract.started`, `.expired`, `.released`, `.quit`, `.renewed`, `.releaseRequested`, `.releaseRefused` |
| Door        | `endEmployment.ts`                                           | `endEmployment`: the one way a contract ends                                                             |
| Lifecycle   | `lifecycle.ts`                                               | the day's work, and the `afterLifecycle` hooks                                                           |
| Renewals    | `renewals.ts`                                                | the renewal policy registry                                                                              |
| Rival rule  | `simpleRivalRenewal.ts`                                      | the built-in `contracts.simpleRivalRenewal` policy                                                       |
| Formula     | `formulas/aiRenewalDecision.ts`                              | `aiRenewalDecision`: renew or let go, and for how long                                                   |
| Titles      | `titles.ts`                                                  | `titlesHeldBy`: the titles a person holds today                                                          |
| Trace kinds | `traceKinds.ts`                                              | `contracts.severance`, `contracts.aiRenewal`, `.unhappy`, `.walkout`, `.aiRelease`                       |
| Phase       | `phases.ts`                                                  | `contracts.lifecycle` (daily, `contracts` group, order 10) and the `contracts.beforeShow` hook           |
| Concerns    | `model/entities/contract-concern.ts`                         | the `contractConcerns` table                                                                             |
| Severance   | `formulas/severance.ts`                                      | `severance`: what ending a contract costs (ECO4-02)                                                      |
| Severance   | `severanceFor.ts`                                            | `severanceFor`: the one place that gathers a contract's inputs for it                                    |
| Release     | `release.ts`                                                 | `releaseEmployment`: every release (the command, ECO9 budget cuts, SOC6 conduct releases)                |
| Rules       | `rules.ts`                                                   | `releaseRefusals`: what the preview and the command refuse                                               |
| Commands    | `commands.ts`                                                | `contracts.release`, `contracts.acknowledgeExpiries`                                                     |
| Queries     | `queries.ts`                                                 | `contracts.releasePreview`, `.list`, `.detail`, `.counts`, `.changesSince`                               |
| Notices     | `notices.ts`                                                 | the `contracts.expiryNotices` after-lifecycle hook                                                       |
| Gate        | `gates.ts`                                                   | `contracts.expiringSoon`                                                                                 |
| Stopgap     | `playerAutoRenewal.ts`                                       | `contracts.playerAutoRenewal`: the player's contracts renew by themselves until ECO5                     |
| Unhappy     | `unhappy.ts`, `phases.ts`                                    | `contracts.unhappyWorkers` (daily, order 30): clocks, requests, walk-outs (ECO4-03)                      |
| Requests    | `requests.ts`                                                | `raiseRequest`, `grantRequest`, `refuseRequest`, `walkoutChanceFor`                                      |
| Story pause | `storyPause.ts`                                              | `hotStorylineFor`: the hot storyline that pauses a worker's clock and rolls (D-09)                       |
| Formulas    | `formulas/walkoutChance.ts`, `formulas/aiReleaseDecision.ts` | the daily walk-out chance; how a rival answers a request                                                 |
| Answer      | `commands.ts`, `queries.ts`                                  | `contracts.answerReleaseRequest`, `contracts.answerPreview`                                              |
| Gate        | `gates.ts`                                                   | `contracts.releaseRequested`: "Worker wants to leave"                                                    |

## Lifecycle

The contract dates rule:

- `startsOn` is the **first day under contract**;
- `endsOn` is the **first day not under contract** (null = open-ended).

`contracts.lifecycle` runs every day in the `contracts` group (400): after
housekeeping and the rivals' turns, before `shows` (500) and `money` (800). So
a contract that ends today is not on today's show and is not paid today, and
one that starts today is both. This matches the new game's
`contractExpiryFixup`, which already treats an `endsOn` on the first day as
stale.

Each day, in this order, each list in ID order:

1. Every **active** contract with `endsOn <= today` asks the
   [renewal policies](#renewal-policies). The first answer that is not null
   wins. A renewal moves `endsOn` later; anything else expires the contract
   through [`endEmployment`](#end-employment) with reason `contracts.endDate`.
   The person becomes a free agent (no active contract), which the Workers
   browser shows as "Free agent".
2. Every **signed** contract with `startsOn <= today` becomes active and
   publishes `contract.started`. If the person has another active contract
   and either one is exclusive, that one ends first as a quit
   (`how: 'exclusiveDeal'`, reason `contracts.exclusiveDeal`, no severance),
   so `employments.exclusiveConflict` never fires. A person can have only one
   signed or active contract per promotion, so a renewal with the same
   promotion extends the row, never adds one.
3. The `afterLifecycle` hooks run (`registerAfterLifecycle`). ECO4-02 adds the
   expiry notices here.

Ending before starting means a same-day handover never holds two active
contracts. The day's work is idempotent: run twice on the same date it finds
nothing left to do. When the player runs a show of theirs before the day's
phases (`shows.runTonight`), the before-show hook `contracts.beforeShow` runs
the lifecycle first, so the dates rule holds on that show too; the phase then
does nothing. `afterLifecycle` hooks must be idempotent within a day for the
same reason.

The lifecycle never writes appearance counts (EVT3's) and does not touch
bookings on future cards: EVT2's availability check reads the contract's
status. Titles, teams and storylines react to the contract events in their own
features (CRTV1, CRTV3, CRTV5).

### Renewal policies

`registerRenewalPolicy({ id, order, decide })` adds a policy;
`renewalPolicies()` lists them by order, then id. `decide(read, employment,
date, { tunables, rng })` answers:

- `null`: not mine to decide, ask the next policy;
- `{ renew: false }`: let the contract run out;
- `{ renew: true, endsOn, trace }`: extend it to `endsOn` (after today).

A renewal writes only `endsOn`, records its trace at `contracts.aiRenewal` /
`<employmentId>:<date>` (a summary for a computer-run promotion) and publishes
`contract.renewed`. With no policy saying yes the contract expires. Until ECO5
ships, the player's contracts renew by themselves through the temporary
[`contracts.playerAutoRenewal`](#player-renewals) policy (order 50, before the
rival rule's 100).

## End employment

`endEmployment(ctx, { employmentId, to, reasonKey, source, how?, mutual?,
severance?, memo? })` is the one way a contract ends. Expiries, releases
(ECO4-02), quits and walk-outs (ECO4-03), budget cuts and closures (ECO9) and
conduct releases (SOC6) all call it. `ctx` is a door context (the same as the
[workers doors](workers.md#doors)), so phases, reactions and commands can all
call it. It:

1. throws `InvalidArgumentError` unless `canTransition(status, to)` (and, for
   `expired`, the end date has come; for `quit`, `how` is given), which rolls
   the caller's step back;
2. writes `status = to` and `endedOn = today`;
3. clears `managerPersonId` on every other signed or active contract of the
   same promotion that names this person;
4. clears the contract's expiry notice, unhappy clock and release request, and
   writes `ending` on its [concern row](#concerns), creating it if needed;
5. pays any [severance](#severance);
6. publishes exactly one event:

| `to`        | Event               | Payload extras                         |
| ----------- | ------------------- | -------------------------------------- |
| `expired`   | `contract.expired`  | `reasonKey`                            |
| `released`  | `contract.released` | `severance`, `source`, `mutual`        |
| `withdrawn` | `contract.released` | `severance`, `source`, `mutual: false` |
| `quit`      | `contract.quit`     | `how`, `severance`                     |

`withdrawn` is reachable only from `signed` (ECO4-02 uses it to call off a
future deal); it publishes `contract.released` so listeners need one event for
"this deal is off". It returns `{ severance, traceRef, ledgerEntryId, ledgerTraceRef }` (the last
two null when nothing was paid).

## Severance

When the severance handed to `endEmployment` rounds to more than 0 cents, its
trace is recorded at `contracts.severance` / the employment (a summary for a
computer-run promotion), and the money moves through `postMoney` with category
`severance`, the negative amount, `refs.personId`, memo "Severance: <ring
name>" and a trace whose value is that amount. Nothing else moves cash.

### The formula

`severance(inputs, { tunables })` (`formulas/severance.ts`, trace "Severance",
unit money) is front-loaded: the first months still owed are paid in full,
later months only in part, and there is a cap. Breaking a long deal costs more
than breaking a short one, but never the whole remaining wage. Other games pay
a flat amount and make iron-clad deals unreleasable; the curve is our answer
to both. In order:

1. **Monthly value**: the monthly wage for written, development and tour
   deals; for a per-appearance deal, the fee ×
   `contracts.severance.appearancesPerMonth`.
2. **Months owed**: days left ÷ 30.4375 (the constant "Average month: 365.25 ÷
   12 days"). An open-ended deal counts as
   `contracts.severance.openEndedMonths` (branch "Open-ended contract").
3. **Months paid** = min(owed, full) + max(0, min(owed, cap) − full) × tail
   rate, with the lines "First 3 months in full", "Next 6.9 months at 35%" and,
   past the cap, "Beyond 18 months: not paid".
4. × the monthly value.
5. × `contracts.severance.ironCladMultiplier` for an iron-clad contract.
6. × a share the caller passes (a granted release request, ECO4-03), or else,
   when morale ≤ `contracts.severance.mutualMorale`, × (1 −
   `contracts.severance.mutualDiscount`) ("Glad to go (morale −62)").
7. × `contracts.severance.unstartedFactor` for a signed deal that has not
   started ("Deal hasn't started").
8. Rounded down to whole cents, never below 0.

Every tunable at 0 makes its own step pay nothing (all of them at 0 pay
nothing at all).

**Worked example.** A $8,000-a-month lower-card worker with 300 days left owes
300 ÷ 30.4375 = 9.86 months. Months paid: 3 + 6.86 × 0.35 = 5.40. Severance:
$8,000 × 5.3997 = **$43,197.53**. With 1,000 days left (32.9 months owed) it
would be 3 + 15 × 0.35 = 8.25 months, $66,000, the most any $8,000 deal can
cost; an iron-clad one doubles that.

| Key                                       | Kind    | Default | Range    | Unit       | Meaning                                                    |
| ----------------------------------------- | ------- | ------- | -------- | ---------- | ---------------------------------------------------------- |
| `contracts.severance.fullMonths`          | integer | 3       | 0–60     | months     | Months still owed that are paid in full                    |
| `contracts.severance.tailRate`            | number  | 0.35    | 0–1      | ratio      | Share paid for each owed month beyond the full months      |
| `contracts.severance.capMonths`           | integer | 18      | 0–120    | months     | Owed months beyond this are not paid at all                |
| `contracts.severance.openEndedMonths`     | integer | 6       | 0–60     | months     | Months treated as owed on an open-ended deal               |
| `contracts.severance.appearancesPerMonth` | integer | 4       | 0–31     | count      | Monthly value of a per-appearance deal, in appearances     |
| `contracts.severance.ironCladMultiplier`  | number  | 2       | 0–10     | multiplier | Severance on an iron-clad contract is multiplied by this   |
| `contracts.severance.mutualMorale`        | integer | −50     | −100–100 | points     | At or below this morale the worker is glad to go           |
| `contracts.severance.mutualDiscount`      | number  | 0.5     | 0–1      | ratio      | Share of the severance a worker who is glad to go gives up |
| `contracts.severance.unstartedFactor`     | number  | 0.5     | 0–1      | ratio      | Share due when calling off a deal that hasn't started      |

### Releasing a worker

`severanceFor(read, employmentId, date, tunables, mode)` gathers a contract's
inputs (`daysOwed` = days from `date` to `endsOn`, `started` = status is
`active`) and calls the formula. It is the one place severance is worked out:
the preview, the command, `releaseEmployment` and, from ECO4-03, a granted
release request (`mode: 'grant'`, refused until ECO4-03 adds its share).

`releaseEmployment(ctx, { employmentId, source, reasonKey, severanceFactor? })`
(`release.ts`, exported from the engine) is the one function every release
calls: the player's command, ECO9's budget cuts and SOC6's conduct releases. A
`severanceFactor` scales the amount with its own line (`{ value: 0, label:
'Fired for cause' }` pays nothing). An active contract becomes `released`
(mutual when the worker is glad to go); a signed deal that has not started
becomes `withdrawn`. It does not check who may release whom.

- **`contracts.releasePreview { employmentId }`** → `{ kind: 'ok', mode:
'release' | 'withdraw', severance (with its Why?), cashBefore, cashAfter,
warnings }` or `{ kind: 'refused', reasons }`. Warnings: `holdsTitle` ("Holds
  the <title>. If they leave, the title is vacated after 7 days.", from
  `titles.orphanGraceDays`, see
  [titles.md](titles.md#orphaned-champions); CRTV1-03), `ironClad`, `intoDebt` ("This
  puts you $3,197.53 in debt."), `bookedSoon` ("Booked on <show>, <date>." for
  the soonest scheduled or booked show from today, plus "and N more shows")
  and `gladToGo`.
- **`contracts.release { employmentId, expectedSeverance }`** refuses
  `notYourWorker` (the issuer is not the human who runs the promotion),
  `notReleasable` (not active or signed), `isOwner` ("<name> owns the
  promotion…") and `severanceChanged` when `expectedSeverance` differs from a
  fresh `severanceFor` (the day moved since the preview: "The amount changed to
  $X; check it again."). It returns `{ severance, cashAfter, ledgerTraceRef }`.
  The ledger gets one Severance row whose Why? holds the severance trace.

The preview and the command share `releaseRefusals` (`rules.ts`), so they
agree on what is refused and, through `severanceFor`, on the amount to the
cent. Releasing your last referee or announcer is allowed; the booking checks
complain on the next card.

## Simple renewals

A D-01 stopgap until the rival labour market (ECO6). Once contracts expire,
every roster in the world shrinks, so computer-run promotions renew by a
simple, traced rule: the built-in policy `contracts.simpleRivalRenewal`
(`aiRenewalDecision`, "Rival renewal"):

- it answers null (so the contract expires) for a closed promotion, an
  open-ended contract, and whenever AIP1's `aiShortcut` says the Rival rules
  shortcut `ai.contracts.simpleRenewals` does not apply: a promotion the player
  runs, the "Level playing field" setting, or the shortcut turned off (since
  ECO4-05; the shortcut's Why? is the renewal Why?'s first line, and the key
  shows on the "Rival rules" chip). With a level playing field and no ECO6,
  rival contracts just run out;
- rule "Holds a title" (when `contracts.ai.keepChampions` is on, from
  `titlesHeldBy`) or "Push at or above `contracts.ai.keepPushAtOrAbove`":
  renew;
- otherwise a `contracts.ai.renewChance` roll ("Renewal chance") decides.

A renewal's new `endsOn` is the old one plus a roll ("New contract length")
from `contracts.ai.renewMinDays` to `contracts.ai.renewMaxDays` (a minimum
above the maximum is read as the swapped range). On a save loaded long after
the old end date, the length counts from today. Keepers draw once (the
length); anyone else draws the renewal roll and, when renewed, the length.

ECO4-05 moved the level-playing-field read to AIP1's `aiShortcut`. It swaps
`titlesHeldBy` for CRTV1's once CRTV1 is on main (not yet: CRTV1 wires it
from its own pack).

Over three years of the default world the rule keeps every rival at 50 % to
73 % of its starting active roster. The player's own run out completely with
`contracts.autoRenewPlayer` off (the default since ECO5-05: the player renews
through contract talks); with it on the player keeps every contract (see
[Player renewals](#player-renewals)).

## Expiring soon

ECO4-02. A long skip stops before one of your important contracts runs out, so
you never learn about it after the fact.

- **The notice.** The after-lifecycle hook `contracts.expiryNotices`
  (`notices.ts`, order 10) runs after each day's ends and starts. For every
  promotion a human runs, each `active` contract with an end date
  within `contracts.expiringSoon.days` days, for a worker pushed at
  `contracts.expiringSoon.minPush` or higher, gets `expiryNotice = { raisedOn:
today, seenOn: null }` on its concern row, unless it already has one. A
  notice whose contract is no longer active, or whose end date moved out of
  the window (a renewal), is cleared the same way. With
  `contracts.expiringSoon.stopSkip` off a new notice is written already seen,
  so the screen still lists it and nothing stops. Rival contracts never get
  notices; a world no human plays never raises one.
- **The gate.** `contracts.expiringSoon` (`gates.ts`, "Contract expiring
  soon") reads only the `unseenExpiry` index, skips notices whose contract is
  no longer active and hits with "Contract expiring soon: <ring name> (ends
  <date>)" (+ " and N more"), subject the employment, hint `contracts`, for the
  soonest end date (ties by id).
- **Seeing it.** `contracts.acknowledgeExpiries { employmentIds | 'all' }` sets
  `seenOn` on the viewer's unseen notices; another promotion's contract is
  refused (`notYourWorker`). Releasing the worker (`endEmployment` clears the
  notice) or a renewal past the window also clears it. The day bar's
  **Contracts** button opens the Contracts screen's Expiring tab (ECO4-04),
  where **Got it** (one row) and **Mark all seen** run it.

**Why the phase decides.** A gate's `check(view, date)` cannot read tunables,
and it runs before every day of a skip, so it must stay a cheap indexed read.
The hook makes the decision with the tunables in hand; the gate only counts
what the hook wrote, the same pattern as the own-injury stop. The cost is a
one-day lag: with `days` 30 the stop comes with 29 days left.

`contracts.list { tab: 'expiring' }` is a wider, quieter view: every active
contract ending within `contracts.expiring.windowDays` (60) days, soonest
first, whatever the push.

| Key                               | Kind    | Default   | Range | Unit   | Meaning                                                                               |
| --------------------------------- | ------- | --------- | ----- | ------ | ------------------------------------------------------------------------------------- |
| `contracts.expiring.windowDays`   | integer | 60        | 1–365 | days   | Contracts ending within this many days are listed as expiring                         |
| `contracts.expiringSoon.days`     | integer | 30        | 0–365 | days   | Raise a notice when one of your contracts ends within this many days (0 = no notices) |
| `contracts.expiringSoon.minPush`  | enum    | `midCard` | push  | choice | Notices only for workers at or above this push (`none` includes crew)                 |
| `contracts.expiringSoon.stopSkip` | boolean | true      |       | flag   | A new expiry notice stops a skip until you mark it as seen                            |

## Scoping

What a viewer sees of contracts (D-07, the same rule as the worker profile's
Career tab):

- `contracts.list`, `contracts.counts` and `contracts.changesSince` cover only
  the viewer's own promotions (`viewerPromotionIds`); a viewer with none (the
  computer, the omniscient viewer) gets empty answers.
- `contracts.detail { employmentId }` answers for any contract in the world.
  For your own (and for the omniscient viewer): every term, shares, appearance
  cap, leave, morale, the notice and the current `severance` with its Why?. For
  a rival's: promotion, role, push, kind, dates, exclusivity and perks only.
  `monthlyWage`, `perAppearanceFee`, `signingBonus`, `shares`, `morale` (and
  the private extras) are left out, not zeroed, and `termsPrivate: true` is
  set.
- `contracts.releasePreview` refuses a rival's contract with only
  `notYourWorker`, so a refusal tells nothing private.
- Rival renewal and severance traces are stored as summaries only.
- Offers that never became contracts (ECO5-04: an `offered` employment, a
  `declined` one, or one `withdrawn` before it was signed; `isUnsignedOffer`)
  are talks, not contracts: `contracts.list`'s Ended tab and
  `contracts.changesSince` leave them out (the talks are on
  `contracts.offers`), and `contracts.detail` answers `null` for another
  promotion's offer, so not even its kind or dates leak
  ([negotiation.md](negotiation.md#commands)).

`contracts.list { tab }` rows: `{ employmentId, personId, promotionId,
ringName, role, push, brandId, status, kind, monthlyWage, perAppearanceFee,
perks, exclusive, startsOn, endsOn, daysLeft, endedOn, endReason,
severancePaid, severanceTraceRef, titles, notice, imageRef }`. Active = active
and signed contracts (a signed row's `startsOn` is in the future); Expiring =
see above; Ended = expired, released, quit and withdrawn, newest `endedOn`
first, with how it ended (`endReason`; a granted request reads `quit`) and the
severance paid, both from the concern row's `ending`.

`contracts.counts` → `{ unseenExpiring, wantsToLeave }` for the nav badge.
`contracts.changesSince { from, to }` → `{ started, expired, released, quit,
requests, renewed }` for the Next Day summary, each `{ employmentId, personId,
ringName, date, how? }`. All but `renewed` are read from the contracts and
concern rows, so a long skip never loses lines to `sim.eventLogSize`;
`renewed` (with `endsOn` and a plain-words `line`) comes from the recent-event
log, because a renewal only moves an end date.

## Player renewals

**Retired by ECO5-05: off by default.** The player now renews through
contract talks (`contracts.offerRenewal`, signed on the review day, see
[negotiation.md#renewals](negotiation.md#renewals)); a contract nobody renews
runs out on its end date and shows on Contracts › Ended. Before ECO5 the player
could not renew, so this stopgap kept the roster. While
`contracts.autoRenewPlayer` is on (now only by override), the built-in
renewal policy `contracts.playerAutoRenewal` (`playerAutoRenewal.ts`, order 50) renews a contract of a promotion the player runs on its end date, on the
same terms, for `contracts.autoRenewPlayerDays` more days (a renewal only
moves `endsOn`, so the last term's length is not known). It goes through the
renewal registry like any renewal: a full Why? ("Automatic renewal", with the
line "Renewed automatically on the same terms, until you can renew contracts
yourself"), `contract.renewed` with source `player`, and a line in
`contracts.changesSince`'s `renewed` list. It answers null for computer and
closed promotions, open-ended contracts and when the tunable is off, so those
contracts expire as before.

ECO5-05 defaulted `contracts.autoRenewPlayer` to off; the policy stays for
saves and tests that turn it on, and can be removed later.

Contracts > **Rules** has a switch for it, "Renew my contracts automatically"
(ECO4-06), shown only while the tunable exists, so the owner can watch a
contract really run out (the Expired path) before ECO5 ships. It goes away with
the tunable.

| Key                             | Kind    | Default | Range  | Unit | Meaning                                                             |
| ------------------------------- | ------- | ------- | ------ | ---- | ------------------------------------------------------------------- |
| `contracts.autoRenewPlayer`     | boolean | false   |        | flag | Temporary: your contracts renew on the same terms when they run out |
| `contracts.autoRenewPlayerDays` | integer | 365     | 1–3650 | days | Temporary: how long each automatic renewal adds                     |

## Unhappy workers

Morale has to lead somewhere (ECO4-03). The daily phase
`contracts.unhappyWorkers` (`contracts` group, order 30: after the lifecycle,
before titles are vacated) looks at every active contract in id order.
Owners never ask to leave (their contract is skipped); bookers and every
other worker do. Closed promotions are skipped.

**The unhappy clock.** A worker whose morale is at or below
`contracts.quit.threshold` (−40) adds a day to their clock on the concern
row (`unhappy: { since, days }`). Morale above the threshold clears the clock,
unless a request is already waiting. Only days in a row count.

**The story pause (D-09).** A worker who is a member of an active storyline
of the same promotion with heat at or above `contracts.quit.storyShieldHeat`
(70) is getting TV time and a story that goes somewhere, so their clock
pauses (it keeps its count, it does not go up) and they are never rolled for
a walk-out. Losing inside a hot angle therefore never ends in a request or a
walk-out. WRK8 owns the morale side of the shield; ECO4-05 makes this read
WRK8's `morale.storyShield.hotHeat` and drops the duplicate tunable.

The clock's Why? is stored for the player's workers at `contracts.unhappy` /
the employment (replaced daily): "Morale −45 at or below −40", "Not in a hot
storyline" or "In a hot storyline (Title Chase, heat 82): clock paused
(D-09)", and "Day 9 of 14". Rival clocks store no trace.

**The request.** On the day the clock reaches `contracts.quit.days` (14; 0
means the first unhappy day) and the worker has no request yet:

- one of the player's workers asks to be released: an open request
  `{ raisedOn, answerBy: raisedOn + contracts.releaseRequest.answerDays,
status: 'open', stopsSkip }` and `contract.releaseRequested`. `stopsSkip`
  copies `contracts.releaseRequest.stopSkip`, so the gate
  `contracts.releaseRequested` ("Big Joe wants to leave", + " and 2 others",
  hint `contracts`) needs no tunable. The stop is on by default: the day
  bar's **Contracts** button opens the request on the Contracts screen
  (ECO4-04), where Grant or Refuse clears it.
- a rival answers at once by its [keep rule](#rival-rules).

**Answering.** `contracts.answerPreview { employmentId }` shows both outcomes:
`grantSeverance` (with its Why?), `cashBefore`, `refuseMoraleDelta`,
`walkoutChanceAfterRefusal` (with its Why?) and `ironClad`.
`contracts.answerReleaseRequest { employmentId, answer }` (refusals
`unknownContract`, `notYourWorker`, `isOwner`, `noOpenRequest`, shared with the
preview):

- **Grant**: the contract ends as a quit (`how: 'granted'`) through
  `endEmployment`, paying `contracts.quit.severanceShare` (0.5) of the normal
  [severance](#severance) ("Agreed share", in place of the glad-to-go
  discount) through `postMoney`. Result `{ severance, cashAfter,
ledgerTraceRef }`.
- **Refuse**: the worker loses `contracts.refuse.moralePenalty` (10) morale
  through WRK1's morale door (reason `contracts.refusedRelease`, "Release
  request refused"), the request is marked `refused`, and
  `contract.releaseRefused` is published. From the next day they may walk out.
  Result `{ walkoutChance }`.

A request left open past its `answerBy` date is refused by the system the
same way, with the label "Release request ignored" (source `system`). With the
stop on, the gate stops every skip first, so this only happens when the stop
is off (or, with ECO4-05, when decision mail expires).

Rows and details of the player's own contracts carry `unhappy: { days, of,
paused, traceRef }`, `request: { status, raisedOn, answerBy }` and `walkout: {
chance, traceRef }`; rival rows never do. `contracts.list { tab, wantsToLeave:
true }` keeps only open requests (the gate's route).
`contracts.counts.wantsToLeave` counts open requests, and
`contracts.changesSince` lists `requests` (also from the event log, so a
granted request still shows) and `quit` with `how`.

## Walk-outs

Each day, before the clock, every refused request is looked at in id order:

- morale above `contracts.quit.threshold` + `contracts.walkout.recoverMargin`
  (10) means the worker settled down: request and clock are cleared, with a
  log line and no event;
- otherwise the daily chance is `walkoutChance`: 0 for an iron-clad contract
  ("Iron-clad contract: never walks out") or a worker in a hot storyline
  ("won't walk out (D-09)"); else `contracts.walkout.chancePerDay` (0.02) plus
  `contracts.walkout.extraPerPoint` (0.001) for every morale point below the
  threshold, capped at `contracts.walkout.maxPerDay` (0.1).
- A chance above 0 is rolled on the `contracts.walkout` stream. A hit ends
  the contract as a quit (`how: 'walkedOut'`, source `system`) with nothing
  paid; `contract.quit` carries `how: 'walkedOut'`. A chance of 0 draws no roll.

The chance and roll are stored for the player's workers at
`contracts.walkout` / the employment. A request refused today is first rolled
tomorrow; the refusal itself stores today's chance there (ECO4-06), so the
Contracts sheet's walk-out chance has its Why? straight away. The Why? reads
"Morale −60: 20 points below −40" and names `contracts.quit.threshold` beside
the walk-out tunables.

## Rival rules

A rival answers its workers' release requests at once with the same keep rule
as its [simple renewals](#simple-renewals) (`formulas/aiReleaseDecision.ts`,
"Rival answers a release request"): a worker who holds one of its titles
(when `contracts.ai.keepChampions` is on) or is pushed at
`contracts.ai.keepPushAtOrAbove` (upper card) or higher is kept, so the
request is refused ("Holds a title (World Title)", "Push main event at or
above upper card"); anyone else is let go ("Lets unhappy workers go") with
the reduced severance paid from the rival's cash. The decision is stored once
at `contracts.aiRelease` / the employment. Refused rival workers face the same
walk-out rolls, so rival rosters move too. Rival clocks, requests and morale
are never shown to the player.

**Decision log (ECO4-05).** Each answer is also one rival decision, kind
`release` (chip "Releases"), written through AIP1's `writeAiDecision` (its
non-job API) from `systems/contracts/decisionLog.ts`: "Let <name> go at their
request (<reason>)" (importance 0) or "Refused to let <name> go (<reason>)"
(importance 1), refs the person, the contract and any titles held, and its
Why? is the stored `contracts.aiRelease` trace. Rival requests stay private:
a grant is revealed the next day like any rival decision (the worker leaves
anyway), a refusal only when the contract ends (a year on for an open-ended
one). The rival and the all-seeing viewer see both at once. Keys
`contracts.decision.release-granted` / `-refused` are in the web's
`contracts` text catalog and the engine's `releaseDecisionText`.

The renewal side of the rival rules reads AIP1's `aiShortcut` (see
[Simple renewals](#simple-renewals)). Rival rosters still shrink: over three
years each rival keeps 50 % to 73 % of its starting roster, since nothing
hires for rivals until ECO6.

## Concerns

`contractConcerns` (`ccn_`, see
[data-model.md](data-model.md#contract-concerns-contractconcerns-ccn_)) holds
one row per contract at most:

- `expiryNotice` `{ raisedOn, seenOn }`: the "expiring soon" notice (ECO4-02);
- `unhappy` `{ since, days }`: the unhappy clock (ECO4-03);
- `request` `{ raisedOn, answerBy, status, answeredOn, mailId, stopsSkip }`:
  a release request (ECO4-03);
- `ending` `{ how, severance, traceRef }`: how the contract ended, written by
  `endEmployment`, so the Ended tab can tell a walk-out from a granted release
  without the event log.

A row whose parts are all null is deleted, never stored. Indexes:
`byEmployment` (unique), `byPromotion`, `unseenExpiry` (key `unseen` while an
expiry notice is unseen) and `openRequest` (key `open` for an open request
that stops a long skip; ECO4-03's gate reads it).
