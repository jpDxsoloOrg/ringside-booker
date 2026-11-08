import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT_INVALID, EXIT_OK, EXIT_USAGE, runValidateWorld } from '../src/run';
import { captureIo, copyFixtureRepo, ENGINE_FIXTURE_PACKS, FIXTURE_REPO } from './helpers';

const CHECK_WORLD = 'content/worlds/check-world';

describe('validate-world exit codes', () => {
  it('exits 0 for a valid world, finding its base pack under content/', async () => {
    const io = captureIo(FIXTURE_REPO);
    expect(await runValidateWorld([CHECK_WORLD, '--strict'], io)).toBe(EXIT_OK);
    expect(io.out()).toContain('World report: Check World');
    expect(io.out()).toContain('check-base@1.0.0, check-world@1.0.0');
    expect(io.out()).toMatch(/OK: 0 errors, 0 warnings\n$/);
    expect(io.err()).toBe('');
  });

  it('exits 1 for an invalid world and lists every problem', async () => {
    const io = captureIo(FIXTURE_REPO);
    const code = await runValidateWorld(
      [join(ENGINE_FIXTURE_PACKS, 'mini-world'), join(ENGINE_FIXTURE_PACKS, 'mini-base')],
      io,
    );
    expect(code).toBe(EXIT_INVALID);
    expect(io.out()).toContain(
      'error promotion-staffing mini-world/promotions.json promotion.harbour-city-wrestling: Active promotion harbour-city-wrestling has no referee under contract on 2026-01-05',
    );
    expect(io.out()).toMatch(/FAILED: 8 errors, 4 warnings\n$/);
  });

  it('exits 2 for a missing pack folder', async () => {
    const io = captureIo(FIXTURE_REPO);
    expect(await runValidateWorld(['content/worlds/no-such-world'], io)).toBe(EXIT_USAGE);
    expect(io.err()).toBe('Pack folder not found: content/worlds/no-such-world\n');
  });

  it('exits 2 for bad arguments', async () => {
    for (const argv of [[], [CHECK_WORLD, '--smoke-days', '0'], [CHECK_WORLD, '--nope']]) {
      const io = captureIo(FIXTURE_REPO);
      expect(await runValidateWorld(argv, io), argv.join(' ')).toBe(EXIT_USAGE);
      expect(io.err()).toContain('Usage: validate-world');
    }
  });

  it('passes warnings without --strict and fails them with it', async () => {
    const { root, cleanUp } = await copyFixtureRepo();
    try {
      const employmentsFile = join(root, CHECK_WORLD, 'employments.json');
      const text = await readFile(employmentsFile, 'utf8');
      await writeFile(
        employmentsFile,
        text.replaceAll(/"endsOn": "[^"]+"/g, '"endsOn": "2027-06-01"'),
      );
      const relaxed = captureIo(root);
      expect(await runValidateWorld([CHECK_WORLD], relaxed)).toBe(EXIT_OK);
      expect(relaxed.out()).toMatch(/OK: 0 errors, 1 warning\n$/);
      const strict = captureIo(root);
      expect(await runValidateWorld([CHECK_WORLD, '--strict'], strict)).toBe(EXIT_INVALID);
      expect(strict.out()).toContain('(--strict: warnings fail)');
    } finally {
      await cleanUp();
    }
  });

  it('leaves out the rules --skip-rule names and says so', async () => {
    const io = captureIo(FIXTURE_REPO);
    const code = await runValidateWorld(
      [
        join(ENGINE_FIXTURE_PACKS, 'mini-world'),
        join(ENGINE_FIXTURE_PACKS, 'mini-base'),
        '--skip-rule',
        'promotion-staffing',
      ],
      io,
    );
    expect(io.out()).toContain('Skipped rules: promotion-staffing\n');
    expect(io.out()).not.toContain('error promotion-staffing');
    expect(io.out()).not.toContain('warning promotion-staffing');
    expect(code).toBe(EXIT_INVALID);
  });

  it('refuses to skip the blocklist or a rule that does not exist', async () => {
    const blocklist = captureIo(FIXTURE_REPO);
    expect(await runValidateWorld([CHECK_WORLD, '--skip-rule', 'blocklist'], blocklist)).toBe(
      EXIT_USAGE,
    );
    expect(blocklist.err()).toContain('--skip-rule cannot skip the blocklist rule');
    const unknown = captureIo(FIXTURE_REPO);
    expect(await runValidateWorld([CHECK_WORLD, '--skip-rule', 'no-such-rule'], unknown)).toBe(
      EXIT_USAGE,
    );
    expect(unknown.err()).toContain('--skip-rule names an unknown rule: no-such-rule');
  });

  it('reports broken JSON with the file, line and column', async () => {
    const { root, cleanUp } = await copyFixtureRepo();
    try {
      await writeFile(join(root, CHECK_WORLD, 'titles.json'), '[\n  { "key": "x",, }\n]\n');
      const io = captureIo(root);
      expect(await runValidateWorld([CHECK_WORLD], io)).toBe(EXIT_INVALID);
      expect(io.out()).toContain(
        'error json-syntax check-world/titles.json: Invalid JSON at content/worlds/check-world/titles.json:2:16:',
      );
    } finally {
      await cleanUp();
    }
  });

  it('writes the markdown report with --report and runs the smoke days', async () => {
    const { root, cleanUp } = await copyFixtureRepo();
    try {
      const io = captureIo(root);
      expect(
        await runValidateWorld([CHECK_WORLD, '--report', 'out/report.md', '--smoke-days', '5'], io),
      ).toBe(EXIT_OK);
      const markdown = await readFile(join(root, 'out/report.md'), 'utf8');
      expect(markdown.startsWith('# World report: Check World\n')).toBe(true);
      expect(io.out()).toContain('Report written to out/report.md');
      expect(io.out()).toContain('Smoke run: 5 days advanced with no step errors.');
    } finally {
      await cleanUp();
    }
  });
});
