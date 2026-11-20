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
using RingsideBooker.UI.Why;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// A worker's quick look in a side sheet (UNITY-15, the approved mockup 07): portrait, name,
    /// side, card position, morale and condition, popularity and overall tiles with their Why?s,
    /// the key skills and the contract. Opens from the Roster, Workers, a promotion's roster and the
    /// injuries list; "Full profile" goes to <see cref="WorkerProfileScreen"/>.
    /// </summary>
    public static class WorkerSheet
    {
        /// <param name="rosterRow">The player's own <c>roster.rows</c> row when known (adds Set push and morale).</param>
        public static async void Open(ScreenContext context, string personId, JToken rosterRow)
        {
            if (personId == null || Kit.Game == null) return;
            QueryResult<JToken> answer = await Kit.Game.Client.Query("workers.profile", new JObject { ["personId"] = personId });
            VisualElement body = Ds.Column("wl-worker");
            JToken profile = answer.Ok ? answer.Data : null;
            string name = Kit.Str(profile, "header.ringName") ?? Kit.Str(rosterRow, "ringName") ?? "Worker";
            if (profile == null)
            {
                body.Add(Kit.Error(answer.Ok ? "This person is no longer in the world." : Kit.Reasons(answer.Reasons)));
                DsOverlay.SideSheet(context.Overlay.Layer, name, body, null, null, 480f);
                return;
            }

            JToken header = Kit.Obj(profile, "header");
            string champion = (await RosterScreen.AllChampionsAsync()).TryGetValue(personId, out string belt) ? belt : null;
            body.Add(WorkerProfileScreen.Hero(header, champion, rosterRow, context, "ds-portrait--lg", compact: true));

            VisualElement tiles = Ds.Row("wl-tiles");
            tiles.Add(WorkerProfileScreen.PopularityTile(profile, true));
            tiles.Add(WorkerProfileScreen.OverallTile(profile, true));
            body.Add(tiles);

            body.Add(Ds.SectionHeader("In the ring"));
            foreach ((string label, double value) in RosterScreen.KeySkills(profile)) body.Add(W.SkillLine(label, value));

            JToken contract = Kit.Arr(profile, "career.contracts").FirstOrDefault(c => Kit.Str(c, "status") == "active" && Kit.Str(c, "promotionId") == Kit.Str(header, "employer.promotionId"));
            body.Add(Ds.SectionHeader("Contract"));
            if (contract == null) body.Add(Ds.Text("A free agent: nobody has them under contract.", "ds-type-caption", "wl-wrap"));
            else
            {
                var pairs = new List<(string, string)> { ("With", Kit.Str(contract, "promotionName")) };
                if (Kit.Num(contract, "terms.monthlyWage") is double wage) pairs.Add(("Wage", $"{W.Money(wage)} a month"));
                pairs.Add(("Ends", Kit.Str(contract, "endsOn") is string ends ? Kit.Date(ends) : "Open-ended"));
                if (Kit.Obj(contract, "terms") is JToken terms) pairs.Add(("Exclusive", Kit.Bool(terms, "exclusive") ? "Yes" : "No"));
                body.Add(Ds.KeyValues(pairs.ToArray()));
            }

            OverlayHandle handle = null;
            VisualElement footer = Ds.Row();
            if (rosterRow != null && Kit.Str(rosterRow, "push") is string push && push != "none" && Kit.Str(rosterRow, "group") == "wrestlers")
            {
                footer.Add(Ds.Button("Set push", () =>
                {
                    handle?.Close();
                    SetPushSheet.Open(context, rosterRow);
                }, DsButtonKind.Secondary, "trend-up"));
            }
            VisualElement sheetSlot = Ds.Row("wl-contract-slot");
            footer.Add(sheetSlot);
            WorkerProfileScreen.FillContractAction(sheetSlot, personId, DsButtonKind.Secondary, () => handle?.Close(), showReason: false);
            footer.Add(Ds.Spacer());
            Button full = Ds.Button("Full profile", () =>
            {
                handle?.Close();
                context.Navigator.Go(ShellRoute.With(ScreenIds.Worker, "id", personId));
            }, DsButtonKind.Primary, "chevron-right");
            full.name = "worker-sheet-profile";
            footer.Add(full);
            string eyebrow = W.PushWord(Kit.Str(header, "push")) ?? W.RoleWord(Kit.Str(header, "mainRole"));
            handle = DsOverlay.SideSheet(context.Overlay.Layer, name, body, eyebrow, footer, 480f);
            if (handle != null) handle.Content.name = "worker-sheet";
        }
    }

    /// <summary>
    /// A worker's profile page (UNITY-15; the web's WorkerProfileScreen): a hero with the plain-words
    /// state and four tiles with Why?s, then tabs Overview (attributes, facts, traits, where they're
    /// popular), Career (contracts, title reigns, teams), Health (<c>health.profile</c>: fatigue,
    /// condition by body part, injuries), Contract (<c>contracts.detail</c> for your own worker,
    /// the public facts otherwise) and Form (<c>match.recentForm</c>, each match linking to its
    /// show's results). Route <c>worker?id=&lt;person or employment id&gt;&amp;tab=…</c>.
    /// </summary>
    public static class WorkerProfileScreen
    {
        private static readonly (string id, string label)[] Tabs =
        {
            ("overview", "Overview"),
            ("career", "Career"),
            ("health", "Health"),
            ("contract", "Contract"),
            ("form", "Form"),
        };

        public static VisualElement Build(ScreenContext context)
        {
            VisualElement page = W.Page("worker");
            VisualElement host = Ds.Column("wl-host");
            page.Add(host);
            Kit.Live(host, () => Render(host, context));
            return page;
        }

        private static async Task Render(VisualElement host, ScreenContext context)
        {
            EngineClient client = Kit.Game.Client;
            string id = context.Route.Param("id");
            string tab = context.Route.Param("tab") ?? "overview";
            if (id != null && id.StartsWith("emp_", StringComparison.Ordinal))
            {
                QueryResult<JToken> detail = await client.Query("contracts.detail", new JObject { ["employmentId"] = id });
                id = Kit.Str(detail.Data, "personId") ?? id;
            }
            QueryResult<JToken> answer = id == null ? null : await client.Query("workers.profile", new JObject { ["personId"] = id });
            Dictionary<string, string> champions = await RosterScreen.AllChampionsAsync();
            host.Clear();
            if (answer == null || !answer.Ok || answer.Data == null || answer.Data.Type == JTokenType.Null)
            {
                host.Add(W.Head("Worker", null, out _));
                host.Add(W.Empty("user-search", "That person isn't in the world.", answer == null ? "No one was picked." : Kit.Reasons(answer.Reasons)));
                host.Add(Ds.Button("Browse workers", () => context.Navigator.Go(ShellRoute.To("workers")), DsButtonKind.Secondary, "user-search"));
                return;
            }
            JToken profile = answer.Data;
            JToken header = Kit.Obj(profile, "header");
            string personId = Kit.Str(header, "personId");
            string champion = champions.TryGetValue(personId ?? string.Empty, out string belt) ? belt : null;

            VisualElement crumbs = Ds.Row("wl-crumbs");
            Button back = Ds.Button("Back", () => context.Navigator.Back(), DsButtonKind.Ghost, "chevron-left");
            back.name = "worker-back";
            crumbs.Add(back);
            host.Add(crumbs);

            VisualElement top = Ds.Row("ds-row--top", "wl-profile-top");
            top.Add(Hero(header, champion, null, context, "ds-portrait--xl", compact: false));
            VisualElement tiles = Ds.Row("ds-row--wrap", "wl-profile-tiles");
            tiles.Add(OverallTile(profile, false));
            tiles.Add(PopularityTile(profile, false));
            double? world = Kit.Num(profile, "popularity.world.value");
            tiles.Add(Tile("Worldwide", W.Int(world), W.Popularity(world).word, DsState.Neutral,
                Kit.WhyTrace("Popularity worldwide", world ?? 0, Kit.Obj(profile, "popularity.world.trace"))));
            string expected = W.PushWord(Kit.Str(profile, "expectedPush.push"));
            if (expected != null)
            {
                tiles.Add(Tile("Expects", expected, Kit.Str(profile, "expectedPush.promotionName"), DsState.Info,
                    Kit.WhyTrace("Expected push", 0, Kit.Obj(profile, "expectedPush.trace"), null, "Why they expect this push")));
            }
            top.Add(tiles);
            host.Add(top);

            var tabs = new DsTabs();
            foreach ((string tabId, string label) in Tabs) tabs.Add(tabId, label);
            tabs.Select(tab, false);
            tabs.name = "worker-tabs";
            tabs.Selected += picked => context.Navigator.Go(ShellRoute.With(ScreenIds.Worker, "id", personId, "tab", picked));
            VisualElement bar = Ds.Row("wl-toolbar");
            bar.Add(tabs);
            host.Add(bar);

            VisualElement body = Ds.Column("wl-tab-body").Named($"worker-tab-{tab}");
            host.Add(body);
            switch (tab)
            {
                case "career": Career(body, profile, context); break;
                case "health": await Health(body, personId); break;
                case "contract": await Contract(body, profile, context); break;
                case "form": await Form(body, personId, context); break;
                default: Overview(body, profile); break;
            }
        }

        // ---- Contract action (UNITY-17) ---------------------------------------------------------

        /// <summary>
        /// The worker's contract button from UNITY-17 (<see cref="Contracts.ContractsScreen.ActionFor"/>):
        /// "Open talks", "Renew contract" or "Offer contract", disabled with its reason in a tooltip;
        /// filled into <paramref name="slot"/> once worked out, nothing when no action applies.
        /// </summary>
        public static async void FillContractAction(VisualElement slot, string personId, DsButtonKind kind = DsButtonKind.Secondary, Action before = null, bool showReason = true)
        {
            if (slot == null || personId == null) return;
            try
            {
                Contracts.ContractAction action = await Contracts.ContractsScreen.ActionFor(personId);
                slot.Clear();
                if (action == null) return;
                Button button = null;
                button = Ds.Button(action.Label, async () =>
                {
                    before?.Invoke();
                    string refused = await action.Open(personId);
                    if (refused != null) DsOverlay.Toast(slot.panel != null ? slot : (VisualElement)ShellController.Current?.Overlay?.Layer, refused, DsState.Warn);
                }, kind, "contracts");
                button.name = "worker-contract-action";
                button.SetEnabled(action.Enabled);
                slot.Add(button);
                if (!action.Enabled && action.Reason != null)
                {
                    if (showReason) slot.Add(Ds.Text(action.Reason, "ds-type-caption", "wl-wrap", "wl-contract-reason"));
                    DsTooltip.Attach(slot, action.Reason, action.Label);
                }
            }
            catch (Exception exception)
            {
                UnityEngine.Debug.LogWarning($"[Worker] contract action: {exception.GetType().Name}");
            }
        }

        // ---- Hero and tiles --------------------------------------------------------------------

        /// <summary>Portrait, title, name, side and position, then morale and condition in words.</summary>
        public static VisualElement Hero(JToken header, string champion, JToken rosterRow, ScreenContext context, string portraitSize, bool compact)
        {
            VisualElement hero = Ds.Row("ds-row--top", "wl-hero");
            hero.Add(W.Portrait(Kit.Str(header, "imageRef"), Kit.Str(header, "alignment"), portraitSize, champion != null));
            VisualElement words = Ds.Column("wl-hero__words");
            if (champion != null) words.Add(Ds.Pill(DsState.Gold, champion, "crown"));
            words.Add(Ds.Text(TextFormat.Upper(Kit.Str(header, "ringName")), compact ? "ds-type-headline" : "ds-type-display", "wl-hero__name"));
            string legal = Kit.Str(header, "legalName");
            if (!compact && legal != null && legal != Kit.Str(header, "ringName")) words.Add(Ds.Text(legal, "ds-type-caption"));
            VisualElement tags = Ds.Row("ds-row--wrap", "wl-hero__tags");
            if (Kit.Str(header, "alignment") is string side && side != "none") tags.Add(W.SideTag(side));
            string position = W.PushWord(Kit.Str(header, "push")) ?? W.RoleWord(Kit.Str(header, "mainRole"));
            tags.Add(Ds.Text($"{position} · {W.StyleWord(Kit.Str(header, "style"))} · {W.Int(Kit.Num(header, "age"))}", "ds-type-caption"));
            words.Add(tags);

            VisualElement states = Ds.Column("wl-hero__states");
            (DsState conditionState, string conditionWord) = W.Condition(Kit.Str(header, "availability.status"), Kit.Str(header, "availability.reason"));
            if (rosterRow != null && Kit.Num(rosterRow, "morale.value") is double morale)
            {
                (DsState moraleState, string moraleWord) = W.Morale(morale);
                states.Add(Ds.Dot(moraleState, $"Morale: {moraleWord}"));
            }
            string until = Kit.Str(header, "availability.until");
            states.Add(Ds.Dot(conditionState, $"Condition: {conditionWord}" + (until != null ? $" until {Kit.Date(until)}" : string.Empty)));
            words.Add(states);

            string employerId = Kit.Str(header, "employer.promotionId");
            VisualElement employer = Ds.Row("wl-hero__employer");
            if (employerId != null)
            {
                VisualElement logoSlot = Ds.Row("wl-logo-slot");
                employer.Add(logoSlot);
                PromotionsScreen.FillLogo(logoSlot, employerId, Kit.Str(header, "employer.shortName"), "ds-logo--sm");
                Button link = Ds.Button(Kit.Str(header, "employer.name"), () => context.Navigator.Go(ShellRoute.With(PromotionsScreen.ProfileId, "id", employerId)), DsButtonKind.Ghost);
                link.AddToClassList("ds-btn--link");
                link.AddToClassList("wl-hero__employer-link");
                employer.Add(link);
            }
            else employer.Add(Ds.Pill(DsState.Info, "Free agent", "user"));
            words.Add(employer);
            hero.Add(words);
            return hero;
        }

        /// <summary>A stat tile whose quiet Why? is a real UNITY-08 button.</summary>
        public static VisualElement Tile(string label, string value, string words, DsState state, WhyButton why, bool small = false)
        {
            VisualElement tile = Ds.StatTile(label, value, words, state);
            if (small) tile.AddToClassList("ds-stat--sm");
            tile.AddToClassList("wl-tile");
            VisualElement top = tile.Q(className: "ds-stat__top");
            if (why != null && top != null)
            {
                tile.AddToClassList("ds-why-host");
                W.QuietWhy(top, why);
            }
            return tile;
        }

        public static VisualElement PopularityTile(JToken profile, bool small)
        {
            double? top = Kit.Num(profile, "popularity.top.value");
            string countryId = Kit.Str(profile, "popularity.top.countryId");
            JToken country = Kit.Arr(profile, "popularity.continents").SelectMany(c => Kit.Arr(c, "countries")).FirstOrDefault(c => Kit.Str(c, "id") == countryId);
            (DsState state, string word) = W.Popularity(top);
            string where = Kit.Str(profile, "popularity.top.countryName");
            return Tile("Popularity", W.Int(top), where != null ? $"{word} in {where}" : word, state,
                Kit.WhyTrace($"Popularity in {where}", top ?? 0, Kit.Obj(country, "trace")), small);
        }

        public static VisualElement OverallTile(JToken profile, bool small)
        {
            string mainRole = Kit.Str(profile, "overall.mainRole");
            JToken rating = Kit.Arr(profile, "overall.byRole").FirstOrDefault(r => Kit.Str(r, "role") == mainRole) ?? Kit.Arr(profile, "overall.byRole").FirstOrDefault();
            double? value = Kit.Num(rating, "value");
            string words = value >= 75 ? "Top level" : value >= 60 ? "Reliable" : value >= 45 ? "Solid" : "Developing";
            return Tile($"Overall ({Kit.Str(rating, "grade") ?? Kit.NoValue})", W.Int(value), $"{words} {W.RoleWord(mainRole)?.ToLowerInvariant()}", DsState.Info,
                Kit.WhyTrace("Overall", value ?? 0, Kit.Obj(rating, "trace")), small);
        }

        // ---- Overview ----------------------------------------------------------------------------

        private static void Overview(VisualElement body, JToken profile)
        {
            JToken header = Kit.Obj(profile, "header");
            VisualElement columns = Ds.Row("ds-row--top", "wl-columns");

            VisualElement skills = Ds.Panel(null, null, null, "wl-col");
            AttributeGroup(skills, "In the ring", Kit.Arr(profile, "attributes.inRing"));
            AttributeGroup(skills, "Character", Kit.Arr(profile, "attributes.character"));
            string mainRole = Kit.Str(header, "mainRole");
            if (mainRole != "wrestler" && mainRole != "occasionalWrestler") AttributeGroup(skills, "Crew", Kit.Arr(profile, "attributes.crew"));
            columns.Add(skills);

            VisualElement about = Ds.Panel("About", null, null, "wl-col");
            double? height = Kit.Num(header, "heightCm");
            double? weight = Kit.Num(header, "weightKg");
            about.Add(Ds.KeyValues(
                ("Real name", Kit.Str(header, "legalName") ?? Kit.NoValue),
                ("Age", W.Int(Kit.Num(header, "age"))),
                ("Size", height.HasValue ? $"{W.Int(height)} cm · {W.Int(weight)} kg · {W.Words(Kit.Str(header, "weightClass.value"))}" : Kit.NoValue),
                ("Style", W.StyleWord(Kit.Str(header, "style"))),
                ("Roles", string.Join(", ", Kit.Arr(header, "roles").Select(r => W.RoleWord((string)r)))),
                ("Based in", Place(Kit.Obj(header, "basedIn"))),
                ("Born", Place(Kit.Obj(header, "born"))),
                ("Debut", Kit.Str(header, "debutDate") is string debut ? $"{Kit.Date(debut)} ({W.Int(Kit.Num(header, "experienceYears"))} years in)" : "Not yet"),
                ("Status", W.Words(Kit.Str(header, "status")))));
            about.Add(Ds.SectionHeader("Worth knowing"));
            List<JToken> traits = Kit.Arr(profile, "traits").ToList();
            VisualElement pills = Ds.Row("ds-row--wrap", "wl-pills");
            if (traits.Count == 0) pills.Add(Ds.Text("Nothing stands out.", "ds-type-caption"));
            foreach (JToken trait in traits)
            {
                string key = Kit.Str(trait, "key");
                DsState state = W.TraitState(key);
                pills.Add(Ds.Pill(state, Kit.Str(trait, "label") ?? W.Trait(key), state == DsState.Good ? "check" : state == DsState.Warn ? "warning" : "info"));
            }
            about.Add(pills);
            AboutMovesAndBio(about, profile);
            columns.Add(about);

            VisualElement where = Ds.Panel("Where they're popular", null, null, "wl-col");
            var places = Kit.Arr(profile, "popularity.continents").SelectMany(c => Kit.Arr(c, "countries"))
                .OrderByDescending(c => Kit.Num(c, "value") ?? 0).Take(6).ToList();
            if (places.Count == 0) where.Add(Ds.Text("Unknown everywhere so far.", "ds-type-caption"));
            foreach (JToken place in places)
            {
                double value = Kit.Num(place, "value") ?? 0;
                (DsState state, string word) = W.Popularity(value);
                VisualElement line = Ds.Row("wl-skill");
                line.Add(Ds.Text(Kit.Str(place, "name"), "wl-skill__label", "wl-skill__label--wide"));
                line.Add(Ds.Meter((float)(value / 100.0), state, word));
                line.Add(W.QuietNumber(W.Int(value)));
                W.QuietWhy(line, Kit.WhyTrace($"Popularity in {Kit.Str(place, "name")}", value, Kit.Obj(place, "trace")));
                where.Add(line);
            }
            columns.Add(where);
            body.Add(columns);
        }

        /// <summary>Named finishers, signatures and the bio, when the person has them (league roster).</summary>
        private static void AboutMovesAndBio(VisualElement about, JToken profile)
        {
            List<string> finishers = Kit.Arr(profile, "moves.finishers").Select(m => (string)m).ToList();
            List<string> signatures = Kit.Arr(profile, "moves.signatures").Select(m => (string)m).ToList();
            if (finishers.Count + signatures.Count > 0)
            {
                about.Add(Ds.SectionHeader("Moves"));
                about.Add(Ds.KeyValues(
                    ("Finishers", finishers.Count > 0 ? string.Join(", ", finishers) : Kit.NoValue),
                    ("Signatures", signatures.Count > 0 ? string.Join(", ", signatures) : Kit.NoValue)));
            }
            if (Kit.Str(profile, "bio") is string bio && bio.Length > 0)
            {
                about.Add(Ds.SectionHeader("Bio"));
                Label text = Ds.Text(bio, "ds-type-body");
                text.style.whiteSpace = WhiteSpace.Normal;
                about.Add(text);
            }
        }

        private static string Place(JToken place) =>
            place == null ? Kit.NoValue : $"{Kit.Str(place, "regionName")}, {Kit.Str(place, "countryName")}";

        private static void AttributeGroup(VisualElement parent, string title, IEnumerable<JToken> attributes)
        {
            List<JToken> list = attributes.ToList();
            if (list.Count == 0) return;
            parent.Add(Ds.SectionHeader(title));
            foreach (JToken attribute in list)
            {
                VisualElement line = W.SkillLine(Kit.Str(attribute, "label") ?? Kit.Str(attribute, "key"), Kit.Num(attribute, "value") ?? 0);
                if (Kit.Str(attribute, "gradeReason") is string reason) DsTooltip.Attach(line, reason, $"Grade {Kit.Str(attribute, "grade")}");
                parent.Add(line);
            }
        }

        // ---- Career ------------------------------------------------------------------------------

        private static void Career(VisualElement body, JToken profile, ScreenContext context)
        {
            body.Add(Ds.SectionHeader("Contracts"));
            List<JToken> contracts = Kit.Arr(profile, "career.contracts").ToList();
            if (contracts.Count == 0) body.Add(Ds.Text("No contracts on record.", "ds-type-caption"));
            else
            {
                var columns = new List<DsColumn<JToken>>
                {
                    new DsColumn<JToken>("promotion", "Promotion", c => W.Cell(Kit.Str(c, "promotionName"), strong: true)) { Grow = 2f, MinWidth = 200, SortKey = c => Kit.Str(c, "promotionName") },
                    new DsColumn<JToken>("role", "Role", c => W.Cell(W.RoleWord(Kit.Str(c, "role")))) { Grow = 1f },
                    new DsColumn<JToken>("as", "Worked as", c => W.Cell(Kit.Str(c, "ringName"))) { Grow = 1.3f },
                    new DsColumn<JToken>("push", "Push", c => W.Cell(W.PushWord(Kit.Str(c, "push")) ?? Kit.NoValue)) { Grow = 1f },
                    new DsColumn<JToken>("from", "From", c => W.Cell(Kit.Date(Kit.Str(c, "startsOn")))) { Grow = 1f, SortKey = c => Kit.Str(c, "startsOn") },
                    new DsColumn<JToken>("to", "To", c => W.Cell(Kit.Str(c, "endedOn") is string ended ? Kit.Date(ended) : Kit.Str(c, "endsOn") is string ends ? $"Ends {Kit.Date(ends)}" : "Open-ended")) { Grow = 1.2f },
                    new DsColumn<JToken>("status", "Status", c => Kit.Str(c, "status") == "active" ? Ds.Dot(DsState.Good, "Active") : Ds.Dot(DsState.Neutral, W.Words(Kit.Str(c, "status")))) { Grow = 0.9f },
                };
                var table = new DsTable<JToken>(columns, contracts) { name = "career-contracts" };
                table.RowClicked += c => context.Navigator.Go(ShellRoute.With(PromotionsScreen.ProfileId, "id", Kit.Str(c, "promotionId")));
                body.Add(table);
            }

            body.Add(Ds.SectionHeader("Title reigns"));
            List<JToken> reigns = Kit.Arr(profile, "career.reigns").ToList();
            if (reigns.Count == 0) body.Add(Ds.Text("Never held a title.", "ds-type-caption"));
            else
            {
                var columns = new List<DsColumn<JToken>>
                {
                    new DsColumn<JToken>("title", "Title", r => Ds.Row("wl-dot-num").With(new Icon("crown", "ds-icon--xs", "wl-crown-lead"), W.Cell(Kit.Str(r, "titleName"), strong: true))) { Grow = 2.2f, MinWidth = 220 },
                    new DsColumn<JToken>("promotion", "Promotion", r => W.Cell(Kit.Str(r, "promotionName"))) { Grow = 1.6f },
                    new DsColumn<JToken>("won", "Won", r => W.Cell(Kit.Date(Kit.Str(r, "wonOn")))) { Grow = 1f, SortKey = r => Kit.Str(r, "wonOn") },
                    new DsColumn<JToken>("lost", "Lost", r => Kit.Str(r, "lostOn") is string lost ? W.Cell(Kit.Date(lost)) : Ds.Pill(DsState.Gold, "Champion", "crown")) { Grow = 1f },
                    new DsColumn<JToken>("days", "Days", r => W.Cell(W.Int(Kit.Num(r, "daysHeld")), number: true)) { Width = 80, Align = DsAlign.Right, SortKey = r => Kit.Num(r, "daysHeld") ?? 0 },
                    new DsColumn<JToken>("defences", "Defences", r => W.Cell(W.Int(Kit.Num(r, "defences")), number: true)) { Width = 90, Align = DsAlign.Right, SortKey = r => Kit.Num(r, "defences") ?? 0 },
                };
                body.Add(new DsTable<JToken>(columns, reigns) { name = "career-reigns" });
            }

            List<JToken> teams = Kit.Arr(profile, "career.teams").ToList();
            if (teams.Count > 0)
            {
                body.Add(Ds.SectionHeader("Teams"));
                VisualElement pills = Ds.Row("ds-row--wrap", "wl-pills");
                foreach (JToken team in teams) pills.Add(Ds.Pill(DsState.Info, Kit.Str(team, "name") ?? Kit.Str(team, "teamName") ?? "Team", "users"));
                body.Add(pills);
            }
        }

        // ---- Health ------------------------------------------------------------------------------

        private static async Task Health(VisualElement body, string personId)
        {
            QueryResult<JToken> answer = await Kit.Game.Client.Query("health.profile", new JObject { ["personId"] = personId });
            if (!answer.Ok)
            {
                body.Add(Kit.Error(Kit.Reasons(answer.Reasons)));
                return;
            }
            JToken health = answer.Data;
            VisualElement tiles = Ds.Row("ds-row--wrap", "wl-tile-row");
            string band = Kit.Str(health, "fatigue.band");
            DsState bandState = band == "fresh" ? DsState.Good : band == "tired" ? DsState.Info : band == "weary" ? DsState.Warn : DsState.Bad;
            double fatigue = Kit.Num(health, "fatigue.value") ?? 0;
            tiles.Add(Tile("Fatigue", W.Words(band) ?? Kit.NoValue, $"{W.Int(fatigue)} of 100 tired", bandState, Kit.WhyRef("Fatigue", fatigue, Kit.Obj(health, "fatigue.traceRef"))));
            tiles.Add(Tile("Medical care", $"Level {W.Int(Kit.Num(health, "medical.level"))}", Kit.Str(health, "medical.promotionName") ?? "Free agent care", DsState.Neutral, null));
            JToken current = Kit.Obj(health, "current");
            tiles.Add(current == null
                ? Tile("Injury", "None", "Fit to work", DsState.Good, null)
                : Tile("Injury", W.Words(Kit.Str(current, "severity")), $"{Kit.Str(current, "label")}, back {Kit.Date(Kit.Str(current, "expectedReturn"))}", DsState.Bad,
                    Kit.WhyRef("Time out", Kit.Num(current, "daysOut") ?? 0, Kit.Obj(current, "durationTraceRef"), "days")));
            body.Add(tiles);

            VisualElement columns = Ds.Row("ds-row--top", "wl-columns");
            VisualElement condition = Ds.Panel("Condition", null, null, "wl-col");
            condition.Add(Ds.Text("Each part of the body wears down with hard matches and heals a little every week, up to a cap that drops with age.", "ds-type-caption", "wl-wrap", "wl-gap-bottom"));
            foreach (JToken part in Kit.Arr(health, "condition"))
            {
                double value = Kit.Num(part, "value") ?? 0;
                DsState state = Kit.Bool(part, "injured") ? DsState.Bad : value >= 80 ? DsState.Good : value >= 60 ? DsState.Info : DsState.Warn;
                string word = Kit.Bool(part, "injured") ? "Injured" : value >= 80 ? "Good" : value >= 60 ? "Worn" : "Battered";
                VisualElement line = Ds.Row("wl-skill");
                line.Add(Ds.Text(W.Words(Kit.Str(part, "part")), "wl-skill__label"));
                line.Add(Ds.Meter((float)(value / 100.0), state, word));
                line.Add(W.QuietNumber(W.Int(value)));
                W.QuietWhy(line, Kit.WhyTrace($"{W.Words(Kit.Str(part, "part"))}: next week", Kit.Num(part, "nextCheck.value") ?? value, Kit.Obj(part, "nextCheck.trace"), null, "Condition after a week of healing"));
                condition.Add(line);
            }
            columns.Add(condition);

            VisualElement history = Ds.Panel("Injury history", null, null, "wl-col", "wl-col--wide");
            List<JToken> injuries = new List<JToken>();
            if (current != null) injuries.Add(current);
            injuries.AddRange(Kit.Arr(health, "history"));
            if (injuries.Count == 0) history.Add(Ds.Text("No injuries on record.", "ds-type-caption"));
            else
            {
                var columnsDef = new List<DsColumn<JToken>>
                {
                    new DsColumn<JToken>("injury", "Injury", i => W.Cell($"{Kit.Str(i, "label")} ({W.Words(Kit.Str(i, "bodyPart"))})")) { Grow = 2f, MinWidth = 180 },
                    new DsColumn<JToken>("severity", "Severity", i => W.Cell(W.Words(Kit.Str(i, "severity")))) { Grow = 1f },
                    new DsColumn<JToken>("since", "Since", i => W.Cell(Kit.Date(Kit.Str(i, "since")))) { Grow = 1f },
                    new DsColumn<JToken>("back", "Back", i => Kit.Str(i, "returnedOn") is string back ? W.Cell(Kit.Date(back)) : Ds.Pill(DsState.Bad, "Still out", "injured")) { Grow = 1f },
                    new DsColumn<JToken>("out", "Time out", i => W.QuietWhy(Ds.Row("wl-dot-num").With(W.Cell(TextFormat.DayCount((int)(Kit.Num(i, "daysOut") ?? 0)))),
                        Kit.WhyRef("Time out", Kit.Num(i, "daysOut") ?? 0, Kit.Obj(i, "durationTraceRef"), "days"))) { Grow = 1f, MinWidth = 100 },
                };
                history.Add(new DsTable<JToken>(columnsDef, injuries) { name = "health-history" });
            }
            columns.Add(history);
            body.Add(columns);
        }

        // ---- Contract ----------------------------------------------------------------------------

        private static async Task Contract(VisualElement body, JToken profile, ScreenContext context)
        {
            JToken header = Kit.Obj(profile, "header");
            string employerId = Kit.Str(header, "employer.promotionId");
            JToken contract = Kit.Arr(profile, "career.contracts").FirstOrDefault(c => Kit.Str(c, "status") == "active" && Kit.Str(c, "promotionId") == employerId);
            if (employerId == null || contract == null)
            {
                body.Add(W.Empty("user", "A free agent.", "Nobody has them under contract."));
                VisualElement offerSlot = Ds.Row("wl-contract-slot", "wl-contract-slot--center").Named("worker-contract-slot");
                body.Add(offerSlot);
                FillContractAction(offerSlot, Kit.Str(header, "personId"), DsButtonKind.Primary);
                return;
            }

            bool yours = Kit.Bool(header, "employer.isViewers");
            JToken detail = null;
            if (yours)
            {
                QueryResult<JToken> answer = await Kit.Game.Client.Query("contracts.detail", new JObject { ["employmentId"] = Kit.Str(contract, "employmentId") });
                if (answer.Ok && !Kit.Bool(answer.Data, "termsPrivate")) detail = answer.Data;
            }

            VisualElement columns = Ds.Row("ds-row--top", "wl-columns");
            VisualElement terms = Ds.Panel(yours ? "Your contract with them" : $"With {Kit.Str(contract, "promotionName")}", null, null, "wl-col");
            JToken source = detail ?? Kit.Obj(contract, "terms");
            var pairs = new List<(string, string)>
            {
                ("Promotion", Kit.Str(contract, "promotionName")),
                ("Role", W.RoleWord(Kit.Str(contract, "role"))),
                ("Since", Kit.Date(Kit.Str(contract, "startsOn"))),
                ("Ends", Kit.Str(contract, "endsOn") is string ends ? Kit.Date(ends) : "Open-ended"),
            };
            if (detail != null && Kit.Num(detail, "daysLeft") is double days) pairs.Add(("Days left", TextFormat.DayCount((int)days)));
            if (source != null)
            {
                pairs.Add(("Kind", W.Words(Kit.Str(source, "kind")) ?? Kit.NoValue));
                pairs.Add(("Exclusive", Kit.Bool(source, "exclusive") ? "Yes" : "No"));
                if (Kit.Num(source, "monthlyWage") is double wage) pairs.Add(("Wage", $"{W.Money(wage)} a month"));
                if (Kit.Num(source, "perAppearanceFee") is double fee && fee > 0) pairs.Add(("Per appearance", W.Money(fee)));
                if (Kit.Num(source, "signingBonus") is double bonus && bonus > 0) pairs.Add(("Signing bonus", W.Money(bonus)));
            }
            else pairs.Add(("Terms", "Private to their promotion"));
            terms.Add(Ds.KeyValues(pairs.ToArray()));
            List<string> perks = detail != null
                ? Kit.Arr(detail, "perks").Select(p => W.Words((string)p)).ToList()
                : Kit.Obj(contract, "terms.perks") is JObject perkMap ? perkMap.Properties().Where(p => p.Value.Type == JTokenType.Boolean && (bool)p.Value).Select(p => W.Words(p.Name)).ToList() : new List<string>();
            if (perks.Count > 0)
            {
                VisualElement pills = Ds.Row("ds-row--wrap", "wl-pills");
                foreach (string perk in perks) pills.Add(Ds.Pill(DsState.Info, perk, "check"));
                terms.Add(pills);
            }
            if (!yours)
            {
                VisualElement rivalSlot = Ds.Row("wl-contract-slot", "wl-gap-top").Named("worker-contract-slot");
                terms.Add(rivalSlot);
                FillContractAction(rivalSlot, Kit.Str(header, "personId"));
            }
            columns.Add(terms);

            if (detail != null)
            {
                VisualElement standing = Ds.Panel("Where things stand", null, null, "wl-col");
                (DsState moraleState, string moraleWord) = W.Morale(Kit.Num(detail, "morale"));
                standing.Add(Ds.Dot(moraleState, $"Morale: {moraleWord}"));
                if (Kit.Obj(detail, "unhappy") != null) standing.Add(Ds.Pill(DsState.Warn, "Unhappy with the deal", "morale"));
                if (Kit.Obj(detail, "request") != null) standing.Add(Ds.Pill(DsState.Bad, "Has asked to leave", "problem"));
                if (Kit.Obj(detail, "walkout") != null) standing.Add(Ds.Pill(DsState.Bad, "Might walk out", "problem"));
                double severance = Kit.Num(detail, "severance.value") ?? 0;
                VisualElement line = Ds.Row("wl-dot-num", "wl-gap-top");
                line.Add(Ds.Text("Releasing them costs", "ds-type-caption"));
                line.Add(Ds.Text(W.Money(severance), "wl-strong"));
                W.QuietWhy(line, Kit.WhyTrace("Severance", severance, Kit.Obj(detail, "severance.trace"), "money"));
                standing.Add(line);
                VisualElement actions = Ds.Row("ds-row--wrap", "wl-details__actions");
                VisualElement actionSlot = Ds.Row("wl-contract-slot").Named("worker-contract-slot");
                actions.Add(actionSlot);
                FillContractAction(actionSlot, Kit.Str(header, "personId"), DsButtonKind.Primary);
                if (Kit.Str(detail, "role") == "wrestler" && Kit.Str(detail, "push") is string push && push != "none")
                {
                    actions.Add(Ds.Button("Set push", () => SetPushSheet.Open(context, detail), DsButtonKind.Secondary, "trend-up"));
                }
                if (ScreenRegistry.IsLive("contracts"))
                {
                    actions.Add(Ds.Button("Open in Contracts", () => context.Navigator.Go(ShellRoute.With("contracts", "tab", "active", "employment", Kit.Str(detail, "employmentId"))), DsButtonKind.Ghost, "chevron-right"));
                }
                standing.Add(actions);
                columns.Add(standing);
            }
            body.Add(columns);
        }

        // ---- Form --------------------------------------------------------------------------------

        private static async Task Form(VisualElement body, string personId, ScreenContext context)
        {
            QueryResult<JToken> answer = await Kit.Game.Client.Query("match.recentForm", new JObject { ["personId"] = personId, ["limit"] = 10 });
            if (!answer.Ok)
            {
                body.Add(Kit.Error(Kit.Reasons(answer.Reasons)));
                return;
            }
            List<JToken> matches = Kit.Arr(answer.Data, "matches").ToList();
            if (matches.Count == 0)
            {
                body.Add(W.Empty("versus", "No matches yet.", "Their last ten matches show here once they've wrestled."));
                return;
            }
            VisualElement strip = Ds.Row("wl-form-strip");
            strip.Add(W.Label("Last " + matches.Count));
            foreach (JToken match in matches.AsEnumerable().Reverse())
            {
                string result = Kit.Str(match, "result");
                Label chip = Ds.Text(result == "win" ? "W" : result == "loss" ? "L" : "D", "wl-form-chip", "wl-form-chip--" + (result ?? "draw"));
                strip.Add(chip);
            }
            body.Add(strip);

            var columns = new List<DsColumn<JToken>>
            {
                new DsColumn<JToken>("date", "Date", m => W.Cell(Kit.Date(Kit.Str(m, "date")))) { Width = 120 },
                new DsColumn<JToken>("result", "Result", m =>
                {
                    string result = Kit.Str(m, "result");
                    return result == "win" ? Ds.Pill(DsState.Good, "Win", "check") : result == "loss" ? Ds.Pill(DsState.Bad, "Loss", "down") : Ds.Pill(DsState.Neutral, W.Words(result) ?? "Draw", "flat");
                }) { Width = 110 },
                new DsColumn<JToken>("opponents", "Against", m => W.Cell(string.Join(", ", Kit.Arr(m, "opponents").Select(o => Kit.Str(o, "name"))), strong: true)) { Grow = 2f, MinWidth = 180 },
                new DsColumn<JToken>("how", "How", m => W.Cell($"{KeyWords(Kit.Str(m, "methodKey"))} · {KeyWords(Kit.Str(m, "finishKey"))}")) { Grow = 1.6f, MinWidth = 160 },
                new DsColumn<JToken>("show", "Show", m => W.Cell(Kit.Str(m, "eventName"))) { Grow = 1.4f, MinWidth = 150 },
                new DsColumn<JToken>("popularity", "Popularity", m => Change(Kit.Num(m, "popularityChange"), "Popularity change", Kit.Obj(m, "traceRefs.popularity"))) { Width = 120, Align = DsAlign.Right },
                new DsColumn<JToken>("momentum", "Momentum", m => Change(Kit.Num(m, "momentumChange"), "Momentum change", Kit.Obj(m, "traceRefs.momentum"))) { Width = 120, Align = DsAlign.Right },
            };
            var table = new DsTable<JToken>(columns, matches) { name = "worker-form" };
            table.RowClicked += m => context.Navigator.Go(ShellRoute.With(ScreenIds.ShowResults, "event", Kit.Str(m, "eventInstanceId")));
            body.Add(table);
            body.Add(Ds.Text("Pick a match to read its show's results.", "ds-type-caption", "wl-gap-top"));
        }

        private static VisualElement Change(double? value, string label, JToken traceRef)
        {
            if (!value.HasValue) return W.Cell(Kit.NoValue);
            DsState state = value.Value > 0.05 ? DsState.Good : value.Value < -0.05 ? DsState.Bad : DsState.Neutral;
            string text = (value.Value > 0 ? "+" : value.Value < 0 ? "−" : string.Empty) + Math.Abs(value.Value).ToString("0.#", System.Globalization.CultureInfo.InvariantCulture);
            VisualElement cell = Ds.Row("wl-dot-num");
            VisualElement trend = Ds.El("ds-trend", Ds.StateClass(state));
            trend.Add(Ds.Text(text, "ds-trend__text"));
            cell.Add(trend);
            return W.QuietWhy(cell, Kit.WhyRef(label, value.Value, traceRef));
        }

        private static string KeyWords(string key)
        {
            if (key == null) return Kit.NoValue;
            int dot = key.LastIndexOf('.');
            return W.Words(dot >= 0 ? key.Substring(dot + 1) : key);
        }
    }
}
