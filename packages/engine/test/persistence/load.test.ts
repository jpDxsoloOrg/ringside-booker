import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { JsonObject } from '../../src/core/json';
import { ATTRIBUTE_KEYS } from '../../src/model/entities/person';
import { TABLES } from '../../src/model/tables';
import { encodeSave, serialiseSaveDocument } from '../../src/persistence/codec';
import { inspectSave } from '../../src/persistence/inspect';
import { loadSave, type LoadReport, type TunableOverrideCheck } from '../../src/persistence/load';
import type { SaveDocument } from '../../src/persistence/save-document';
import { worldToDocument } from '../../src/persistence/world-document';
import { gzipJson } from '../support/gzip-json';
import { testId } from '../support/ids';
import { PLACEHOLDER_SIM_STATE, tinySaveDocument } from '../support/saves';

const GOLDEN_SAVE = new URL('../fixtures/saves/v1-tiny.json', import.meta.url);

function failureOf(report: LoadReport) {
  if (report.ok) {
    throw new Error('expected the load to fail');
  }
  return report;
}

/** A deep, writable copy of the tiny save, for tests that break one field. */
function editableDoc(): SaveDocument {
  return structuredClone(tinySaveDocument());
}

const KNOWN_TUNABLES = new Set(['economy.ticketPrice']);

/** A stand-in for the tunables registry's override check: keeps known keys, drops the rest. */
function keepKnownTunables(overrides: JsonObject): TunableOverrideCheck {
  const kept: Record<string, JsonObject[string]> = {};
  const dropped: { key: string; message: string }[] = [];
  for (const [key, value] of Object.entries(overrides)) {
    if (KNOWN_TUNABLES.has(key)) {
      kept[key] = value;
    } else {
      dropped.push({ key, message: `Tunable "${key}" does not exist.` });
    }
  }
  return { kept, dropped };
}

describe('loadSave: success', () => {
  it('loads the v1 golden fixture with no warnings', async () => {
    const report = await loadSave(new Uint8Array(readFileSync(GOLDEN_SAVE)), TABLES);
    if (!report.ok) {
      expect.fail(JSON.stringify(report.issues, null, 2));
    }
    expect(report.warnings).toEqual([]);
    expect(report.migrationsApplied).toEqual([]);
    expect(report.doc.header.worldName).toBe('Test Tiny World');
  });

  it('gives back a world that saves to the same document', async () => {
    const doc = tinySaveDocument();
    const report = await loadSave(await encodeSave(doc), TABLES);
    if (!report.ok) {
      expect.fail(JSON.stringify(report.issues, null, 2));
    }
    const resaved = worldToDocument(report.world, {
      simState: PLACEHOLDER_SIM_STATE,
      headerPromotionId: doc.header.promotionName === null ? null : testId('promotion', 1),
      savedAt: doc.savedAt,
      label: doc.header.label,
      engineVersion: doc.engineVersion,
      ...(doc.header.schemaFingerprint === undefined
        ? {}
        : { schemaFingerprint: doc.header.schemaFingerprint }),
    });
    expect(serialiseSaveDocument(resaved)).toBe(serialiseSaveDocument(doc));
  });

  it('keeps an unknown tunable override out of the world and reports it as a warning', async () => {
    const doc = editableDoc();
    doc.state.tunableOverrides = { 'economy.ticketPrice': 4, 'retired.knob': 2 };
    const report = await loadSave(await encodeSave(doc), TABLES, {
      validateTunableOverrides: keepKnownTunables,
    });
    if (!report.ok) {
      expect.fail(JSON.stringify(report.issues, null, 2));
    }
    expect(report.warnings).toEqual([
      {
        path: 'state.tunableOverrides["retired.knob"]',
        message: 'Tunable "retired.knob" does not exist. The override was dropped.',
      },
    ]);
    expect(report.doc.state.tunableOverrides).toEqual({ 'economy.ticketPrice': 4 });
  });

  it('drops traces the trace check refuses and reports them as warnings', async () => {
    const doc = editableDoc();
    doc.state.traces = { recent: [{ kind: 'old-shape' }, { kind: 'calc' }] };
    const report = await loadSave(await encodeSave(doc), TABLES, {
      validateTraces: () => ({
        kept: { recent: [{ kind: 'calc' }] },
        dropped: [{ path: 'recent[0]', message: 'Unknown trace shape.' }],
      }),
    });
    expect(report).toMatchObject({
      ok: true,
      warnings: [
        { path: 'state.traces.recent[0]', message: 'Unknown trace shape. The trace was dropped.' },
      ],
    });
  });
  it('joins a trace path that starts with an index without a stray dot', async () => {
    const doc = editableDoc();
    doc.state.traces = [{ kind: 'old-shape' }];
    const report = await loadSave(await encodeSave(doc), TABLES, {
      validateTraces: () => ({
        kept: [],
        dropped: [{ path: '[0]', message: 'Unknown trace shape.' }],
      }),
    });
    expect(report).toMatchObject({ ok: true, warnings: [{ path: 'state.traces[0]' }] });
  });
});

describe('loadSave: each stage reports its own failure', () => {
  it('decode: truncated gzip', async () => {
    const bytes = await encodeSave(tinySaveDocument());
    const report = failureOf(await loadSave(bytes.slice(0, bytes.length - 40), TABLES));
    expect(report.stage).toBe('decode');
    expect(report.issues).toHaveLength(1);
  });

  it('parse: not JSON', async () => {
    const report = failureOf(await loadSave(gzipJson('this is not json'), TABLES));
    expect(report.stage).toBe('parse');
    expect(report.issues[0]?.message).toMatch(/not valid JSON/);
  });

  it('parse: JSON that is not an object', async () => {
    const report = failureOf(await loadSave(gzipJson([1, 2, 3]), TABLES));
    expect(report.stage).toBe('parse');
  });

  it("format: another program's file", async () => {
    const report = failureOf(
      await loadSave(gzipJson({ ...tinySaveDocument(), format: 'other' }), TABLES),
    );
    expect(report).toMatchObject({ stage: 'format', issues: [{ path: 'format' }] });
    expect(report.issues[0]?.message).toMatch(/not a Ringside Booker save/);
  });

  it('format: a version that is not a whole number', async () => {
    const report = failureOf(
      await loadSave(gzipJson({ ...tinySaveDocument(), formatVersion: '1' }), TABLES),
    );
    expect(report).toMatchObject({ stage: 'format', issues: [{ path: 'formatVersion' }] });
  });

  it('version: a save from a newer version of the game', async () => {
    const report = failureOf(
      await loadSave(gzipJson({ ...tinySaveDocument(), formatVersion: 99 }), TABLES),
    );
    expect(report.stage).toBe('version');
    expect(report.issues[0]?.message).toMatch(/this save was made by a newer version of the game/i);
  });

  it('version: a format older than v1', async () => {
    const report = failureOf(
      await loadSave(gzipJson({ ...tinySaveDocument(), formatVersion: 0 }), TABLES),
    );
    expect(report.stage).toBe('version');
    expect(report.issues[0]?.message).toMatch(/not supported/);
  });

  it('validate: an attribute out of range, with the full path', async () => {
    const doc = editableDoc();
    doc.state.world.tables.people[12]!.attributes.mic = 140;
    const report = failureOf(await loadSave(await encodeSave(doc), TABLES));
    expect(report.stage).toBe('validate');
    expect(report.issues.map((issue) => issue.path)).toEqual([
      'state.world.tables.people[12].attributes.mic',
    ]);
    expect(report.issues[0]?.message).toMatch(/100/);
  });

  it('validate: a header that is missing a field', async () => {
    const header = Object.fromEntries(
      Object.entries(tinySaveDocument().header).filter(([key]) => key !== 'label'),
    );
    const report = failureOf(await loadSave(gzipJson({ ...tinySaveDocument(), header }), TABLES));
    expect(report).toMatchObject({ stage: 'validate', issues: [{ path: 'header.label' }] });
  });

  it('validate: an injected part schema reports at the part path', async () => {
    const doc = editableDoc();
    doc.state.rng = { streams: { injuries: 'not a state' } };
    const report = failureOf(
      await loadSave(await encodeSave(doc), TABLES, {
        stateParts: { rng: z.strictObject({ streams: z.record(z.string(), z.array(z.number())) }) },
      }),
    );
    expect(report).toMatchObject({
      stage: 'validate',
      issues: [{ path: 'state.rng.streams.injuries' }],
    });
  });

  it('validate: caps the issue list at 50 and counts the rest', async () => {
    const doc = editableDoc();
    const people = doc.state.world.tables.people;
    for (let i = 0; i < 10; i++) {
      for (const attribute of ATTRIBUTE_KEYS) {
        people[i]!.attributes[attribute] = 140;
      }
    }
    expect(ATTRIBUTE_KEYS).toHaveLength(12);
    const report = failureOf(await loadSave(await encodeSave(doc), TABLES));
    expect(report.stage).toBe('validate');
    expect(report.issues).toHaveLength(50);
    expect(report.truncated).toBe(70);
  });

  it('build: two rows with the same ID', async () => {
    const doc = editableDoc();
    const people = doc.state.world.tables.people;
    people[3] = { ...people[3]!, id: people[2]!.id };
    const report = failureOf(await loadSave(await encodeSave(doc), TABLES));
    expect(report).toMatchObject({
      stage: 'build',
      issues: [{ path: 'state.world.tables.people[3]' }],
    });
    expect(report.issues[0]?.message).toMatch(/repeats the ID/);
  });

  it('integrity: a reference to a promotion that does not exist', async () => {
    const doc = editableDoc();
    const employments = doc.state.world.tables.employments;
    const missingPromotion = testId('promotion', 99);
    employments[4] = { ...employments[4]!, promotionId: missingPromotion };
    const report = failureOf(await loadSave(await encodeSave(doc), TABLES));
    expect(report.stage).toBe('integrity');
    const dangling = report.issues.find(
      (issue) => issue.path === 'state.world.tables.employments[4].promotionId',
    );
    expect(dangling?.message).toContain(`missing promotion ${missingPromotion}`);
  });

  it('never throws, even when a hook throws', async () => {
    const report = failureOf(
      await loadSave(await encodeSave(tinySaveDocument()), TABLES, {
        validateTunableOverrides: () => {
          throw new Error('registry exploded');
        },
      }),
    );
    expect(report.stage).toBe('validate');
    expect(report.issues[0]?.message).toMatch(/registry exploded/);
  });
});

describe('inspectSave', () => {
  it('reads the header, format version and engine version', async () => {
    const doc = tinySaveDocument();
    const report = await inspectSave(await encodeSave(doc));
    expect(report).toEqual({
      ok: true,
      header: doc.header,
      formatVersion: 1,
      engineVersion: '0.1.0',
    });
  });

  it('does not validate the world', async () => {
    const doc = editableDoc();
    doc.state.world.tables.people[0]!.attributes.mic = 140;
    expect(await inspectSave(await encodeSave(doc))).toMatchObject({ ok: true });
  });

  it('refuses a bad header at the validate stage', async () => {
    const doc = tinySaveDocument();
    const report = await inspectSave(gzipJson({ ...doc, header: { ...doc.header, label: '' } }));
    expect(report).toMatchObject({
      ok: false,
      stage: 'validate',
      issues: [{ path: 'header.label' }],
    });
  });

  it('refuses a newer save at the version stage', async () => {
    const report = await inspectSave(gzipJson({ ...tinySaveDocument(), formatVersion: 2 }));
    expect(report).toMatchObject({ ok: false, stage: 'version' });
  });
});
