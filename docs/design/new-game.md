# New game

How a game starts: the preview the new-game wizard reads, the input it sends
back, the settings and setup steps that turn a freshly loaded world into your
game, and founding a promotion of your own.

Code: `packages/engine/src/systems/newgame/`. Both entry points are exported
from `@ringside/engine`:

- `previewWorld(packs, rootPackId)` tells the wizard what a pack set holds.
- `createNewGame(packs, input)` checks your choices and returns a ready engine
  state plus a summary.

Neither one is an engine query or command. They run before any engine exists,
so they are plain functions, but they follow the same rules as the engine API
([engine-api.md](engine-api.md)): arguments are parsed with zod, every refusal
comes back as a `Reason` (`{ code, message, field }`), nothing is thrown for
bad input, and every result is plain JSON. Neither touches storage. The world
stays inside the Web Worker; only the summary crosses to the UI. The worker
host then builds the save with `createSaveDocument` + `encodeSave`, passing
`summary.promotion.id` as `headerPromotionId`.

## Input

`newGameInputSchema` (`input.ts`):

| Field              | Shape                                                            | Notes                                                                    |
| ------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `rootPackId`       | string                                                           | The world pack to start from. Its dependencies load with it.             |
| `seed`             | string, 1–64                                                     | Every random stream and every ID comes from it.                          |
| `startDate`        | `GameDate`, optional                                             | Defaults to the world pack's start date. May not be before it.           |
| `playerId`         | string, 1–64                                                     | The human controller's player ID (the wizard passes the local player's). |
| `playerName`       | string, 1–40                                                     | Stored in `WorldMeta.players` next to the player ID.                     |
| `saveName`         | string, 1–60                                                     | Becomes `WorldMeta.worldName`.                                           |
| `seasonLength`     | `{ preset: '1m' \| '3m' \| '6m' \| '12m' }` or `{ customWeeks }` | See [Season length](#season-length-and-season-1).                        |
| `player`           | `existing` or `found`, see below                                 | Which promotion you run.                                                 |
| `settings`         | `Record<string, boolean \| string>`                              | Registered setting keys only. Anything left out takes its default.       |
| `tunableOverrides` | `Record<string, number>`, optional                               | Checked against each tunable's range and saved with the game.            |

`player` is either `{ mode: 'existing', promotionKey }` (the pack key of a
promotion to take over) or a promotion to found:

| Field           | Shape                         | Notes                                                    |
| --------------- | ----------------------------- | -------------------------------------------------------- |
| `name`          | string, 3–48                  | Must not match another promotion's name, ignoring case.  |
| `shortName`     | string, 2–8 letters or digits | Upper-cased on parse. Must not match another short name. |
| `homeRegionKey` | region pack key               | Must be a loaded region.                                 |
| `style`         | `PromotionStyle`              |                                                          |
| `size`          | `small \| medium \| large`    | See [Founding a promotion](#founding-a-promotion).       |
| `color`         | `#rrggbb`                     | Used by the placeholder logo and the starter-kit belt.   |
| `starterKit`    | boolean                       | A vacant title and a weekly show.                        |
| `weeklyShowDay` | `Weekday` (0 = Monday)        | The starter kit's show day.                              |

### Refusals

| Code                     | Field                      | When                                                         |
| ------------------------ | -------------------------- | ------------------------------------------------------------ |
| `invalidArgs`            | the zod path               | The input does not match the schema.                         |
| `unknownSetting`         | `settings.<key>`           | No setting is registered under that key.                     |
| `invalidSetting`         | `settings.<key>`           | The value does not suit the setting (type or enum option).   |
| `seasonLengthOutOfRange` | `seasonLength.customWeeks` | Custom weeks are not a whole number from 4 to 104.           |
| `invalidTunableOverride` | `tunableOverrides.<key>`   | Unknown tunable or a value outside its range.                |
| `packIssue`              | none                       | The packs do not load; one reason per pack error.            |
| `startDateBeforePack`    | `startDate`                | The chosen start is before the world pack's start date.      |
| `unknownPromotion`       | `player.promotionKey`      | No promotion with that key.                                  |
| `promotionInactive`      | `player.promotionKey`      | The promotion is dormant or closed.                          |
| `nameTaken`              | `player.name`              | Another promotion has that name. The message names it.       |
| `shortNameTaken`         | `player.shortName`         | Another promotion has that short name. The message names it. |
| `unknownRegion`          | `player.homeRegionKey`     | No region with that key.                                     |
| `setupStepFailed`        | none                       | A setup step threw. The result also carries its `report`.    |
| `invalidWorld`           | none                       | The finished world fails its integrity check (a bug).        |

Every check that can run is run, so the wizard gets all the problems with a
form at once rather than one per submit.

## Settings

The wizard renders its options from a registry, `newGameSettings()`
(`settings.ts`). An option appears only once a system has implemented it and
registered it, so there are no dead checkboxes: random winners and owner goals
arrive with the epics that implement them.

```ts
interface NewGameSettingDef {
  key: string; // camelCase, unique
  kind: 'boolean' | 'enum';
  options?: string[]; // enum only
  default: boolean | string;
  label: string;
  description: string; // says exactly what it does, nothing more
  group: 'world' | 'difficulty' | 'advanced';
}
```

Built-in settings:

| Key                        | Kind    | Default | Group      | Stored in                                 | What it does                                                                             |
| -------------------------- | ------- | ------- | ---------- | ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `agingEnabled`             | boolean | true    | world      | `settings.agingEnabled`                   | People age and skills follow age curves (read by the WRK epic).                          |
| `sandbox`                  | boolean | false   | world      | `settings.sandbox`                        | You may edit the world freely.                                                           |
| `generationLevel`          | enum    | `low`   | world      | `settings.generationLevel`                | How much new content appears over time (`off`, `low`, `medium`, `high`).                 |
| `levelPlayingField`        | boolean | false   | difficulty | `settings.levelPlayingField`              | Rival promotions follow exactly the same rules as yours: no simulation shortcuts (D-01). |
| `equalStart`               | boolean | false   | difficulty | `settings.extra.equalStart`               | A one-time reset of cash, prestige and popularity (step 600).                            |
| `randomiseContractLengths` | boolean | false   | advanced   | `settings.extra.randomiseContractLengths` | New random end dates for running contracts (step 500).                                   |
| `rerollPotential`          | boolean | false   | advanced   | `settings.extra.rerollPotential`          | Fresh potential rolls for everyone (step 700).                                           |

The four settings `WorldMeta.settings` names have typed fields; every other
registered setting is stored by key in `WorldMeta.settings.extra`. Systems
read a setting through `getSetting(world, key)`, typed by the
`NewGameSettingMap` interface. A world saved before a setting existed reads as
the setting's default.

**`levelPlayingField` is not `equalStart`.** The level playing field is a
lasting rule that switches off every rival-promotion shortcut. It is stored
now because D-01 makes it a new-game option; until the AIP epic registers the
`ai.*` shortcut tunables and reads the flag, there are no shortcuts for it to
switch off, so on and off play the same. Equal start is a separate, one-time
choice about where everyone begins.

Per-world settings are not tunables ([tunables.md](tunables.md)): tunables are
balance numbers, settings are the rules of this particular game.

## Season length and season 1

Design decision D-08: you choose how long a season is. `season.ts` holds the
presets, all whole weeks so weekly shows divide evenly into seasons:

| Preset | Label     | Days |
| ------ | --------- | ---- |
| `1m`   | 1 month   | 28   |
| `3m`   | 3 months  | 91   |
| `6m`   | 6 months  | 182  |
| `12m`  | 12 months | 364  |

The default is `12m`. A custom season is 4–104 whole weeks, `weeks × 7` days,
which always fits the stored range of 28–730 days.

`createNewGame` resolves the choice to days and passes it to the pack loader
as `settings.season.lengthDays`, so the loaded world already holds season 1:
number 1, active, starting on the start date, ending
`startDate + lengthDays − 1`. Step 800 stores the setting again, so the
stored length and season 1 can never disagree. Season-end processing and
changing the length between seasons belong to the DAY epic.

## Controllers

Design decision D-07: the engine never assumes a single player. Step 300 sets:

- `controller: { kind: 'human', playerId }` on the promotion you chose or
  founded;
- `controller: { kind: 'computer' }` on every other promotion;
- `controller: null` on every brand (a brand is run by its promotion's
  controller until brand wars assign one per brand);
- `WorldMeta.players` to `[{ playerId, displayName }]`, so your name survives
  reloads and more humans can join later;
- `WorldMeta.worldName` to the save name.

Nothing anywhere stores "the player's promotion". You are the booker of the
promotion your controller runs; how ownership and job security work is the
DAY epic's optional owner-goals mode. The save header's promotion comes from
`summary.promotion.id`, passed in by the host.

## Setup steps

Every option that changes the loaded world is a step in a registry
(`steps.ts`), run in ascending `order` through the day pipeline's `runStep`:
each step gets its own transaction, RNG snapshot, event staging and report.
Unlike a day, the first failing step stops new game, and the result is the
reasons plus that step's report, never a world.

| Order | Step                           | Owner | Runs when                  | What it does                                                                                                                           |
| ----- | ------------------------------ | ----- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 100   | `wld.applyTunableOverrides`    | WLD   | always                     | Applies `tunableOverrides`; every later step reads them, and they are saved with the game.                                             |
| 200   | `wld.foundPromotion`           | WLD   | `player.mode` is `found`   | Founds your promotion (below).                                                                                                         |
| 300   | `wld.assignControllers`        | WLD   | always                     | Controllers, players and world name (above).                                                                                           |
| 400   | `wld.contractExpiryFixup`      | WLD   | always                     | A running contract ending on or before the start date gets a new end date 30–180 days after it (stream `newgame.contracts`).           |
| 500   | `wld.randomiseContractLengths` | WLD   | `randomiseContractLengths` | Every running contract with an end date ends `startDate + 30–720` days (stream `newgame.contract-lengths`).                            |
| 600   | `wld.equalStart`               | WLD   | `equalStart`               | Every promotion: cash 1,000,000, prestige 50, popularity 35 in every region of its home country and none elsewhere; all deals removed. |
| 700   | `wld.rerollPotential`          | WLD   | `rerollPotential`          | WLD-07's `reseedPotential` for everyone (stream `newgame.potential`).                                                                  |
| 800   | `wld.storeSettings`            | WLD   | always                     | Stores every setting and the season length in `WorldMeta.settings`.                                                                    |
| 900+  | pricing, production, networks  | ECO   | ECO's own settings         | Expected here, after the equal start reset, so the reset never throws their work away.                                                 |

After the last step, `createNewGame` publishes `world.created`
(`{ startDate, seasonLengthDays, promotionId, playerId }`) from the
`wld.worldCreated` step, checks the finished world with `checkWorld`, and
builds the `EngineState`: `initialEngineState(world)` with the RNG state as
the setup left it, the tunable overrides, and the event log holding
`world.created` as event 1. `createEngine({ state, systems })` accepts it as
it is. No system is subscribed yet when new game runs, so `world.created` is
a record in the event log rather than something a reaction handles; a system
that needs to change the world at new game registers a setup step instead.

The contract fix-up spreads expiries out instead of letting stale contracts
expire on day one, so a pack with sloppy dates doesn't dump half a roster into
free agency on the first morning.

## Founding a promotion

`foundPromotion(ctx, spec)` (`foundPromotion.ts`) takes any step context, so a
mid-game founding feature calls the same function with the same numbers. The
promotion is founded on the start date with no logo (the placeholder art draws
one from its colour), every production level and staff policy at 0, no owner,
no booker and no roster: you hire from the free-agent pool. It is run by the
computer until step 300 hands it to you.

| Size   | Cash      | Home region popularity | Rest of home country | Prestige |
| ------ | --------- | ---------------------- | -------------------- | -------- |
| small  | 75,000    | 8                      | 2                    | 20       |
| medium | 300,000   | 20                     | 8                    | 35       |
| large  | 1,200,000 | 35                     | 18                   | 50       |

Popularity elsewhere is zero, so nothing is stored for it.

With the **starter kit** you also get:

- a vacant singles title, "<short name> Championship": open division, one
  holder, prestige 20, the promotion's colour, no image;
- a weekly show, "<short name> Weekly": regular importance, every week on the
  chosen day, 5 slots and no pre-show, not televised, with your home region as
  its preferred region, so the day loop has a show of yours to stop on.

### Tunables

Registered in `systems/world/tunables.ts`. Money is in cents.

| Key                                      | Default      | Range   | Unit   |
| ---------------------------------------- | ------------ | ------- | ------ |
| `newgame.contractFixup.minDays`          | 30           | 1–3650  | days   |
| `newgame.contractFixup.maxDays`          | 180          | 1–3650  | days   |
| `newgame.contractLength.minDays`         | 30           | 1–3650  | days   |
| `newgame.contractLength.maxDays`         | 720          | 1–3650  | days   |
| `newgame.equalStart.cash`                | 100,000,000  | 0–10^11 | money  |
| `newgame.equalStart.homePopularity`      | 35           | 0–100   | points |
| `newgame.equalStart.prestige`            | 50           | 0–100   | points |
| `newgame.found.small.cash`               | 7,500,000    | 0–10^11 | money  |
| `newgame.found.medium.cash`              | 30,000,000   | 0–10^11 | money  |
| `newgame.found.large.cash`               | 120,000,000  | 0–10^11 | money  |
| `newgame.found.<size>.homePopularity`    | 8 / 20 / 35  | 0–100   | points |
| `newgame.found.<size>.countryPopularity` | 2 / 8 / 18   | 0–100   | points |
| `newgame.found.<size>.prestige`          | 20 / 35 / 50 | 0–100   | points |
| `newgame.found.titlePrestige`            | 20           | 0–100   | points |
| `newgame.found.weeklyShowSlots`          | 5            | 3–12    | count  |

When a minimum and maximum cross, the two are swapped rather than failing.

## World preview

`previewWorld(packs, rootPackId)` loads the packs with a fixed seed
(`world-preview`) and returns a `Result` holding:

- `manifest` and `startDate` of the world pack;
- `promotions`: every active promotion, most prestigious first, with its key,
  name, short name, colour, home region and country, style, cash, prestige,
  roster size (wrestlers under an active contract), active title count,
  population-weighted popularity across its home country, how many regions
  know it, and its active brands;
- `topWorkers`: the 20 best-known active wrestlers, ranked by their best
  country-level (population-weighted) popularity, with ring name, promotion
  short name (null for a free agent), age, ring style and that popularity
  summary;
- `peopleCount`: how many active people (wrestlers and staff, employed or not)
  the world starts with;
- `regions`: continents → countries → regions with populations, for the
  founding form;
- `settings`: every registered setting; some may be hidden in the wizard until a system uses them;
- `seasonLength`: the presets, the default preset and the custom week range;
- `foundingSizes`: each size's cash, home and country popularity and prestige
  from the tunables;
- `takenShortNames` and `takenNames`: what a founded promotion may not use.

The content part is memoised per pack set (pack ids and versions) and frozen;
the settings, season and founding parts are read fresh on every call, so a
setting registered after the first preview still shows up. Pack problems come
back as the pack loader's issues.

## Adding a setting or a step

Another system adds its options without editing anything in `newgame/`:

```ts
// systems/economy/newgame.ts
import { registerNewGameSetting, registerSetupStep } from '../newgame';

declare module '../newgame/settings' {
  interface NewGameSettingMap {
    autoContractPricing: boolean;
  }
}

registerNewGameSetting({
  key: 'autoContractPricing',
  kind: 'boolean',
  default: true,
  label: 'Set contract prices automatically',
  description: 'Every running contract is repriced from the worker’s value at the start.',
  group: 'advanced',
});

registerSetupStep({
  id: 'eco.autoContractPricing',
  order: 900, // after equal start
  when: (settings) => settings['autoContractPricing'] === true,
  run: (tx, ctx) => {
    // ...reads ctx.tunables, ctx.rng('eco.pricing'), writes through tx
  },
});
```

Later the system reads the choice with
`getSetting(world, 'autoContractPricing')`. Rules for a new step:

- Pick an unused order. Registration fails on a duplicate id or order.
- Anything that sets up money, production or TV goes at 900 or above.
- Use your own random stream, so your step never shifts another one's rolls.
- Throw to refuse: the step is rolled back, new game stops, and the player
  sees the reason. A half-configured world is never saved.
