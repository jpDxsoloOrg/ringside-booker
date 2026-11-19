using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// Workers (UNITY-15; the web's WorkersScreen): everyone in the world from <c>workers.list</c>.
    /// Tabs for everyone / free agents / injured, a search box, the engine's filters (role,
    /// employer, division, style, availability) behind one Filter button with removable pills, a
    /// sortable compact table (column picker; overall and popularity Why?s via
    /// <c>workers.explain</c>) or portrait cards, both paged for big worlds. A row or card opens the
    /// quick look; "Full profile" opens <see cref="WorkerProfileScreen"/>.
    /// </summary>
    public static class WorkersScreen
    {
        private static string view = "table";
        private static string tab = "everyone";
        private static string roleFilter;
        private static string employerFilter;
        private static string genderFilter;
        private static string styleFilter;
        private static string search = string.Empty;
        private static int cardsShown = W.PageSize / 2;

        /// <summary>The table drawn last (screenshot tour).</summary>
        public static PagedTable<JToken> LastTable { get; private set; }

        public static VisualElement Build(ScreenContext context)
        {
            if (context.Route.Param("view") is string pickedView) view = pickedView;
            VisualElement page = W.Page("workers");
            VisualElement host = Ds.Column("wl-host");
            page.Add(host);
            Kit.Live(host, () => Render(host, context));
            return page;
        }

        private static JObject Filters()
        {
            var filters = new JObject();
            if (roleFilter != null) filters["roles"] = new JArray(roleFilter);
            if (genderFilter != null) filters["genders"] = new JArray(genderFilter);
            if (styleFilter != null) filters["styles"] = new JArray(styleFilter);
            if (tab == "free") filters["employer"] = new JObject { ["kind"] = "freeAgent" };
            else if (employerFilter != null) filters["employer"] = new JObject { ["kind"] = "promotion", ["promotionId"] = employerFilter };
            if (tab == "injured") filters["availability"] = new JArray("injured", "rehab");
            return filters;
        }

        private static async Task Render(VisualElement host, ScreenContext context)
        {
            EngineClient client = Kit.Game.Client;
            QueryResult<JToken> answer = await client.Query("workers.list", new JObject { ["filters"] = Filters() });
            QueryResult<JToken> everyone = await client.Query("workers.list", new JObject { ["filters"] = new JObject { ["availability"] = new JArray("injured", "rehab") } });
            QueryResult<JToken> promotions = await client.Query("promotions.list");
            host.Clear();
            if (!answer.Ok)
            {
                host.Add(W.Head("Workers", null, out _));
                host.Add(Kit.Error(Kit.Reasons(answer.Reasons)));
                return;
            }
            JToken data = answer.Data;
            List<JToken> rows = Kit.Arr(data, "rows").ToList();
            var logos = Kit.Arr(promotions.Data).ToDictionary(p => Kit.Str(p, "promotionId") ?? string.Empty, p => p);

            var switcher = new DsTabs(segmented: true);
            switcher.Add("table", "Table", null, "columns").Add("cards", "Cards", null, "users");
            switcher.Select(view, false);
            switcher.name = "workers-view";
            switcher.Selected += picked => context.Navigator.Go(ShellRoute.With("workers", "view", picked));
            string subtitle = $"{TextFormat.Number((long)(Kit.Num(data, "total") ?? rows.Count))} people in the world · {TextFormat.Number((long)(Kit.Num(data, "freeAgents") ?? 0))} free agents";
            host.Add(W.Head("Workers", subtitle, out _, switcher));

            VisualElement bar = Ds.Row("wl-toolbar");
            var tabs = new DsTabs();
            tabs.Add("everyone", "Everyone").Add("free", "Free agents", (int)(Kit.Num(data, "freeAgents") ?? 0))
                .Add("injured", "Injured", Kit.Arr(everyone.Data, "rows").Count(), "injured");
            tabs.Select(tab, false);
            tabs.name = "workers-tabs";
            tabs.Selected += picked =>
            {
                tab = picked;
                context.Navigator.Go(ShellRoute.With("workers", "view", view));
            };
            bar.Add(tabs);
            bar.Add(Ds.Spacer());
            VisualElement body = Ds.Column("wl-body");
            void Redraw() => Draw(body, rows, logos, context);
            bar.Add(W.Search("Search by name", search, text =>
            {
                search = text;
                cardsShown = W.PageSize / 2;
                Redraw();
            }, "workers-search"));
            Button filter = Ds.Button("Filter", null, DsButtonKind.Secondary, "filter");
            filter.name = "workers-filter";
            filter.clicked += () => OpenFilters(filter, data, context);
            bar.Add(filter);
            host.Add(bar);

            host.Add(W.ActiveFilters(ActivePills(data, context), () =>
            {
                roleFilter = employerFilter = genderFilter = styleFilter = null;
                Reload(context);
            }));
            host.Add(body);
            Redraw();
        }

        private static void Reload(ScreenContext context) => context.Navigator.Go(ShellRoute.With("workers", "view", view));

        private static IEnumerable<(string, Action)> ActivePills(JToken data, ScreenContext context)
        {
            if (roleFilter != null) yield return (W.RoleWord(roleFilter), () => { roleFilter = null; Reload(context); });
            if (employerFilter != null && tab != "free")
            {
                string name = Kit.Arr(data, "facets.promotions").Where(p => Kit.Str(p, "promotionId") == employerFilter).Select(p => Kit.Str(p, "shortName") ?? Kit.Str(p, "name")).FirstOrDefault() ?? "One promotion";
                yield return (name, () => { employerFilter = null; Reload(context); });
            }
            if (genderFilter != null) yield return (W.GenderWord(genderFilter), () => { genderFilter = null; Reload(context); });
            if (styleFilter != null) yield return (W.StyleWord(styleFilter), () => { styleFilter = null; Reload(context); });
        }

        private static void OpenFilters(VisualElement anchor, JToken data, ScreenContext context)
        {
            VisualElement content = Ds.Column("wl-filters").Named("workers-filters");
            UI.Shell.OverlayHandle handle = null;
            void Pick(Action set)
            {
                set();
                handle?.Close();
                Reload(context);
            }
            content.Add(W.FilterGroup("Role", W.Roles.Select(r => (r, W.RoleWord(r))), roleFilter, value => Pick(() => roleFilter = value)));
            content.Add(W.FilterGroup("Division", new[] { ("male", "Men"), ("female", "Women"), ("nonBinary", "Non-binary") }, genderFilter, value => Pick(() => genderFilter = value)));
            content.Add(W.FilterGroup("Style", W.Styles.Select(s => (s, W.StyleWord(s))), styleFilter, value => Pick(() => styleFilter = value)));
            if (tab != "free")
            {
                var promotions = Kit.Arr(data, "facets.promotions").Select(p => (Kit.Str(p, "promotionId"), Kit.Str(p, "shortName") ?? Kit.Str(p, "name")))
                    .OrderBy(p => p.Item2).ToList();
                content.Add(W.FilterGroup("Works for", promotions, employerFilter, value => Pick(() => employerFilter = value)));
            }
            handle = DsOverlay.Popover(anchor, content);
        }

        private static void Draw(VisualElement body, List<JToken> all, Dictionary<string, JToken> promotions, ScreenContext context)
        {
            body.Clear();
            IEnumerable<JToken> list = all;
            if (!string.IsNullOrWhiteSpace(search))
            {
                string needle = search.Trim();
                list = list.Where(r => (Kit.Str(r, "ringName") ?? string.Empty).IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0
                    || (Kit.Str(r, "legalName") ?? string.Empty).IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0);
            }
            List<JToken> rows = list.ToList();
            if (rows.Count == 0)
            {
                body.Add(W.Empty("user-search", "Nobody matches.", "Try another name or clear the filters."));
                return;
            }

            if (view == "cards")
            {
                VisualElement grid = Ds.Row("ds-row--wrap", "ds-row--top", "wl-card-grid").Named("workers-cards");
                foreach (JToken row in rows.Take(cardsShown)) grid.Add(Card(row, promotions, context));
                body.Add(grid);
                if (rows.Count > cardsShown)
                {
                    body.Add(W.More(cardsShown, rows.Count, () =>
                    {
                        cardsShown += W.PageSize / 2;
                        Draw(body, all, promotions, context);
                    }, "people"));
                }
                return;
            }

            LastTable = Table(rows, promotions, context);
            body.Add(LastTable);
        }

        private static PagedTable<JToken> Table(List<JToken> rows, Dictionary<string, JToken> promotions, ScreenContext context)
        {
            var columns = new List<DsColumn<JToken>>
            {
                new DsColumn<JToken>("name", "Name", r => W.NameCell(Kit.Str(r, "ringName"), Kit.Str(r, "imageRef"), Kit.Str(r, "alignment")))
                    { Grow = 2.4f, MinWidth = 220, Pinned = true, SortKey = r => Kit.Str(r, "ringName") },
                new DsColumn<JToken>("employer", "Works for", r => EmployerCell(r, promotions)) { Grow = 1.6f, MinWidth = 170, SortKey = r => Kit.Str(r, "employer.shortName") ?? "~" },
                new DsColumn<JToken>("role", "Role", r => W.Cell(W.PushWord(Kit.Str(r, "push")) ?? W.RoleWord(Kit.Str(r, "mainRole")))) { Grow = 1.1f, MinWidth = 110, SortKey = r => W.PushRank(Kit.Str(r, "push")) * 10 + (Kit.Str(r, "mainRole") == "wrestler" ? 1 : 0), Help = "Their card position where they work, else their main role." },
                new DsColumn<JToken>("popularity", "Popularity", PopularityCell) { Grow = 1.6f, MinWidth = 180, SortKey = r => Kit.Num(r, "topPopularity.value") ?? 0, Help = "Where they are best known. Hover for Why?" },
                new DsColumn<JToken>("overall", "Overall", r =>
                {
                    double overall = Kit.Num(r, "overall") ?? 0;
                    VisualElement cell = Ds.Row("wl-dot-num");
                    cell.Add(W.Cell(W.Int(overall), number: true));
                    cell.Add(Ds.Text(Kit.Str(r, "grade") ?? string.Empty, "wl-grade"));
                    return W.QuietWhy(cell, Kit.WhyExplain($"{Kit.Str(r, "ringName")} overall", Math.Round(overall), "workers.explain", new JObject { ["personId"] = Kit.Str(r, "personId"), ["metric"] = "overall" }));
                }) { Width = 120, SortKey = r => Kit.Num(r, "overall") ?? 0, Help = "How good they are at their main role." },
                new DsColumn<JToken>("age", "Age", r => W.Cell(W.Int(Kit.Num(r, "age")), number: true)) { Width = 60, Align = DsAlign.Right, SortKey = r => Kit.Num(r, "age") ?? 0 },
                new DsColumn<JToken>("availability", "Condition", r =>
                {
                    (DsState state, string word) = W.Condition(Kit.Str(r, "availability.status"), Kit.Str(r, "availability.label"));
                    VisualElement dot = Ds.Dot(state, word);
                    if (Kit.Str(r, "availability.until") is string until) DsTooltip.Attach(dot, $"{Kit.Str(r, "availability.label")} until {Kit.Date(until)}");
                    return dot;
                }) { Grow = 1f, MinWidth = 110, SortKey = r => Kit.Str(r, "availability.status") },
                new DsColumn<JToken>("side", "Side", r => W.SideTag(Kit.Str(r, "alignment"))) { Width = 80, Default = false, SortKey = r => Kit.Str(r, "alignment") ?? string.Empty },
                new DsColumn<JToken>("style", "Style", r => W.Cell(W.StyleWord(Kit.Str(r, "style")))) { Grow = 1f, Default = false, SortKey = r => Kit.Str(r, "style") ?? string.Empty },
                new DsColumn<JToken>("roles", "All roles", r => W.Cell(string.Join(", ", Kit.Arr(r, "roles").Select(x => W.RoleWord((string)x))))) { Grow = 1.4f, Default = false },
                new DsColumn<JToken>("gender", "Division", r => W.Cell(W.GenderWord(Kit.Str(r, "gender")))) { Width = 100, Default = false, SortKey = r => Kit.Str(r, "gender") },
                new DsColumn<JToken>("world", "Worldwide", r => W.Cell(W.Int(Kit.Num(r, "worldPopularity")), number: true)) { Width = 100, Align = DsAlign.Right, Default = false, SortKey = r => Kit.Num(r, "worldPopularity") ?? 0 },
            };
            var table = new PagedTable<JToken>(columns, rows, "people", null, "overall", true) { name = "workers-table" };
            table.Table.RowClicked += r => WorkerSheet.Open(context, Kit.Str(r, "personId"), null);
            return table;
        }

        private static VisualElement EmployerCell(JToken row, Dictionary<string, JToken> promotions)
        {
            string id = Kit.Str(row, "employer.promotionId");
            if (id == null) return Ds.Pill(DsState.Info, "Free agent", "user");
            promotions.TryGetValue(id, out JToken promotion);
            return W.PromotionCell(Kit.Str(promotion, "logoRef"), Kit.Str(row, "employer.shortName"), Kit.Str(row, "employer.name"), Kit.Str(promotion, "color"));
        }

        private static VisualElement PopularityCell(JToken row)
        {
            double? value = Kit.Num(row, "topPopularity.value");
            if (!value.HasValue) return Ds.Dot(DsState.Neutral, "Unknown");
            (DsState state, string word) = W.Popularity(value);
            string country = Kit.Str(row, "topPopularity.countryName");
            VisualElement cell = Ds.Row("wl-dot-num");
            cell.Add(Ds.Dot(state, word));
            cell.Add(W.QuietNumber($"{W.Int(value)} · {country}"));
            return W.QuietWhy(cell, Kit.WhyExplain($"{Kit.Str(row, "ringName")} popularity in {country}", Math.Round(value.Value), "workers.explain",
                new JObject { ["personId"] = Kit.Str(row, "personId"), ["metric"] = "topPopularity" }));
        }

        private static VisualElement Card(JToken row, Dictionary<string, JToken> promotions, ScreenContext context)
        {
            (DsState conditionState, string conditionWord) = W.Condition(Kit.Str(row, "availability.status"), Kit.Str(row, "availability.label"));
            double popularity = Kit.Num(row, "topPopularity.value") ?? 0;
            var data = new WorkerCard
            {
                Id = Kit.Str(row, "personId"),
                Name = Kit.Str(row, "ringName"),
                Position = W.PushWord(Kit.Str(row, "push")) ?? W.RoleWord(Kit.Str(row, "mainRole")),
                Alignment = W.Side(Kit.Str(row, "alignment")),
                Style = W.StyleWord(Kit.Str(row, "style")),
                Picture = W.Picture(Kit.Str(row, "imageRef")),
                Popularity = (int)Math.Round(popularity),
                PopularityWord = W.Popularity(popularity).word,
                Condition = conditionState,
                ConditionWord = conditionWord,
            };
            VisualElement card = DsCards.PortraitCard(data);
            // Morale is private to a worker's employer, so this card shows who they work for instead.
            VisualElement facts = card.Q(className: "ds-pcard__facts");
            if (facts != null)
            {
                facts.Clear();
                facts.Add(Fact("Popularity", $"{W.Popularity(popularity).word}", W.Popularity(popularity).state));
                facts.Add(Fact("Works for", Kit.Str(row, "employer.shortName") ?? "Free agent", Kit.Str(row, "employer.promotionId") == null ? DsState.Info : DsState.Neutral));
                facts.Add(Fact("Condition", conditionWord, conditionState));
            }
            string personId = Kit.Str(row, "personId");
            card.name = $"worker-card-{personId}";
            card.AddManipulator(new Clickable(() => WorkerSheet.Open(context, personId, null)));
            card.RegisterCallback<NavigationSubmitEvent>(_ => WorkerSheet.Open(context, personId, null));
            return card;
        }

        private static VisualElement Fact(string label, string word, DsState state)
        {
            VisualElement fact = Ds.El("ds-pcard__fact", Ds.StateClass(state));
            fact.Add(Ds.Text(TextFormat.Upper(label), "ds-pcard__fact-label"));
            fact.Add(Ds.Dot(state, word));
            return fact;
        }
    }
}
