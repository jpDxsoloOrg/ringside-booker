# Match rating

How a single segment on a card is judged: where it sits, how long it runs
without minutes, how much it counts, and (in later MTCH1 sections) how its
rating is worked out. The `match` system
(`packages/engine/src/systems/match/`) owns all of it; the match types, angle
types and win methods it reads are the runtime catalogs described in
[data-packs.md](data-packs.md#match-and-segment-catalogs).

Nothing here is stored. Every value is derived from the card when it is asked
for, so moving a segment can never leave a stale role or class behind.

## D-10 in short

[D-10](design-decisions.md#d-10-cards-are-built-from-segment-slots-not-minutes-2026-11-07)
says you never set minutes. A show has a number of segment slots, and a
segment's position decides its **role**. The role implies a **duration class**
(short, standard or long) and a **weight** (how much it counts toward the show
score). The main event is always the long, heaviest slot. A match type can move
the duration class one step up or down.

## Slots

Three pure functions in `systems/match/slots.ts`, each returning a traced value
so a "Why?" panel can show the rule that decided it. All three are exported
from `@ringside/engine`.

| Question                     | Function                                     | Returns                 |
| ---------------------------- | -------------------------------------------- | ----------------------- |
| Which role does a slot have? | `slotRoleOf({ slot, slots, preShow }, deps)` | `Traced<SlotRole>`      |
| How long does it run?        | `durationClassOf({ role, matchType }, deps)` | `Traced<DurationClass>` |
| How much does it count?      | `slotWeightOf({ role }, deps)`               | `Traced<number>`        |

`deps` is `{ tunables }`. Slots are 1-based and counted separately on the
pre-show and the main card.

### Slot role

Rules, checked in this order; the first that holds decides:

| Rule                                                                         | Role       |
| ---------------------------------------------------------------------------- | ---------- |
| The slot is on the pre-show                                                  | Pre-show   |
| Last slot of the main card                                                   | Main event |
| The slot before the main event, on a card of `match.slot.semiMainFromSlots`+ | Semi-main  |
| First slot of the main card                                                  | Opener     |
| Anything else                                                                | Midcard    |

So every main card has exactly one main event, its last slot. A 3-slot card
reads Opener, Midcard, Main event; a 6-slot card reads Opener, Midcard,
Midcard, Midcard, Semi-main, Main event. A slot outside the card throws a
`RangeError`; callers check their input first.

### Duration class

The role gives the base class: `match.slot.durationClass.<role>` for the
pre-show, opener, midcard and semi-main. The main event has no tunable: it is
always long ("D-10: the main event is always the long slot").

The segment's match type then moves the class by its `durationShift` (-1, 0 or
1), never past short or long. In the main event a downward shift is ignored
("Main event stays long"). A talking segment has no match type and is never
shifted. Trace lines read like "Midcard → Standard" and "Battle Royal pushes it
up a step → Long".

### Slot weight

The weight is the tunable `match.slot.weight.<role>`. For the main event it is
the larger of its own weight and every other role's weight ("The main event
never weighs less than another slot"), so no override can make another slot
heavier. A weight of 0 makes that role count for nothing. EVT3 and EVT4 use the
weight for the show score; the Match lab shows it as a chip.

### Tunables

Category `Match: slots`, in `systems/match/tunables.ts`:

| Key                                 | Kind    | Default  | Range               | Unit       |
| ----------------------------------- | ------- | -------- | ------------------- | ---------- |
| `match.slot.weight.preShow`         | number  | 0.4      | 0–5, step 0.05      | multiplier |
| `match.slot.weight.opener`          | number  | 0.9      | 0–5, step 0.05      | multiplier |
| `match.slot.weight.midcard`         | number  | 1        | 0–5, step 0.05      | multiplier |
| `match.slot.weight.semiMain`        | number  | 1.25     | 0–5, step 0.05      | multiplier |
| `match.slot.weight.mainEvent`       | number  | 1.75     | 0–5, step 0.05      | multiplier |
| `match.slot.durationClass.preShow`  | enum    | short    | short/standard/long | choice     |
| `match.slot.durationClass.opener`   | enum    | standard | short/standard/long | choice     |
| `match.slot.durationClass.midcard`  | enum    | standard | short/standard/long | choice     |
| `match.slot.durationClass.semiMain` | enum    | standard | short/standard/long | choice     |
| `match.slot.semiMainFromSlots`      | integer | 4        | 3–12                | count      |

### Worked example: a 6-slot show with one pre-show slot

Default tunables, with a sprint opening, a battle royal in slot 3 and a sprint
in the main event:

| Slot     | Segment      | Role       | Duration class                | Weight |
| -------- | ------------ | ---------- | ----------------------------- | ------ |
| Pre-show | Promo        | Pre-show   | Short (talking, no shift)     | 0.4    |
| 1        | Sprint       | Opener     | Standard, pulled down → Short | 0.9    |
| 2        | Singles      | Midcard    | Standard                      | 1      |
| 3        | Battle Royal | Midcard    | Standard, pushed up → Long    | 1      |
| 4        | Tag Team     | Midcard    | Standard                      | 1      |
| 5        | Singles      | Semi-main  | Standard                      | 1.25   |
| 6        | Sprint       | Main event | Long (main event stays long)  | 1.75   |

Override `match.slot.weight.mainEvent` to 0.5 and the main event still weighs
1.25, the semi-main's weight.

## Queries

Both are open to every viewer and return plain JSON.

- **`match.catalog`** `{ includeHidden? }` → `{ matchTypes, angleTypes,
methods, available }`. The options are the catalog entries in display order
  (hidden ones only when asked), with key, name, short name (the name when the
  entry has none), order, side and size limits, `durationShift`,
  `allowsTitles` and, for methods, `changesTitles`. On a world with no match
  types (a save from before catalogs) every list is empty and `available` is
  false, so a screen can say why.
- **`match.slotRoles`** `{ slots: 3–12, preShowSlots: 0–3, matchTypeKeys? }` →
  one row per slot, pre-show first: `{ slot, preShow, role, roleLabel,
durationClass, durationLabel, weight, roleTrace, durationTrace, weightTrace }`.
  `matchTypeKeys` has one entry per slot (null for a talking segment or an empty
  slot). An unknown key comes back as an `invalidArgs` reason naming its index,
  such as `matchTypeKeys[2]`. The card builder (EVT2) calls this after every
  reorder instead of working roles out itself.
