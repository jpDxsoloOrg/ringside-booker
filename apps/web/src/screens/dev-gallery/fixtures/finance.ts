import { cents, inputOf, parseGameDate, parseId, startCalc, yearMonthOf } from '@ringside/engine';
import type {
  CompanyView,
  FinanceOverview,
  FinancePolicyPreview,
  TraceNode,
  Traced,
  YearMonth,
} from '@ringside/engine';

/**
 * Finances as `finance.overview`, `finance.company` and `finance.policyPreview` might return them,
 * for the gallery's finance entries. Gallery data only, all invented; no engine is asked.
 */

/** `2027-02` as a month. */
function monthOf(text: string): YearMonth {
  return yearMonthOf(parseGameDate(`${text}-01`));
}

const MONTHS: readonly YearMonth[] = [
  '2026-03',
  '2026-04',
  '2026-05',
  '2026-06',
  '2026-07',
  '2026-08',
  '2026-09',
  '2026-10',
  '2026-11',
  '2026-12',
  '2027-01',
  '2027-02',
].map(monthOf);

function monthEnds(values: readonly number[]): FinanceOverview['monthEndCash'] {
  return MONTHS.map((month, index) => ({ month, cash: values[index] ?? 0 }));
}

function payrollTrace(monthly: number, contracts: number): TraceNode {
  return startCalc('Monthly payroll', inputOf(`${String(contracts)} paid contracts`, monthly), {
    unit: 'money',
  }).done().trace;
}

/** Monthly payroll spread over the year, as the payroll phase works it out. */
function dailyWagesOf(monthly: number): Traced<number> {
  return startCalc('Daily wages', inputOf('Monthly payroll', monthly), { unit: 'money' })
    .multiply('Months a year', 12)
    .divide('Days a year', 365.25)
    .round('round')
    .done();
}

const BIG_PAYROLL = 92_400_000;
const BIG_DAILY = dailyWagesOf(BIG_PAYROLL);
const NO_DAILY = dailyWagesOf(0);

/** A national company in the black, a year into the game. */
export const galleryOverviewInTheBlack: FinanceOverview = {
  promotionId: parseId('promotion', 'pro_0000000001'),
  date: parseGameDate('2027-02-14'),
  cash: cents(1_215_000_000),
  cashTraceRef: null,
  thisMonth: {
    month: monthOf('2027-02'),
    income: 48_500_000,
    costs: -41_200_000,
    net: 7_300_000,
  },
  lastMonth: {
    month: monthOf('2027-01'),
    income: 96_000_000,
    costs: -101_400_000,
    net: -5_400_000,
  },
  monthlyPayroll: BIG_PAYROLL,
  monthlyPayrollTrace: payrollTrace(BIG_PAYROLL, 42),
  dailyWages: BIG_DAILY.value,
  dailyWagesTrace: BIG_DAILY.trace,
  paidContracts: 42,
  monthEndCash: monthEnds([
    1_000_000_000, 1_040_000_000, 1_085_000_000, 1_060_000_000, 1_110_000_000, 1_150_000_000,
    1_170_000_000, 1_195_000_000, 1_230_000_000, 1_262_000_000, 1_207_700_000, 1_215_000_000,
  ]),
  policies: { travel: 2, catering: 1, medical: 2 },
};

/** A small company in the red, three weeks into the game: no trend yet. */
export const galleryOverviewInTheRed: FinanceOverview = {
  promotionId: parseId('promotion', 'pro_0000000002'),
  date: parseGameDate('2027-02-21'),
  cash: cents(-2_480_000),
  cashTraceRef: null,
  thisMonth: {
    month: monthOf('2027-02'),
    income: 1_200_000,
    costs: -4_680_000,
    net: -3_480_000,
  },
  lastMonth: null,
  monthlyPayroll: 0,
  monthlyPayrollTrace: payrollTrace(0, 0),
  dailyWages: NO_DAILY.value,
  dailyWagesTrace: NO_DAILY.trace,
  paidContracts: 0,
  monthEndCash: monthEnds([
    1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000, 1_000_000,
    1_000_000, 1_000_000, 1_000_000, -2_480_000,
  ]),
  policies: { travel: 0, catering: 0, medical: 1 },
};

/** The month the red company's game started in. */
export const GALLERY_RED_START_MONTH = monthOf('2027-02');

function companyTraces(
  reach: number,
  label: string,
): Pick<CompanyView, 'reachTrace' | 'sizeTrace'> {
  return {
    reachTrace: startCalc('Reach', inputOf('Popularity, weighted by level', reach)).done().trace,
    sizeTrace: inputOf(`Size at reach ${String(reach)}`, label).trace,
  };
}

/** A national company with room to grow. */
export const galleryCompanyNational: CompanyView = {
  promotionId: parseId('promotion', 'pro_0000000001'),
  name: 'Harbor City Wrestling',
  reach: 34.94,
  ...companyTraces(34.94, 'National'),
  size: 'national',
  sizeLabel: 'National',
  nextSize: { size: 'continental', label: 'Continental', at: 45 },
};

/** A local company with nobody on a monthly wage. */
export const galleryCompanyLocal: CompanyView = {
  promotionId: parseId('promotion', 'pro_0000000002'),
  name: 'Hardpan Pro',
  reach: 3.6,
  ...companyTraces(3.6, 'Local'),
  size: 'local',
  sizeLabel: 'Local',
  nextSize: { size: 'regional', label: 'Regional', at: 6 },
};

function levelTrace(label: string, cost: number): TraceNode {
  return startCalc(label, inputOf('People under contract', 40))
    .multiply('Rate per person a month', cost / 40)
    .done().trace;
}

/** Medical at all four levels, today at Basic, with a registered effect line on each. */
export const galleryMedicalPreview: FinancePolicyPreview = {
  area: 'medical',
  current: 1,
  levels: [
    {
      level: 0,
      label: 'None',
      monthlyCost: 0,
      monthlyCostTrace: levelTrace('Medical at None', 0),
      delta: -600_000,
      effects: [{ text: 'Injuries heal slower', tone: 'negative' }],
    },
    {
      level: 1,
      label: 'Basic',
      monthlyCost: 600_000,
      monthlyCostTrace: levelTrace('Medical at Basic', 600_000),
      delta: 0,
      effects: [{ text: 'Injuries heal at the usual pace', tone: 'neutral' }],
    },
    {
      level: 2,
      label: 'Good',
      monthlyCost: 2_400_000,
      monthlyCostTrace: levelTrace('Medical at Good', 2_400_000),
      delta: 1_800_000,
      effects: [{ text: 'Injuries heal faster', tone: 'positive' }],
    },
    {
      level: 3,
      label: 'Premium',
      monthlyCost: 6_000_000,
      monthlyCostTrace: levelTrace('Medical at Premium', 6_000_000),
      delta: 5_400_000,
      effects: [
        { text: 'Injuries heal much faster', tone: 'positive' },
        { text: 'The roster notices the care', tone: 'neutral' },
      ],
    },
  ],
};
