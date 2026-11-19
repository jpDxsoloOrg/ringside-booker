using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.Import.Pictures;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Widgets;
using RingsideBooker.UI.Why;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.News
{
    /// <summary>
    /// Office › News in the Windows game (UNITY-19), the web's NewsScreen on the UNITY-11 design
    /// system, laid out like a sports site's front page: the lead story big with its people, the
    /// top stories beside it, then every story in a compact sortable feed with its filters. A story
    /// opens in a side sheet (the full text, who is in it, importance, buzz with a quiet Why?).
    /// The Alerts button opens the alert settings.
    /// <para>
    /// Routes: <c>news</c>; <c>news?story=&lt;newsId&gt;</c> opens a story; <c>&amp;alert=1</c> (the day
    /// button's "Open news", <see cref="UI.Day.DayControlLogic"/>) clears the news alert stop here
    /// with <c>news.ackAlerts</c>, as does opening News any other way while an alert waits;
    /// <c>news?sheet=alerts</c> (the Skip days sheet) opens the alert settings. Feed filters as the
    /// web's URL: <c>kind=a,b</c>, <c>mine=1</c>, <c>period=7|30|90</c>, <c>front=1</c>.
    /// Opening the screen marks the news read for the sidebar's badge (<see cref="NewsSeen"/>).
    /// </para>
    /// </summary>
    public static class NewsScreen
    {
        public const string ScreenId = "news";

        /// <summary>The screen built last (dev tours read it).</summary>
        public static NewsView Current { get; private set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Register()
        {
            ScreenRegistry.Register(ScreenId, Build);
        }

        public static VisualElement Build(ScreenContext context)
        {
            var view = new NewsView(context);
            Current = view;
            return view.Root;
        }

        private static StyleSheet sheet;

        /// <summary>Adds the screen's stylesheet (Resources/News/News.uss); sheets in the overlay layer need their own.</summary>
        public static void Style(VisualElement element)
        {
            if (sheet == null) sheet = Resources.Load<StyleSheet>("News/News");
            if (sheet != null && !element.styleSheets.Contains(sheet)) element.styleSheets.Add(sheet);
        }
    }

    /// <summary>
    /// The people the news names, for portraits: picture ref and alignment from <c>workers.list</c>,
    /// read once per game (pictures never change in a game; alignment only tints the silhouette).
    /// </summary>
    internal static class NewsPeople
    {
        private static EngineGame loadedFor;
        private static readonly Dictionary<string, (string imageRef, string alignment)> People = new Dictionary<string, (string, string)>();

        public static bool Loaded(EngineGame game) => loadedFor == game;

        public static void Fill(EngineGame game, QueryResult<JToken> list)
        {
            if (list == null || !list.Ok) return;
            People.Clear();
            foreach (JToken row in Kit.Arr(list.Data, "rows"))
            {
                string id = Kit.Str(row, "personId");
                if (id != null) People[id] = (Kit.Str(row, "imageRef"), Kit.Str(row, "alignment"));
            }
            loadedFor = game;
        }

        public static Alignment AlignmentOf(string personId) =>
            People.TryGetValue(personId ?? string.Empty, out (string imageRef, string alignment) person)
                ? person.alignment == "face" ? Alignment.Face : person.alignment == "heel" ? Alignment.Heel : Alignment.Tweener
                : Alignment.Tweener;

        /// <summary>The person's picture from the workshop world, or null (a painted silhouette then).</summary>
        public static Texture2D Picture(string personId)
        {
            if (!People.TryGetValue(personId ?? string.Empty, out (string imageRef, string alignment) person) || string.IsNullOrEmpty(person.imageRef)) return null;
            PictureProvider pictures = WorkshopWorlds.CurrentPictures;
            if (pictures == null || !pictures.HasPicture(person.imageRef)) return null;
            return pictures.Get(person.imageRef);
        }

        public static VisualElement Portrait(string personId, string sizeClass) =>
            DsCards.PortraitBox(Picture(personId), AlignmentOf(personId), sizeClass);
    }

    /// <summary>The News screen's state and drawing (one per visit).</summary>
    public sealed class NewsView
    {
        private const int TopStories = 4;

        private readonly ScreenContext context;
        private readonly Label dateLine;
        private readonly VisualElement front;
        private readonly VisualElement toolbar;
        private readonly Label countLine;
        private readonly VisualElement tableHost;
        private readonly VisualElement moreHost;
        private readonly DsTable<JToken> table;
        private Dictionary<string, NewsName> names = new Dictionary<string, NewsName>();
        private NewsFilters filters;
        private int pages = 1;
        private GameDate today;
        private bool acknowledged;
        private bool checkedOnOpen;
        private bool routeHandled;

        public NewsView(ScreenContext context)
        {
            this.context = context;
            filters = NewsFilters.FromRoute(context.Route);

            Root = Ds.Column("nw-page").Named("screen-news");
            NewsScreen.Style(Root);

            VisualElement head = Ds.Row("nw-head");
            VisualElement titles = Ds.Column("nw-head__titles");
            titles.Add(Ds.Text("NEWS", "ds-type-headline", "nw-head__title"));
            dateLine = Ds.Text(string.Empty, "ds-type-caption", "nw-head__date");
            titles.Add(dateLine);
            head.Add(titles);
            head.Add(Ds.Spacer());
            Button alerts = Ds.Button("Alerts", OpenAlerts, DsButtonKind.Secondary, "bell");
            alerts.name = "news-alerts";
            DsTooltip.Attach(alerts, "Which stories stop a long skip.");
            head.Add(alerts);
            Root.Add(head);

            front = Ds.Row("nw-front").Named("news-front");
            Root.Add(front);

            VisualElement feedHead = Ds.Row("nw-feed-head");
            feedHead.Add(Ds.SectionHeader("All stories"));
            Root.Add(feedHead);
            toolbar = Ds.Row("nw-toolbar").Named("news-toolbar");
            Root.Add(toolbar);
            countLine = Ds.Text(string.Empty, "nw-count").Named("news-count");

            table = new DsTable<JToken>(Columns(), Array.Empty<JToken>()) { name = "news-table" };
            table.AddToClassList("nw-table");
            table.SortBy("date", true);
            table.RowClicked += row => OpenStory(Kit.Str(row, "id"));
            tableHost = Ds.Column("nw-table-host");
            tableHost.Add(table);
            Root.Add(tableHost);
            moreHost = Ds.Row("nw-more");
            Root.Add(moreHost);

            Kit.Live(Root, Render);
        }

        public VisualElement Root { get; }
        public NewsFilters Filters => filters;
        public DsTable<JToken> Table => table;

        /// <summary>The feed's rows as last drawn (tours read it).</summary>
        public IReadOnlyList<JToken> Rows { get; private set; } = Array.Empty<JToken>();

        /// <summary>The front page as last drawn: the lead story's id and the top stories' ids.</summary>
        public string LeadId { get; private set; }

        public void SetFilters(NewsFilters next)
        {
            if (next.Equals(filters)) return;
            filters = next;
            pages = 1;
            _ = Render();
        }

        // ---- Loading --------------------------------------------------------------------------------

        private async Task Render()
        {
            EngineGame game = Kit.Game;
            EngineClient client = game.Client;
            bool hasPromotion = game.PromotionId != null;
            bool needPeople = !NewsPeople.Loaded(game);
            NewsFilters shown = filters;
            int shownPages = pages;
            (QueryResult<SimStatus> status, QueryResult<JToken> top, QueryResult<JToken> rules, QueryResult<JToken> people) = await client.Read("news.screen", reader =>
                (reader.Query<SimStatus>(EngineQueries.SimStatus),
                    reader.Query("news.top"),
                    hasPromotion ? reader.Query("news.alertRules") : null,
                    needPeople ? reader.Query("workers.list") : null));
            if (!status.Ok || !GameDate.TryParse(status.Data?.Date, out today))
            {
                front.Clear();
                front.Add(Ds.Empty("newspaper", "The news could not be loaded", Kit.Reasons(status.Reasons)));
                return;
            }
            if (needPeople) NewsPeople.Fill(game, people);

            (QueryResult<JToken> feed, QueryResult<JToken> todayCount) = await client.Read("news.feed", reader =>
                (reader.Query("news.feed", NewsModel.FeedArgs(shown, today, shownPages)),
                    reader.Query("news.feed", new JObject { ["from"] = today.Iso, ["minImportance"] = NewsSeen.MinImportance, ["limit"] = 1 })));
            if (Root.panel == null) return;

            dateLine.text = today.Long;
            AcknowledgeAlert(hasPromotion, rules);
            if (todayCount.Ok) NewsSeen.MarkRead(today.Iso, (int)(Kit.Num(todayCount.Data, "total") ?? 0));

            DrawFront(top);
            DrawToolbar();
            DrawFeed(feed);

            if (!routeHandled)
            {
                routeHandled = true;
                if (context.Route.Param("story") is string storyId) OpenStory(storyId);
                else if (context.Route.Param("sheet") == "alerts") OpenAlerts();
            }
        }

        /// <summary>
        /// Clears the seat's news alert, as the web's <c>useAcknowledgeAlert</c>: arriving from the
        /// day button (<c>alert=1</c>), or opening News any other way while an alert waits. An alert
        /// that arrives while the screen stays open is left for the day button. Once per visit; a
        /// seat with no promotion has no alerts.
        /// </summary>
        private void AcknowledgeAlert(bool hasPromotion, QueryResult<JToken> rules)
        {
            if (!hasPromotion || acknowledged) return;
            bool fromAlert = context.Route.Param("alert") == "1";
            bool pending = rules != null && rules.Ok && Kit.Str(rules.Data, "pending") != null;
            bool firstLook = !checkedOnOpen;
            checkedOnOpen = true;
            if (!fromAlert && !(firstLook && pending)) return;
            acknowledged = true;
            _ = Kit.Run(EngineCommands.AckNewsAlerts, new JObject());
        }

        // ---- Front page -----------------------------------------------------------------------------

        private void DrawFront(QueryResult<JToken> top)
        {
            front.Clear();
            Dictionary<string, NewsName> topNames = NewsText.NamesFrom(Kit.Obj(top.Data, "names"));
            (JToken lead, List<JToken> others) = NewsModel.FrontPage(top.Ok ? top.Data : null, TopStories);
            LeadId = Kit.Str(lead, "id");
            if (lead == null)
            {
                front.Add(Ds.Empty("newspaper", "No news yet", "Stories land here as the world moves on: results, signings, title changes."));
                return;
            }
            front.Add(LeadCard(lead, topNames));
            if (others.Count == 0) return;
            VisualElement side = Ds.Column("nw-top").Named("news-top");
            side.Add(Ds.SectionHeader("Top stories"));
            int index = 0;
            foreach (JToken story in others) side.Add(StoryCard(story, topNames, index++));
            front.Add(side);
        }

        private VisualElement LeadCard(JToken story, IReadOnlyDictionary<string, NewsName> storyNames)
        {
            string kind = Kit.Str(story, "kind");
            List<NewsName> people = NewsModel.PeopleOf(story, storyNames);
            VisualElement feature = null;
            if (people.Count > 0)
            {
                feature = Ds.Row("nw-lead__faces");
                foreach (NewsName person in people) feature.Add(NewsPeople.Portrait(person.Id, "ds-portrait--xl"));
            }
            else if (NewsModel.PromotionOf(story, storyNames) is NewsName promotion)
            {
                feature = Ds.Row("nw-lead__logo");
                PromotionLogos.Prepend(feature, promotion.Id, null, "rb-logo--xl");
            }
            VisualElement card = DsCards.NewsCard(new NewsItem
            {
                Kicker = KickerText(story),
                Headline = NewsText.Render(story["headline"], storyNames),
                Dek = NewsText.Render(story["body"], storyNames),
                When = NewsModel.When(Kit.Str(story, "date"), today),
                Icon = NewsModel.KindIcon(kind),
                State = NewsModel.KindState(kind),
            }, lead: true, tone: Alignment.Tweener, feature: feature ?? Ds.Row("nw-lead__faces").With(DsCards.PortraitBox(null, Alignment.Tweener, "ds-portrait--xl", gold: true)));
            card.AddToClassList("nw-lead");
            card.name = "news-lead";
            Clickable(card, Kit.Str(story, "id"));
            return card;
        }

        private VisualElement StoryCard(JToken story, IReadOnlyDictionary<string, NewsName> storyNames, int index)
        {
            string kind = Kit.Str(story, "kind");
            VisualElement card = Ds.Row("ds-news", "nw-story", Ds.StateClass(NewsModel.KindState(kind))).Named($"news-top-{index}");
            List<NewsName> people = NewsModel.PeopleOf(story, storyNames, 1);
            VisualElement art = Ds.El("nw-story__art");
            if (people.Count > 0) art.Add(NewsPeople.Portrait(people[0].Id, "ds-portrait--sm"));
            else if (NewsModel.PromotionOf(story, storyNames) is NewsName promotion) PromotionLogos.Prepend(art, promotion.Id, null, "rb-logo--lg");
            else art.Add(Ds.El("nw-story__icon-box").With(new Icon(NewsModel.KindIcon(kind), "ds-icon--lg", "nw-story__icon")));
            card.Add(art);
            VisualElement words = Ds.Column("ds-news__words", "nw-story__words");
            VisualElement kicker = Ds.Row("ds-news__kicker");
            kicker.Add(new Icon(NewsModel.KindIcon(kind), "ds-icon--xs"));
            kicker.Add(Ds.Text(TextFormat.Upper(KickerText(story)), "ds-news__kicker-text"));
            kicker.Add(Ds.Text(NewsModel.When(Kit.Str(story, "date"), today), "ds-news__when"));
            words.Add(kicker);
            words.Add(Ds.Text(NewsText.Render(story["headline"], storyNames), "ds-news__headline", "nw-story__headline"));
            card.Add(words);
            Clickable(card, Kit.Str(story, "id"));
            return card;
        }

        private static string KickerText(JToken story) =>
            (Kit.Str(story, "kindLabel") ?? NewsModel.KindLabel(Kit.Str(story, "kind"))) + (Kit.Bool(story, "frontPage") ? " · Front page" : string.Empty);

        /// <summary>A card that opens its story on click, Enter or Space.</summary>
        private void Clickable(VisualElement card, string newsId)
        {
            card.focusable = true;
            card.AddToClassList("nw-clickable");
            card.RegisterCallback<ClickEvent>(_ => OpenStory(newsId));
            card.RegisterCallback<NavigationSubmitEvent>(_ => OpenStory(newsId));
        }

        // ---- Feed -----------------------------------------------------------------------------------

        private void DrawToolbar()
        {
            toolbar.Clear();
            VisualElement periods = Ds.Row("nw-chips").Named("news-period");
            foreach ((string id, string label) in NewsModel.Periods)
            {
                string period = id;
                Button chip = Ds.Chip(label, filters.Period == id, () => SetFilters(filters.WithPeriod(period)));
                chip.name = "news-period-" + id;
                periods.Add(chip);
            }
            toolbar.Add(periods);
            toolbar.Add(Ds.El("nw-toolbar__gap"));

            if (Kit.Game?.PromotionId != null)
            {
                Button mine = Ds.Chip("My promotion", filters.Mine, () => SetFilters(filters.WithMine(!filters.Mine)), icon: "office");
                mine.name = "news-mine";
                DsTooltip.Attach(mine, "Only stories that name your promotion or one of its shows.");
                toolbar.Add(mine);
            }
            Button frontOnly = Ds.Chip("Front page", filters.FrontPageOnly, () => SetFilters(filters.WithFrontPageOnly(!filters.FrontPageOnly)), icon: "star");
            frontOnly.name = "news-front-only";
            DsTooltip.Attach(frontOnly, "Only the biggest stories: front-page news.");
            toolbar.Add(frontOnly);

            Button kinds = null;
            kinds = Ds.Button(filters.Kinds.Count == 0 ? "Every kind" : $"Kinds · {filters.Kinds.Count}", () => OpenKinds(kinds),
                filters.Kinds.Count == 0 ? DsButtonKind.Ghost : DsButtonKind.Secondary, "filter");
            kinds.name = "news-kinds";
            toolbar.Add(kinds);
            if (filters.ActiveCount > 0)
            {
                Button clear = Ds.Button("Clear", () => SetFilters(NewsFilters.None), DsButtonKind.Ghost);
                clear.name = "news-clear-filters";
                toolbar.Add(clear);
            }
            toolbar.Add(Ds.Spacer());
            toolbar.Add(countLine);
        }

        /// <summary>The kinds picker: a popover of chips, none picked = every kind.</summary>
        private void OpenKinds(VisualElement anchor)
        {
            VisualElement content = Ds.Column("nw-kinds").Named("news-kinds-popover");
            NewsScreen.Style(content);
            content.Add(Ds.Text("SHOW THESE KINDS", "nw-kinds__title"));
            content.Add(Ds.Text("None picked shows every kind.", "nw-kinds__hint"));
            VisualElement chips = Ds.Row("ds-row--wrap", "nw-kinds__chips");
            content.Add(chips);
            void Fill()
            {
                chips.Clear();
                foreach ((string id, string label) in NewsModel.Kinds)
                {
                    string kind = id;
                    Button chip = Ds.Chip(label, filters.Kinds.Contains(id), () =>
                    {
                        SetFilters(filters.Toggle(kind));
                        Fill();
                    }, icon: NewsModel.KindIcon(id));
                    chip.name = "news-kind-" + id;
                    chips.Add(chip);
                }
            }
            Fill();
            DsOverlay.Popover(anchor, content, alignRight: false);
        }

        private void DrawFeed(QueryResult<JToken> feed)
        {
            moreHost.Clear();
            if (!feed.Ok)
            {
                Rows = Array.Empty<JToken>();
                table.SetRows(Rows);
                countLine.text = string.Empty;
                moreHost.Add(Ds.Empty("newspaper", "The news could not be loaded", Kit.Reasons(feed.Reasons)));
                return;
            }
            names = NewsText.NamesFrom(Kit.Obj(feed.Data, "names"));
            Rows = Kit.Arr(feed.Data, "items").ToList();
            int total = (int)(Kit.Num(feed.Data, "total") ?? Rows.Count);
            countLine.text = NewsModel.CountText(Rows.Count, total);
            table.SetRows(Rows);
            tableHost.SetShown(Rows.Count > 0);
            if (Rows.Count == 0)
            {
                moreHost.Add(filters.ActiveCount > 0
                    ? Ds.Empty("filter", "No stories match these filters", "Loosen a filter, or clear them all.", "Clear filters", () => SetFilters(NewsFilters.None))
                    : Ds.Empty("newspaper", "No news yet", "Stories appear here as the world moves on."));
                return;
            }
            int limit = Math.Min(NewsModel.PageSize * pages, NewsModel.MaxLimit);
            if (Rows.Count < total && limit < NewsModel.MaxLimit)
            {
                Button more = Ds.Button("Show older stories", () =>
                {
                    pages++;
                    _ = Render();
                });
                more.name = "news-more";
                moreHost.Add(more);
            }
        }

        private List<DsColumn<JToken>> Columns() => new List<DsColumn<JToken>>
        {
            new DsColumn<JToken>("date", "Date", row => Ds.Text(Kit.Date(Kit.Str(row, "date")), "ds-cell__text", "ds-cell__text--muted"))
            {
                Width = 120, SortKey = row => Kit.Str(row, "date") + Kit.Str(row, "id"), Pinned = true,
            },
            new DsColumn<JToken>("kind", "Kind", row => Ds.Pill(NewsModel.KindState(Kit.Str(row, "kind")), Kit.Str(row, "kindLabel") ?? NewsModel.KindLabel(Kit.Str(row, "kind")), NewsModel.KindIcon(Kit.Str(row, "kind"))))
            {
                Width = 160, SortKey = row => Kit.Str(row, "kindLabel"),
            },
            new DsColumn<JToken>("headline", "Headline", Headline)
            {
                Grow = 4, MinWidth = 320, Pinned = true, SortKey = row => NewsText.Render(row["headline"], names),
            },
            new DsColumn<JToken>("who", "Who", row => Ds.Text(Who(row), "ds-cell__text", "ds-cell__text--muted", "nw-cell"))
            {
                Grow = 2, MinWidth = 180, Help = "Who the story is about.",
            },
            new DsColumn<JToken>("importance", "Importance", row => Ds.Text(NewsModel.ImportanceLabel((int)(Kit.Num(row, "importance") ?? 0)), "ds-cell__text"))
            {
                Width = 120, Default = false, SortKey = row => Kit.Num(row, "importance") ?? 0,
                Help = "How prominently the story is shown: filler, minor, major or front page.",
            },
            new DsColumn<JToken>("buzz", "Buzz", Buzz)
            {
                Width = 96, Align = DsAlign.Right, SortKey = row => Kit.Num(row, "buzz") ?? 0,
                Help = "How much the story got people talking, 0 to 100, fixed when it ran.",
            },
        };

        private VisualElement Headline(JToken row)
        {
            VisualElement cell = Ds.Row("nw-headline-cell");
            if (Kit.Bool(row, "frontPage")) cell.Add(new Icon("star", "ds-icon--xs", "nw-headline-cell__star") { Filled = true });
            cell.Add(Ds.Text(NewsText.Render(row["headline"], names), "ds-cell__text", "ds-cell__text--strong", "nw-cell"));
            return cell;
        }

        private string Who(JToken row)
        {
            List<NewsName> entities = NewsModel.EntitiesOf(row, names);
            return entities.Count == 0 ? "—" : string.Join(", ", entities.Select(entity => entity.Name));
        }

        private VisualElement Buzz(JToken row)
        {
            double buzz = Kit.Num(row, "buzz") ?? 0;
            int shown = NewsModel.ShownBuzz(buzz);
            return NewsUi.Value(shown.ToString(), NewsUi.BuzzWhy(row, shown), "ds-cell__text--num");
        }

        // ---- Sheets ---------------------------------------------------------------------------------

        public void OpenStory(string newsId)
        {
            if (string.IsNullOrEmpty(newsId)) return;
            NewsStorySheet.Open(Root, newsId, today, context.Navigator);
        }

        public void OpenAlerts() => NewsAlertSheet.Open(Root);
    }

    /// <summary>Small pieces the News screen and its sheets share.</summary>
    internal static class NewsUi
    {
        /// <summary>A value with its quiet Why? (shown in full on hover or focus), or the value alone.</summary>
        public static VisualElement Value(string text, WhyButton why, params string[] classes)
        {
            VisualElement row = Ds.Row("nw-value");
            Label label = Ds.Text(text, "ds-cell__text", "nw-value__text");
            foreach (string className in classes) label.AddToClassList(className);
            row.Add(label);
            if (why != null)
            {
                why.AddToClassList("nw-why");
                row.Add(why);
            }
            return row;
        }

        /// <summary>The buzz's Why? over the story's <c>news.buzz</c> trace, or null once the trace store has dropped it.</summary>
        public static WhyButton BuzzWhy(JToken story, int shown) =>
            Kit.WhyRef("Buzz", shown, Kit.Obj(story, "buzzTraceRef"), null, "Why this story got its buzz");
    }
}
