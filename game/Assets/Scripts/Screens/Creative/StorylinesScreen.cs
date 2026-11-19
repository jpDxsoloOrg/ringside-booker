using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Creative
{
    /// <summary>
    /// Creative › Storylines in the Windows game (UNITY-16), the web's StorylinesScreen and
    /// StorylineDetailScreen on the UNITY-11 design system. The desk shows each storyline as a card
    /// that leads with its heat (a word, a meter, then the number with a quiet Why?) and its people
    /// by side. A storyline's page has the people (change sides, add, remove), the timeline of linked
    /// segments with each heat step, the heat and how it cools, the summary, and End with the payoff
    /// preview. Rival storylines show only their public facts.
    /// <para>Routes: <c>storylines</c>, <c>storylines?tab=ended</c>, <c>storylines?storyline=&lt;id&gt;</c>.</para>
    /// </summary>
    public static class StorylinesScreen
    {
        public const string ScreenId = "storylines";

        /// <summary>The screen built last (dev tours read it).</summary>
        public static StorylinesView Current { get; private set; }

        /// <summary>The engine's warnings from <c>storylines.create</c>, shown once on the new storyline's page.</summary>
        internal static (string storylineId, IReadOnlyList<string> warnings) PendingWarnings;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Register()
        {
            ScreenRegistry.Register(ScreenId, Build);
        }

        public static VisualElement Build(ScreenContext context)
        {
            var view = new StorylinesView(context);
            Current = view;
            return view.Root;
        }

        public static ShellRoute StorylineRoute(string storylineId, string tab = null) =>
            ShellRoute.With(ScreenId, "storyline", storylineId, "tab", tab == "ended" ? tab : null);

        public static ShellRoute ListRoute(string tab = null) => ShellRoute.With(ScreenId, "tab", tab == "ended" ? tab : null);
    }

    /// <summary>The Storylines screen's state and drawing (one per visit).</summary>
    public sealed class StorylinesView
    {
        /// <summary>How many people a card lists per side before "+N more".</summary>
        public const int CardSideMax = 3;

        private readonly ScreenContext context;
        private readonly string storylineId;
        private string tab;

        public StorylinesView(ScreenContext context)
        {
            this.context = context;
            tab = context.Route.Param("tab") == "ended" ? "ended" : "active";
            storylineId = context.Route.Param("storyline");
            Root = Ds.Column("cr-page").Named(storylineId == null ? "screen-storylines" : "screen-storyline");
            CreativeUi.Style(Root);
            Kit.Live(Root, Render);
        }

        public VisualElement Root { get; }
        public string Tab => tab;
        public string StorylineId => storylineId;

        /// <summary>The desk's rows drawn last (both tabs), or the page's storyline.</summary>
        public IReadOnlyList<JToken> Rows { get; private set; } = new List<JToken>();

        /// <summary>The page's <c>storylines.detail</c> answer, once drawn.</summary>
        public JToken Detail { get; private set; }

        /// <summary>The next day to play (ISO), from <c>sim.status</c>.</summary>
        public string Today { get; private set; }

        public void SelectTab(string id)
        {
            tab = id == "ended" ? "ended" : "active";
            Redraw();
        }

        public void Open(string id) => context.Navigator.Go(StorylinesScreen.StorylineRoute(id, tab));

        private async void Redraw()
        {
            try
            {
                await Render();
            }
            catch (Exception exception)
            {
                Debug.LogException(exception);
            }
        }

        private Task Render() => storylineId == null ? RenderDesk() : RenderPage();

        // ---- The desk -------------------------------------------------------------------------------

        private async Task RenderDesk()
        {
            EngineGame game = Kit.Game;
            var args = new JObject { ["status"] = "all" };
            if (game.PromotionId != null) args["promotionId"] = game.PromotionId;
            QueryResult<JToken>[] results = await CreativeUi.Queries(game.Client, ("storylines.list", args));
            QueryResult<JToken> list = results[0];
            Root.Clear();

            List<JToken> rows = list.Ok ? Kit.Arr(list.Data, "rows").ToList() : new List<JToken>();
            Rows = rows;
            bool editable = list.Ok && Kit.Bool(list.Data, "editable");
            int activeCount = (int)(Kit.Num(list.Data, "activeCount") ?? 0);
            double hotFrom = Kit.Num(list.Data, "hotFrom") ?? 70;

            VisualElement head = Ds.Row("cr-head");
            VisualElement words = Ds.Column("cr-head__words");
            words.Add(Ds.Display("Storylines", "ds-type-headline", "cr-head__title"));
            words.Add(Ds.Text(list.Ok ? StorylineText.CountsText(activeCount, rows.Count - activeCount) : "Your feuds and how hot they run", "cr-head__sub"));
            head.Add(words);
            head.Add(Ds.Spacer());
            if (editable)
            {
                SkewButton create = Ds.Cta("New storyline", () => StorylineSheets.OpenEditor(Root, null, game.PromotionId), "add");
                create.name = "storylines-new";
                head.Add(create);
            }
            Root.Add(head);

            if (!list.Ok)
            {
                Root.Add(CreativeUi.NoWorld(list)
                    ? Ds.Empty("storylines", "No game loaded", "Start or load a game to see your storylines.")
                    : Ds.Empty("storylines", "Storylines can't be shown", CreativeUi.QueryProblem(list)));
                return;
            }

            if (editable && activeCount >= (Kit.Num(list.Data, "softLimit") ?? int.MaxValue))
            {
                Root.Add(CreativeUi.Notice(DsState.Warn, StorylineText.SoftLimitText(activeCount)).Named("storylines-soft-limit"));
            }

            List<JToken> active = rows.Where(row => Kit.Str(row, "status") == "active").ToList();
            List<JToken> ended = rows.Where(row => Kit.Str(row, "status") == "ended").ToList();
            VisualElement bar = Ds.Row("cr-tabs");
            var tabs = new DsTabs().Add("active", "Active", active.Count).Add("ended", "Ended", ended.Count);
            tabs.name = "storylines-tabs";
            tabs.Select(tab, false);
            tabs.Selected += SelectTab;
            bar.Add(tabs);
            Root.Add(bar);

            List<JToken> shown = tab == "ended" ? ended : active;
            if (shown.Count == 0)
            {
                Root.Add(tab == "active"
                    ? Ds.Empty("storylines", "No storylines yet", "Start a storyline to give your feuds heat that builds show to show.",
                        editable ? "New storyline" : null, editable ? () => StorylineSheets.OpenEditor(Root, null, game.PromotionId) : (Action)null, "add")
                    : Ds.Empty("storylines", "No ended storylines", "Storylines you end move here."));
                return;
            }

            VisualElement cards = Ds.Row("ds-row--wrap", "cr-cards").Named("storylines-cards");
            foreach (JToken row in shown) cards.Add(Card(row, hotFrom));
            Root.Add(cards);
        }

        private VisualElement Card(JToken row, double hotFrom)
        {
            string id = Kit.Str(row, "id");
            string name = Kit.Str(row, "name");
            VisualElement card = CreativeUi.Clickable(Ds.Column("cr-scard"), () => Open(id)).Named("storyline-card-" + id);

            VisualElement top = Ds.Row("cr-scard__top");
            top.Add(CreativeUi.Clip(name, "cr-scard__name"));
            string brand = Kit.Str(row, "brandName");
            if (brand != null) top.Add(Ds.Tag(brand));
            if (Kit.Str(row, "status") == "ended") top.Add(Ds.Pill(DsState.Neutral, "Ended", "stop"));
            card.Add(top);

            card.Add(HeatRow(row, hotFrom, "cr-scard__heat"));

            VisualElement sides = Ds.Row("ds-row--top", "cr-scard__sides");
            sides.Add(SideColumn("Faces", "face", Kit.Arr(row, "faces").ToList()));
            sides.Add(SideColumn("Heels", "heel", Kit.Arr(row, "heels").ToList()));
            card.Add(sides);
            List<JToken> neutrals = Kit.Arr(row, "neutrals").ToList();
            if (neutrals.Count > 0)
            {
                card.Add(CreativeUi.Clip("Neutral: " + string.Join(", ", neutrals.Select(member => Kit.Str(member, "name"))), "cr-scard__neutral"));
            }

            card.Add(CreativeUi.Clip(string.Join(" · ", StorylineText.FooterFacts(Kit.Str(row, "startedOn"), Kit.Str(row, "endedOn"),
                Kit.Num(row, "linkedSegmentCount"), Kit.Num(row, "daysSinceProgress"))), "cr-scard__foot"));
            return card;
        }

        /// <summary>Heat as a word, a meter and the number with its quiet Why?; "Heat not public" for a rival's.</summary>
        private static VisualElement HeatRow(JToken row, double hotFrom, string extraClass)
        {
            VisualElement line = Ds.Row("cr-heat", extraClass);
            double? heat = Kit.Num(row, "heat");
            if (!heat.HasValue)
            {
                line.Add(new Icon("lock", "ds-icon--sm", "cr-heat__lock"));
                line.Add(Ds.Text(StorylineText.HeatNotPublic, "cr-quiet", "cr-heat__private"));
                return line;
            }
            (string word, DsState state) = StorylineText.HeatWord(heat.Value, hotFrom);
            line.Add(Ds.Pill(state, word, word == StorylineText.HotLabel ? "hot" : word == "Warm" ? "trend-up" : "flat", word == StorylineText.HotLabel));
            VisualElement meter = Ds.Meter((float)(heat.Value / 100.0), state);
            meter.AddToClassList("cr-heat__meter");
            line.Add(meter);
            line.Add(CreativeUi.Value(TitleText.Whole(heat.Value), CreativeUi.WhyRef("Heat", heat.Value, Kit.Obj(row, "heatTraceRef"), null, $"Heat: {Kit.Str(row, "name")}"), "cr-heat__number"));
            return line;
        }

        private static VisualElement SideColumn(string title, string side, List<JToken> members)
        {
            VisualElement column = Ds.Column("cr-side-list");
            column.Add(Ds.Tag(title, side));
            if (members.Count == 0)
            {
                column.Add(Ds.Text("No one yet", "cr-quiet"));
                return column;
            }
            foreach (JToken member in members.Take(CardSideMax))
            {
                VisualElement line = Ds.Row("cr-member-line");
                line.Add(CreativeUi.Portrait(Kit.Str(member, "imageRef"), "ds-portrait--xs", false, side == "face" ? Alignment.Face : Alignment.Heel, Kit.Str(member, "name")));
                line.Add(CreativeUi.Person(Kit.Str(member, "name"), Kit.Str(member, "personId"), "cr-member-line__name"));
                if (!Kit.Bool(member, "stillEmployed"))
                {
                    var left = new Icon("warning", "ds-icon--xs", "cr-member-line__left");
                    DsTooltip.Attach(left, StorylineText.LeftPromotion);
                    line.Add(left);
                }
                column.Add(line);
            }
            if (members.Count > CardSideMax) column.Add(Ds.Text($"+{members.Count - CardSideMax} more", "cr-quiet"));
            return column;
        }

        // ---- A storyline's page ---------------------------------------------------------------------

        private async Task RenderPage()
        {
            EngineGame game = Kit.Game;
            EngineClient client = game.Client;
            // One engine-thread trip: the storyline, then what its page needs once we know whose it is.
            (QueryResult<JToken> detail, JToken list, JToken status, JToken timeline, JToken payoff) = await client.Read("creative storyline page", reader =>
            {
                QueryResult<JToken> story = reader.Query("storylines.detail", new JObject { ["storylineId"] = storylineId });
                if (!story.Ok) return (story, (JToken)null, (JToken)null, (JToken)null, (JToken)null);
                bool own = Kit.Num(story.Data, "heat").HasValue;
                QueryResult<JToken> rows = reader.Query("storylines.list", new JObject { ["promotionId"] = Kit.Str(story.Data, "promotionId"), ["status"] = "active" });
                QueryResult<JToken> sim = reader.Query("sim.status", new JObject());
                QueryResult<JToken> steps = own ? reader.Query("storylines.timeline", new JObject { ["storylineId"] = storylineId }) : null;
                QueryResult<JToken> paid = Kit.Obj(story.Data, "ending") != null ? reader.Query("storylines.payoff", new JObject { ["storylineId"] = storylineId }) : null;
                return (story, rows.Ok ? rows.Data : null, sim.Ok ? sim.Data : null, steps != null && steps.Ok ? steps.Data : null, paid != null && paid.Ok ? paid.Data : null);
            });

            Root.Clear();
            Root.Add(CreativeUi.BackLink("Back to Storylines", () => context.Navigator.Go(StorylinesScreen.ListRoute(tab)), "storyline-back"));
            if (!detail.Ok)
            {
                Detail = null;
                Rows = new List<JToken>();
                Root.Add(CreativeUi.NoWorld(detail)
                    ? Ds.Empty("storylines", "No game loaded", "Start or load a game to see your storylines.")
                    : Ds.Empty("storylines", "There is no storyline to show", CreativeUi.QueryProblem(detail)));
                return;
            }

            JToken story = detail.Data;
            Detail = story;
            Rows = new List<JToken> { story };
            Today = Kit.Str(status, "date");
            bool ownStory = Kit.Num(story, "heat").HasValue;
            bool editable = Kit.Bool(story, "editable");
            double hotFrom = Kit.Num(list, "hotFrom") ?? 70;
            List<JToken> linked = Kit.Arr(story, "timeline").ToList();

            if (StorylinesScreen.PendingWarnings.storylineId == storylineId)
            {
                foreach (string warning in StorylinesScreen.PendingWarnings.warnings) Root.Add(CreativeUi.Notice(DsState.Warn, warning).Named("storyline-warning"));
                StorylinesScreen.PendingWarnings = (null, null);
            }

            Root.Add(Header(story, editable));

            string finaleOn = StorylineText.FinalePlayedOn(Kit.Str(story, "status"), linked);
            if (finaleOn != null && editable)
            {
                VisualElement finale = Ds.Row("cr-callout", Ds.StateClass(DsState.Gold)).Named("storyline-finale");
                finale.Add(new Icon("crown", "ds-icon--lg", "cr-callout__icon"));
                finale.Add(Ds.Text(StorylineText.FinalePlayedText(finaleOn), "cr-callout__text"));
                finale.Add(Ds.Spacer());
                Button end = Ds.Button("End and pay off", () => StorylineSheets.OpenEnd(Root, story, Today), DsButtonKind.Primary, "check");
                end.name = "storyline-finale-end";
                finale.Add(end);
                Root.Add(finale);
            }

            VisualElement columns = Ds.Row("ds-row--top", "cr-columns");
            VisualElement main = Ds.Column("cr-main");
            VisualElement side = Ds.Column("cr-side");
            if (Kit.Obj(story, "ending") != null) main.Add(EndingPanel(story, payoff));
            main.Add(PeoplePanel(story, editable));
            if (ownStory) main.Add(TimelinePanel(linked, Kit.Str(timeline, "kind") == "ok" ? Kit.Arr(timeline, "rows") : Enumerable.Empty<JToken>()));
            side.Add(HeatPanel(story, hotFrom, ownStory));
            if (ownStory)
            {
                VisualElement summary = Ds.Panel("Summary", editable ? "Edit" : null, editable ? () => StorylineSheets.OpenEditor(Root, story, Kit.Str(story, "promotionId")) : (Action)null, "cr-panel");
                string text = Kit.Str(story, "summary");
                summary.Add(Ds.Text(string.IsNullOrEmpty(text) ? "No summary yet." : text, "cr-summary"));
                side.Add(summary);
            }
            if (editable && Kit.Bool(status, "sandbox")) side.Add(SandboxPanel(story));
            columns.Add(main);
            columns.Add(side);
            Root.Add(columns);
        }

        private VisualElement Header(JToken story, bool editable)
        {
            VisualElement header = Ds.Row("cr-hero", "cr-hero--story").Named("storyline-header");
            VisualElement words = Ds.Column("cr-hero__words");
            words.Add(CreativeUi.Clip(TextFormat.Upper(Kit.Str(story, "name")), "ds-type-headline", "cr-hero__name"));
            VisualElement chips = Ds.Row("cr-chips");
            bool active = Kit.Str(story, "status") == "active";
            chips.Add(Ds.Pill(active ? DsState.Good : DsState.Neutral, active ? "Active" : "Ended", active ? "play" : "stop"));
            string brand = Kit.Str(story, "brandName");
            if (brand != null) chips.Add(Ds.Tag(brand));
            if (!Kit.Num(story, "heat").HasValue) chips.Add(CreativeUi.Promotion(Kit.Str(story, "promotionName"), Kit.Str(story, "promotionId"), "cr-hero__line"));
            chips.Add(Ds.Text(StorylineText.DatesText(Kit.Str(story, "startedOn"), Kit.Str(story, "endedOn")), "cr-hero__line"));
            words.Add(chips);
            header.Add(words);
            header.Add(Ds.Spacer());
            if (editable)
            {
                VisualElement actions = Ds.Row("cr-actions", "cr-actions--inline");
                Button edit = Ds.Button("Edit", () => StorylineSheets.OpenEditor(Root, story, Kit.Str(story, "promotionId")), DsButtonKind.Secondary, "edit");
                edit.name = "storyline-edit";
                actions.Add(edit);
                Button end = Ds.Button("End storyline", () => StorylineSheets.OpenEnd(Root, story, Today), DsButtonKind.Danger, "stop");
                end.name = "storyline-end";
                actions.Add(end);
                header.Add(actions);
            }
            return header;
        }

        private VisualElement HeatPanel(JToken story, double hotFrom, bool own)
        {
            VisualElement panel = Ds.Panel("Heat", null, null, "cr-panel").Named("storyline-heat");
            if (!own)
            {
                panel.Add(Ds.Text($"Heat not public: only {Kit.Str(story, "promotionName")} knows how hot this is.", "cr-quiet"));
                return panel;
            }
            double heat = Kit.Num(story, "heat") ?? 0;
            (string word, DsState state) = StorylineText.HeatWord(heat, hotFrom);
            VisualElement big = Ds.Row("cr-heat-big", Ds.StateClass(state));
            big.Add(new Icon(word == StorylineText.HotLabel ? "hot" : word == "Warm" ? "trend-up" : "flat", "ds-icon--xl", "cr-heat-big__icon"));
            big.Add(Ds.Display(word, "cr-heat-big__word"));
            big.Add(Ds.Spacer());
            big.Add(CreativeUi.Value(TitleText.Whole(heat), CreativeUi.WhyRef("Heat", heat, Kit.Obj(story, "heatTraceRef"), null, $"Heat: {Kit.Str(story, "name")}"), "cr-heat-big__number"));
            panel.Add(big);
            VisualElement meter = Ds.Meter((float)(heat / 100.0), state);
            meter.AddToClassList("cr-heat-big__meter");
            panel.Add(meter);
            panel.Add(Ds.Text($"Hot from {TitleText.Whole(hotFrom)}.", "cr-quiet"));
            string cooling = StorylineText.CoolingText(Kit.Obj(story, "cooling"));
            if (cooling != null)
            {
                bool coolingNow = Kit.Bool(story, "cooling.coolingNow");
                panel.Add(CreativeUi.Notice(coolingNow ? DsState.Warn : DsState.Info, cooling, coolingNow ? "trend-down" : "clock").Named("storyline-cooling"));
            }
            JToken started = Kit.Obj(story, "startedBecauseTraceRef");
            if (started != null)
            {
                panel.Add(CreativeUi.Value("Why it started", CreativeUi.WhyRef("Why it started", 0, started, null, "Why it started"), "cr-quiet"));
            }
            return panel;
        }

        private VisualElement PeoplePanel(JToken story, bool editable)
        {
            VisualElement panel = Ds.Panel("People", editable ? "Add people" : null, editable ? () => StorylineSheets.OpenAddMembers(Root, story) : (Action)null, "cr-panel").Named("storyline-people");
            VisualElement problem = CreativeUi.Problem("storyline-people-problem");
            panel.Add(problem);
            VisualElement groups = Ds.Row("ds-row--top", "cr-people");
            foreach ((string side, string title, string _) in StorylineText.Sides)
            {
                List<JToken> members = Kit.Arr(story, side == "face" ? "faces" : side == "heel" ? "heels" : "neutrals").ToList();
                if (side == "neutral" && members.Count == 0) continue;
                VisualElement column = Ds.Column("cr-people__side");
                VisualElement head = Ds.Row("cr-people__head");
                head.Add(Ds.Tag(title, side == "neutral" ? null : side));
                head.Add(Ds.Text(TextFormat.Number(members.Count), "cr-people__count"));
                column.Add(head);
                if (members.Count == 0) column.Add(Ds.Text("No one yet", "cr-quiet"));
                foreach (JToken member in members) column.Add(MemberRow(story, member, side, editable, problem));
                groups.Add(column);
            }
            panel.Add(groups);
            return panel;
        }

        private VisualElement MemberRow(JToken story, JToken member, string side, bool editable, VisualElement problem)
        {
            string personId = Kit.Str(member, "personId");
            string name = Kit.Str(member, "name");
            VisualElement row = Ds.Row("cr-member").Named("storyline-member-" + personId);
            row.Add(CreativeUi.Portrait(Kit.Str(member, "imageRef"), "ds-portrait--sm", false, side == "face" ? Alignment.Face : side == "heel" ? Alignment.Heel : Alignment.Tweener, name));
            VisualElement words = Ds.Column("cr-member__words");
            words.Add(CreativeUi.Person(name, personId, "cr-member__name"));
            string alignment = Kit.Str(member, "alignment");
            words.Add(CreativeUi.Clip(alignment == null ? "Not with the promotion" : $"{Kit.Capital(alignment)} overall", "cr-member__meta"));
            row.Add(words);
            if (!Kit.Bool(member, "stillEmployed")) row.Add(Ds.Pill(DsState.Bad, StorylineText.LeftPromotion, "warning"));
            if (editable)
            {
                Button more = null;
                more = Ds.IconButton("more", $"Actions for {name}", () =>
                {
                    var items = StorylineText.Sides
                        .Where(entry => entry.side != side)
                        .Select(entry => ($"Make {entry.label.ToLowerInvariant()}", entry.side == "face" ? "up" : entry.side == "heel" ? "down" : "flat", false,
                            (Action)(() => StorylineSheets.SetSide(Root, story, personId, entry.side, problem))))
                        .ToList();
                    items.Add(("Remove", "user-minus", true, () => StorylineSheets.ConfirmRemove(Root, story, personId, name)));
                    CreativeUi.Menu(more, items, "member-menu");
                });
                more.name = "storyline-member-menu-" + personId;
                row.Add(more);
            }
            return row;
        }

        private VisualElement TimelinePanel(List<JToken> linked, IEnumerable<JToken> steps)
        {
            VisualElement panel = Ds.Panel("Timeline", null, null, "cr-panel").Named("storyline-timeline");
            List<StorylineText.TimelineEntry> entries = StorylineText.TimelineEntries(linked, steps, Today);
            if (entries.Count == 0)
            {
                panel.Add(Ds.Text(StorylineText.EmptyTimeline, "cr-quiet"));
                return panel;
            }
            panel.Add(Ds.Text("Newest first: each linked segment and how it moved the heat.", "cr-quiet"));
            VisualElement list = Ds.Column("cr-timeline");
            foreach (StorylineText.TimelineEntry entry in entries) list.Add(TimelineRow(entry));
            panel.Add(list);
            return panel;
        }

        private static VisualElement TimelineRow(StorylineText.TimelineEntry entry)
        {
            VisualElement row = Ds.Row("cr-tl", "cr-tl--" + entry.State).Named("timeline-" + entry.SegmentId);
            row.Add(Ds.El("cr-tl__dot"));
            VisualElement when = Ds.Column("cr-tl__when");
            when.Add(Ds.Text(Kit.Date(entry.Date), "cr-tl__date"));
            string slot = entry.PreShow.HasValue && entry.Slot.HasValue ? StorylineText.SlotLabel(entry.PreShow.Value, entry.Slot.Value) : null;
            if (slot != null) when.Add(Ds.Text(slot, "cr-tl__slot"));
            row.Add(when);
            VisualElement words = Ds.Column("cr-tl__words");
            VisualElement showLine = Ds.Row("cr-tl__show-line");
            if (entry.EventInstanceId != null) PromotionLogos.PrependShow(showLine, entry.EventInstanceId, null, Kit.Game?.PromotionId, "rb-logo--sm");
            showLine.Add(CreativeUi.Clip(entry.ShowName ?? "A show no longer kept", "cr-tl__show"));
            words.Add(showLine);
            VisualElement segment = Ds.Row("cr-tl__segment");
            segment.Add(CreativeUi.Clip(entry.Label ?? "A segment no longer kept", "cr-tl__label"));
            if (entry.Finale) segment.Add(Ds.Tag("Finale", "gold"));
            words.Add(segment);
            row.Add(words);
            VisualElement stars = Ds.Row("cr-tl__stars");
            if (entry.Stars.HasValue)
            {
                stars.Add(new Stars((float)entry.Stars.Value, "ds-icon--xs"));
                CreativeUi.Quiet(stars, CreativeUi.WhyRef("Stars", entry.Stars.Value, StorylineText.TraceRefFromKey(entry.RatingTraceKey), "stars", $"Stars: {entry.Label}"));
            }
            row.Add(stars);
            VisualElement heat = Ds.Row("cr-tl__heat");
            if (entry.HeatBefore.HasValue && entry.HeatAfter.HasValue)
            {
                double delta = entry.HeatAfter.Value - entry.HeatBefore.Value;
                DsState state = delta > 0 ? DsState.Good : delta < 0 ? DsState.Bad : DsState.Neutral;
                VisualElement change = Ds.Row("cr-heat-step", Ds.StateClass(state));
                change.Add(new Icon(delta > 0 ? "trend-up" : delta < 0 ? "trend-down" : "flat", "ds-icon--xs", "cr-heat-step__icon"));
                change.Add(Ds.Text($"Heat {StorylineText.HeatStep(entry.HeatBefore.Value, entry.HeatAfter.Value)}", "cr-heat-step__text"));
                heat.Add(CreativeUi.Quiet(change, CreativeUi.WhyRef("Heat step", entry.HeatAfter.Value, entry.HeatTraceRef, null, $"Heat: {entry.Label}")));
            }
            else
            {
                heat.Add(Ds.Text(entry.State == "booked" ? StorylineText.Booked : StorylineText.NotCounted, "cr-tl__pending"));
            }
            row.Add(heat);
            return row;
        }

        private static VisualElement EndingPanel(JToken story, JToken payoff)
        {
            VisualElement panel = Ds.Panel("Ending", null, null, "cr-panel").Named("storyline-ending");
            JToken ending = Kit.Obj(story, "ending");
            int minSegments = (int)(Kit.Num(ending, "minSegments") ?? 0);
            string kind = Kit.Str(payoff, "kind");
            int counted = kind == "paid" || kind == "noPayoff" ? (int)(Kit.Num(payoff, "record.countedSegments") ?? 0) : (int)(Kit.Num(ending, "linkedSegments") ?? 0);
            if (kind == "paid")
            {
                panel.Add(CreativeUi.Value("Payoff", CreativeUi.WhyRef("Payoff", 0, Kit.Obj(payoff, "traceRef"), null, "Payoff"), "cr-ending__title"));
                panel.Add(StorylineSheets.PaidList(story, Kit.Obj(payoff, "record")));
            }
            else if (kind == "noPayoff")
            {
                panel.Add(CreativeUi.Value(StorylineText.NoPayoffRecordText(minSegments, counted), CreativeUi.WhyRef("Payoff", 0, Kit.Obj(payoff, "traceRef"), null, "Payoff"), "cr-ending__title"));
            }
            else
            {
                panel.Add(Ds.Text(payoff == null ? "Loading what it paid…" : StorylineText.OldSavePayoff, "cr-ending__title"));
            }
            panel.Add(Ds.Text($"Ended {Kit.Date(Kit.Str(ending, "endedOn"))} with {(counted == 1 ? "1 linked segment" : $"{TextFormat.Number(counted)} linked segments")}.", "cr-quiet"));
            return panel;
        }

        private static VisualElement SandboxPanel(JToken story)
        {
            VisualElement panel = Ds.Panel("Sandbox", null, null, "cr-panel").Named("storyline-sandbox");
            string text = TitleText.Whole(Kit.Num(story, "heat") ?? 0);
            var field = new CreativeUi.Field("New heat", text, value => text = value,
                "Sandbox games only: put this story at any heat from 0 to 100 to try the warm and hot steps. It does not count as progress.", "storyline-set-heat");
            panel.Add(field);
            Button set = Ds.Button("Set heat", async () =>
            {
                string trimmed = (text ?? string.Empty).Trim();
                if (!int.TryParse(trimmed, out int heat) || heat < 0 || heat > 100 || trimmed.Length > 3)
                {
                    field.SetError("Enter a whole number from 0 to 100.");
                    return;
                }
                field.SetError(await CreativeUi.Run("storylines.setHeat", new JObject { ["storylineId"] = Kit.Str(story, "id"), ["heat"] = heat }));
            }, DsButtonKind.Secondary, "hot");
            panel.Add(set);
            return panel;
        }
    }
}
