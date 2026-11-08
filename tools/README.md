# Tools

Headless programs that run the engine outside the browser: the balance harness, data validation,
the default-world builder and the blog tooling.

There is no package at `tools/` itself. Every tool is its own npm workspace in `tools/<name>`, so
each one keeps its own dependency list. The blog tools need a database client, for example, and
the engine tools never should.

## Adding a tool

1. Create `tools/<name>/package.json`:
   - `"private": true` and `"type": "module"`
   - a dependency on `@ringside/engine` if the tool runs the engine (exact version, like every
     other dependency). `tools/blog` only reads Markdown, so it has none.
   - `test` and `typecheck` scripts
2. Create `tools/<name>/tsconfig.json` that extends `../../tsconfig.base.json` with
   `"lib": ["ES2022"]`, `"types": ["node"]`, `"rootDir"`, `"outDir": "dist/types"` and, for a
   tool that runs the engine, a reference to `../../packages/engine`.
3. Add `{ "path": "./tools/<name>" }` to the `references` in the root `tsconfig.json` so
   `npm run typecheck` covers it.
4. Create `tools/<name>/vitest.config.ts`. The root `vitest.config.ts` lists
   `'tools/*/vitest.config.ts'` as a project glob, so the new tool's tests run with `npm test`
   without touching the root config. The glob names the config file instead of plain `'tools/*'`
   because Vitest reads every match of a project glob as a project, and `tools/README.md` would
   match too. Until the first tool lands the glob matches nothing, which Vitest accepts.

The root `workspaces` list already includes `tools/*`, so `npm install` picks the new package up.

Tools may import `@ringside/engine/testing` (or `@ringside/engine/testing/fixtures`, which leaves
out the Vitest assertion helpers so it also loads outside a test run). The lint ban on those entry
points only covers `apps/**` and `packages/*/src/**`.

## Planned tools

| Folder                 | Ticket  | Purpose                                                   |
| ---------------------- | ------- | --------------------------------------------------------- |
| `tools/sim-runner`     | SIM-12  | Headless runner and balance harness for long skips        |
| `tools/validate-world` | WLD-03  | Validates world and content data packs                    |
| `tools/worldgen`       | WLD-09  | Builds the default roster and world shipped in `content/` |
| `tools/blog`           | BLOG-04 | Tooling for the blog series                               |
