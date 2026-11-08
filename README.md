# Ringside Booker

A wrestling promotion management sim that runs in your browser. You book the shows, sign the
talent and keep the money coming in while rival promotions run themselves around you. The
promotions, wrestlers and titles are all original and fictional, there is no server, and your
saves stay on your machine.

Work in progress. Design docs are in [`docs/design/`](docs/design/), and the build log is in
[`docs/dev-journal/`](docs/dev-journal/).

## Docs

- Design: [`docs/design/`](docs/design/) for the game and technical design, starting with
  [`architecture.md`](docs/design/architecture.md)
- Dev journal: [`docs/dev-journal/README.md`](docs/dev-journal/README.md), dated notes on how
  the game gets built
- Blog: [`docs/blog/README.md`](docs/blog/README.md), the public post series, with its tooling in
  [`tools/blog/`](tools/blog/)

## Requirements

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

| Script                 | What it does                                                     |
| ---------------------- | ---------------------------------------------------------------- |
| `npm run dev`          | Starts the web app's Vite dev server at http://localhost:5173/   |
| `npm test`             | Runs every Vitest project once (engine, web, tools)              |
| `npm run test:watch`   | Runs Vitest in watch mode                                        |
| `npm run typecheck`    | `tsc -b` over all project references; declarations go to `dist/` |
| `npm run format`       | Formats the repository with Prettier                             |
| `npm run format:check` | Checks formatting without writing anything                       |
| `npm run build`        | Runs the `build` script of every workspace that has one          |
| `npm run lint`         | Runs ESLint over the repository and fails on any warning         |
| `npm run lint:fix`     | Runs ESLint and applies the fixes it can make                    |
| `npm run verify`       | Format check, lint, typecheck and tests, stopping at a failure   |

Each workspace also has its own `test` and `typecheck` scripts, for example
`npm test -w @ringside/engine`.

## CI

Every pull request and every push to `main` runs the `check` job in
[`.github/workflows/ci.yml`](.github/workflows/ci.yml). It runs, in order:

1. `npm ci`
2. `npm audit --omit=dev --audit-level=high` (reports only; it never fails the job)
3. `npm run format:check`
4. `npm run lint`
5. `npm run typecheck`
6. `npm test -- --coverage` (the coverage report is kept as a build artifact for 7 days)
7. `npm run build`

A PR merges only when `check` is green.

To run the same sequence locally before pushing:

```sh
npm run verify
```

That is `npm run format:check && npm run lint && npm run typecheck && npm test`, and it stops at
the first step that fails.

The lint config ([`eslint.config.js`](eslint.config.js)) is where the engine rules below are
enforced: no `any` anywhere, and inside `packages/engine` no `Math.random` (including through
`globalThis`, `window` or an alias of `Math`), no wall-clock reads (`Date.now`, `new Date()`,
`performance.now`), no DOM or browser globals, no timers and no imports from `apps/` or UI
libraries. [`packages/engine/test/lint-guards.test.ts`](packages/engine/test/lint-guards.test.ts)
checks that each of those rules still fires, so a dependency update can't switch one off quietly.

## Contributing

Run `npm run verify` before opening a PR; CI runs the same checks plus the build.

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
├── apps/
│   └── web/               the game UI. React + Vite. Talks to the engine through a Web Worker.
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

## Content is fictional

Every promotion, wrestler, title and event in this repository is made up. Any resemblance to
real people or companies is a coincidence.
