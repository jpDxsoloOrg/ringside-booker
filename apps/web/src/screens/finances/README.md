# Business > Finances

`/game/finances` (`routes.game.finances({ tab, month, category })`): the books of the promotion the
local seat runs. The engine side (the ledger, payroll, show costs, policies and the queries) is in
`docs/design/finances.md`; this folder only reads it.

| File                                  | What it does                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| `FinancesScreen.tsx`                  | Heading, the no-promotion empty state, and the lazily loaded view                 |
| `FinancesView.tsx`                    | The tab strip from the registry; `?tab=` in the URL; the `notYourBooks` refusal   |
| `financeRegistry.ts`                  | `registerFinanceTab`, `registerFinanceKpi`, `listFinanceTabs`, `listFinanceKpis`  |
| `builtins.tsx`                        | The built-in tabs and KPI cards (orders 10 to 40)                                 |
| `OverviewTab.tsx`, `kpis.tsx`         | KPI cards (Cash, This month so far, Projected payroll, Company size), by category |
| `MonthlyTab.tsx`                      | Twelve months by category: a table on desktop, one card per month on a phone      |
| `LedgerTab.tsx`                       | Every row, newest first, 100 at a time, filtered by month and category            |
| `PoliciesTab.tsx`, `PolicyPicker.tsx` | Travel, Catering and Medical levels with their monthly cost; `finance.setPolicy`  |
| `financeParams.ts`                    | The URL: tab ids, Ledger filters, month labels                                    |
| `financeParts.tsx`                    | `SignedMoney` (drawn `−$30,357`, read "minus $30,357") and the refusal state      |

## The URL

`?tab=overview|monthly|ledger|policies|<registered id>`; an unknown or hidden tab falls back to
Overview, and Overview itself leaves `?tab` out. The Ledger's filters are `?month=YYYY-MM` and
`?category=<ledger category key>`; values that do not parse are ignored. Tab changes and filter
changes replace the history entry, so Back leaves Finances. Other screens deep-link with
`routes.game.finances({ tab: 'ledger', month: '2027-01', category: 'travel' })`.

## Adding a tab or a KPI card

Another feature adds to the screen from its own folder, without editing it:

```tsx
registerFinanceTab({
  id: 'image', // also the ?tab= value
  label: 'Public image',
  order: 25,
  render: ({ promotionId }) => <PublicImageTab promotionId={promotionId} />,
  visible: ({ promotionId }) => true, // optional
});

registerFinanceKpi({
  id: 'eco9.health',
  order: 45,
  render: ({ promotionId, overview }) => <KpiCard label="Financial health" value="Healthy" />,
});
```

Both return a function that removes the entry again and throw for an id that is taken. `render`
of a tab only runs while it is selected, so it may run its own queries; a KPI's `render` gets the
Overview's `finance.overview` answer and returns a `KpiCard` (or null to leave it out). Import the
registering module from `FinancesView.tsx` (one line) so it loads with the screen's chunk.
`resetFinanceRegistryForTests()` removes everything a test added and keeps the built-ins.

| Kind | Order | Entry                   |
| ---- | ----- | ----------------------- |
| Tab  | 10    | Overview                |
| Tab  | 20    | Monthly                 |
| Tab  | 25    | Public image (ECO2)     |
| Tab  | 30    | Ledger                  |
| Tab  | 35    | Deals (ECO8)            |
| Tab  | 40    | Policies                |
| KPI  | 10    | Cash                    |
| KPI  | 15    | Hype (ECO3)             |
| KPI  | 20    | This month so far       |
| KPI  | 25    | Public image (ECO2)     |
| KPI  | 30    | Projected payroll       |
| KPI  | 40    | Company size            |
| KPI  | 45    | Financial health (ECO9) |

The ECO2/ECO3/ECO8/ECO9 rows are reservations; those features say which slot they took.

## Why? everywhere

- **Cash**: the stored cash trace (`cashTraceRef`), the same one the top bar's cash chip opens.
- **This month so far**: income plus costs, built on screen from the month totals.
- **Projected payroll**: `monthlyPayrollTrace`, the same formula the next Wages row posts with.
- **Company size**: the size trace, plus a second Why? on reach.
- **Ledger rows**: each row's own trace; an older row whose breakdown is no longer kept says
  "Not kept".
- **Policies**: each level's monthly cost, and any effect line that carries a trace.

## Phones

KPIs go 2-up (`KpiCardGrid`), the monthly table becomes one card per month (newest first, the
categories behind a disclosure, months before the game left out), the ledger rows become
DataTable cards, the policy levels stack, and the tab strip scrolls inside itself. Nothing scrolls
the page sideways at 390px.
