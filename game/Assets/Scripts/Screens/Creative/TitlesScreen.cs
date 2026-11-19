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
using RingsideBooker.UI.Why;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Creative
{
    /// <summary>
    /// Creative › Titles in the Windows game (UNITY-16), the web's TitlesScreen and TitleDetailScreen
    /// on the UNITY-11 design system. The list shows our belts grouped by brand (then the
    /// promotion-wide ones) and, on Around the world, every other promotion's titles grouped by
    /// promotion: a champion card per belt that leads with who holds it and for how long, prestige in
    /// words before its number (quiet Why?). A title opens its page: champion, lineage (short default
    /// columns, more in the picker) and records, with the Edit, Award, Vacate, Retire and Reactivate
    /// sheets for the player's own titles.
    /// <para>Routes: <c>titles</c>, <c>titles?tab=world&amp;status=retired</c>, <c>titles?title=&lt;id&gt;</c>
    /// (the title's page; tab and status ride along so Back returns to the same list).</para>
    /// </summary>
    public static class TitlesScreen
    {
        public const string ScreenId = "titles";

        /// <summary>The screen built last (dev tours read it).</summary>
        public static TitlesView Current { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Register()
        {
            ScreenRegistry.Register(ScreenId, Build);
        }

        public static VisualElement Build(ScreenContext context)
        {
            var view = new TitlesView(context);
            Current = view;
            return view.Root;
        }

        /// <summary>A title's page, remembering the list view it came from.</summary>
        public static ShellRoute TitleRoute(string titleId, string tab = null, string status = null) =>
            ShellRoute.With(ScreenId, "title", titleId, "tab", tab == "world" ? tab : null, "status", status == "retired" ? status : null);

        public static ShellRoute ListRoute(string tab = null, string status = null) =>
            ShellRoute.With(ScreenId, "tab", tab == "world" ? tab : null, "status", status == "retired" ? status : null);
    }

    /// <summary>The Titles screen's state and drawing (one per visit).</summary>
    public sealed class TitlesView
    {
        private readonly ScreenContext context;
        private readonly string titleId;
        private string tab;
        private string status;
        private bool showAllRecords;

        public TitlesView(ScreenContext context)
        {
            this.context = context;
            ShellRoute route = context.Route;
            tab = route.Param("tab") == "world" ? "world" : "own";
            status = route.Param("status") == "retired" ? "retired" : "active";
            titleId = route.Param("title");
            Root = Ds.Column("cr-page").Named(titleId == null ? "screen-titles" : "screen-title");
            CreativeUi.Style(Root);
            Kit.Live(Root, Render);
        }

        public VisualElement Root { get; }
        public string Tab => tab;
        public string Status => status;
        public string TitleId => titleId;

        /// <summary>The rows drawn last: the list's cards, or the page's title row.</summary>
        public IReadOnlyList<JToken> ShownTitles { get; private set; } = new List<JToken>();

        /// <summary>The page's <c>titles.detail</c> answer, once drawn.</summary>
        public JToken Detail { get; private set; }

        public DsTable<JToken> Lineage { get; private set; }

        public void SelectTab(string id)
        {
            tab = id == "world" ? "world" : "own";
            Redraw();
        }

        public void SelectStatus(string id)
        {
            status = id == "retired" ? "retired" : "active";
            Redraw();
        }

        public void Open(string id) => context.Navigator.Go(TitlesScreen.TitleRoute(id, tab, status));

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

        private Task Render() => titleId == null ? RenderList() : RenderDetail();

        // ---- The list -------------------------------------------------------------------------------

        private async Task RenderList()
        {
            EngineGame game = Kit.Game;
            QueryResult<JToken>[] results = await CreativeUi.Queries(game.Client,
                ("titles.list", new JObject { ["scope"] = tab, ["status"] = status }));
            QueryResult<JToken> list = results[0];
            Root.Clear();

            VisualElement head = Ds.Row("cr-head");
            VisualElement words = Ds.Column("cr-head__words");
            words.Add(Ds.Display("Titles", "ds-type-headline", "cr-head__title"));
            JToken counts = list.Ok ? Kit.Obj(list.Data, "counts") : null;
            int active = (int)(Kit.Num(counts, "active") ?? 0);
            int retired = (int)(Kit.Num(counts, "retired") ?? 0);
            words.Add(Ds.Text(tab == "own" ? "Your promotion's belts, by brand" : "Every other promotion's belts", "cr-head__sub"));
            head.Add(words);
            head.Add(Ds.Spacer());
            if (tab == "own" && game.PromotionId != null)
            {
                SkewButton create = Ds.Cta("New title", () => TitleSheets.OpenForm(Root, null, game.PromotionId), "add");
                create.name = "titles-new";
                head.Add(create);
            }
            Root.Add(head);

            VisualElement bar = Ds.Row("cr-tabs");
            var tabs = new DsTabs().Add("own", "Our titles").Add("world", "Around the world");
            tabs.name = "titles-tabs";
            tabs.Select(tab, false);
            tabs.Selected += SelectTab;
            bar.Add(tabs);
            Root.Add(bar);

            VisualElement toolbar = Ds.Row("cr-toolbar");
            toolbar.Add(Ds.Chip("Active", status == "active", () => SelectStatus("active"), active).Named("titles-status-active"));
            toolbar.Add(Ds.Chip("Retired", status == "retired", () => SelectStatus("retired"), retired).Named("titles-status-retired"));
            Root.Add(toolbar);

            if (!list.Ok)
            {
                ShownTitles = new List<JToken>();
                Root.Add(Ds.Empty("titles", "The titles could not be loaded", CreativeUi.QueryProblem(list)));
                return;
            }

            List<JToken> groups = Kit.Arr(list.Data, "groups").ToList();
            ShownTitles = groups.SelectMany(group => Kit.Arr(group, "titles")).ToList();
            if (groups.Count == 0)
            {
                if (status == "retired")
                {
                    Root.Add(Ds.Empty("titles", "No retired titles", "Every title here is still active. A retired title keeps its lineage and shows up here."));
                }
                else
                {
                    Root.Add(Ds.Empty("titles", "No titles", tab == "own" ? "Your promotion has no active titles." : "No other promotion has an active title."));
                }
                return;
            }

            foreach (JToken group in groups) Root.Add(Group(group));
        }

        private VisualElement Group(JToken group)
        {
            string name = Kit.Str(group, "brandName") ?? Kit.Str(group, "promotionName");
            VisualElement section = Ds.Column("cr-group").Named("titles-group-" + Kit.Str(group, "key"));
            VisualElement header = Ds.Row("cr-group__head");
            header.Add(CreativeUi.Logo(Kit.Str(group, "logoRef"), name, "rb-logo--sm"));
            Label groupName = Ds.Display(name, "cr-group__name");
            if (Kit.Str(group, "brandId") == null && tab == "world") CreativeUi.LinkTo(groupName, ShellRoute.With(ScreenIds.Promotion, "id", Kit.Str(group, "promotionId")));
            header.Add(groupName);
            int count = Kit.Arr(group, "titles").Count();
            header.Add(Ds.Text(count == 1 ? "1 title" : $"{TextFormat.Number(count)} titles", "cr-group__count"));
            header.Add(Ds.El("cr-group__rule"));
            section.Add(header);
            VisualElement cards = Ds.Row("ds-row--wrap", "cr-cards");
            foreach (JToken row in Kit.Arr(group, "titles")) cards.Add(Card(row));
            section.Add(cards);
            return section;
        }

        /// <summary>One belt as a champion card: who holds it and for how long first, then prestige in words.</summary>
        private VisualElement Card(JToken row)
        {
            string id = Kit.Str(row, "titleId");
            string name = Kit.Str(row, "name");
            double prestige = Kit.Num(row, "prestige") ?? 0;
            JToken champion = Kit.Obj(row, "champion");
            bool retiredTitle = Kit.Str(row, "status") == "retired";

            VisualElement card = CreativeUi.Clickable(Ds.Column("cr-tcard"), () => Open(id));
            card.EnableInClassList("cr-tcard--vacant", champion == null);
            card.name = "title-card-" + id;

            VisualElement top = Ds.Row("cr-tcard__top");
            top.Add(CreativeUi.Belt(Kit.Str(row, "imageRef"), prestige, "cr-belt--md"));
            VisualElement words = Ds.Column("cr-tcard__words");
            words.Add(CreativeUi.Clip(name, "cr-tcard__name"));
            words.Add(CreativeUi.Clip($"{Kit.Str(row, "divisionLabel")} · {TitleText.HolderCount((int)(Kit.Num(row, "holderCount") ?? 1))}", "cr-tcard__meta"));
            top.Add(words);
            IReadOnlyList<string> actions = TitleText.RowActions(Kit.Bool(row, "editable"), Kit.Str(row, "status"), champion != null);
            if (actions.Count > 0)
            {
                Button more = null;
                more = Ds.IconButton("more", $"Actions for the {name}", () => TitleSheets.OpenMenu(more, row, Open));
                more.name = "title-menu-" + id;
                more.AddToClassList("cr-tcard__menu");
                top.Add(more);
            }
            card.Add(top);

            VisualElement holder = Ds.Row("cr-tcard__champ");
            if (champion != null)
            {
                JToken first = Kit.Arr(champion, "holders").FirstOrDefault();
                holder.Add(CreativeUi.Portrait(Kit.Str(first, "imageRef"), "ds-portrait--sm", true));
                VisualElement who = Ds.Column("cr-tcard__who");
                VisualElement nameRow = Ds.Row("cr-tcard__who-row");
                nameRow.Add(new Icon("titles", "ds-icon--xs", "cr-belt-mark"));
                bool solo = Kit.Arr(champion, "holders").Count() == 1;
                nameRow.Add(CreativeUi.Person(Kit.Str(champion, "label"), solo ? Kit.Str(first, "personId") : null, "cr-tcard__champion"));
                who.Add(nameRow);
                who.Add(CreativeUi.Clip(TitleText.ReignLine((int)(Kit.Num(champion, "daysHeld") ?? 0), (int)(Kit.Num(champion, "defences") ?? 0)), "cr-tcard__reign"));
                holder.Add(who);
            }
            else
            {
                VisualElement empty = Ds.El("cr-tcard__empty-portrait");
                empty.Add(new Icon("titles", "ds-icon--lg", "cr-tcard__empty-icon"));
                holder.Add(empty);
                VisualElement who = Ds.Column("cr-tcard__who");
                who.Add(CreativeUi.Clip(retiredTitle ? "Retired" : TitleText.Vacant, "cr-tcard__champion", "cr-tcard__champion--vacant"));
                string retiredOn = Kit.Str(row, "retiredOn");
                who.Add(CreativeUi.Clip(retiredTitle && retiredOn != null ? $"Retired {Kit.Date(retiredOn)}" : "Nobody holds it", "cr-tcard__reign"));
                holder.Add(who);
                if (actions.Contains(TitleText.Award))
                {
                    Button award = Ds.Button("Award", () => TitleSheets.OpenAward(Root, row), DsButtonKind.Secondary, "trophy");
                    award.name = "title-award-" + id;
                    award.AddToClassList("cr-tcard__award");
                    holder.Add(award);
                }
            }
            card.Add(holder);

            VisualElement foot = Ds.Row("cr-tcard__foot");
            foot.Add(Ds.Text(TextFormat.Upper("Prestige"), "cr-micro"));
            foot.Add(CreativeUi.Value($"{TitleText.PrestigeWords(prestige)} {TitleText.Whole(prestige)}",
                CreativeUi.WhyEither("Prestige", prestige, Kit.Obj(row, "prestigeTraceRef"), Kit.Obj(row, "prestigeTrace"), null, $"Prestige: {name}"),
                "cr-tcard__prestige"));
            VisualElement meter = Ds.Meter((float)(prestige / 100.0), DsState.Gold);
            meter.AddToClassList("cr-tcard__meter");
            foot.Add(meter);
            card.Add(foot);
            return card;
        }

        // ---- A title's page -------------------------------------------------------------------------

        private async Task RenderDetail()
        {
            EngineGame game = Kit.Game;
            QueryResult<JToken>[] results = await CreativeUi.Queries(game.Client,
                ("titles.detail", new JObject { ["titleId"] = titleId }));
            QueryResult<JToken> detail = results[0];
            Root.Clear();
            Root.Add(CreativeUi.BackLink("Back to Titles", () => context.Navigator.Go(TitlesScreen.ListRoute(tab, status)), "title-back"));
            if (!detail.Ok)
            {
                Detail = null;
                ShownTitles = new List<JToken>();
                Root.Add(Ds.Empty("titles", "There is no title to show", CreativeUi.QueryProblem(detail)));
                return;
            }
            Detail = detail.Data;
            JToken title = Kit.Obj(detail.Data, "title");
            ShownTitles = new List<JToken> { title };
            List<JToken> reigns = Kit.Arr(detail.Data, "reigns").ToList();

            Root.Add(Hero(title));

            IReadOnlyList<string> actions = TitleText.RowActions(Kit.Bool(title, "editable"), Kit.Str(title, "status"), Kit.Obj(title, "champion") != null);
            if (actions.Count > 0)
            {
                VisualElement bar = Ds.Row("cr-actions").Named("title-actions");
                foreach (string action in actions)
                {
                    string kind = action;
                    Button button = Ds.Button(TitleText.ActionLabel(action), () => TitleSheets.Run(Root, kind, title, null),
                        TitleText.IsDanger(action) ? DsButtonKind.Ghost : DsButtonKind.Secondary, TitleText.ActionIcon(action));
                    button.name = "title-action-" + action;
                    bar.Add(button);
                }
                Root.Add(bar);
            }

            VisualElement columns = Ds.Row("ds-row--top", "cr-columns");
            VisualElement main = Ds.Column("cr-main");
            main.Add(ChampionPanel(title, reigns, actions));
            main.Add(LineagePanel(title, reigns));
            columns.Add(main);
            VisualElement side = Ds.Column("cr-side");
            side.Add(RecordsPanel(detail.Data, reigns));
            side.Add(AboutPanel(title));
            columns.Add(side);
            Root.Add(columns);
        }

        private static VisualElement Hero(JToken title)
        {
            string name = Kit.Str(title, "name");
            double prestige = Kit.Num(title, "prestige") ?? 0;
            VisualElement hero = Ds.Row("cr-hero").Named("title-hero");
            hero.Add(CreativeUi.Belt(Kit.Str(title, "imageRef"), prestige, "cr-belt--lg"));
            VisualElement words = Ds.Column("cr-hero__words");
            words.Add(CreativeUi.Clip(TextFormat.Upper(name), "ds-type-headline", "cr-hero__name"));
            VisualElement belongs = Ds.Row("cr-hero__belongs");
            PromotionLogos.Prepend(belongs, Kit.Str(title, "promotionId"), Kit.Str(title, "promotionName"), "rb-logo--sm");
            belongs.Add(CreativeUi.Promotion(Kit.Str(title, "promotionName"), Kit.Str(title, "promotionId"), "cr-hero__line"));
            belongs.Add(CreativeUi.Clip($" · {Kit.Str(title, "brandName") ?? TitleText.PromotionWideLabel}", "cr-hero__line"));
            words.Add(belongs);
            VisualElement chips = Ds.Row("cr-chips");
            bool active = Kit.Str(title, "status") == "active";
            chips.Add(Ds.Pill(active ? DsState.Good : DsState.Neutral, active ? "Active" : "Retired", active ? "check-circle" : "lock"));
            chips.Add(Ds.Pill(DsState.Info, Kit.Str(title, "divisionLabel") ?? CreativeUi.NoValue, "users"));
            chips.Add(Ds.Pill(DsState.Info, TitleText.HolderCount((int)(Kit.Num(title, "holderCount") ?? 1)), "user"));
            words.Add(chips);
            hero.Add(words);

            VisualElement tile = Ds.Column("ds-stat", Ds.StateClass(DsState.Gold), "cr-prestige");
            tile.Add(Ds.Text(TextFormat.Upper("Prestige"), "ds-stat__label"));
            VisualElement valueRow = Ds.Row("ds-stat__value-row");
            valueRow.Add(Ds.Text(TitleText.Whole(prestige), "ds-stat__value"));
            CreativeUi.Quiet(valueRow, CreativeUi.WhyEither("Prestige", prestige, Kit.Obj(title, "prestigeTraceRef"), Kit.Obj(title, "prestigeTrace"), null, $"Prestige: {name}"));
            tile.Add(valueRow);
            tile.Add(Ds.Text(TitleText.PrestigeWords(prestige), "ds-stat__words"));
            VisualElement meter = Ds.Meter((float)(prestige / 100.0), DsState.Gold);
            tile.Add(meter);
            hero.Add(tile);
            return hero;
        }

        private VisualElement ChampionPanel(JToken title, List<JToken> reigns, IReadOnlyList<string> actions)
        {
            VisualElement panel = Ds.Panel("Champion", null, null, "cr-panel").Named("title-champion");
            JToken champion = Kit.Obj(title, "champion");
            if (champion == null)
            {
                bool retired = Kit.Str(title, "status") == "retired";
                JToken latest = reigns.FirstOrDefault();
                string since = retired ? Kit.Str(title, "retiredOn") ?? Kit.Str(title, "introducedOn") : Kit.Str(latest, "lostOn") ?? Kit.Str(title, "introducedOn");
                VisualElement vacant = Ds.Row("cr-vacant");
                VisualElement box = Ds.El("cr-tcard__empty-portrait", "cr-vacant__art");
                box.Add(new Icon("titles", "ds-icon--2xl", "cr-tcard__empty-icon"));
                vacant.Add(box);
                VisualElement words = Ds.Column("cr-vacant__words");
                words.Add(Ds.Display(retired ? "Retired" : "Vacant", "cr-vacant__title"));
                words.Add(Ds.Text($"{(retired ? "Retired on" : "Vacant since")} {Kit.Date(since)}", "cr-vacant__line"));
                if (actions.Contains(TitleText.Award)) words.Add(Ds.Text("Award it to crown a new champion.", "cr-vacant__hint"));
                vacant.Add(words);
                vacant.Add(Ds.Spacer());
                if (actions.Contains(TitleText.Award))
                {
                    SkewButton award = Ds.Cta("Award the title", () => TitleSheets.OpenAward(Root, title), "trophy");
                    award.name = "title-award";
                    vacant.Add(award);
                }
                else if (actions.Contains(TitleText.Reactivate))
                {
                    SkewButton back = Ds.Cta("Bring it back", () => TitleSheets.Run(Root, TitleText.Reactivate, title, null), "unlock");
                    back.name = "title-reactivate";
                    vacant.Add(back);
                }
                panel.Add(vacant);
                return panel;
            }

            string reignId = Kit.Str(champion, "reignId");
            JToken current = reigns.FirstOrDefault(reign => Kit.Str(reign, "reignId") == reignId);
            VisualElement body = Ds.Row("cr-champ");
            VisualElement portraits = Ds.Row("cr-champ__portraits");
            foreach (JToken holder in Kit.Arr(champion, "holders"))
            {
                VisualElement one = Ds.Column("cr-champ__holder");
                one.Add(CreativeUi.Portrait(Kit.Str(holder, "imageRef"), "ds-portrait--md", true));
                one.Add(CreativeUi.Person(Kit.Str(holder, "ringName"), Kit.Str(holder, "personId"), "cr-champ__holder-name"));
                portraits.Add(one);
            }
            body.Add(portraits);
            VisualElement words2 = Ds.Column("cr-champ__words");
            VisualElement nameRow = Ds.Row("cr-champ__name-row");
            nameRow.Add(new Icon("titles", "ds-icon--md", "cr-belt-mark"));
            nameRow.Add(CreativeUi.Clip(TextFormat.Upper(Kit.Str(champion, "label")), "cr-champ__name"));
            words2.Add(nameRow);
            int days = (int)(Kit.Num(champion, "daysHeld") ?? 0);
            int defences = (int)(Kit.Num(champion, "defences") ?? 0);
            words2.Add(Ds.Text($"Champion since {Kit.Date(Kit.Str(champion, "wonOn"))}", "cr-champ__line"));
            VisualElement stats = Ds.Row("cr-champ__stats");
            VisualElement daysTile = Ds.Column("cr-mini-stat");
            daysTile.Add(Ds.Text(TextFormat.Upper("Days held"), "cr-micro"));
            daysTile.Add(CreativeUi.Value(TitleText.ReignDays(days), CreativeUi.WhyTrace("Days held", days, Kit.Obj(current, "daysHeldTrace"), "days", "Days held"), "cr-mini-stat__value"));
            stats.Add(daysTile);
            VisualElement defTile = Ds.Column("cr-mini-stat");
            defTile.Add(Ds.Text(TextFormat.Upper("Defences"), "cr-micro"));
            defTile.Add(Ds.Text(TextFormat.Number(defences), "cr-mini-stat__value"));
            stats.Add(defTile);
            words2.Add(stats);
            body.Add(words2);
            panel.Add(body);
            return panel;
        }

        private VisualElement LineagePanel(JToken title, List<JToken> reigns)
        {
            VisualElement panel = Ds.Panel("Lineage", null, null, "cr-panel").Named("title-lineage");
            if (reigns.Count == 0)
            {
                panel.Add(Ds.Empty("titles", TitleText.NoReignsText, "Every reign shows here once someone holds the title."));
                Lineage = null;
                return panel;
            }
            string currentReign = Kit.Str(title, "champion.reignId");
            var columns = new List<DsColumn<JToken>>
            {
                new DsColumn<JToken>("number", "#", reign => CreativeUi.Cell(TitleText.Whole(Kit.Num(reign, "number") ?? 0), "ds-cell__text--num", "ds-cell__text--muted"))
                    { Width = 44, Align = DsAlign.Right, Help = "The reign's number, counted in the order they were won." },
                new DsColumn<JToken>("champions", "Champion", reign => ChampionCell(reign, Kit.Str(reign, "reignId") == currentReign)) { Grow = 3, MinWidth = 180, Pinned = true },
                DsColumn<JToken>.Text("won", "Won", reign => Kit.Date(Kit.Str(reign, "wonOn")), "ds-cell__text--muted"),
                DsColumn<JToken>.Text("lost", "Lost", reign => Kit.Str(reign, "lostOn") == null ? TitleText.CurrentReignText : Kit.Date(Kit.Str(reign, "lostOn")), "ds-cell__text--muted"),
                new DsColumn<JToken>("days", "Days held", reign =>
                {
                    int held = (int)(Kit.Num(reign, "daysHeld") ?? 0);
                    return CreativeUi.Value(TitleText.ReignDays(held),
                        CreativeUi.WhyTrace("Days held", held, Kit.Obj(reign, "daysHeldTrace"), "days", $"Days held: {Kit.Str(reign, "label")}"), "ds-cell__text");
                }) { Width = 140, Help = "How long the reign lasted (counted to today for the current champion)." },
                new DsColumn<JToken>("defences", "Defences", reign => CreativeUi.Cell(TitleText.Whole(Kit.Num(reign, "defences") ?? 0), "ds-cell__text--num")) { Width = 96, Align = DsAlign.Right },
                new DsColumn<JToken>("ended", "How it ended", reign =>
                    CreativeUi.Value(Kit.Str(reign, "endReasonLabel") ?? CreativeUi.NoValue,
                        CreativeUi.WhyRef("How it ended", 0, Kit.Obj(reign, "endTraceRef"), null, $"How it ended: {Kit.Str(reign, "label")}"), "ds-cell__text"))
                    { Grow = 2, MinWidth = 140, Default = false },
            };
            columns.First(column => column.Id == "won").Width = 118;
            columns.First(column => column.Id == "lost").Width = 118;
            columns.First(column => column.Id == "lost").Default = false;
            var table = new DsTable<JToken>(columns, reigns);
            table.name = "title-lineage-table";
            table.AddToClassList("cr-table");
            Lineage = table;
            panel.Add(table);
            return panel;
        }

        private static VisualElement ChampionCell(JToken reign, bool current)
        {
            VisualElement cell = Ds.Row("cr-name-cell");
            List<JToken> holders = Kit.Arr(reign, "holders").ToList();
            cell.Add(CreativeUi.Portrait(Kit.Str(holders.FirstOrDefault(), "imageRef"), "ds-portrait--xs", current));
            if (current) cell.Add(new Icon("titles", "ds-icon--xs", "cr-belt-mark", "cr-name-cell__mark"));
            string label = Kit.Str(reign, "label");
            if (holders.Count == 1)
            {
                string atTime = Kit.Str(holders[0], "nameAtTime");
                string now = Kit.Str(holders[0], "currentRingName");
                label = atTime ?? label;
                cell.Add(CreativeUi.Person(label, Kit.Str(holders[0], "personId"), "ds-cell__text", "ds-cell__text--strong", "cr-name-cell__name"));
                if (now != null && now != atTime) cell.Add(CreativeUi.Clip($"now {now}", "ds-cell__text", "ds-cell__text--muted", "cr-name-cell__aside"));
            }
            else
            {
                cell.Add(CreativeUi.Clip(label, "ds-cell__text", "ds-cell__text--strong", "cr-name-cell__name"));
                string members = string.Join(" & ", holders.Select(holder => Kit.Str(holder, "nameAtTime")));
                if (members != label) cell.Add(CreativeUi.Clip(members, "ds-cell__text", "ds-cell__text--muted", "cr-name-cell__aside"));
            }
            return cell;
        }

        private VisualElement RecordsPanel(JToken detail, List<JToken> reigns)
        {
            VisualElement panel = Ds.Panel("Records", null, null, "cr-panel").Named("title-records");
            JToken stats = Kit.Obj(detail, "stats");
            double vacantDays = Kit.Num(stats, "daysVacant") ?? 0;
            panel.Add(CreativeUi.Facts(
                ("Total reigns", CreativeUi.FactText(TitleText.Whole(Kit.Num(stats, "totalReigns") ?? 0))),
                ("Different champions", CreativeUi.FactText(TitleText.Whole(Kit.Num(stats, "distinctChampions") ?? 0))),
                ("Days vacant", CreativeUi.Value(TitleText.Whole(vacantDays), CreativeUi.WhyTrace("Days vacant", vacantDays, Kit.Obj(stats, "daysVacantTrace"), "days", "Days vacant"), "ds-kv__value"))));
            string recordedFrom = Kit.Str(stats, "historyRecordedFrom");
            if (recordedFrom != null) panel.Add(Ds.Text($"History before {Kit.Date(recordedFrom)} not recorded. Days vacant count from then.", "cr-quiet"));

            bool anyFinished = reigns.Any(reign => Kit.Str(reign, "lostOn") != null);
            if (!anyFinished)
            {
                panel.Add(Ds.Text($"{TitleText.NoRecordsText}. Records start once a reign has ended.", "cr-quiet"));
                return panel;
            }

            // The lineage names the record holders: the ring name they hold now.
            var names = new Dictionary<string, string>();
            foreach (JToken reign in reigns)
            {
                foreach (JToken holder in Kit.Arr(reign, "holders"))
                {
                    string personId = Kit.Str(holder, "personId");
                    if (personId != null && !names.ContainsKey(personId)) names[personId] = Kit.Str(holder, "currentRingName");
                }
            }
            JToken records = Kit.Obj(detail, "records");
            var rows = new List<VisualElement>();
            foreach ((string key, string label, string unit) in TitleText.RecordRows)
            {
                JToken record = Kit.Obj(records, key);
                if (record == null) continue;
                string who = string.Join(" & ", Kit.Arr(record, "personIds").Select(id => names.TryGetValue((string)id, out string known) ? known : Kit.Str(record, "label")).Distinct());
                VisualElement row = Ds.Column("cr-record").Named("title-record-" + key);
                row.Add(Ds.Text(label, "cr-record__label"));
                VisualElement line = Ds.Row("cr-record__line");
                List<string> ids = Kit.Arr(record, "personIds").Select(id => (string)id).ToList();
                line.Add(CreativeUi.Person(string.IsNullOrEmpty(who) ? Kit.Str(record, "label") : who, ids.Count == 1 ? ids[0] : null, "cr-record__who"));
                line.Add(Ds.Text(TitleText.RecordValue(Kit.Num(record, "value") ?? 0, unit), "cr-record__value"));
                row.Add(line);
                rows.Add(row);
            }
            const int Shown = 3;
            VisualElement list = Ds.Column("cr-records");
            foreach (VisualElement row in rows.Take(showAllRecords ? rows.Count : Shown)) list.Add(row);
            panel.Add(list);
            if (rows.Count > Shown)
            {
                Button more = Ds.Button(showAllRecords ? "Fewer records" : $"All records ({rows.Count})", () =>
                {
                    showAllRecords = !showAllRecords;
                    Redraw();
                }, DsButtonKind.Ghost, showAllRecords ? "chevron-up" : "chevron-down");
                more.name = "title-records-more";
                panel.Add(more);
            }
            return panel;
        }

        private static VisualElement AboutPanel(JToken title)
        {
            VisualElement panel = Ds.Panel("About the title", null, null, "cr-panel");
            string retiredOn = Kit.Str(title, "retiredOn");
            panel.Add(CreativeUi.Facts(
                ("Promotion", CreativeUi.Promotion(Kit.Str(title, "promotionName"), Kit.Str(title, "promotionId"), "ds-kv__value")),
                ("Brand", CreativeUi.FactText(Kit.Str(title, "brandName") ?? TitleText.PromotionWideLabel)),
                ("Division", CreativeUi.FactText(Kit.Str(title, "divisionLabel"))),
                ("Kind", CreativeUi.FactText(TitleText.HolderCount((int)(Kit.Num(title, "holderCount") ?? 1)))),
                ("Introduced", CreativeUi.FactText(Kit.Date(Kit.Str(title, "introducedOn")))),
                ("Retired", retiredOn == null ? null : CreativeUi.FactText(Kit.Date(retiredOn)))));
            return panel;
        }
    }
}
