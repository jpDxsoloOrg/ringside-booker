using System;
using System.Collections.Generic;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Design
{
    /// <summary>What the top bar's scoreboard shows: date, money and popularity, each with a quiet Why?.</summary>
    public sealed class ShellScore
    {
        public string Date;
        public string Season;
        public string Cash;
        public string CashWords;
        public DsState CashState = DsState.Neutral;
        public string Popularity;
        public string PopularityWords;
        public WhyBreakdown CashWhy;
        public WhyBreakdown PopularityWhy;
    }

    /// <summary>
    /// The redesigned app shell (UNITY-11; the component phase 2 moves the game onto): a sidebar of
    /// icon links that collapses to a 60 px rail, a 48 px top bar with "Section › Page", a scoreboard
    /// (date, cash, popularity) and the skewed CTA, and a scrolling screen host. Built from
    /// <c>Resources/Design/AppShell.uxml</c>; the nav comes from <see cref="NavigationModel"/>.
    /// </summary>
    public sealed class AppShell
    {
        public const string UxmlResource = "Design/AppShell";

        private readonly VisualElement app;
        private readonly VisualElement sidebar;
        private readonly VisualElement promo;
        private readonly ScrollView nav;
        private readonly VisualElement crumbs;
        private readonly VisualElement board;
        private readonly VisualElement actions;
        private readonly VisualElement tickerSlot;
        private readonly Dictionary<string, Button> links = new Dictionary<string, Button>();
        private readonly Dictionary<string, Label> badges = new Dictionary<string, Label>();
        private readonly Button collapseButton;
        private Action<string> navigate;
        private Button bell;
        private Label bellBadge;
        private Action onBell;
        private string tickerKey;

        /// <summary>PlayerPrefs key that remembers the collapsed sidebar.</summary>
        public const string CollapsedPref = "rb.ui.sidebarCollapsed";

        private static readonly HashSet<string> FooterIds = new HashSet<string> { "settings", "main-menu", "collapse" };

        public AppShell(VisualElement root)
        {
            var tree = Resources.Load<VisualTreeAsset>(UxmlResource);
            if (tree == null) throw new InvalidOperationException($"Missing Resources/{UxmlResource}.uxml");
            tree.CloneTree(root);
            root.AddToClassList("ds-root");
            Root = root;
            app = root.Q<VisualElement>("ds-app");
            sidebar = root.Q<VisualElement>("ds-sidebar");
            promo = root.Q<VisualElement>("ds-promo");
            nav = root.Q<ScrollView>("ds-nav");
            crumbs = root.Q<VisualElement>("ds-crumbs");
            board = root.Q<VisualElement>("ds-topbar-board");
            actions = root.Q<VisualElement>("ds-topbar-actions");
            Content = root.Q<VisualElement>("ds-content");
            ScreenHost = root.Q<VisualElement>("ds-screen-host");
            SummarySlot = root.Q<VisualElement>("ds-summary-slot");
            tickerSlot = root.Q<VisualElement>("ds-ticker-slot");
            tickerSlot.style.display = DisplayStyle.None;
            Scroll = root.Q<ScrollView>("ds-scroll");
            Overlay = new OverlayLayer(root.Q<VisualElement>(OverlayLayer.ElementName));

            // The app icon (ring B) in the mark's old 38×26 box; the red "RB" shape if it is missing.
            VisualElement mark = root.Q<VisualElement>("ds-brand-mark");
            VisualElement icon = BrandIcon.Create(BrandIcon.Small, 32, "ds-brand__mark-icon");
            if (icon != null)
            {
                mark.AddToClassList("ds-brand__mark--icon");
                mark.Add(icon);
            }
            else
            {
                var markShape = new SkewShape();
                markShape.AddToClassList("ds-brand__mark-shape");
                markShape.Add(Ui.Text("RB", "ds-brand__mark-text"));
                mark.Add(markShape);
            }
            root.Q<VisualElement>("ds-brand").AddManipulator(new Clickable(() => navigate?.Invoke(NavigationModel.HomeItemId)));
            // The quiet ALPHA/BETA badge after the words (POL9-10); hidden when the sidebar is collapsed.
            WhatsNew.WhatsNewStyles.Apply(root);
            Label channel = WhatsNew.ChannelBadge.Create("rb-channel-badge--sidebar");
            if (channel != null) root.Q<VisualElement>("ds-brand").Add(channel);

            VisualElement footer = root.Q<VisualElement>("ds-sidebar-footer");
            footer.Add(Link("settings", "Settings", "settings", null, () => navigate?.Invoke("settings")));
            footer.Add(Link("main-menu", "Main menu", "log-out", null, () => navigate?.Invoke("main-menu")));
            collapseButton = Link("collapse", "Collapse", "sidebar-close", null, () => Collapsed = !Collapsed);
            footer.Add(collapseButton);

            root.Q<VisualElement>("ds-topbar-stripe").Add(GradientStripe.Flame(0.55f));
            Collapsed = ReadCollapsed();
        }

        public VisualElement Root { get; }
        public VisualElement Content { get; }
        /// <summary>Where the current screen goes (<see cref="Show"/>).</summary>
        public VisualElement ScreenHost { get; }
        /// <summary>Above the screen: the "what happened" summary after a day moves.</summary>
        public VisualElement SummarySlot { get; }
        /// <summary>The top bar's end, after the scoreboard: the bell, then the day control.</summary>
        public VisualElement Actions => actions;
        public ScrollView Scroll { get; }
        public OverlayLayer Overlay { get; }
        /// <summary>The top bar's "Section › Page" title; <see cref="SetCrumbs"/> redraws it (POL5-02 adds a "?" after it).</summary>
        public VisualElement Crumbs => crumbs;

        /// <summary>The sidebar as a 60 px icon rail (labels become tooltips).</summary>
        public bool Collapsed
        {
            get => app.ClassListContains("ds-app--collapsed");
            set
            {
                app.EnableInClassList("ds-app--collapsed", value);
                try
                {
                    PlayerPrefs.SetInt(CollapsedPref, value ? 1 : 0);
                }
                catch (Exception)
                {
                    // Preferences are a convenience; the sidebar works without them.
                }
                collapseButton.Q<Icon>().Glyph = value ? "sidebar-open" : "sidebar-close";
                collapseButton.Q<Label>().text = TextFormat.Upper(value ? "Expand" : "Collapse");
            }
        }

        /// <summary>The promotion block: logo (picture or monogram plate), name and tagline; a SAMPLE tag for demo data.</summary>
        public void SetPromotion(string name, string tagline, string monogram, string colorHex, Texture2D logo = null, bool sample = false)
        {
            promo.Clear();
            promo.Add(DsCards.Logo(monogram, colorHex, "ds-logo--sm", logo));
            VisualElement words = Ui.El("ds-promo__words");
            words.Add(Ui.Text(TextFormat.Upper(name), "ds-promo__name"));
            VisualElement line = Ui.El("ds-promo__line");
            if (!string.IsNullOrEmpty(tagline)) line.Add(Ui.Text(tagline, "ds-promo__tagline"));
            if (sample) line.Add(Ds.Tag("Sample", "gold"));
            words.Add(line);
            promo.Add(words);
            promo.tooltip = name;
            if (!promo.ClassListContains("ds-promo--tipped"))
            {
                promo.AddToClassList("ds-promo--tipped");
                DsTooltip.Attach(promo, null, name, () => Collapsed);
            }
        }

        /// <summary>
        /// Badge counts by nav item id; 0 or missing hides the badge. <paramref name="states"/>
        /// (optional, by item id) picks a badge's colour token (default <see cref="DsState.Live"/>;
        /// news uses a quieter one), <paramref name="words"/> what the count means ("3 new stories"),
        /// shown as the badge's tooltip. Badge labels are named <c>nav-badge-&lt;item id&gt;</c>.
        /// </summary>
        public void SetBadges(IReadOnlyDictionary<string, int> counts, IReadOnlyDictionary<string, DsState> states = null,
            IReadOnlyDictionary<string, string> words = null)
        {
            foreach (KeyValuePair<string, Label> pair in badges)
            {
                int count = 0;
                counts?.TryGetValue(pair.Key, out count);
                pair.Value.text = count > 99 ? "99+" : count.ToString();
                pair.Value.style.display = count > 0 ? DisplayStyle.Flex : DisplayStyle.None;
                DsState state = DsState.Live;
                states?.TryGetValue(pair.Key, out state);
                foreach (DsState each in (DsState[])Enum.GetValues(typeof(DsState))) pair.Value.EnableInClassList(Ds.StateClass(each), each == state);
                string text = null;
                words?.TryGetValue(pair.Key, out text);
                pair.Value.userData = text;
            }
        }

        /// <summary>The bell before the day control: how many things wait on the player. Created on first call.</summary>
        public void SetBell(int count, Action onClick, string tooltip = "Needs attention")
        {
            onBell = onClick;
            if (bell == null)
            {
                bell = Ds.IconButton("bell", tooltip, () => onBell?.Invoke());
                bell.name = "ds-bell";
                bell.AddToClassList("ds-topbar__bell");
                bellBadge = Ds.Badge("0");
                bellBadge.AddToClassList("ds-topbar__bell-badge");
                bell.Add(bellBadge);
                actions.Insert(0, bell);
            }
            bellBadge.text = count > 99 ? "99+" : count.ToString();
            bellBadge.style.display = count > 0 ? DisplayStyle.Flex : DisplayStyle.None;
        }

        /// <summary>The news ticker under the top bar; hidden with no headlines. Rebuilt only when they change.</summary>
        public void SetTicker(IReadOnlyList<string> headlines, bool animate = true)
        {
            string key = headlines == null ? string.Empty : string.Join("\n", headlines);
            if (key == tickerKey) return;
            tickerKey = key;
            tickerSlot.Clear();
            bool any = headlines != null && headlines.Count > 0;
            tickerSlot.style.display = any ? DisplayStyle.Flex : DisplayStyle.None;
            if (any) tickerSlot.Add(DsCards.Ticker("Latest", headlines, animate));
        }

        /// <summary>A scoreboard cell by id ("date", "cash", "popularity"), or null.</summary>
        public VisualElement ScoreCell(string id) => board.Q<VisualElement>("score-" + id);

        private static bool ReadCollapsed()
        {
            try
            {
                return PlayerPrefs.GetInt(CollapsedPref, 0) == 1;
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>Builds the nav from the model's visible sections. Badges by item id (0 hides).</summary>
        public void SetNav(IEnumerable<NavSection> sections, Action<string> onNavigate, IReadOnlyDictionary<string, int> badges = null)
        {
            navigate = onNavigate;
            nav.Clear();
            // Section links are rebuilt; the footer's links stay.
            foreach (string id in new List<string>(links.Keys))
            {
                if (FooterIds.Contains(id)) continue;
                links.Remove(id);
                this.badges.Remove(id);
            }
            foreach (NavSection section in sections)
            {
                VisualElement block = Ui.El("ds-nav__section");
                block.Add(Ui.Text(TextFormat.Upper(section.Label), "ds-nav__heading"));
                foreach (NavItem item in section.Items)
                {
                    int count = 0;
                    badges?.TryGetValue(item.Id, out count);
                    string id = item.Id;
                    block.Add(Link(item.Id, item.Label, item.Icon, count > 0 ? count : (int?)null, () => navigate?.Invoke(id)));
                }
                nav.Add(block);
            }
        }

        public void SetCurrent(string itemId)
        {
            foreach (KeyValuePair<string, Button> pair in links) pair.Value.EnableInClassList("ds-nav__link--current", pair.Key == itemId);
        }

        public void SetCrumbs(string section, string page)
        {
            crumbs.Clear();
            if (section != null)
            {
                crumbs.Add(Ui.Text(TextFormat.Upper(section), "ds-crumbs__section"));
                crumbs.Add(new Icon("chevron-right", "ds-icon--xs", "ds-crumbs__sep"));
            }
            crumbs.Add(Ui.Text(TextFormat.Upper(page), "ds-crumbs__page"));
        }

        /// <summary>The scoreboard: three cells (date, cash, popularity), each a number over a word.</summary>
        public void SetScore(ShellScore score)
        {
            board.Clear();
            board.Add(ScoreCell("date", "Date", score.Date, score.Season, DsState.Neutral, null));
            if (score.Cash != null) board.Add(ScoreCell("cash", "Cash", score.Cash, score.CashWords, score.CashState, score.CashWhy));
            if (score.Popularity != null) board.Add(ScoreCell("popularity", "Popularity", score.Popularity, score.PopularityWords, DsState.Info, score.PopularityWhy));
        }

        /// <summary>The top bar's end: notifications, the skewed CTA and the skip button.</summary>
        public SkewButton SetActions(string ctaText, Action onCta, int notifications, Action onSkip, Action onBell)
        {
            actions.Clear();
            Button bell = Ds.IconButton("bell", "Notifications", onBell);
            bell.AddToClassList("ds-topbar__bell");
            if (notifications > 0)
            {
                Label badge = Ds.Badge(notifications.ToString());
                badge.AddToClassList("ds-topbar__bell-badge");
                bell.Add(badge);
            }
            actions.Add(bell);
            SkewButton cta = Ds.Cta(ctaText, onCta, "next-day");
            cta.name = "ds-cta";
            cta.AddToClassList("ds-topbar__cta");
            actions.Add(cta);
            Button skip = Ds.IconButton("fast-forward", "Skip days…", onSkip, quiet: false);
            skip.AddToClassList("ds-topbar__skip");
            actions.Add(skip);
            return cta;
        }

        public void Show(VisualElement screen)
        {
            DsTooltip.Hide();
            ScreenHost.Clear();
            ScreenHost.Add(screen);
            Scroll.scrollOffset = Vector2.zero;
        }

        private static VisualElement ScoreCell(string id, string label, string value, string words, DsState state, WhyBreakdown why)
        {
            VisualElement cell = Ui.El("ds-score", Ds.StateClass(state)).Named("score-" + id);
            VisualElement top = Ui.El("ds-score__top");
            top.Add(Ui.Text(TextFormat.Upper(label), "ds-score__label"));
            cell.Add(top);
            VisualElement bottom = Ui.El("ds-score__bottom");
            bottom.Add(Ui.Text(TextFormat.Upper(value), "ds-score__value"));
            if (words != null) bottom.Add(Ui.Text(words, "ds-score__words"));
            cell.Add(bottom);
            if (why != null) Ds.Why(cell, why, top);
            return cell;
        }

        private Button Link(string id, string label, string icon, int? badge, Action onClick)
        {
            var link = new Button(onClick) { text = string.Empty, name = "nav-" + id };
            link.AddToClassList("ds-nav__link");
            link.Add(Ui.El("ds-nav__rail"));
            link.Add(new Icon(IconLibrary.Has(icon) ? icon : "office", "ds-icon--md", "ds-nav__icon"));
            link.Add(Ui.Text(TextFormat.Upper(label), "ds-nav__label"));
            Label count = Ds.Badge(badge.HasValue ? (badge.Value > 99 ? "99+" : badge.Value.ToString()) : "0");
            count.AddToClassList("ds-nav__badge");
            count.name = "nav-badge-" + id;
            count.RegisterCallback<PointerEnterEvent>(_ =>
            {
                if (count.userData is string text && !Collapsed) DsTooltip.ShowNow(count, text);
            });
            count.RegisterCallback<PointerLeaveEvent>(_ => DsTooltip.Hide());
            count.style.display = badge.HasValue ? DisplayStyle.Flex : DisplayStyle.None;
            link.Add(count);
            badges[id] = count;
            DsTooltip.Attach(link, null, label, () => Collapsed);
            links[id] = link;
            return link;
        }
    }
}
