import { describe, expect, it } from 'vitest';
import { parseId } from '@ringside/engine';
import type { TitleCardRow } from '@ringside/engine';
import {
  editArgsFromForm,
  emptyTitleForm,
  formErrorsFromReasons,
  parseWeight,
  titleFormFromRow,
  WEIGHT_NOT_A_NUMBER,
} from './titleForm';

type FormRow = Pick<
  TitleCardRow,
  'titleId' | 'name' | 'brandId' | 'holderCount' | 'division' | 'color'
>;

/** Only the fields the form reads; the rest of a card row doesn't matter here. */
function row(): FormRow {
  return {
    titleId: parseId('title', 'tit_0000000001'),
    name: 'Test Crown',
    brandId: null,
    holderCount: 2,
    division: { gender: 'female', minWeightKg: null, maxWeightKg: 70.4 },
    color: '#C9A227',
  };
}

describe('titleForm', () => {
  it('puts each reason under its field, word for word, and the rest at the top', () => {
    const errors = formErrorsFromReasons([
      { code: 'duplicateName', message: 'Already taken.', field: 'name' },
      { code: 'brandInactive', message: 'Not running.', field: 'brandId' },
      { code: 'weightRange', message: 'Limit below minimum.', field: 'division.maxWeightKg' },
      { code: 'holderCountLocked', message: 'Vacate first.', field: 'holderCount' },
      { code: 'notAllowed', message: 'Not yours.' },
    ]);
    expect(errors.fields).toEqual({
      name: 'Already taken.',
      brand: 'Not running.',
      maxWeight: 'Limit below minimum.',
      holderCount: 'Vacate first.',
    });
    expect(errors.general).toEqual(['Not yours.']);
  });

  it('reads weights: empty is no limit, a comma is a decimal point, nonsense is refused', () => {
    expect(parseWeight('')).toBeNull();
    expect(parseWeight(' 93,5 ')).toBe(93.5);
    expect(parseWeight('heavy')).toBeUndefined();
    expect(parseWeight('-4')).toBeUndefined();
  });

  it('fills in from a row, rounding weights, and sends back the exact weight left alone', () => {
    const values = titleFormFromRow(row());
    expect(values).toMatchObject({ gender: 'female', maxWeight: '70', color: '#c9a227' });
    const built = editArgsFromForm(row(), values);
    expect(built.ok && built.args.division).toEqual({
      gender: 'female',
      minWeightKg: null,
      maxWeightKg: 70.4,
    });
    // Unchanged holders are not sent, so a held title can still be renamed.
    expect(built.ok && 'holderCount' in built.args).toBe(false);
  });

  it('stops a weight it cannot read before anything is sent', () => {
    const built = editArgsFromForm(row(), { ...emptyTitleForm(), minWeight: 'abc' });
    expect(built.ok).toBe(false);
    expect(!built.ok && built.errors.fields.minWeight).toBe(WEIGHT_NOT_A_NUMBER);
  });
});
