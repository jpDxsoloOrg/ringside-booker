using System;
using System.Collections.Generic;
using System.Linq;
using RingsideBooker.Screens;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Help
{
    /// <summary>Where the Help center is: an article (and a heading in it) and the search words.</summary>
    public sealed class HelpLocation
    {
        public string Slug;
        public string Anchor;
        public string Query;

        public static HelpLocation From(ShellRoute route) =>
            new HelpLocation { Slug = route?.Param("slug"), Anchor = route?.Param("anchor"), Query = route?.Param("q") };

        public ShellRoute ToRoute()
        {
            var pairs = new List<string>();
            if (!string.IsNullOrEmpty(Slug)) pairs.AddRange(new[] { "slug", Slug });
            if (!string.IsNullOrEmpty(Anchor)) pairs.AddRange(new[] { "anchor", Anchor });
            if (!string.IsNullOrEmpty(Query)) pairs.AddRange(new[] { "q", Query });
            return ShellRoute.With(HelpScreen.ScreenId, pairs.ToArray());
        }
    }

    /// <summary>
    /// The Help center (POL5-02) in the Windows game: route <c>help</c>, <c>help?slug=&lt;slug&gt;[&amp;anchor=&lt;id&gt;][&amp;q=&lt;words&gt;]</c>.
    /// Search and the article list on the left, the index or an article on the right. The same
    /// view opens from the title screen (<see cref="BuildOutOfGame"/>), where screen links are
    /// plain text. Also wires the screen header's quiet "?" (<see cref="TopBarView.CrumbsDecorator"/>)
    /// that opens a screen's article in a side sheet (<see cref="HelpSheet"/>).
    /// </summary>
    public static class HelpScreen
    {
        public const string ScreenId = "help";

        /// <summary>The view built last (tests and tours read it).</summary>
        public static HelpView Current { get; private set; }

        /// <summary>The search words, kept for the session so Back to the index keeps them.</summary>
        internal static string LastQuery = string.Empty;

        /// <summary>Optional: fills the index's "Getting started" card slot (POL5-05's checklist, in game).</summary>
        public static Func<ScreenContext, VisualElement> GettingStartedSlot { get; set; }

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Register()
        {
            ScreenRegistry.Register(ScreenId, Build);
            TopBarView.CrumbsDecorator = AddScreenHelp;
        }

        public static VisualElement Build(ScreenContext context)
        {
            HelpLocation location = HelpLocation.From(context.Route);
            var view = new HelpView(HelpLibrary.Shared, inGame: true,
                go: next => context.Navigator.Go(next.ToRoute()),
                openScreen: id => context.Navigator.Go(ShellRoute.To(id)),
                gettingStarted: GettingStartedSlot != null ? () => GettingStartedSlot(context) : null);
            view.Root.name = "screen-help";
            Current = view;
            view.Show(location);
            return view.Root;
        }

        /// <summary>The Help center outside a game (the title screen): it moves between articles itself.</summary>
        public static HelpView BuildOutOfGame(HelpLocation start = null)
        {
            HelpView view = null;
            view = new HelpView(HelpLibrary.Shared, inGame: false, go: next => view.Show(next), openScreen: null, gettingStarted: null);
            view.Root.name = "title-help";
            Current = view;
            view.Show(start ?? new HelpLocation());
            return view;
        }

        /// <summary>Adds the stylesheet (Resources/Help/Help.uss); sheets in the overlay layer need their own.</summary>
        public static void Style(VisualElement element)
        {
            shared ??= Resources.Load<StyleSheet>("Screens/ScreenDs");
            sheet ??= Resources.Load<StyleSheet>("Help/Help");
            if (shared != null && !element.styleSheets.Contains(shared)) element.styleSheets.Add(shared);
            if (sheet != null && !element.styleSheets.Contains(sheet)) element.styleSheets.Add(sheet);
        }

        private static StyleSheet sheet;
        private static StyleSheet shared;

        /// <summary>Every screen id a <c>screen:</c> link or an article's <c>screens</c> may name.</summary>
        public static HashSet<string> KnownScreenIds()
        {
            var ids = new HashSet<string>(NavigationModel.Sections.SelectMany(section => section.Items).Select(item => item.Id))
            {
                ScreenIds.Settings, ScreenIds.ShowNight, ScreenIds.ShowResults, ScreenIds.Worker, ScreenIds.Promotion, ScreenId,
            };
            return ids;
        }

        /// <summary>The "?" after the screen's title in the top bar, for a screen that has an article.</summary>
        private static void AddScreenHelp(VisualElement crumbs, ShellRoute route)
        {
            if (crumbs == null || route == null || route.ScreenId == ScreenId) return;
            HelpArticleMeta meta = HelpLibrary.Shared.ForScreen(route.ScreenId);
            if (meta == null) return;
            Button help = Ds.IconButton("help", $"Help: {meta.Title}", () => HelpSheet.Open(crumbs, meta.Slug));
            help.name = "screen-help";
            help.AddToClassList("hp-screen-help");
            crumbs.Add(help);
        }
    }

    /// <summary>The Help center's state and drawing (one per visit).</summary>
    public sealed class HelpView
    {
        private readonly HelpLibrary library;
        private readonly bool inGame;
        private readonly Action<HelpLocation> go;
        private readonly Action<string> openScreen;
        private readonly Func<VisualElement> gettingStarted;
        private readonly VisualElement listHost;
        private readonly VisualElement main;
        private readonly TextField search;
        private HelpLocation location = new HelpLocation();

        public HelpView(HelpLibrary library, bool inGame, Action<HelpLocation> go, Action<string> openScreen, Func<VisualElement> gettingStarted)
        {
            this.library = library;
            this.inGame = inGame;
            this.go = go;
            this.openScreen = openScreen;
            this.gettingStarted = gettingStarted;

            Root = Ds.Row("hp-page", inGame ? "hp-page--game" : "hp-page--title");
            HelpScreen.Style(Root);
            VisualElement side = Ds.Column("hp-side");
            VisualElement box = ScreenDs.SearchBox("Search help", Search, "help-search");
            search = box.Q<TextField>("help-search");
            side.Add(box);
            listHost = Ds.Column("hp-side__list").Named("help-list");
            side.Add(listHost);
            Root.Add(side);
            main = Ds.Column("hp-main").Named("help-main");
            if (inGame)
            {
                Root.Add(main);
            }
            else
            {
                // The title screen's panel does not scroll: the article scrolls on its own.
                var scroll = new ScrollView(ScrollViewMode.Vertical) { horizontalScrollerVisibility = ScrollerVisibility.Hidden };
                scroll.AddToClassList("hp-main-scroll");
                scroll.Add(main);
                Root.Add(scroll);
            }
        }

        public VisualElement Root { get; }

        /// <summary>The slug on screen (null on the index or for an unknown slug).</summary>
        public string ShownSlug { get; private set; }

        /// <summary>The search results drawn last (empty without a query).</summary>
        public List<HelpSearchResult> Results { get; private set; } = new List<HelpSearchResult>();

        public HelpLocation Location => location;

        /// <summary>Shows a location: the index, an article (scrolled to its anchor) or "Article not found".</summary>
        public void Show(HelpLocation next)
        {
            location = next ?? new HelpLocation();
            // The words in the route win; otherwise the session's last search stays (Back keeps it).
            string query = !string.IsNullOrEmpty(location.Query) ? location.Query : HelpScreen.LastQuery ?? string.Empty;
            HelpScreen.LastQuery = query;
            search.SetValueWithoutNotify(query);
            DrawList(query);
            main.Clear();
            ShownSlug = null;
            if (library.Problem != null)
            {
                main.Add(Ds.Empty("help", "Help can't open", library.Problem));
                return;
            }
            if (string.IsNullOrEmpty(location.Slug))
            {
                DrawIndex();
                return;
            }
            HelpArticle article = library.Article(location.Slug);
            if (article == null)
            {
                VisualElement missing = Ds.Empty("help", "Article not found", $"There's no help article called “{location.Slug}”.",
                    "Back to Help", () => go(new HelpLocation { Query = HelpScreen.LastQuery }), "back");
                missing.name = "help-not-found";
                main.Add(missing);
                return;
            }
            DrawArticle(article);
        }

        /// <summary>Types search words (tours and tests): redraws the list in place.</summary>
        public void Search(string query)
        {
            HelpScreen.LastQuery = query ?? string.Empty;
            if (search.value != HelpScreen.LastQuery) search.SetValueWithoutNotify(HelpScreen.LastQuery);
            DrawList(HelpScreen.LastQuery);
        }

        private void DrawList(string query)
        {
            listHost.Clear();
            if (!string.IsNullOrWhiteSpace(query))
            {
                Results = library.Search.Find(query);
                if (Results.Count == 0)
                {
                    listHost.Add(Ds.Text($"No articles match “{query.Trim()}”.", "ds-type-caption", "hp-side__empty").Named("help-no-results"));
                    return;
                }
                foreach (HelpSearchResult result in Results)
                {
                    string slug = result.Slug;
                    Button row = ListButton(result.Title, result.Snippet, slug == location.Slug, () => go(new HelpLocation { Slug = slug, Query = query }));
                    row.name = "help-result-" + slug;
                    listHost.Add(row);
                }
                return;
            }
            Results = new List<HelpSearchResult>();
            Button home = ListButton("Help home", null, string.IsNullOrEmpty(location.Slug), () => go(new HelpLocation()));
            home.name = "help-home";
            listHost.Add(home);
            foreach ((HelpSection section, IReadOnlyList<HelpArticleMeta> articles) in library.Sections())
            {
                listHost.Add(Ds.Text(TextFormat.Upper(section.Title), "ds-type-micro", "hp-side__heading"));
                foreach (HelpArticleMeta meta in articles)
                {
                    string slug = meta.Slug;
                    Button row = ListButton(meta.Title, null, slug == location.Slug, () => go(new HelpLocation { Slug = slug }));
                    row.name = "help-item-" + slug;
                    listHost.Add(row);
                }
            }
        }

        private static Button ListButton(string title, string detail, bool current, Action onClick)
        {
            var button = new Button(onClick) { text = string.Empty };
            button.AddToClassList("hp-side__item");
            button.EnableInClassList("hp-side__item--current", current);
            button.Add(Ui.Text(title, "hp-side__title"));
            if (!string.IsNullOrEmpty(detail)) button.Add(Ui.Text(detail, "hp-side__detail"));
            return button;
        }

        private void DrawIndex()
        {
            VisualElement head = Ds.Column("hp-head");
            head.Add(Ds.Text("HELP", "ds-type-headline"));
            head.Add(Ds.Text("Short guides to the game's main screens. Pick one below, or search.", "ds-type-body", "hp-summary"));
            main.Add(head);

            VisualElement slot = gettingStarted?.Invoke();
            if (slot != null) main.Add(slot);

            foreach ((HelpSection section, IReadOnlyList<HelpArticleMeta> articles) in library.Sections())
            {
                VisualElement panel = Ds.Panel(section.Title, null, null, "hp-section");
                panel.name = "help-section-" + section.Id;
                VisualElement grid = Ds.Row("hp-cards");
                foreach (HelpArticleMeta meta in articles)
                {
                    string slug = meta.Slug;
                    var card = new Button(() => go(new HelpLocation { Slug = slug })) { text = string.Empty, name = "help-card-" + slug };
                    card.AddToClassList("hp-card");
                    card.Add(Ui.Text(meta.Title, "hp-card__title"));
                    card.Add(Ui.Text(meta.Summary, "hp-card__summary"));
                    grid.Add(card);
                }
                panel.Add(grid);
                main.Add(panel);
            }
        }

        private void DrawArticle(HelpArticle article)
        {
            ShownSlug = article.Meta.Slug;
            GettingStarted.Record(GettingStarted.ReadArticle);
            HelpSection section = library.SectionOf(article.Meta);

            VisualElement head = Ds.Column("hp-head");
            if (section != null) head.Add(Ds.Text(TextFormat.Upper(section.Title), "ds-type-micro", "hp-eyebrow"));
            head.Add(Ds.Text(article.Meta.Title, "ds-type-headline", "hp-title").Named("help-article-title"));
            head.Add(Ds.Text(article.Meta.Summary, "ds-type-body", "hp-summary"));
            main.Add(head);

            List<HelpBlock> headings = article.Headings.Where(heading => heading.Level == 2).ToList();
            if (headings.Count >= 3)
            {
                VisualElement contents = Ds.Column("hp-toc").Named("help-toc");
                contents.Add(Ds.Text("ON THIS PAGE", "ds-type-micro", "hp-toc__label"));
                VisualElement chips = Ds.Row("hp-toc__chips");
                foreach (HelpBlock heading in headings)
                {
                    string anchor = heading.Anchor;
                    Button chip = Ds.Chip(HelpMarkdown.PlainText(heading.Inlines), false, () => ScrollToAnchor(anchor));
                    chip.name = "help-toc-" + anchor;
                    chips.Add(chip);
                }
                contents.Add(chips);
                main.Add(contents);
            }

            VisualElement body = HelpRenderer.Render(article.Blocks, Options());
            body.name = "help-article-body";
            main.Add(body);

            if (inGame)
            {
                List<string> live = article.Meta.Screens.Where(ScreenRegistry.IsLive).ToList();
                if (live.Count > 0)
                {
                    VisualElement goRow = Ds.Row("hp-go");
                    foreach (string screen in live)
                    {
                        string id = screen;
                        Button button = Ds.Button("Go to " + NavigationModel.ScreenLabel(id), () => openScreen?.Invoke(id), DsButtonKind.Secondary, "chevron-right");
                        button.name = "help-go-" + id;
                        goRow.Add(button);
                    }
                    main.Add(goRow);
                }
            }

            List<HelpArticleMeta> related = library.Index.Articles.Where(meta => meta.Section == article.Meta.Section && meta.Slug != article.Meta.Slug).OrderBy(meta => meta.Order).ToList();
            if (related.Count > 0)
            {
                VisualElement panel = Ds.Panel("More in " + (section?.Title ?? "Help"), null, null, "hp-related");
                foreach (HelpArticleMeta meta in related)
                {
                    string slug = meta.Slug;
                    Button link = Ds.Button(meta.Title, () => go(new HelpLocation { Slug = slug }), DsButtonKind.Ghost, "file-text");
                    link.AddToClassList("hp-related__link");
                    panel.Add(link);
                }
                main.Add(panel);
            }

            if (!string.IsNullOrEmpty(location.Anchor)) ScrollToAnchor(location.Anchor);
        }

        private HelpRenderOptions Options() => new HelpRenderOptions
        {
            Followable = link => HelpLinks.Followable(link, inGame),
            Follow = link =>
            {
                if (link.Kind == HelpLinkKind.Help)
                {
                    if (link.Slug == ShownSlug && link.Anchor != null) ScrollToAnchor(link.Anchor);
                    else go(new HelpLocation { Slug = link.Slug, Anchor = link.Anchor });
                }
                else if (link.Kind == HelpLinkKind.Screen) openScreen?.Invoke(link.ScreenId);
                else HelpLinks.OpenExternal(link);
            },
        };

        /// <summary>Scrolls the screen to a heading once it has been laid out.</summary>
        public void ScrollToAnchor(string anchor)
        {
            VisualElement target = main.Q<VisualElement>(HelpRenderer.HeadingPrefix + anchor);
            if (target == null) return;
            void Scroll()
            {
                ScrollView scroll = target.GetFirstAncestorOfType<ScrollView>();
                if (scroll == null || float.IsNaN(target.worldBound.y)) return;
                Vector2 local = scroll.contentContainer.WorldToLocal(target.worldBound.position);
                scroll.scrollOffset = new Vector2(scroll.scrollOffset.x, Mathf.Max(0, local.y - 16));
            }
            target.schedule.Execute(Scroll).ExecuteLater(60);
        }
    }

    /// <summary>Which help links can be followed, and opening https links.</summary>
    public static class HelpLinks
    {
        public static bool Followable(HelpLinkTarget link, bool inGame)
        {
            switch (link.Kind)
            {
                case HelpLinkKind.Help:
                    return HelpLibrary.Shared.Meta(link.Slug) != null;
                case HelpLinkKind.Screen:
                    // Out of a game there is no screen to go to; an unbuilt screen stays plain text.
                    return inGame && ScreenRegistry.IsLive(link.ScreenId);
                case HelpLinkKind.External:
                    return true;
                default:
                    return false;
            }
        }

        public static void OpenExternal(HelpLinkTarget link)
        {
            if (link?.Kind == HelpLinkKind.External && link.Href.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) Application.OpenURL(link.Href);
        }
    }

    /// <summary>A screen's article in a side sheet (the screen header's "?"), with "Open in Help".</summary>
    public static class HelpSheet
    {
        /// <summary>The sheet open now, or null.</summary>
        public static OverlayHandle Current { get; private set; }

        public static OverlayHandle Open(VisualElement anyElement, string slug)
        {
            HelpArticle article = HelpLibrary.Shared.Article(slug);
            if (article == null) return null;
            GettingStarted.Record(GettingStarted.ReadArticle);
            ShellNavigator navigator = ShellController.Current?.Navigator;

            VisualElement body = Ui.El("hp-sheet");
            HelpScreen.Style(body);
            body.Add(Ds.Text(article.Meta.Summary, "ds-type-body", "hp-summary"));
            OverlayHandle handle = null;
            body.Add(HelpRenderer.Render(article.Blocks, new HelpRenderOptions
            {
                Followable = link => HelpLinks.Followable(link, navigator != null),
                Follow = link =>
                {
                    handle?.Close();
                    if (link.Kind == HelpLinkKind.Help) navigator?.Go(new HelpLocation { Slug = link.Slug, Anchor = link.Anchor }.ToRoute());
                    else if (link.Kind == HelpLinkKind.Screen) navigator?.Go(ShellRoute.To(link.ScreenId));
                    else HelpLinks.OpenExternal(link);
                },
            }));

            VisualElement footer = null;
            if (navigator != null)
            {
                footer = Ds.Row("hp-sheet__footer");
                Button open = Ds.Button("Open in Help", () =>
                {
                    handle?.Close();
                    navigator.Go(new HelpLocation { Slug = slug }.ToRoute());
                }, DsButtonKind.Secondary, "help");
                open.name = "help-sheet-open";
                footer.Add(open);
            }
            handle = DsOverlay.SideSheet(anyElement, article.Meta.Title, body, "HELP", footer, 520f);
            if (handle != null)
            {
                handle.Content.name = "help-sheet";
                Current = handle;
                handle.Closed += () =>
                {
                    if (Current == handle) Current = null;
                };
            }
            return handle;
        }
    }
}
