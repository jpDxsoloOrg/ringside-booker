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
        private readonly Dictionary<string, Button> links = new Dictionary<string, Button>();
        private readonly Button collapseButton;
        private Action<string> navigate;

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
            Scroll = root.Q<ScrollView>("ds-scroll");
            Overlay = new OverlayLayer(root.Q<VisualElement>(OverlayLayer.ElementName));

            VisualElement mark = root.Q<VisualElement>("ds-brand-mark");
            var markShape = new SkewShape();
            markShape.AddToClassList("ds-brand__mark-shape");
            markShape.Add(Ui.Text("RB", "ds-brand__mark-text"));
            mark.Add(markShape);

            VisualElement footer = root.Q<VisualElement>("ds-sidebar-footer");
            footer.Add(Link("settings", "Settings", "settings", null, () => navigate?.Invoke("settings")));
            footer.Add(Link("main-menu", "Main menu", "log-out", null, () => navigate?.Invoke("main-menu")));
            collapseButton = Link("collapse", "Collapse", "sidebar-close", null, () => Collapsed = !Collapsed);
            footer.Add(collapseButton);

            root.Q<VisualElement>("ds-topbar-stripe").Add(GradientStripe.Flame(0.55f));
        }

        public VisualElement Root { get; }
        public VisualElement Content { get; }
        public ScrollView Scroll { get; }
        public OverlayLayer Overlay { get; }

        /// <summary>The sidebar as a 60 px icon rail (labels become tooltips).</summary>
        public bool Collapsed
        {
            get => app.ClassListContains("ds-app--collapsed");
            set
            {
                app.EnableInClassList("ds-app--collapsed", value);
                collapseButton.Q<Icon>().Glyph = value ? "sidebar-open" : "sidebar-close";
                collapseButton.Q<Label>().text = TextFormat.Upper(value ? "Expand" : "Collapse");
            }
        }

        public void SetPromotion(string name, string tagline, string monogram, string colorHex)
        {
            promo.Clear();
            promo.Add(DsCards.Logo(monogram, colorHex, "ds-logo--sm"));
            VisualElement words = Ui.El("ds-promo__words");
            words.Add(Ui.Text(TextFormat.Upper(name), "ds-promo__name"));
            if (tagline != null) words.Add(Ui.Text(tagline, "ds-promo__tagline"));
            promo.Add(words);
            DsTooltip.Attach(promo, tagline, name);
        }

        /// <summary>Builds the nav from the model's visible sections. Badges by item id (0 hides).</summary>
        public void SetNav(IEnumerable<NavSection> sections, Action<string> onNavigate, IReadOnlyDictionary<string, int> badges = null)
        {
            navigate = onNavigate;
            nav.Clear();
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
            board.Add(ScoreCell("cash", "Cash", score.Cash, score.CashWords, score.CashState, score.CashWhy));
            board.Add(ScoreCell("popularity", "Popularity", score.Popularity, score.PopularityWords, DsState.Info, score.PopularityWhy));
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
            Content.Clear();
            Content.Add(screen);
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
            if (badge.HasValue)
            {
                Label count = Ds.Badge(badge.Value > 99 ? "99+" : badge.Value.ToString());
                count.AddToClassList("ds-nav__badge");
                link.Add(count);
            }
            DsTooltip.Attach(link, null, label, () => Collapsed);
            links[id] = link;
            return link;
        }
    }
}
