using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using RingsideBooker.UI.Why;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Business
{
    /// <summary>
    /// Business › Finances in the Windows game (UNITY-18), the web's FinancesScreen on the UNITY-11
    /// design system. It leads with the answer to "am I making money, and how long will the cash
    /// last?" in plain words (the cash runway), then the headline numbers (Cash, Cash runway, This
    /// month, TV income) with quiet Why?s, and this month's money by category. The full ledger and
    /// the staff policies are one tab away. Engine reads: <c>finance.overview</c>, <c>finance.monthly</c>,
    /// <c>production.cashRunway</c>, <c>broadcast.incomeSummary</c>, <c>finance.ledger</c>,
    /// <c>finance.policies</c> / <c>finance.policyPreview</c>; command <c>finance.setPolicy</c>.
    /// Routes: <c>finances?tab=overview|ledger|policies&amp;month=YYYY-MM&amp;category=&lt;key&gt;</c>.
    /// The screen has no stops of its own (the engine has no finance gate).
    /// </summary>
    public static class FinancesScreen
    {
        public const string ScreenId = "finances";
        public const string TabOverview = "overview";
        public const string TabLedger = "ledger";
        public const string TabPolicies = "policies";
        public const int LedgerPageSize = 100;

        /// <summary>The screen built last (dev tours read it).</summary>
        public static FinancesView Current { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Register()
        {
            ScreenRegistry.Register(ScreenId, Build);
        }

        public static VisualElement Build(ScreenContext context)
        {
            var view = new FinancesView(context);
            Current = view;
            return view.Root;
        }

        public static ShellRoute Route(string tab = null, string month = null, string category = null)
        {
            var pairs = new List<string>();
            if (tab != null) pairs.AddRange(new[] { "tab", tab });
            if (month != null) pairs.AddRange(new[] { "month", month });
            if (category != null) pairs.AddRange(new[] { "category", category });
            return ShellRoute.With(ScreenId, pairs.ToArray());
        }
    }

    /// <summary>The Finances screen's state and drawing (one per visit).</summary>
    public sealed class FinancesView
    {
        private readonly ScreenContext context;
        private readonly DsTabs tabs;
        private readonly VisualElement body;
        private string tab;
        private string month;
        private string category;
        private readonly List<JToken> ledgerRows = new List<JToken>();
        private string ledgerCursor;
        private string rolledUpNote;
        private DsTable<JToken> ledgerTable;
        private bool loadingOlder;

        public FinancesView(ScreenContext context)
        {
            this.context = context;
            ShellRoute route = context.Route;
            tab = route.Param("tab") ?? FinancesScreen.TabOverview;
            if (tab != FinancesScreen.TabLedger && tab != FinancesScreen.TabPolicies) tab = FinancesScreen.TabOverview;
            month = route.Param("month");
            category = route.Param("category");

            Root = BusinessUi.Page("screen-finances", "Finances", "Am I making money, and how long will the cash last?", out _);
            tabs = new DsTabs().Named("finances-tabs");
            tabs.Add(FinancesScreen.TabOverview, "Overview", null, "finance")
                .Add(FinancesScreen.TabLedger, "Ledger", null, "file-text")
                .Add(FinancesScreen.TabPolicies, "Policies", null, "clipboard");
            tabs.AddToClassList("biz-tabs");
            tabs.Select(tab, false);
            tabs.Selected += SelectTab;
            Root.Add(tabs);
            body = Ds.Column("biz-body").Named("finances-body");
            Root.Add(body);
            Kit.Live(body, Render);
        }

        public VisualElement Root { get; }
        public string Tab => tab;
        public DsTable<JToken> LedgerTable => ledgerTable;
        public int LedgerRowCount => ledgerRows.Count;

        public void SelectTab(string id)
        {
            if (id == tab) return;
            tab = id;
            tabs.Select(id, false);
            _ = Render();
        }

        /// <summary>Filters the ledger (null = all) and shows it.</summary>
        public void FilterLedger(string newMonth, string newCategory)
        {
            month = newMonth;
            category = newCategory;
            tab = FinancesScreen.TabLedger;
            tabs.Select(tab, false);
            _ = Render();
        }

        private Task Render() => tab switch
        {
            FinancesScreen.TabLedger => RenderLedger(),
            FinancesScreen.TabPolicies => RenderPolicies(),
            _ => RenderOverview(),
        };

        private static string PromotionId => Kit.Game?.PromotionId;

        private bool NoPromotion()
        {
            if (PromotionId != null) return false;
            body.Clear();
            body.Add(Ds.Empty("finance", "You don't run a promotion", "Only a promotion keeps books. Take a job or found a promotion to see them."));
            return true;
        }

        // ---- Overview -------------------------------------------------------------------------------

        private async Task RenderOverview()
        {
            if (NoPromotion()) return;
            string promotionId = PromotionId;
            var args = new JObject { ["promotionId"] = promotionId };
            (QueryResult<JToken> overview, QueryResult<JToken> monthly, QueryResult<JToken> runway, QueryResult<JToken> tv) =
                await Kit.Game.Client.Read("finances.overview", reader => (
                    reader.Query("finance.overview", args),
                    reader.Query("finance.monthly", new JObject { ["promotionId"] = promotionId, ["months"] = 12 }),
                    reader.Query("production.cashRunway", args),
                    reader.Query("broadcast.incomeSummary", new JObject { ["promotionId"] = promotionId, ["days"] = 30 })));
            if (tab != FinancesScreen.TabOverview) return;
            body.Clear();
            if (!overview.Ok)
            {
                body.Add(Ds.Empty("warning", "The books can't be shown", Kit.Reasons(overview.Reasons)));
                return;
            }
            JToken data = overview.Data;
            if (runway.Ok) body.Add(BusinessUi.Verdict(runway.Data));

            VisualElement tiles = Ds.Row("biz-tiles").Named("finances-kpis");
            double cash = Kit.Num(data, "cash") ?? 0;
            tiles.Add(BusinessUi.Tile("Cash", BusinessText.Compact(cash), CashWords(data, cash), cash < 0 ? DsState.Bad : DsState.Neutral,
                BusinessUi.WhyRef("Cash", cash, Kit.Obj(data, "cashTraceRef"), "money"), null, "tile-cash", "wallet"));
            if (runway.Ok) tiles.Add(BusinessUi.RunwayTile(runway.Data));
            tiles.Add(ThisMonthTile(data));
            if (tv.Ok) tiles.Add(TvIncomeTile(tv.Data));
            body.Add(BusinessUi.MarkLast(tiles));

            VisualElement columns = Ds.Row("biz-columns");
            JToken current = monthly.Ok ? Kit.Arr(monthly.Data, "months").LastOrDefault() : null;
            columns.Add(ThisMonthPanel(current));
            columns.Add(FixedCostsPanel(data, runway.Ok ? runway.Data : null));
            body.Add(BusinessUi.MarkLast(columns));
        }

        private static string CashWords(JToken overview, double cash)
        {
            if (cash < 0) return "In the red: costs are still paid";
            JToken last = Kit.Obj(overview, "lastMonth");
            if (last == null || last.Type != JTokenType.Object) return "In the bank today";
            return $"{BusinessText.SignedCompact(Kit.Num(last, "net") ?? 0, true)} last month";
        }

        private static VisualElement ThisMonthTile(JToken overview)
        {
            JToken thisMonth = Kit.Obj(overview, "thisMonth");
            double net = Kit.Num(thisMonth, "net") ?? 0;
            double income = Kit.Num(thisMonth, "income") ?? 0;
            double costs = Kit.Num(thisMonth, "costs") ?? 0;
            string words = $"In {BusinessText.Compact(income)} · out {BusinessText.Compact(Math.Abs(costs))}";
            JToken last = Kit.Obj(overview, "lastMonth");
            if (last != null && last.Type == JTokenType.Object)
            {
                double change = net - (Kit.Num(last, "net") ?? 0);
                words += $" · {BusinessText.SignedCompact(change, true)} vs last month";
            }
            WhySource source = WhySource.FromTrace(ThisMonthTrace(income, costs, net));
            var why = new WhyButton("This month's net", TraceValue.Of(net), source, "money") { PanelTitle = "This month's net" };
            return BusinessUi.Tile("This month so far", BusinessText.SignedCompact(net, true), words, net < 0 ? DsState.Warn : DsState.Good, why, null, "tile-this-month", "calendar");
        }

        /// <summary>This month's income less its costs, as a trace the Why? panel can read (the web's <c>thisMonthTrace</c>).</summary>
        internal static TraceNode ThisMonthTrace(double income, double costs, double net)
        {
            var json = new JObject
            {
                ["kind"] = "formula",
                ["label"] = "This month's net",
                ["unit"] = "money",
                ["value"] = net,
                ["children"] = new JArray
                {
                    new JObject { ["kind"] = "input", ["label"] = "Income this month", ["unit"] = "money", ["value"] = income },
                    new JObject
                    {
                        ["kind"] = "add", ["label"] = "Costs this month", ["unit"] = "money",
                        ["value"] = costs, ["operand"] = costs, ["before"] = income, ["after"] = net,
                    },
                },
            };
            try
            {
                return TraceReader.ParseNode(json.ToString(Newtonsoft.Json.Formatting.None));
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[Finances] this month's trace: {exception.Message}");
                return null;
            }
        }

        private static VisualElement TvIncomeTile(JToken summary)
        {
            double total = Kit.Num(summary, "total") ?? 0;
            string words = BusinessText.LastAiringText(Kit.Obj(summary, "lastAiring"));
            WhyButton why = Kit.WhyTrace("TV income (30 days)", total, Kit.Obj(summary, "trace"), "money", "TV income (30 days)");
            return BusinessUi.Tile("TV income · 30 days", BusinessText.Compact(total), words, total < 0 ? DsState.Bad : DsState.Neutral, why, null, "tile-tv-income", "tv");
        }

        private VisualElement ThisMonthPanel(JToken current)
        {
            string monthKey = Kit.Str(current, "month");
            VisualElement panel = Ds.Panel("This month by category", "Ledger", () => FilterLedger(monthKey, null), "biz-grow").Named("finances-this-month");
            if (current == null)
            {
                panel.Add(BusinessUi.Quiet("No months to show yet."));
                return panel;
            }
            panel.Add(BusinessUi.Quiet($"{BusinessText.MonthLabel(monthKey, true)}, so far. Press a line to see its rows."));
            JToken byCategory = Kit.Obj(current, "byCategory");
            var lines = BusinessText.LedgerCategories
                .Select(key => (key, amount: Kit.Num(byCategory, key)))
                .Where(entry => entry.amount.HasValue)
                .ToList();
            if (lines.Count == 0)
            {
                panel.Add(Ds.Empty("finance", "No money has moved this month yet", "Press Next Day."));
                return panel;
            }
            AddGroup(panel, "Money in", lines.Where(line => BusinessText.IsIncome(line.key)), monthKey);
            AddGroup(panel, "Money out", lines.Where(line => !BusinessText.IsIncome(line.key)), monthKey);
            VisualElement total = Ds.Row("biz-line", "biz-line--total");
            total.Add(Ds.Text("Net so far", "biz-line__label"));
            double net = Kit.Num(current, "net") ?? 0;
            total.Add(Ds.Text(BusinessText.Signed(net, true), "biz-line__amount", net < 0 ? "biz-bad" : "biz-good"));
            panel.Add(total);
            return panel;
        }

        private void AddGroup(VisualElement panel, string heading, IEnumerable<(string key, double? amount)> lines, string monthKey)
        {
            var list = lines.ToList();
            if (list.Count == 0) return;
            panel.Add(BusinessUi.SubHeading(heading));
            foreach ((string key, double? amount) in list)
            {
                string captured = key;
                var line = new Button(() => FilterLedger(monthKey, captured)) { text = string.Empty, name = $"category-{key}" };
                line.AddToClassList("biz-line");
                line.AddToClassList("biz-line--link");
                line.Add(Ds.Dot(BusinessText.IsIncome(key) ? DsState.Good : DsState.Bad, null));
                line.Add(Ds.Text(BusinessText.CategoryLabel(key), "biz-line__label"));
                line.Add(Ds.Text(BusinessText.Signed(amount ?? 0), "biz-line__amount", (amount ?? 0) < 0 ? "biz-bad" : "biz-good"));
                line.Add(new Icon("chevron-right", "ds-icon--xs", "biz-line__chevron"));
                DsTooltip.Attach(line, $"See the {BusinessText.CategoryLabel(key)} rows in the ledger", null);
                panel.Add(line);
            }
        }

        private VisualElement FixedCostsPanel(JToken overview, JToken runway)
        {
            VisualElement panel = Ds.Panel("What you pay every month", "Production", () => context.Navigator.Go(ShellRoute.To(ProductionScreen.ScreenId)), "biz-grow").Named("finances-fixed-costs");
            panel.Add(BusinessUi.Quiet("Paid whether or not a show runs. Production and policies change these."));
            double payroll = Kit.Num(overview, "monthlyPayroll") ?? 0;
            int contracts = (int)(Kit.Num(overview, "paidContracts") ?? 0);
            var rows = new List<(string key, VisualElement value)>
            {
                ("Wages", BusinessUi.Value(BusinessText.Money(payroll), Kit.WhyTrace("Projected payroll", payroll, Kit.Obj(overview, "monthlyPayrollTrace"), "money", "Projected payroll"), "biz-num")),
            };
            if (runway != null)
            {
                JToken spend = Kit.Obj(runway, "spend");
                rows.Add(("Medical", BusinessUi.FactText(BusinessText.Money(Kit.Num(spend, "medical") ?? 0))));
                rows.Add(("Production overhead", BusinessUi.FactText(BusinessText.Money(Kit.Num(spend, "overhead") ?? 0))));
                rows.Add(("Show production", BusinessUi.FactText(BusinessText.Money(Kit.Num(spend, "showProduction") ?? 0))));
            }
            panel.Add(BusinessUi.Facts(rows.ToArray()));
            panel.Add(BusinessUi.Quiet($"Wages are paid daily: {BusinessText.Money(Kit.Num(overview, "dailyWages") ?? 0)} a day across {contracts} paid {(contracts == 1 ? "contract" : "contracts")}."));
            return panel;
        }

        // ---- Ledger ---------------------------------------------------------------------------------

        private async Task RenderLedger()
        {
            if (NoPromotion()) return;
            string promotionId = PromotionId;
            JObject args = LedgerArgs(promotionId, null);
            (QueryResult<JToken> page, QueryResult<JToken> monthly) = await Kit.Game.Client.Read("finances.ledger", reader => (
                reader.Query("finance.ledger", args),
                reader.Query("finance.monthly", new JObject { ["promotionId"] = promotionId, ["months"] = 24 })));
            if (tab != FinancesScreen.TabLedger) return;
            body.Clear();
            if (!page.Ok)
            {
                body.Add(Ds.Empty("warning", "The ledger can't be shown", Kit.Reasons(page.Reasons)));
                return;
            }
            ledgerRows.Clear();
            ledgerRows.AddRange(Kit.Arr(page.Data, "rows"));
            ledgerCursor = Kit.Str(page.Data, "nextCursor");
            rolledUpNote = Kit.Str(page.Data, "rolledUp.note");

            List<string> months = monthly.Ok
                ? Kit.Arr(monthly.Data, "months").Where(entry => Kit.Obj(entry, "byCategory") is JObject cats && cats.Count > 0).Select(entry => Kit.Str(entry, "month")).Reverse().ToList()
                : new List<string>();
            List<string> categories = monthly.Ok ? Kit.Arr(monthly.Data, "categories").Select(token => (string)token).ToList() : new List<string>();

            VisualElement toolbar = Ds.Row("biz-toolbar").Named("ledger-toolbar");
            toolbar.Add(Ds.Text("Every payment, newest first. Press ? on a row to see how it was worked out.", "biz-quiet", "biz-toolbar__lead"));
            toolbar.Add(Ds.Spacer());
            if (month != null) toolbar.Add(FilterPill(BusinessText.MonthLabel(month, true), () => FilterLedger(null, category)));
            if (category != null) toolbar.Add(FilterPill(BusinessText.CategoryLabel(category), () => FilterLedger(month, null)));
            Button filter = Ds.Button("Filter", null, DsButtonKind.Secondary, "filter");
            filter.name = "ledger-filter";
            filter.clicked += () => OpenFilters(filter, months, categories);
            toolbar.Add(filter);
            body.Add(toolbar);

            ledgerTable = new DsTable<JToken>(LedgerColumns(), ledgerRows).Named("ledger-table");
            ledgerTable.AddToClassList("biz-table");
            if (ledgerRows.Count == 0)
            {
                bool filtered = month != null || category != null;
                body.Add(filtered
                    ? Ds.Empty("search", "No rows match these filters", rolledUpNote ?? "Try another month or category.", "Clear filters", () => FilterLedger(null, null))
                    : Ds.Empty("finance", rolledUpNote ?? "No money has moved yet. Press Next Day.", null));
                return;
            }
            body.Add(ledgerTable);
            body.Add(LedgerFooter());
        }

        private JObject LedgerArgs(string promotionId, string before)
        {
            var args = new JObject { ["promotionId"] = promotionId, ["limit"] = FinancesScreen.LedgerPageSize };
            if (month != null) args["month"] = month;
            if (category != null) args["category"] = category;
            if (before != null) args["before"] = before;
            return args;
        }

        private VisualElement LedgerFooter()
        {
            VisualElement footer = Ds.Row("biz-ledger-footer").Named("ledger-footer");
            footer.Add(BusinessUi.Quiet($"{ledgerRows.Count} {(ledgerRows.Count == 1 ? "row" : "rows")} shown{(ledgerCursor == null ? ", the oldest included" : string.Empty)}"));
            if (rolledUpNote != null && ledgerCursor == null) footer.Add(BusinessUi.Quiet(rolledUpNote));
            footer.Add(Ds.Spacer());
            if (ledgerCursor != null)
            {
                Button older = Ds.Button("Load older", null, DsButtonKind.Secondary, "down");
                older.name = "ledger-older";
                older.clicked += () => _ = LoadOlder(older);
                footer.Add(older);
            }
            return footer;
        }

        private async Task LoadOlder(Button button)
        {
            if (loadingOlder || ledgerCursor == null) return;
            loadingOlder = true;
            button.SetEnabled(false);
            BusinessUi.SetButtonText(button, "Loading older rows…");
            try
            {
                QueryResult<JToken> page = await Kit.Game.Client.Query("finance.ledger", LedgerArgs(PromotionId, ledgerCursor));
                if (!page.Ok) return;
                ledgerRows.AddRange(Kit.Arr(page.Data, "rows"));
                ledgerCursor = Kit.Str(page.Data, "nextCursor");
                ledgerTable.SetRows(ledgerRows);
                VisualElement footer = body.Q<VisualElement>("ledger-footer");
                int at = footer == null ? -1 : body.IndexOf(footer);
                footer?.RemoveFromHierarchy();
                if (at >= 0) body.Insert(at, LedgerFooter());
                else body.Add(LedgerFooter());
            }
            finally
            {
                loadingOlder = false;
            }
        }

        private static VisualElement FilterPill(string text, Action clear)
        {
            Button pill = Ds.Chip(text, true, clear, null, "close");
            pill.AddToClassList("biz-filter-pill");
            DsTooltip.Attach(pill, "Remove this filter", null);
            return pill;
        }

        private void OpenFilters(VisualElement anchor, List<string> months, List<string> categories)
        {
            VisualElement content = Ds.Column("biz-filters").Named("ledger-filters");
            BusinessUi.Style(content);
            OverlayHandle handle = null;
            var monthOptions = new List<(string value, string text)> { (null, "All months") };
            monthOptions.AddRange(months.Take(8).Select(entry => (entry, BusinessText.MonthLabel(entry))));
            if (month != null && !months.Contains(month)) monthOptions.Add((month, BusinessText.MonthLabel(month)));
            content.Add(BusinessUi.Choices("Month", monthOptions, month, value =>
            {
                handle?.Close();
                FilterLedger(value, category);
            }, "filter-month"));
            var income = new List<(string value, string text)> { (null, "All categories") };
            income.AddRange(BusinessText.IncomeCategories.Where(categories.Contains).Select(key => (key, BusinessText.CategoryLabel(key))));
            content.Add(BusinessUi.Choices("Money in", income, category, value =>
            {
                handle?.Close();
                FilterLedger(month, value);
            }, "filter-income"));
            var costs = BusinessText.CostCategories.Where(categories.Contains).Select(key => (key, BusinessText.CategoryLabel(key))).ToList();
            if (costs.Count > 0)
            {
                content.Add(BusinessUi.Choices("Money out", costs, category, value =>
                {
                    handle?.Close();
                    FilterLedger(month, value);
                }, "filter-costs"));
            }
            handle = DsOverlay.Popover(anchor, content);
        }

        private IEnumerable<DsColumn<JToken>> LedgerColumns()
        {
            yield return new DsColumn<JToken>("date", "Date", row => BusinessUi.Cell(Kit.Date(Kit.Str(row, "date"))))
            {
                Width = 130,
                Pinned = true,
            };
            yield return new DsColumn<JToken>("category", "Category", row =>
            {
                VisualElement cell = Ds.Row("biz-cat-cell");
                bool income = Kit.Str(row, "kind") == "income";
                cell.Add(Ds.Dot(income ? DsState.Good : DsState.Bad, null));
                cell.Add(BusinessUi.Cell(Kit.Str(row, "label") ?? BusinessText.CategoryLabel(Kit.Str(row, "category")), "ds-cell__text--strong"));
                return cell;
            })
            {
                Width = 200,
                SortKey = row => Kit.Str(row, "label"),
                Help = "Green dots are money in, red dots money out.",
            };
            yield return new DsColumn<JToken>("memo", "What for", row => BusinessUi.Cell(Kit.Str(row, "memo") ?? string.Empty))
            {
                Grow = 1,
                MinWidth = 160,
            };
            yield return new DsColumn<JToken>("amount", "Amount", row =>
            {
                double amount = Kit.Num(row, "amount") ?? 0;
                JToken traceRef = Kit.Obj(row, "traceRef");
                WhyButton why = traceRef == null || traceRef.Type == JTokenType.Null
                    ? null
                    : BusinessUi.WhyRef($"{Kit.Str(row, "label")}, {Kit.Date(Kit.Str(row, "date"), true)}", amount, traceRef, "money");
                VisualElement cell = BusinessUi.NumWhy(BusinessText.Signed(amount, true), why, amount < 0 ? "biz-bad" : "biz-good");
                if (why == null) DsTooltip.Attach(cell, "The breakdown of this older row is no longer kept.", null);
                return cell;
            })
            {
                Width = 150,
                Align = DsAlign.Right,
                SortKey = row => Kit.Num(row, "amount") ?? 0,
            };
            yield return new DsColumn<JToken>("from", "From", FromCell)
            {
                Width = 140,
                Default = false,
                Help = "The show or the worker the row came from.",
            };
        }

        private VisualElement FromCell(JToken row)
        {
            string eventId = Kit.Str(row, "refs.eventInstanceId");
            string personId = Kit.Str(row, "refs.personId");
            VisualElement cell = Ds.Row("biz-links");
            if (eventId != null)
            {
                Button show = Ds.Button("Show results", () => context.Navigator.Go(ShellRoute.With(ScreenIds.ShowResults, "event", eventId)), DsButtonKind.Ghost);
                show.AddToClassList("ds-btn--link");
                cell.Add(show);
            }
            if (personId != null && ScreenRegistry.IsLive(ScreenIds.Worker))
            {
                Button worker = Ds.Button("Worker", () => context.Navigator.Go(ShellRoute.With(ScreenIds.Worker, "id", personId)), DsButtonKind.Ghost);
                worker.AddToClassList("ds-btn--link");
                cell.Add(worker);
            }
            if (cell.childCount == 0) cell.Add(BusinessUi.Muted(BusinessText.NoValue));
            return cell;
        }

        // ---- Policies -------------------------------------------------------------------------------

        private async Task RenderPolicies()
        {
            if (NoPromotion()) return;
            string promotionId = PromotionId;
            var args = new JObject { ["promotionId"] = promotionId };
            QueryResult<JToken> policies = await Kit.Game.Client.Query("finance.policies", args);
            List<JToken> list = policies.Ok ? Kit.Arr(policies.Data, "policies").ToList() : new List<JToken>();
            List<QueryResult<JToken>> previews = await Kit.Game.Client.Read("finances.policies", reader =>
                list.Select(policy => reader.Query("finance.policyPreview", new JObject { ["promotionId"] = promotionId, ["area"] = Kit.Str(policy, "area") })).ToList());
            if (tab != FinancesScreen.TabPolicies) return;
            body.Clear();
            if (!policies.Ok)
            {
                body.Add(Ds.Empty("warning", "The policies can't be shown", Kit.Reasons(policies.Reasons)));
                return;
            }
            body.Add(BusinessUi.Quiet("Travel and catering are paid on show nights, medical on the 1st of each month. A change applies from the next show or the next 1st. Estimates cover the next 30 days."));
            for (int i = 0; i < list.Count; i++) body.Add(PolicyPanel(promotionId, list[i], previews[i]));
        }

        private static string AreaLabel(string area) => area switch
        {
            "travel" => "Travel",
            "catering" => "Catering",
            "medical" => "Medical",
            _ => Kit.Capital(area),
        };

        private VisualElement PolicyPanel(string promotionId, JToken policy, QueryResult<JToken> preview)
        {
            string area = Kit.Str(policy, "area");
            VisualElement panel = Ds.Panel(AreaLabel(area), null, null, "biz-policy").Named($"policy-{area}");
            double estimate = Kit.Num(policy, "monthlyEstimate") ?? 0;
            VisualElement now = Ds.Row("biz-policy__now");
            now.Add(Ds.Text($"Now {Kit.Str(policy, "label")}: about {BusinessText.Money(estimate)} a month", "biz-policy__now-text"));
            WhyButton why = Kit.WhyTrace($"{AreaLabel(area)} a month", estimate, Kit.Obj(policy, "monthlyEstimateTrace"), "money");
            if (why != null) now.Add(BusinessUi.Quiet(why, now));
            panel.Add(now);
            if (Kit.Str(policy, "description") is string description) panel.Add(BusinessUi.Quiet(description));
            Label feedback = Kit.Feedback();
            if (!preview.Ok)
            {
                panel.Add(Kit.Error(Kit.Reasons(preview.Reasons)));
                return panel;
            }
            string current = Kit.Str(preview.Data, "current");
            VisualElement levels = Ds.Row("biz-levels");
            foreach (JToken level in Kit.Arr(preview.Data, "levels"))
            {
                string id = Kit.Str(level, "level");
                bool selected = id == current;
                var card = new Button(() => _ = SetPolicy(promotionId, area, id, feedback)) { text = string.Empty, name = $"policy-{area}-{id}" };
                card.AddToClassList("biz-level");
                card.EnableInClassList("biz-level--current", selected);
                card.SetEnabled(!selected);
                VisualElement top = Ds.Row("biz-level__top");
                top.Add(Ds.Text(Kit.Str(level, "label"), "biz-level__name"));
                if (selected) top.Add(Ds.Pill(DsState.Info, "Now", "check"));
                card.Add(top);
                double cost = Kit.Num(level, "monthlyCost") ?? 0;
                card.Add(Ds.Text($"{BusinessText.Money(cost)} a month", "biz-level__cost"));
                double delta = Kit.Num(level, "delta") ?? 0;
                if (!selected && delta != 0)
                {
                    card.Add(Ds.Text($"{BusinessText.Signed(delta, true)} a month", "biz-level__delta", delta > 0 ? "biz-bad" : "biz-good"));
                }
                foreach (JToken effect in Kit.Arr(level, "effects"))
                {
                    string tone = Kit.Str(effect, "tone");
                    card.Add(Ds.Text(Kit.Str(effect, "text"), "biz-level__effect", tone == "positive" ? "biz-good" : tone == "negative" ? "biz-bad" : "biz-quiet-text"));
                }
                levels.Add(card);
            }
            panel.Add(levels);
            panel.Add(feedback);
            return panel;
        }

        private async Task SetPolicy(string promotionId, string area, string level, Label feedback)
        {
            CommandResult<JToken> result = await Kit.Run("finance.setPolicy", new JObject { ["promotionId"] = promotionId, ["area"] = area, ["level"] = level }, feedback);
            if (result.Ok) DsOverlay.Toast(Root, $"{AreaLabel(area)} policy changed", DsState.Good, "The next costs follow it.");
        }
    }
}
