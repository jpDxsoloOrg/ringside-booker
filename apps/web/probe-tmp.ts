import { readFileSync } from 'node:fs';
import { createEngine, createSaveDocumentSchema, defaultSystems, documentToWorld, initialEngineState, TABLES } from '@ringside/engine';
const raw = JSON.parse(readFileSync('../../packages/engine/test/fixtures/saves/v1-tiny.json', 'utf8'));
const tables = raw.state.world.tables;
const debuts: Record<string, string> = { per_0000000002: '2016-04-09', per_0000000003: '2016-04-16', per_0000000004: '2016-04-23' };
for (const p of tables.people) if (debuts[p.id]) p.debutDate = debuts[p.id];
for (const d of tables.eventDefinitions) d.activeUntil = '2026-04-10';
const golden = createSaveDocumentSchema().parse(raw);
const world = documentToWorld(golden, TABLES);
const engine = createEngine({ state: initialEngineState(world), systems: defaultSystems });
const human = { kind: 'human', playerId: 'player-1' } as const;
console.log(JSON.stringify(engine.command('news.setAlertRules', { rules: { myRoster: true }, stopSkip: true }, human)));
let stops = 0;
for (let i = 0; i < 20; i++) {
  const r = await engine.advanceDays({ maxDays: 30 });
  const d = engine.query('clock.get', {}, { kind: 'omniscient' }) as any;
  console.log(r.daysAdvanced, JSON.stringify(r.stoppedBy).slice(0, 300), d.data?.date, r.failures.length);
  if (r.stoppedBy.kind !== 'gate') break;
  const hits = r.stoppedBy.hits;
  if (hits.some((h: any) => h.gateId === 'news.alert')) { stops++; engine.command('news.ackAlerts', {}, human); }
  if (hits.some((h: any) => h.gateId !== 'news.alert')) { console.log('other gate'); break; }
}
console.log('news stops', stops);
