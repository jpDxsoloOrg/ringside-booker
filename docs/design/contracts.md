# Contracts

The contracts system (`packages/engine/src/systems/contracts/`) moves every
contract in the world along its lifecycle over time: signed deals start on
their start date, active deals end on their end date, and every ending goes
through one door. It also keeps the per-contract state the later contract
features need (expiry notices, the unhappy clock, release requests and how a
contract ended).

ECO4-01 built the lifecycle, the `endEmployment` door, the contract events,
the `contractConcerns` table and the simple rival renewal. ECO4-02 (releases
and expiry notices), ECO4-03 (unhappy workers and walk-outs), ECO4-04 (the
live Contracts screen) and ECO4-05 fill in their sections below. Nothing on
screen changes with ECO4-01.

Rival contracts are private: no query for the player shows a rival's terms,
morale or concern rows, and the traces of rival renewals and rival severance
are stored as summaries only.

| Piece       | Where                                | What it does                                                                                   |
| ----------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Tunables    | `tunables.ts`                        | The simple rival renewal's numbers, category `Contracts`                                       |
| Streams     | `streams.ts`                         | `contracts.ai-renewal`: the rival renewal rolls                                                |
| Events      | `events.ts`                          | `contract.started`, `.expired`, `.released`, `.quit`, `.renewed`                               |
| Door        | `endEmployment.ts`                   | `endEmployment`: the one way a contract ends                                                   |
| Lifecycle   | `lifecycle.ts`                       | the day's work, and the `afterLifecycle` hooks                                                 |
| Renewals    | `renewals.ts`                        | the renewal policy registry                                                                    |
| Rival rule  | `simpleRivalRenewal.ts`              | the built-in `contracts.simpleRivalRenewal` policy                                             |
| Formula     | `formulas/aiRenewalDecision.ts`      | `aiRenewalDecision`: renew or let go, and for how long                                         |
| Titles      | `titles.ts`                          | `titlesHeldBy`: the titles a person holds today                                                |
| Trace kinds | `traceKinds.ts`                      | `contracts.severance` and `contracts.aiRenewal`                                                |
| Phase       | `phases.ts`                          | `contracts.lifecycle` (daily, `contracts` group, order 10) and the `contracts.beforeShow` hook |
| Concerns    | `model/entities/contract-concern.ts` | the `contractConcerns` table                                                                   |

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
`contract.renewed`. With no policy saying yes the contract expires. The
player's contracts are never renewed automatically: until ECO5 ships they
simply run out.

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
"this deal is off". It returns `{ severance, traceRef }`.

## Severance

When the severance handed to `endEmployment` rounds to more than 0 cents, its
trace is recorded at `contracts.severance` / the employment (a summary for a
computer-run promotion), and the money moves through `postMoney` with category
`severance`, the negative amount, `refs.personId`, memo "Severance: <ring
name>" and a trace whose value is that amount. Nothing else moves cash. How
much severance a release costs is ECO4-02's.

## Simple renewals

A D-01 stopgap until the rival labour market (ECO6). Once contracts expire,
every roster in the world shrinks, so computer-run promotions renew by a
simple, traced rule: the built-in policy `contracts.simpleRivalRenewal`
(`aiRenewalDecision`, "Rival renewal"):

- it answers null (so the contract expires) for a promotion the player runs,
  for a closed promotion, when `ai.contracts.simpleRenewals` is off, and under
  the "Level playing field" setting. With a level playing field and no ECO6,
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

ECO4-05 moves the level-playing-field read to AIP1's `aiShortcut` and swaps
`titlesHeldBy` for CRTV1's once both are on main.

Over three years of the default world the rule keeps every rival at 50 % to
73 % of its starting active roster (the player's own run out completely, as
intended until ECO5).

## Expiring soon

ECO4-02.

## Unhappy workers

ECO4-03.

## Walk-outs

ECO4-03.

## Rival rules

ECO4-05.

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
