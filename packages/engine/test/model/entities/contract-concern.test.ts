// The contract concerns table (ECO4-01). Design: docs/design/data-model.md, "Contract concerns".
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ContractConcernSchema,
  contractConcernsTable,
  OPEN_REQUEST_KEY,
  UNSEEN_EXPIRY_KEY,
} from '../../../src/model/entities/contract-concern';
import { checkWorld } from '../../../src/model/integrity';
import { TABLES } from '../../../src/model/tables';
import { loadSave } from '../../../src/persistence/load';
import { documentToWorld } from '../../../src/persistence/world-document';
import { TEST_START_DATE } from '../../support/builders/build-row';
import { aContractConcern } from '../../support/builders/promotions';
import { worldBuilder } from '../../support/world-builder';

const BEFORE_CONTRACT_CONCERNS = new URL(
  '../../fixtures/saves/v1-tiny-before-contract-concerns.json',
  import.meta.url,
);

const OPEN_REQUEST = {
  raisedOn: TEST_START_DATE,
  answerBy: TEST_START_DATE,
  status: 'open',
  answeredOn: null,
  mailId: null,
  stopsSkip: true,
} as const;

describe('ContractConcernSchema', () => {
  it('accepts the default row', () => {
    expect(ContractConcernSchema.safeParse(aContractConcern()).success).toBe(true);
  });

  it('refuses a row whose parts are all null', () => {
    expect(ContractConcernSchema.safeParse({ ...aContractConcern(), ending: null }).success).toBe(
      false,
    );
  });

  it('refuses an unknown ending and negative severance', () => {
    const row = aContractConcern();
    expect(
      ContractConcernSchema.safeParse({ ...row, ending: { ...row.ending, how: 'fired' } }).success,
    ).toBe(false);
    expect(
      ContractConcernSchema.safeParse({ ...row, ending: { ...row.ending, severance: -1 } }).success,
    ).toBe(false);
  });
});

describe('contractConcerns table', () => {
  it('is registered under prefix ccn with its indexes', () => {
    expect(TABLES.contractConcerns).toBe(contractConcernsTable);
    expect(contractConcernsTable.indexes.map((index) => index.name)).toEqual([
      'byEmployment',
      'byPromotion',
      'unseenExpiry',
      'openRequest',
    ]);
    expect(aContractConcern().id).toMatch(/^ccn_/);
  });

  it('keys unseen notices and open requests that stop a skip', () => {
    const built = worldBuilder()
      .withGeography('mini')
      .withPromotion({}, (promotion) => promotion.withRoster(3))
      .with('concerns', (context) => {
        const [first, second, third] = context.ids.employments;
        const rows = [
          { employmentId: first!, expiryNotice: { raisedOn: TEST_START_DATE, seenOn: null } },
          { employmentId: second!, request: OPEN_REQUEST, ending: null },
          { employmentId: third!, request: { ...OPEN_REQUEST, stopsSkip: false }, ending: null },
        ];
        for (const overrides of rows) {
          const employment = context.tx.view.tables.employments.require(overrides.employmentId);
          context.insert(
            'contractConcerns',
            aContractConcern(
              {
                ...overrides,
                personId: employment.personId,
                promotionId: employment.promotionId,
              },
              context.sequence,
            ),
          );
        }
      })
      .build();
    const table = built.world.tables.contractConcerns;
    expect(checkWorld(built.world, TABLES, { validateRows: true }).issues).toEqual([]);
    expect(table.lookup('unseenExpiry', UNSEEN_EXPIRY_KEY)).toHaveLength(1);
    expect(table.lookup('openRequest', OPEN_REQUEST_KEY)).toHaveLength(1);
    const promotionId = built.world.tables.employments.require(
      built.ids.employments[0]!,
    ).promotionId;
    expect(table.lookup('byPromotion', promotionId)).toHaveLength(3);
  });
});

describe('saves written before the contract concerns table', () => {
  it('load with an empty table and pass the world checks', async () => {
    const report = await loadSave(new Uint8Array(readFileSync(BEFORE_CONTRACT_CONCERNS)), TABLES);
    if (!report.ok) {
      expect.fail(JSON.stringify(report.issues, null, 2));
    }
    expect(report.doc.state.world.tables.contractConcerns).toEqual([]);
    const world = documentToWorld(report.doc, TABLES);
    expect(checkWorld(world, TABLES, { validateRows: true }).issues).toEqual([]);
  });
});
