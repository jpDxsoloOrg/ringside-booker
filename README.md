# Ringside Booker

A wrestling promotion management game for Windows. You run a promotion: sign the talent, book the
shows, watch them play out and keep the money coming in, while rival promotions run themselves
around you. Every number in the game can explain itself with a **Why?** panel.

It's in **Alpha**, a personal project tested by the owner and a few friends. Saves can break
between Alpha versions.

- [Play it](#play-it)
- [What's in the game](#whats-in-the-game)
- [In development](#in-development)
- [Run it from source](#run-it-from-source)
- [For developers](#for-developers)

## Play it

1. Go to [Releases](https://github.com/jpDxsoloOrg/ringside-booker/releases) and download the
   newest `RingsideBooker-Setup-<version>.exe` (Windows 10 or 11, 64-bit).
2. Run it. Windows may say **"Windows protected your PC"**, because the installer isn't signed.
   Choose **More info**, then **Run anyway**.
3. Keep **Install for me only**, and click through. No admin rights are needed.
4. On first start, enter your **tester code** (the owner gives you one). The game remembers it and
   works offline after that.

Updates arrive inside the game: when a new version is out, the title screen shows **Update
available**, and one click saves, updates and restarts. Your saves live in
`%USERPROFILE%\AppData\LocalLow\jpDxsolo\Ringside Booker\Saves` and survive updates and
uninstalls. A zip of each version is on the Releases page too, if you'd rather not install.

Found a bug? **Settings › Send feedback** opens an email with a bug report attached.

## What's in the game

**Starting a game**

- Take over a promotion in the default world, or found your own from scratch.
- Import a world from a workshop mod: pick one from your Steam workshop folder, or choose any
  folder. The game shows a report of what came in.
- Choose which promotions are active in your world.
- **Draft start:** every wrestler goes into a pool, every promotion starts level (same money and
  popularity, no TV deals, titles vacant), and you draft your roster against the rivals. Picks sign
  for a season, or you negotiate their contracts after the draft.

**Running your promotion**

- **Office:** what needs you today, the lead story, standings, money at a glance and power
  rankings.
- **Roster:** cards or a sortable table, quick looks and full profiles, pushes, injuries and morale.
- **Booking:** build each card from matches and talking segments, with Auto-fill, lengths, a
  running order, venues and a card check that tells you what to fix.
- **Show night:** run the show segment by segment, or sim the rest. **Results** show the rating,
  crowd, gate, viewers, popularity change and a report for every segment.
- **Calendar:** your shows and the whole world's. Create, edit and retire weekly shows, and add
  one-off specials.
- **Match lab:** try any match or talking segment as often as you like without touching your game.

**Creative**

- **Titles:** champions, lineage and prestige; create, award, vacate, retire and reactivate belts.
- **Storylines:** feuds with sides and heat that builds and cools, and a payoff when they end.

**Business**

- **Contracts:** sign free agents through negotiation (they can refuse or counter), renew, release,
  handle people who want to leave, and offer someone a different job.
- **Trades:** swap wrestlers and cash with rival promotions. They accept, refuse or counter, and
  wrestlers have a say. Rivals sometimes offer you trades.
- **Finances:** the verdict, monthly money in and out, a full ledger and spending policies.
- **Networks:** TV deals, proposals, renegotiation and cancellation. **Production** sets how good
  your shows can look and what that costs.

**The world**

- Rival promotions book their own shows, sign people and change their titles.
- **Workers**, **Promotions**, **Event history** and **News** browse the whole world.

**Always there**

- Skip days, weeks or months; a skip stops for your shows and anything that needs you.
- Autosave with backups, a crash screen that gets you back to your last save, in-game Help, and
  the in-game update check.

## In development

The road to the Beta, in order (each finished sprint ships as an Alpha update):

| Next                          | What                                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Division rankings             | Wrestlers ranked in their divisions by record, strength of victory and streak; #1 contender matches; every wrestler's record |
| Seasons                       | Season rollover with a recap, awards and a record book                                                                       |
| Polish and speed              | Faster skips for big imported worlds, and the screens still missing parts                                                    |
| Match options                 | Stipulations, production notes and match plans                                                                               |
| Card flow                     | How the whole card plays, a live forecast while booking, and crews and stakes in ratings                                     |
| Chemistry and prestige        | Pairs build chemistry; titles gain and lose prestige                                                                         |
| Tag teams, stables and brands | Real teams and stables, and brands with a roster split                                                                       |
| Character work                | Gimmicks, turns, managers and tournaments                                                                                    |
| Careers                       | Wrestlers age, grow, decline and retire                                                                                      |
| Morale and the inbox          | Contract morale and an inbox for decisions                                                                                   |
| Goals and difficulty          | Season goals, owner goals, job security and difficulty modes                                                                 |
| Money and business            | Sponsors, merchandise, loans, financial pressure and takeovers                                                               |
| Tours                         | Runs of shows through neighbouring towns                                                                                     |

After the Beta: the locker room, scouting and training (with a free agent mode), smarter rivals, a
living world, development territories, brand wars, editors and mod tools, and localization.
Multiplayer is a stretch goal.

## Run it from source

You can build and run the game yourself. Playing in the Unity editor, or a plain Unity build, doesn't
ask for a tester code. Builds packaged with `game/tools/package-windows.sh` are alpha-channel tester
builds and do, unless you package with `RB_CHANNEL=release`.

**You need:** Windows 10 or 11, [Unity Hub](https://unity.com/download) with Unity
**6000.6.9f1** (the version in `game/ProjectSettings/ProjectVersion.txt`), Node.js 20 and npm 10,
and Git with [Git LFS](https://git-lfs.com/).

1. Clone the repository to a Windows drive (Unity is slow on WSL paths) and fetch the LFS files:

   ```sh
   git clone https://github.com/jpDxsoloOrg/ringside-booker.git
   cd ringside-booker
   git lfs pull
   ```

2. Install the packages and build the engine bundle the game loads:

   ```sh
   npm ci
   node packages/engine-host/scripts/build-bundle.mjs --outfile game/Assets/StreamingAssets/engine/engine.js
   ```

3. In Unity Hub, **Add** the `game` folder and open it with Unity 6000.6.9f1. Open
   `Assets/Scenes/Boot.unity` and press **Play**.

4. To build the game instead: in Unity, **File › Build Profiles › Windows › Build**. From WSL,
   `game/tools/package-windows.sh` builds and zips it, and `game/tools/build-installer.sh` makes
   the installer (it needs Inno Setup 6). See [`game/README.md`](game/README.md) and
   [`game/docs/installer.md`](game/docs/installer.md).

## For developers

The simulation is a TypeScript engine in [`packages/engine`](packages/engine/), embedded in the
Unity game through a JavaScript runtime. The design docs are in [`docs/design/`](docs/design/),
starting with [`architecture.md`](docs/design/architecture.md); the build log is in
[`docs/dev-journal/`](docs/dev-journal/) and the blog in [`docs/blog/`](docs/blog/README.md).
Game-side docs are in [`game/docs/`](game/docs/), and the release notes in
[`CHANGELOG.md`](CHANGELOG.md).

## Requirements (engine and tools)

- Node.js 20.11 or newer (`.nvmrc` pins the 20 line, so `nvm use` picks it up)
- npm 10

## Quick start

```sh
npm ci
npm test
npm run typecheck
```

`npm ci` installs every workspace from the lockfile, `npm test` runs the Vitest suites of every
workspace, and `npm run typecheck` builds the TypeScript project references.

## Scripts

Run these from the repository root.

| Script                 | What it does                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `npm run dev`          | Starts the retired web app's Vite dev server at http://localhost:5173/                        |
| `npm test`             | Runs every Vitest project once (engine, web, tools), without the slow suites                  |
| `npm run test:slow`    | `npm test` with the slow suites too (`RB_SLOW_TESTS=1`)                                       |
| `npm run test:tz`      | Runs the engine's calendar tests in two far-apart time zones                                  |
| `npm run test:watch`   | Runs Vitest in watch mode                                                                     |
| `npm run typecheck`    | `tsc -b` over all project references; declarations go to `dist/`                              |
| `npm run format`       | Formats the repository with Prettier                                                          |
| `npm run format:check` | Checks formatting without writing anything                                                    |
| `npm run build`        | Runs the `build` script of every workspace that has one                                       |
| `npm run lint`         | Runs ESLint over the repository and fails on any warning                                      |
| `npm run lint:fix`     | Runs ESLint and applies the fixes it can make                                                 |
| `npm run verify`       | Format check, lint, typecheck and tests, stopping at a failure                                |
| `npm run verify:full`  | The end-of-sprint run: everything, slow suites included (see [End of sprint](#end-of-sprint)) |
| `npm run sim -- ...`   | Runs the simulation headless (see [Headless runner](#headless-runner))                        |

Each workspace also has its own `test` and `typecheck` scripts, for example
`npm test -w @ringside/engine`.

## Headless runner

[`tools/sim-runner`](tools/sim-runner/) runs the simulation without any UI. It builds a world (or
reads one), advances it through the public engine API and prints a summary: start and end dates,
days per second, step failures by step, events by type and a world hash. The hash is a 64-bit
fingerprint of the whole engine state apart from wall-clock timings and error stacks, so two runs
from the same start with the same arguments must print the same hash.

```sh
# A year on the 300-person roster fixture
npm run sim -- --days 365

# The same summary as JSON
npm run sim -- --days 365 --json

# Run twice from the same start; exit 1 if the two runs end in different worlds
npm run sim -- --days 60 --check-determinism

# Change a tunable for this run only
npm run sim -- --days 365 --tunable health.fatigue.recoveryPerDay=0

# Print one stored calculation trace as a tree once the run ends
npm run sim -- --days 30 --people 20 --trace health.fatigueRecovery:per_0000000002

# Start from a saved engine state (the JSON engine.exportState() returns)
npm run sim -- --days 90 --world path/to/state.json
```

| Option                  | Meaning                                                                         |
| ----------------------- | ------------------------------------------------------------------------------- |
| `--days <n>`            | Days to simulate, 1 to 36500 (required). Runs over ten years make several calls |
| `--world <source>`      | `fixture:roster` (default) or a path to an `EngineState` JSON file              |
| `--seed <text>`         | Seed of the fixture world (default `1`); a state file keeps its own seed        |
| `--people <n>`          | Roster size of the fixture world, 1 to 5000 (default 300)                       |
| `--tunable <key=value>` | Overrides a tunable through the `tunables.setOverride` command (repeatable)     |
| `--json`                | Prints the summary as JSON                                                      |
| `--check-determinism`   | Runs twice from the same start and compares the hash, event counts and failures |
| `--strict`              | Exits 1 when any step fails or a show dated before the end date is still open   |
| `--trace <kind:id>`     | Prints one stored trace at the end                                              |

Exit codes:

| Code | Meaning                                                                         |
| ---- | ------------------------------------------------------------------------------- |
| 0    | The run finished                                                                |
| 1    | The determinism runs differ, or `--strict` found a failed step or an open show  |
| 2    | Bad arguments, a tunable the engine refused, or a world file that can't be read |
| 3    | A gate stopped the run; the gate's reason is printed                            |

There is no option to skip a gate. The fixture world has no player promotion, so a gate that
fires in a headless run means something is wrong with the world.

When two hashes differ, rerun both sides with `--json` and compare the event counts and failures
to narrow it down. A bug report can quote the seed, the day count and the hash.

### Speed baseline

365 days on the 300-person `fixture:roster`, with only the engine's own system and the condition
system registered (`npm run sim -- --days 365`):

| Where                                   | Advance time | Days per second | Whole command |
| --------------------------------------- | ------------ | --------------- | ------------- |
| Local (Intel i5-13600KF, Node 20, WSL2) | 85–100 ms    | 3,600–4,300     | 0.8 s         |
| CI (`ubuntu-latest`, "one-year timing") | 166 ms       | 2,199           | —             |

The budget is 10 seconds for that run on CI hardware. Later systems will slow it down a lot; this
table is the starting point for the performance work.

## CI

Every pull request and every push to `main` runs two jobs side by side in
[`.github/workflows/ci.yml`](.github/workflows/ci.yml), so the checks finish in about 5 minutes:

- `check`: `npm ci`, `npm audit --omit=dev --audit-level=high` (reports only; it never fails the
  job), `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run blog:check`,
  `npm run sim -- --days 60 --check-determinism --strict` (see [Headless runner](#headless-runner)),
  `npm run validate:world -- --strict` and `npm run build`.
- `test`: `npm ci` and `npm test`, without coverage. Run `npm test -- --coverage` locally when you
  want the report.

A PR merges only when both are green. Each job stops after 15 minutes.

Run CI on any branch by hand with `workflow_dispatch` from the Actions tab.

To run the pull request checks locally before pushing:

```sh
npm run verify
```

That is `npm run format:check && npm run lint && npm run typecheck && npm test`, and it stops at
the first step that fails.

### Slow suites

Fast CI matters more than test count (owner decision, 2026-11-13), so the expensive checks stay
out of `npm test` and pull requests: the statistical sweeps over thousands of generated people
and names, the default-world balance harnesses (momentum drift, the Match lab tuning pass), the
CPU-budget speed guards and the 5,000-person real-name sample. They are marked with
`it.runIf(SLOW_TESTS)` or `describe.runIf(SLOW_TESTS)` (engine:
[`packages/engine/test/support/slow.ts`](packages/engine/test/support/slow.ts); web and tools read
`process.env['RB_SLOW_TESTS']` the same way) and run when `RB_SLOW_TESTS=1`:

```sh
npm run test:slow
```

Save compatibility, determinism and the core formulas stay in the default run. A new heavy test
(a year-long sim, a sweep over thousands of draws, a speed budget) goes behind the flag.

### End of sprint

At the end of each sprint, before the sprint is closed, run everything once:

```sh
npm run verify:full
```

It runs the format check, lint, typecheck, `npm run test:slow`, `npm run test:tz` (the calendar
tests in two far-apart time zones), the 60-day determinism sim, the 365-day strict sim, the world
validator, the blog check and the build, stopping at the first failure.

The lint config ([`eslint.config.js`](eslint.config.js)) is where the engine rules below are
enforced: no `any` anywhere, and inside `packages/engine` no `Math.random` (including through
`globalThis`, `window`, an alias of `Math` or a computed key), no wall-clock reads (`Date.now`,
`new Date()`, `performance.now`), no DOM or browser globals, no timers and no imports from `apps/`
or UI libraries. [`packages/engine/test/lint-guards.test.ts`](packages/engine/test/lint-guards.test.ts)
checks that each of those rules still fires, so a dependency update can't switch one off quietly.

## Contributing

Run `npm run verify` before opening a PR; CI runs the same checks plus the build. At the end of
each sprint run `npm run verify:full` (see [End of sprint](#end-of-sprint)).

### Dependency updates

Dependabot ([`.github/dependabot.yml`](.github/dependabot.yml)) opens weekly PRs: one grouped PR
for minor and patch updates of dev dependencies, one for runtime dependencies, and one per GitHub
Actions update. Major versions of the dev toolchain (TypeScript, ESLint, Vitest, Vite and the rest)
are ignored there on purpose: they get upgraded deliberately in their own ticket, with the lint
guards and tests as the safety net. When you add a dev dependency, add it to the `ignore` list in
that file as well, since Dependabot can't scope an ignore rule to dev dependencies on its own.

### Known `npm audit` advisories

CI audits runtime dependencies only (`npm audit --omit=dev`), because only those ship to players.
A full `npm audit` also lists advisories in the dev toolchain. They come from the pinned Vitest 3 /
Vite 5 line (`vitest`, `vite`, `vite-node`, `esbuild`, `tinypool`, `@vitest/*`), the coverage
tooling (`test-exclude`, `glob`, `minimatch`) and `typescript-eslint` (through `minimatch`). None
of them is code that ships in the built game: they affect the local dev server, build tooling and
test runner. The fixes all need major upgrades, so they are left alone until the next deliberate
toolchain upgrade, which clears them in one go. Don't run `npm audit fix --force` to silence them.

The runtime audit currently reports two moderate advisories in `react-router` (through
`react-router-dom` 6). They sit below the `high` level the CI step reports on, and the fix is the
React Router 7 major upgrade, which is a deliberate change of its own.

## Repository layout

npm workspaces monorepo:

```
ringside-booker/
├── packages/
│   └── engine/            @ringside/engine: the simulation. Pure TypeScript, no DOM, no React.
│       ├── src/
│       │   ├── core/      ids, rng, tunables, trace, pipeline, event bus, errors
│       │   ├── model/     entity types + zod schemas, the World store
│       │   ├── systems/   one folder per game system (workers, matches, shows, economy, ...)
│       │   ├── persistence/  save format, versioning, migrations
│       │   └── index.ts   public API
│       └── test/
├── game/                  the Windows game: a Unity project that embeds the engine (see game/README.md)
├── services/
│   └── access/            the small tester-code service (AWS Lambda + DynamoDB)
├── apps/
│   └── web/               the retired web UI (React + Vite), kept for reference
│       └── src/
│           ├── app/       shell, routing, layout, providers
│           ├── screens/   one folder per screen
│           ├── components/ shared UI building blocks
│           ├── worker/    engine host running in a Web Worker
│           ├── storage/   IndexedDB save slots, import/export
│           └── styles/    design tokens, global CSS
├── content/               the shipped fictional world and base data packs (JSON)
├── tools/                 headless runners: balance harness, data validation
└── docs/
    ├── design/            game + technical design docs
    ├── dev-journal/       dated build notes
    └── blog/              blog series
```

`apps/web` is a Vite + React app. Its dev server reads the engine straight from
`packages/engine/src`, so engine edits hot-reload; production builds go through the
`@ringside/engine` package entry. In dev builds `/dev/gallery` lists the shared UI components.
Tools each get their own workspace under `tools/<name>`; see [`tools/README.md`](tools/README.md).

The full architecture is in [`docs/design/architecture.md`](docs/design/architecture.md).

## Engine rules

- **No `any`.** Use `unknown` and narrow it.
- **No `Math.random`.** All randomness comes from the seeded RNG and its named streams.
- **All state lives in the World.** Entities reference each other by ID only.
- **Every number is traced.** Formulas return a value plus the trace that explains it.
- **The engine has no DOM.** It runs the same in the browser, a Web Worker and Node.

## Content

The base world's promotions, wrestlers, titles and events are made up, and any resemblance to
real people or companies is a coincidence. The Alpha's default world also adds the roster of the
owner's own online league; those names are cleared before any wider release (#10905). Worlds
imported from workshop mods are read from the player's own computer and never stored in this
repository.
