import { inputOf, parseGameDate, parseId, PRESTIGE_WORLD_FILE_LABEL } from '@ringside/engine';
import type { TitleCardRow } from '@ringside/engine';

/**
 * Sample `titles.list` rows for the Office's Champions panel gallery entry (CRTV1-06): a singles
 * champion, a tag team and a vacant title. Gallery data only: fictional names, fixed numbers.
 */

const PROMOTION = parseId('promotion', 'pro_0000000301');
const MAINSTAGE = parseId('brand', 'brd_0000000301');

function row(
  index: number,
  name: string,
  prestige: number,
  champion: TitleCardRow['champion'],
  holderCount: TitleCardRow['holderCount'] = 1,
): TitleCardRow {
  const titleId = parseId('title', `tit_000000030${String(index)}`);
  return {
    titleId,
    name,
    promotionId: PROMOTION,
    promotionName: 'Gallery Wrestling',
    brandId: MAINSTAGE,
    brandName: 'Gallery Mainstage',
    holderCount,
    division: { gender: 'open', minWeightKg: null, maxWeightKg: null },
    divisionLabel: 'Open',
    prestige,
    prestigeTraceRef: null,
    prestigeTrace: inputOf(
      PRESTIGE_WORLD_FILE_LABEL,
      prestige,
      { kind: 'title', id: titleId },
      'points',
    ).trace,
    status: 'active',
    introducedOn: parseGameDate('2020-01-01'),
    retiredOn: null,
    imageRef: null,
    color: '#C9A227',
    editable: true,
    champion,
  };
}

function person(index: number) {
  return parseId('person', `per_000000030${String(index)}`);
}

export const galleryChampionRows: readonly TitleCardRow[] = [
  row(1, 'Gallery World Championship', 84, {
    reignId: parseId('titleReign', 'trn_0000000301'),
    holders: [{ personId: person(1), ringName: 'Rook Halvorsen', imageRef: null }],
    teamId: null,
    label: 'Rook Halvorsen',
    wonOn: parseGameDate('2026-08-02'),
    daysHeld: 142,
    defences: 6,
  }),
  row(
    2,
    'Gallery Tag Team Championship',
    58,
    {
      reignId: parseId('titleReign', 'trn_0000000302'),
      holders: [
        { personId: person(2), ringName: 'Kai Storm', imageRef: null },
        { personId: person(3), ringName: 'Rex Vale', imageRef: null },
      ],
      teamId: parseId('team', 'tem_0000000301'),
      label: 'Apex Syndicate',
      wonOn: parseGameDate('2026-11-01'),
      daysHeld: 45,
      defences: 2,
    },
    2,
  ),
  row(3, 'Gallery Overclock Championship', 31, null),
];
