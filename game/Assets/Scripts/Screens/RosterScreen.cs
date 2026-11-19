using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Day;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// The Roster on the UNITY-11 design (UNITY-15; the web's RosterScreen): portrait cards or the
    /// compact table (short default columns, more in the column picker, rows that expand), a tab per
    /// role group over <c>roster.rows</c> and the Injuries tab over <c>health.report</c> (opening it
    /// marks new injuries seen, which clears the day's Roster stop). Search, filters behind one
    /// button, a sort menu, and a "worth a look" strip. Set push on a row (<c>roster.setPush</c>); a
    /// card or row opens the worker's quick look. Joins <c>workers.list</c> (style) and
    /// <c>titles.list</c> (who holds what) by person.
    /// </summary>
    public static class RosterScreen
    {
        private static readonly (string id, string label)[] Tabs =
        {
            ("wrestlers", "Wrestlers"),
            ("managers", "Managers"),
            ("announcers", "Announcers"),
            ("referees", "Referees"),
            ("producers", "Producers"),
            ("others", "Others"),
            (DayControlLogic.InjuriesTabId, "Injuries"),
        };

        private static readonly (string id, string label)[] Sorts =
        {
            ("position", "Card position"),
            ("popularity", "Popularity"),
            ("overall", "Overall"),
            ("name", "Name"),
            ("contract", "Contract end"),
        };

        /// <summary>Remembered while the game runs: cards or table, the sort and the filters.</summary>
        private static string view = "cards";
        private static string sort = "position";
        private static string sideFilter;
        private static string brandFilter;
        private static string genderFilter;
        private static bool championsOnly;
        private static string search = string.Empty;

        /// <summary>The table drawn last (the screenshot tour expands a row and opens its column picker).</summary>
        public static DsTable<Entry> LastTable { get; private set; }

        /// <summary>The entries drawn last, in their order.</summary>
        public static List<Entry> LastShown { get; private set; }

        /// <summary>One roster row with what the other queries add.</summary>
        public sealed class Entry
        {
            public JToken Row;
            public string PersonId;
            public string EmploymentId;
            public string Name;
            public string Style;
            public string Champion;
            public double Popularity;
            public double Overall;
            public double? Morale;
            public int PushRank;
        }

        public static VisualElement Build(ScreenContext context)
        {
            string tab = context.Route.Param("tab") ?? "wrestlers";
            if (context.Route.Param("view") is string pickedView) view = pickedView;
            VisualElement page = W.Page("roster");
            VisualElement host = Ds.Column("wl-host");
            page.Add(host);
            if (tab == DayControlLogic.InjuriesTabId) Kit.Live(host, () => RenderInjuries(host, context));
            else Kit.Live(host, () => RenderGroup(host, tab, context));
            return page;
        }

        private static VisualElement TabBar(string tab, ScreenContext context, Dictionary<string, int> counts)
        {
            var tabs = new DsTabs();
            foreach ((string id, string label) in Tabs)
            {
                tabs.Add(id, label, counts != null && counts.TryGetValue(id, out int count) ? count : (int?)null,
                    id == DayControlLogic.InjuriesTabId ? "injured" : null);
            }
            tabs.Select(tab, false);
            tabs.name = "roster-tabs";
            tabs.Selected += picked => context.Navigator.Go(ShellRoute.With("roster", "tab", picked));
            return tabs;
        }

        private static async Task RenderGroup(VisualElement host, string group, ScreenContext context)
        {
            EngineGame game = Kit.Game;
            EngineClient client = game.Client;
            QueryResult<JToken> rows = await client.Query("roster.rows", new JObject { ["group"] = group });
            QueryResult<JToken> summary = await client.Query("roster.summary");
            QueryResult<JToken> workers = await client.Query("workers.list", new JObject
            {
                ["filters"] = new JObject { ["employer"] = new JObject { ["kind"] = "promotion", ["promotionId"] = game.PromotionId } },
            });
            QueryResult<JToken> titles = await client.Query("titles.list", new JObject { ["scope"] = "own", ["status"] = "active" });
            host.Clear();
            if (!rows.Ok)
            {
                host.Add(Kit.Error(Kit.Reasons(rows.Reasons)));
                return;
            }

            var styleOf = new Dictionary<string, string>();
            foreach (JToken worker in Kit.Arr(workers.Data, "rows")) styleOf[Kit.Str(worker, "personId") ?? string.Empty] = Kit.Str(worker, "style");
            Dictionary<string, string> championOf = ChampionsByPerson(titles.Data);

            List<Entry> all = Kit.Arr(rows.Data, "rows").Select(row => new Entry
            {
                Row = row,
                PersonId = Kit.Str(row, "personId"),
                EmploymentId = Kit.Str(row, "employmentId"),
                Name = Kit.Str(row, "ringName") ?? Kit.NoValue,
                Style = styleOf.TryGetValue(Kit.Str(row, "personId") ?? string.Empty, out string style) ? style : null,
                Champion = championOf.TryGetValue(Kit.Str(row, "personId") ?? string.Empty, out string belt) ? belt : null,
                Popularity = Kit.Num(row, "popularity") ?? 0,
                Overall = Kit.Num(row, "overall.value") ?? 0,
                Morale = Kit.Num(row, "morale.value"),
                PushRank = W.PushRank(Kit.Str(row, "push")),
            }).ToList();

            // Head: title, a plain-words count line, and the Cards / Table switch.
            int champions = all.Count(entry => entry.Champion != null);
            int look = all.Count(NeedsALook);
            string noun = group == "others" ? "other staff" : group;
            string subtitle = $"{all.Count} {noun}" + (champions > 0 ? $" · {champions} hold titles" : string.Empty) + (look > 0 ? $" · {look} need a look" : string.Empty);
            var switcher = new DsTabs(segmented: true);
            switcher.Add("cards", "Cards", null, "users").Add("table", "Table", null, "columns");
            switcher.Select(view, false);
            switcher.name = "roster-view";
            switcher.Selected += picked => context.Navigator.Go(ShellRoute.With("roster", "tab", group, "view", picked));
            host.Add(W.Head("Roster", subtitle, out _, switcher));

            var counts = new Dictionary<string, int> { [group] = all.Count };
            if (summary.Ok && Kit.Num(summary.Data, "unavailable") is double away && away > 0) counts[DayControlLogic.InjuriesTabId] = (int)away;

            // Toolbar: the role tabs, then search, Filter and Sort on the right.
            VisualElement bar = Ds.Row("wl-toolbar");
            bar.Add(TabBar(group, context, counts));
            bar.Add(Ds.Spacer());
            VisualElement body = Ds.Column("wl-body");
            void Redraw() => DrawBody(body, all, group, context);
            bar.Add(W.Search("Search the roster", search, text =>
            {
                search = text;
                Redraw();
            }, "roster-search"));
            Button filter = Ds.Button("Filter", null, DsButtonKind.Secondary, "filter");
            filter.name = "roster-filter";
            filter.clicked += () => OpenFilters(filter, all, Redraw);
            bar.Add(filter);
            Button sortButton = Ds.Button("Sort: " + Sorts.First(s => s.id == sort).label, null, DsButtonKind.Ghost, "sort");
            sortButton.name = "roster-sort";
            sortButton.clicked += () => OpenSort(sortButton, () => context.Navigator.Go(ShellRoute.With("roster", "tab", group, "view", view)));
            bar.Add(sortButton);
            host.Add(bar);

            host.Add(Attention(all, context));
            if (WorkshopWorlds.CurrentPicturesNote is string note) host.Add(Kit.Note(note).Named("roster-pictures-note"));
            host.Add(body);
            Redraw();
        }

        /// <summary>A small portrait from a workshop world mod's pictures (placeholder when missing); nothing for a world without pictures.</summary>
        public static VisualElement Portrait(Import.Pictures.PictureProvider pictures, string imageRef)
        {
            if (pictures == null) return null;
            var image = new Image { image = pictures.Get(imageRef), scaleMode = UnityEngine.ScaleMode.ScaleAndCrop };
            image.AddToClassList("rb-portrait");
            return image;
        }

        /// <summary>Person id → the first title they hold anywhere (<c>titles.list</c> own and world scopes).</summary>
        public static async Task<Dictionary<string, string>> AllChampionsAsync()
        {
            EngineClient client = Kit.Game.Client;
            QueryResult<JToken> own = await client.Query("titles.list", new JObject { ["scope"] = "own", ["status"] = "active" });
            QueryResult<JToken> world = await client.Query("titles.list", new JObject { ["scope"] = "world", ["status"] = "active" });
            Dictionary<string, string> all = ChampionsByPerson(world.Data);
            foreach (KeyValuePair<string, string> pair in ChampionsByPerson(own.Data)) all[pair.Key] = pair.Value;
            return all;
        }

        /// <summary>Person id → the first title they hold, from <c>titles.list</c>.</summary>
        public static Dictionary<string, string> ChampionsByPerson(JToken titles)
        {
            var championOf = new Dictionary<string, string>();
            foreach (JToken title in Kit.Arr(titles, "groups").SelectMany(g => Kit.Arr(g, "titles")))
            {
                foreach (JToken holder in Kit.Arr(title, "champion.holders"))
                {
                    string id = Kit.Str(holder, "personId");
                    if (id != null && !championOf.ContainsKey(id)) championOf[id] = Kit.Str(title, "name");
                }
            }
            return championOf;
        }

        private static bool NeedsALook(Entry entry)
        {
            string status = Kit.Str(entry.Row, "availability.status");
            double? days = Kit.Num(entry.Row, "daysLeft");
            return (status != null && status != "available") || (entry.Morale.HasValue && entry.Morale.Value < -15) || (days.HasValue && days.Value <= 60);
        }

        /// <summary>The "worth a look" strip: plain words, coloured by state; quiet when nothing is wrong.</summary>
        private static VisualElement Attention(List<Entry> all, ScreenContext context)
        {
            VisualElement strip = Ds.Row("ds-row--wrap", "wl-attention").Named("roster-attention");
            var pills = new List<VisualElement>();
            List<Entry> hurt = all.Where(e => Kit.Str(e.Row, "availability.status") == "injured").ToList();
            if (hurt.Count == 1) pills.Add(Ds.Pill(DsState.Bad, $"{hurt[0].Name} is hurting", "injured"));
            else if (hurt.Count > 1) pills.Add(Ds.Pill(DsState.Bad, $"{hurt.Count} are hurting", "injured"));
            List<Entry> unhappy = all.Where(e => e.Morale.HasValue && e.Morale.Value < -15).OrderBy(e => e.Morale).ToList();
            if (unhappy.Count == 1) pills.Add(Ds.Pill(DsState.Warn, $"{unhappy[0].Name} is unhappy", "morale"));
            else if (unhappy.Count > 1) pills.Add(Ds.Pill(DsState.Warn, $"{unhappy.Count} are unhappy", "morale"));
            int ending = all.Count(e => Kit.Num(e.Row, "daysLeft") is double days && days <= 60);
            if (ending > 0)
            {
                VisualElement contracts = Ds.Pill(DsState.Warn, ending == 1 ? "1 contract ends within 60 days" : $"{ending} contracts end within 60 days", "contracts");
                if (ScreenRegistry.IsLive("contracts"))
                {
                    contracts.AddManipulator(new Clickable(() => context.Navigator.Go(ShellRoute.To("contracts"))));
                    contracts.AddToClassList("wl-clickable");
                }
                pills.Add(contracts);
            }
            int under = all.Count(e => Kit.Str(e.Row, "pushGap.verdict") == "underPushed");
            if (under > 0) pills.Add(Ds.Pill(DsState.Info, under == 1 ? "1 expects a bigger push" : $"{under} expect a bigger push", "trend-up"));
            if (pills.Count == 0) return strip;
            strip.Add(W.Label("Worth a look"));
            foreach (VisualElement pill in pills) strip.Add(pill);
            return strip;
        }

        private static IEnumerable<Entry> Filtered(IEnumerable<Entry> all)
        {
            IEnumerable<Entry> list = all;
            if (!string.IsNullOrWhiteSpace(search))
            {
                string needle = search.Trim();
                list = list.Where(e => e.Name.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0);
            }
            if (sideFilter != null) list = list.Where(e => Kit.Str(e.Row, "alignment") == sideFilter);
            if (brandFilter != null) list = list.Where(e => (Kit.Str(e.Row, "brandId") ?? "shared") == brandFilter);
            if (genderFilter != null) list = list.Where(e => Kit.Str(e.Row, "gender") == genderFilter);
            if (championsOnly) list = list.Where(e => e.Champion != null);
            return sort switch
            {
                "popularity" => list.OrderByDescending(e => e.Popularity),
                "overall" => list.OrderByDescending(e => e.Overall),
                "name" => list.OrderBy(e => e.Name, StringComparer.OrdinalIgnoreCase),
                "contract" => list.OrderBy(e => Kit.Num(e.Row, "daysLeft") ?? double.MaxValue),
                _ => list.OrderByDescending(e => e.PushRank).ThenByDescending(e => e.Champion != null).ThenByDescending(e => e.Popularity),
            };
        }

        private static void DrawBody(VisualElement body, List<Entry> all, string group, ScreenContext context)
        {
            body.Clear();
            List<Entry> shown = Filtered(all).ToList();
            LastShown = shown;
            body.Add(W.ActiveFilters(ActiveFilterPills(all, () => DrawBody(body, all, group, context)), () =>
            {
                sideFilter = brandFilter = genderFilter = null;
                championsOnly = false;
                DrawBody(body, all, group, context);
            }));
            if (all.Count == 0)
            {
                body.Add(W.Empty("roster", $"No {group} under contract.", "Sign people from Workers or Contracts."));
                return;
            }
            if (shown.Count == 0)
            {
                body.Add(W.Empty("search", "Nobody matches.", "Try another name or clear the filters."));
                return;
            }

            if (view == "table")
            {
                LastTable = Table(shown, group == "wrestlers", context);
                body.Add(LastTable);
                return;
            }

            VisualElement grid = Ds.Row("ds-row--wrap", "ds-row--top", "wl-card-grid").Named("roster-cards");
            foreach (Entry entry in shown) grid.Add(Card(entry, context));
            body.Add(grid);
        }

        private static IEnumerable<(string, Action)> ActiveFilterPills(List<Entry> all, Action redraw)
        {
            if (sideFilter != null) yield return (W.SideWord(sideFilter), () => { sideFilter = null; redraw(); });
            if (genderFilter != null) yield return (W.GenderWord(genderFilter), () => { genderFilter = null; redraw(); });
            if (brandFilter != null)
            {
                string name = all.Select(e => e.Row).Where(r => (Kit.Str(r, "brandId") ?? "shared") == brandFilter).Select(r => Kit.Str(r, "brandName")).FirstOrDefault() ?? "Shared";
                yield return (name, () => { brandFilter = null; redraw(); });
            }
            if (championsOnly) yield return ("Champions", () => { championsOnly = false; redraw(); });
        }

        private static void OpenFilters(VisualElement anchor, List<Entry> all, Action redraw)
        {
            VisualElement content = Ds.Column("wl-filters").Named("roster-filters");
            void Refresh()
            {
                content.Clear();
                content.Add(W.FilterGroup("Side", new[] { ("face", "Face"), ("heel", "Heel"), ("tweener", "Tweener") }, sideFilter, value => { sideFilter = value; redraw(); Refresh(); }));
                content.Add(W.FilterGroup("Division", new[] { ("male", "Men"), ("female", "Women") }, genderFilter, value => { genderFilter = value; redraw(); Refresh(); }));
                var brands = all.Select(e => (Kit.Str(e.Row, "brandId") ?? "shared", Kit.Str(e.Row, "brandName") ?? "Shared")).Distinct().ToList();
                if (brands.Count > 1) content.Add(W.FilterGroup("Brand", brands, brandFilter, value => { brandFilter = value; redraw(); Refresh(); }));
                content.Add(W.FilterGroup("Titles", new[] { ("yes", "Champions only") }, championsOnly ? "yes" : null, value => { championsOnly = value != null; redraw(); Refresh(); }));
            }
            Refresh();
            DsOverlay.Popover(anchor, content);
        }

        private static void OpenSort(VisualElement anchor, Action changed)
        {
            VisualElement content = Ds.Column("wl-menu");
            OverlayHandle handle = null;
            foreach ((string id, string label) in Sorts)
            {
                string captured = id;
                Button option = Ds.Button(label, () =>
                {
                    sort = captured;
                    handle?.Close();
                    changed();
                }, id == sort ? DsButtonKind.Secondary : DsButtonKind.Ghost, id == sort ? "check" : null);
                option.AddToClassList("wl-menu__item");
                option.name = "roster-sort-" + id;
                content.Add(option);
            }
            handle = DsOverlay.Popover(anchor, content);
        }

        // ---- Cards -----------------------------------------------------------------------------

        private static VisualElement Card(Entry entry, ScreenContext context)
        {
            JToken row = entry.Row;
            (DsState moraleState, string moraleWord) = W.Morale(entry.Morale);
            (DsState conditionState, string conditionWord) = W.Condition(Kit.Str(row, "availability.status"), Kit.Str(row, "availability.reason"));
            (_, string popularityWord) = W.Popularity(entry.Popularity);
            var data = new WorkerCard
            {
                Id = entry.PersonId,
                Name = entry.Name,
                Position = W.PushWord(Kit.Str(row, "push")) ?? W.RoleWord(Kit.Str(row, "role")),
                Alignment = W.Side(Kit.Str(row, "alignment")),
                Style = entry.Style != null ? W.StyleWord(entry.Style) : W.RoleWord(Kit.Str(row, "role")),
                Picture = W.Picture(Kit.Str(row, "imageRef")),
                Popularity = (int)Math.Round(entry.Popularity),
                PopularityWord = popularityWord,
                Morale = moraleState,
                MoraleWord = moraleWord,
                Condition = conditionState,
                ConditionWord = conditionWord,
                Champion = entry.Champion,
            };
            VisualElement card = DsCards.PortraitCard(data);
            card.name = $"roster-card-{entry.EmploymentId}";
            card.AddManipulator(new Clickable(() => WorkerSheet.Open(context, entry.PersonId, row)));
            card.RegisterCallback<NavigationSubmitEvent>(_ => WorkerSheet.Open(context, entry.PersonId, row));
            return card;
        }

        // ---- Table -----------------------------------------------------------------------------

        private static DsTable<Entry> Table(List<Entry> rows, bool wrestlers, ScreenContext context)
        {
            var columns = new List<DsColumn<Entry>>
            {
                new DsColumn<Entry>("name", "Name", e => W.NameCell(e.Name, Kit.Str(e.Row, "imageRef"), Kit.Str(e.Row, "alignment"), e.Champion != null))
                    { Grow = 2.4f, MinWidth = 220, Pinned = true, SortKey = e => e.Name },
                new DsColumn<Entry>("position", "Position", e => PositionCell(e, wrestlers, context))
                    { Grow = 1.3f, MinWidth = 130, SortKey = e => e.PushRank, Help = "Where they sit on the card. Set changes it." },
                new DsColumn<Entry>("side", "Side", e => W.SideTag(Kit.Str(e.Row, "alignment"))) { Width = 80, SortKey = e => Kit.Str(e.Row, "alignment") },
                new DsColumn<Entry>("popularity", "Popularity", PopularityCell)
                    { Grow = 1.4f, MinWidth = 150, SortKey = e => e.Popularity, Help = "How well known they are where you run. Hover for Why?" },
                new DsColumn<Entry>("morale", "Morale", e =>
                {
                    (DsState state, string word) = W.Morale(e.Morale);
                    return W.DotNumber(state, word, null, e.Morale.HasValue ? Kit.WhyRef("Morale", e.Morale.Value, Kit.Obj(e.Row, "morale.traceRef")) : null);
                }) { Grow = 1f, MinWidth = 110, SortKey = e => e.Morale ?? 0 },
                new DsColumn<Entry>("condition", "Condition", e =>
                {
                    (DsState state, string word) = W.Condition(Kit.Str(e.Row, "availability.status"), Kit.Str(e.Row, "availability.reason"));
                    VisualElement cell = Ds.Dot(state, word);
                    if (Kit.Str(e.Row, "availability.until") is string until) DsTooltip.Attach(cell, $"{word} until {Kit.Date(until)}");
                    return cell;
                }) { Grow = 1f, MinWidth = 110, SortKey = e => Kit.Str(e.Row, "availability.status") ?? string.Empty },
                new DsColumn<Entry>("contract", "Contract", ContractCell)
                    { Grow = 1.1f, MinWidth = 120, SortKey = e => Kit.Num(e.Row, "daysLeft") ?? double.MaxValue },
                new DsColumn<Entry>("brand", "Brand", e => W.Cell(Kit.Str(e.Row, "brandName") ?? "Shared")) { Grow = 1.1f, Default = false, SortKey = e => Kit.Str(e.Row, "brandName") ?? string.Empty },
                new DsColumn<Entry>("expects", "Expects", ExpectsCell) { Grow = 1f, Default = false, SortKey = e => W.PushRank(Kit.Str(e.Row, "expectedPush")), Help = "The push they think they've earned." },
                new DsColumn<Entry>("overall", "Overall", e => W.QuietWhy(Ds.Row("wl-dot-num").With(W.Cell($"{Math.Round(e.Overall)} {Kit.Str(e.Row, "overall.grade")}", number: true)),
                    Kit.WhyExplain("Overall", e.Overall, "roster.explain", new JObject { ["employmentId"] = e.EmploymentId, ["metric"] = "overall" })))
                    { Width = 100, Align = DsAlign.Right, Default = false, SortKey = e => e.Overall },
                new DsColumn<Entry>("momentum", "Momentum", e =>
                {
                    double? momentum = Kit.Num(e.Row, "momentum.value");
                    return W.QuietWhy(Ds.Row("wl-dot-num").With(W.Cell(W.Int(momentum), number: true)),
                        momentum.HasValue ? Kit.WhyRef("Momentum", momentum.Value, Kit.Obj(e.Row, "momentum.traceRef")) : null);
                }) { Width = 110, Align = DsAlign.Right, Default = false, SortKey = e => Kit.Num(e.Row, "momentum.value") ?? 0 },
                new DsColumn<Entry>("style", "Style", e => W.Cell(W.StyleWord(e.Style))) { Grow = 1f, Default = false, SortKey = e => e.Style ?? string.Empty },
                new DsColumn<Entry>("age", "Age", e => W.Cell(W.Int(Kit.Num(e.Row, "age")), number: true)) { Width = 60, Align = DsAlign.Right, Default = false, SortKey = e => Kit.Num(e.Row, "age") ?? 0 },
            };
            var table = new DsTable<Entry>(columns, rows, entry => Details(entry, wrestlers, context));
            table.name = "roster-table";
            table.RowClicked += entry => WorkerSheet.Open(context, entry.PersonId, entry.Row);
            return table;
        }

        private static VisualElement PositionCell(Entry entry, bool wrestlers, ScreenContext context)
        {
            string push = Kit.Str(entry.Row, "push");
            VisualElement cell = Ds.Row("wl-dot-num");
            cell.Add(W.Cell(W.PushWord(push) ?? W.RoleWord(Kit.Str(entry.Row, "role"))));
            if (wrestlers && push != null && push != "none")
            {
                Button set = Ds.Button("Set", () => SetPushSheet.Open(context, entry.Row), DsButtonKind.Ghost);
                set.AddToClassList("ds-btn--link");
                set.AddToClassList("wl-inline-link");
                set.name = $"set-push-{entry.EmploymentId}";
                DsTooltip.Attach(set, $"Set push — {entry.Name}");
                cell.Add(set);
            }
            return cell;
        }

        private static VisualElement PopularityCell(Entry entry)
        {
            (DsState state, string word) = W.Popularity(entry.Popularity);
            return W.DotNumber(state, word, W.Int(entry.Popularity),
                Kit.WhyExplain("Popularity", entry.Popularity, "roster.explain", new JObject { ["employmentId"] = entry.EmploymentId, ["metric"] = "popularity" }, "points"));
        }

        private static VisualElement ExpectsCell(Entry entry)
        {
            string verdict = Kit.Str(entry.Row, "pushGap.verdict");
            string word = W.PushWord(Kit.Str(entry.Row, "expectedPush")) ?? Kit.NoValue;
            return verdict == "underPushed" ? Ds.Pill(DsState.Warn, word, "trend-up") : W.Cell(word);
        }

        private static VisualElement ContractCell(Entry entry)
        {
            string text = W.ContractWord(Kit.Str(entry.Row, "endsOn"), Kit.Num(entry.Row, "daysLeft"), out bool soon);
            return soon ? Ds.Pill(DsState.Warn, text, "contracts") : W.Cell(text);
        }

        /// <summary>The expanded row: the skills behind the words, the facts, and the next actions.</summary>
        private static VisualElement Details(Entry entry, bool wrestlers, ScreenContext context)
        {
            VisualElement row = Ds.Row("ds-row--top", "wl-details");
            VisualElement skills = Ds.Column("wl-details__col");
            skills.Add(W.Label("In the ring"));
            skills.Add(Ds.Loading("Reading their file…"));
            row.Add(skills);

            VisualElement facts = Ds.Column("wl-details__col");
            facts.Add(W.Label("About"));
            facts.Add(Ds.KeyValues(
                ("Style", W.StyleWord(entry.Style)),
                ("Age", W.Int(Kit.Num(entry.Row, "age"))),
                ("Brand", Kit.Str(entry.Row, "brandName") ?? "Shared"),
                ("Expects", W.PushWord(Kit.Str(entry.Row, "expectedPush")) ?? Kit.NoValue),
                ("Contract", Kit.Str(entry.Row, "endsOn") is string ends ? Kit.Date(ends) : "Open-ended")));
            row.Add(facts);

            VisualElement notes = Ds.Column("wl-details__col");
            notes.Add(W.Label("Worth knowing"));
            VisualElement traits = Ds.Column("wl-traits");
            notes.Add(traits);
            VisualElement actions = Ds.Row("ds-row--wrap", "wl-details__actions");
            if (wrestlers && Kit.Str(entry.Row, "push") is string push && push != "none")
            {
                actions.Add(Ds.Button("Set push", () => SetPushSheet.Open(context, entry.Row), DsButtonKind.Secondary, "trend-up"));
            }
            if (ScreenRegistry.IsLive("contracts"))
            {
                actions.Add(Ds.Button("Contract", () => context.Navigator.Go(ShellRoute.With("contracts", "employment", entry.EmploymentId)), DsButtonKind.Secondary, "contracts"));
            }
            actions.Add(Ds.Button("Full profile", () => context.Navigator.Go(ShellRoute.With(ScreenIds.Worker, "id", entry.PersonId)), DsButtonKind.Ghost, "chevron-right"));
            notes.Add(actions);
            row.Add(notes);

            FillDetails(entry, skills, traits);
            return row;
        }

        private static async void FillDetails(Entry entry, VisualElement skills, VisualElement traits)
        {
            QueryResult<JToken> profile = await Kit.Game.Client.Query("workers.profile", new JObject { ["personId"] = entry.PersonId });
            skills.Clear();
            skills.Add(W.Label("In the ring"));
            if (!profile.Ok)
            {
                skills.Add(Kit.Error(Kit.Reasons(profile.Reasons)));
                return;
            }
            foreach ((string label, double value) in KeySkills(profile.Data)) skills.Add(W.SkillLine(label, value));
            List<JToken> list = Kit.Arr(profile.Data, "traits").Take(4).ToList();
            if (list.Count == 0) traits.Add(Ds.Text("Nothing stands out.", "ds-type-caption"));
            foreach (JToken trait in list)
            {
                string key = Kit.Str(trait, "key");
                DsState state = W.TraitState(key);
                traits.Add(Ds.Pill(state, Kit.Str(trait, "label") ?? W.Trait(key), state == DsState.Good ? "check" : state == DsState.Warn ? "warning" : "info"));
            }
        }

        /// <summary>The four numbers the roster leads with: ring work, charisma, mic and stamina (else the first four).</summary>
        public static IEnumerable<(string label, double value)> KeySkills(JToken profile)
        {
            List<JToken> attributes = Kit.Arr(profile, "attributes.inRing").Concat(Kit.Arr(profile, "attributes.character")).ToList();
            string[] wanted = { "ringwork", "charisma", "mic", "stamina" };
            List<JToken> picked = wanted.Select(key => attributes.FirstOrDefault(a => Kit.Str(a, "key") == key)).Where(a => a != null).ToList();
            if (picked.Count < 2) picked = attributes.Take(4).ToList();
            return picked.Select(a => (Kit.Str(a, "label") == "Mic skills" ? "Mic" : Kit.Str(a, "label") ?? Kit.Str(a, "key"), Kit.Num(a, "value") ?? 0));
        }

        // ---- Injuries ----------------------------------------------------------------------------

        private static async Task RenderInjuries(VisualElement host, ScreenContext context)
        {
            EngineGame game = Kit.Game;
            QueryResult<JToken> report = await game.Client.Query("health.report",
                new JObject { ["promotionId"] = game.PromotionId });
            host.Clear();
            if (!report.Ok)
            {
                host.Add(Kit.Error(Kit.Reasons(report.Reasons)));
                return;
            }

            await Acknowledge(report.Data);

            List<JToken> rows = Kit.Arr(report.Data, "rows").ToList();
            host.Add(W.Head("Roster", $"Who is out as of {Kit.Date(Kit.Str(report.Data, "asOf"), true)}, soonest back first.", out _));
            VisualElement bar = Ds.Row("wl-toolbar");
            bar.Add(TabBar(DayControlLogic.InjuriesTabId, context, new Dictionary<string, int> { [DayControlLogic.InjuriesTabId] = rows.Count }));
            bar.Add(Ds.Spacer());
            host.Add(bar);
            if (rows.Count == 0)
            {
                host.Add(W.Empty("check-circle", "Nobody on your roster is injured.", "Injuries from matches and life outside the ring show up here."));
                return;
            }
            var columns = new List<DsColumn<JToken>>
            {
                new DsColumn<JToken>("name", "Name", row => W.NameCell(Kit.Str(row, "name"), Kit.Str(row, "imageRef"), null)) { Grow = 2f, MinWidth = 200, Pinned = true, SortKey = row => Kit.Str(row, "name") },
                new DsColumn<JToken>("injury", "Injury", row => W.Cell($"{Kit.Str(row, "label")} ({W.Words(Kit.Str(row, "bodyPart"))})")) { Grow = 2f, MinWidth = 180 },
                new DsColumn<JToken>("severity", "Severity", row =>
                {
                    string severity = Kit.Str(row, "severity");
                    return Ds.Pill(severity == "severe" ? DsState.Bad : severity == "moderate" ? DsState.Warn : DsState.Info, Kit.Capital(severity), "injured");
                }) { Grow = 1f, MinWidth = 110, SortKey = row => Kit.Str(row, "severity") },
                new DsColumn<JToken>("since", "Since", row => W.Cell(Kit.Date(Kit.Str(row, "since")))) { Grow = 1f, SortKey = row => Kit.Str(row, "since") },
                new DsColumn<JToken>("back", "Back", row => W.Cell(Kit.Date(Kit.Str(row, "expectedReturn")))) { Grow = 1f, SortKey = row => Kit.Str(row, "expectedReturn") },
                new DsColumn<JToken>("left", "Days left", row =>
                {
                    double? remaining = Kit.Num(row, "daysRemaining");
                    return W.QuietWhy(Ds.Row("wl-dot-num").With(W.Cell(remaining.HasValue ? TextFormat.DayCount((int)remaining.Value) : Kit.NoValue)),
                        Kit.WhyRef("Time out", Kit.Num(row, "daysOut") ?? 0, Kit.Obj(row, "durationTraceRef"), "days"));
                }) { Grow = 1f, MinWidth = 110, SortKey = row => Kit.Num(row, "daysRemaining") ?? 0 },
                new DsColumn<JToken>("loss", "Condition lost", row =>
                {
                    double loss = Kit.Num(row, "conditionLoss") ?? 0;
                    return W.QuietWhy(Ds.Row("wl-dot-num").With(W.Cell(Kit.Decimal1(loss), number: true)),
                        Kit.WhyRef("Condition lost", loss, Kit.Obj(row, "conditionLossTraceRef")));
                }) { Grow = 1f, MinWidth = 110, SortKey = row => Kit.Num(row, "conditionLoss") ?? 0 },
                new DsColumn<JToken>("angles", "Angles", row => Kit.Bool(row, "canWorkAngles") ? Ds.Dot(DsState.Good, "Can work") : Ds.Dot(DsState.Neutral, "No")) { Grow = 1f, Help = "Whether they can still appear in angles and promos." },
            };
            var table = new DsTable<JToken>(columns, rows) { name = "injuries-table" };
            table.RowClicked += row => WorkerSheet.Open(context, Kit.Str(row, "personId"), null);
            host.Add(table);
        }

        /// <summary>Opening the tab marks every injury the player has not seen as seen (the web's useAcknowledgeOnView).</summary>
        private static async Task Acknowledge(JToken report)
        {
            EngineGame game = Kit.Game;
            if (game.Client.IsAdvancing) return;
            var ids = new HashSet<string>(Kit.Arr(report, "waitingForViewer").Select(id => (string)id));
            foreach (JToken row in Kit.Arr(report, "rows"))
            {
                if (Kit.Bool(row, "pendingNotice")) ids.Add(Kit.Str(row, "injuryId"));
            }
            List<string> all = ids.Where(id => id != null).ToList();
            for (int start = 0; start < all.Count; start += 50)
            {
                await game.Client.Command("health.acknowledgeInjuries",
                    new JObject { ["injuryIds"] = new JArray(all.Skip(start).Take(50)) });
            }
        }
    }

    /// <summary>The Set push sheet (the web's SetPushSheet) on the design system: one wrestler's card position.</summary>
    public static class SetPushSheet
    {
        public static void Open(ScreenContext context, JToken row) => Open(context.Overlay.Layer, row);

        public static void Open(VisualElement anyElement, JToken row)
        {
            string name = Kit.Str(row, "ringName");
            string current = Kit.Str(row, "push");
            string expected = Kit.Str(row, "expectedPush");
            string picked = current;
            VisualElement body = Ds.Column("wl-setpush");
            body.Add(Ds.Text("Where they sit on the card. Pushing someone below where they expect to be costs morale; above it raises what they expect next.", "ds-type-caption", "wl-wrap"));
            var buttons = new List<(Button button, string push)>();
            foreach (string push in Kit.CardPushes)
            {
                string value = push;
                string hint = push == current && push == expected ? "Now · what they expect"
                    : push == current ? "Now" : push == expected ? "What they expect" : null;
                var option = new Button { text = string.Empty };
                option.AddToClassList("wl-option");
                option.Add(Ds.Text(W.PushWord(push), "wl-option__label"));
                if (hint != null) option.Add(Ds.Text(hint, "wl-option__hint"));
                option.clicked += () =>
                {
                    picked = value;
                    foreach ((Button other, string otherPush) in buttons) other.EnableInClassList("wl-option--selected", otherPush == picked);
                };
                option.EnableInClassList("wl-option--selected", push == current);
                option.name = $"set-push-option-{push}";
                buttons.Add((option, push));
                body.Add(option);
            }
            Label feedback = Kit.Feedback();
            body.Add(feedback);
            OverlayHandle handle = null;
            VisualElement footer = Ds.Row();
            footer.Add(Ds.Button("Cancel", () => handle?.Close(), DsButtonKind.Ghost));
            footer.Add(Ds.Spacer());
            Button save = Ds.Button("Save", async () =>
            {
                if (picked == current)
                {
                    handle?.Close();
                    return;
                }
                CommandResult<JToken> result = await Kit.Run("roster.setPush",
                    new JObject { ["employmentIds"] = new JArray(Kit.Str(row, "employmentId")), ["push"] = picked }, feedback);
                if (result.Ok)
                {
                    handle?.Close();
                    DsOverlay.Toast(anyElement, $"{name} is now {W.PushWord(picked)?.ToLowerInvariant()}", DsState.Good);
                }
            }, DsButtonKind.Primary, "check");
            save.name = "set-push-save";
            footer.Add(save);
            handle = DsOverlay.SideSheet(anyElement, $"Set push — {name}", body, "Card position", footer, 420f);
            if (handle != null) handle.Content.name = "set-push-sheet";
        }
    }
}
