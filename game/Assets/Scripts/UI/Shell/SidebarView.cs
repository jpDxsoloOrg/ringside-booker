using System;
using System.Collections.Generic;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Shell
{
    /// <summary>
    /// The left sidebar: wordmark, the promotion's crest block, every visible nav section, then
    /// Settings and Main menu. The current page has a red-orange rail down its edge.
    /// </summary>
    public sealed class SidebarView
    {
        private readonly ShellNavigator navigator;
        private readonly Label crest;
        private readonly Label promotionName;
        private readonly Label promotionTagline;
        private readonly Label sampleBadge;
        private readonly ScrollView nav;
        private readonly Dictionary<string, (Button link, Label badge, NavItem item)> links =
            new Dictionary<string, (Button, Label, NavItem)>();
        private bool? builtForPromotion;
        private string currentScreenId;

        /// <summary>
        /// Turns a promotion's logo ref into its picture (set by the screens: a workshop world's
        /// pictures), or null for none; the crest then shows the monogram.
        /// </summary>
        public static Func<string, UnityEngine.Texture2D> LogoTexture { get; set; }

        public SidebarView(VisualElement sidebar, ShellNavigator navigator, Action onMainMenu)
        {
            this.navigator = navigator;
            crest = sidebar.Q<Label>("promotion-crest");
            promotionName = sidebar.Q<Label>("promotion-name");
            promotionTagline = sidebar.Q<Label>("promotion-tagline");
            sampleBadge = sidebar.Q<Label>("promotion-sample");
            nav = sidebar.Q<ScrollView>("sidebar-nav");

            sidebar.Q<Button>("brand").clicked += () => navigator.Go(NavigationModel.HomeItemId);

            VisualElement footer = sidebar.Q<VisualElement>("sidebar-footer");
            footer.Add(FooterLink("settings", "Settings", "SE", () => navigator.Go(ScreenIds.Settings)));
            footer.Add(FooterLink("main-menu", "Main menu", "MM", onMainMenu));
        }

        /// <summary>Draws the promotion block and (re)builds the sections the player can see.</summary>
        public void Render(ShellSnapshot snapshot)
        {
            PromotionInfo promotion = snapshot.Promotion;
            crest.EnableInClassList("promotion-crest--empty", promotion == null);
            UnityEngine.Texture2D logo = promotion?.LogoRef == null ? null : LogoTexture?.Invoke(promotion.LogoRef);
            crest.EnableInClassList("promotion-crest--logo", logo != null);
            crest.style.backgroundImage = logo != null ? new StyleBackground(logo) : new StyleBackground(StyleKeyword.Null);
            if (promotion == null)
            {
                crest.text = "?";
                promotionName.text = TextFormat.Upper("No promotion");
                promotionTagline.text = "Free agent booker";
            }
            else
            {
                crest.text = logo != null ? string.Empty : Monogram(promotion.ShortName ?? promotion.Name);
                crest.tooltip = promotion.Name;
                promotionName.text = TextFormat.Upper(promotion.Name);
                promotionTagline.text = promotion.Tagline ?? string.Empty;
            }
            sampleBadge.SetShown(snapshot.Sample);

            if (builtForPromotion != snapshot.HasPromotion) BuildNav(snapshot.HasPromotion);

            foreach ((Button _, Label badge, NavItem item) in links.Values)
            {
                int count = item?.BadgeKey != null ? snapshot.Badge(item.BadgeKey.Value) : 0;
                badge.text = count > 99 ? "99+" : count.ToString();
                badge.SetShown(count > 0);
            }
        }

        /// <summary>Marks the link for <paramref name="screenId"/> as the current page.</summary>
        public void SetCurrent(string screenId)
        {
            currentScreenId = screenId;
            foreach (KeyValuePair<string, (Button link, Label badge, NavItem item)> pair in links)
            {
                pair.Value.link.EnableInClassList("nav-link--current", pair.Key == screenId);
            }
        }

        private void BuildNav(bool hasPromotion)
        {
            builtForPromotion = hasPromotion;
            nav.Clear();
            // Footer links (no nav item) stay; section links are rebuilt.
            var keep = new Dictionary<string, (Button, Label, NavItem)>();
            foreach (KeyValuePair<string, (Button link, Label badge, NavItem item)> pair in links)
            {
                if (pair.Value.item == null) keep[pair.Key] = pair.Value;
            }
            links.Clear();
            foreach (KeyValuePair<string, (Button, Label, NavItem)> pair in keep) links[pair.Key] = pair.Value;

            foreach (NavSection section in NavigationModel.Visible(hasPromotion))
            {
                VisualElement block = Ui.El("nav-section").Named($"nav-section-{section.Id}");
                block.Add(Ui.Text(TextFormat.Upper(section.Label), "nav-section__heading"));
                foreach (NavItem item in section.Items)
                {
                    NavItem target = item;
                    (Button link, Label badge) = NavLink(item.Label, Monogram(item.Label), () => navigator.Go(target.Id));
                    link.name = $"nav-{item.Id}";
                    links[item.Id] = (link, badge, item);
                    block.Add(link);
                }
                nav.Add(block);
            }
            if (currentScreenId != null) SetCurrent(currentScreenId);
        }

        private VisualElement FooterLink(string id, string label, string glyph, Action onClick)
        {
            (Button link, Label badge) = NavLink(label, glyph, onClick);
            link.name = $"nav-{id}";
            links[id] = (link, badge, null);
            return link;
        }

        private static (Button link, Label badge) NavLink(string label, string glyph, Action onClick)
        {
            Button link = Ui.Button(string.Empty, onClick, "nav-link");
            link.tooltip = label;
            Label badge = Ui.Text(string.Empty, "badge", "badge--action", "nav-link__badge");
            badge.SetShown(false);
            link.With(
                Ui.Text(glyph, "nav-link__icon"),
                Ui.Text(TextFormat.Upper(label), "nav-link__label"),
                badge);
            return (link, badge);
        }

        /// <summary>Up to two capitals for a crest or nav glyph: "Harbor City Wrestling" → "HC".</summary>
        public static string Monogram(string text)
        {
            if (string.IsNullOrWhiteSpace(text)) return "?";
            string[] words = text.Split(new[] { ' ', '-', '&' }, StringSplitOptions.RemoveEmptyEntries);
            if (words.Length == 1) return TextFormat.Upper(words[0].Substring(0, Math.Min(2, words[0].Length)));
            return TextFormat.Upper($"{words[0][0]}{words[1][0]}");
        }
    }
}
