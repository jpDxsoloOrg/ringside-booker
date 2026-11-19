using System;
using System.Collections.Generic;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Shell
{
    /// <summary>
    /// The sidebar over the redesigned <see cref="AppShell"/> (UNITY-11): the promotion block, every
    /// visible nav section with icons and badges, then Settings, Main menu and Collapse. The current
    /// page has a red-orange rail; the sidebar collapses to a 60 px icon rail (remembered).
    /// </summary>
    public sealed class SidebarView
    {
        private const string NoPromotionColor = "#334155";

        private readonly AppShell shell;
        private readonly ShellNavigator navigator;
        private readonly Action onMainMenu;
        private bool? builtForPromotion;
        private string currentScreenId;

        /// <summary>
        /// Turns a promotion's logo ref into its picture (set by the screens: a workshop world's
        /// pictures), or null for none; the block then shows the monogram.
        /// </summary>
        public static Func<string, UnityEngine.Texture2D> LogoTexture { get; set; }

        public SidebarView(AppShell shell, ShellNavigator navigator, Action onMainMenu)
        {
            this.shell = shell;
            this.navigator = navigator;
            this.onMainMenu = onMainMenu;
        }

        /// <summary>Draws the promotion block, (re)builds the sections the player can see and sets the badges.</summary>
        public void Render(ShellSnapshot snapshot)
        {
            PromotionInfo promotion = snapshot.Promotion;
            if (promotion == null)
            {
                shell.SetPromotion("No promotion", "Free agent booker", "?", NoPromotionColor, null, snapshot.Sample);
            }
            else
            {
                UnityEngine.Texture2D logo = promotion.LogoRef == null ? null : LogoTexture?.Invoke(promotion.LogoRef);
                shell.SetPromotion(promotion.Name, promotion.Tagline, Monogram(promotion.ShortName ?? promotion.Name),
                    PlateColor(promotion.Name), logo, snapshot.Sample);
            }

            if (builtForPromotion != snapshot.HasPromotion)
            {
                builtForPromotion = snapshot.HasPromotion;
                shell.SetNav(NavigationModel.Visible(snapshot.HasPromotion), Navigate);
                if (currentScreenId != null) shell.SetCurrent(currentScreenId);
            }

            var counts = new Dictionary<string, int>();
            var states = new Dictionary<string, DsState>();
            var words = new Dictionary<string, string>();
            foreach (NavSection section in NavigationModel.Sections)
            {
                foreach (NavItem item in section.Items)
                {
                    if (item.BadgeKey == null) continue;
                    int count = snapshot.Badge(item.BadgeKey.Value);
                    counts[item.Id] = count;
                    states[item.Id] = BadgeState(item.BadgeKey.Value);
                    words[item.Id] = NavBadgeWords.For(item.BadgeKey.Value, count);
                }
            }
            shell.SetBadges(counts, states, words);
        }

        /// <summary>
        /// A badge's colour token: things waiting on the player and workers who want to leave in the
        /// shell's live red; unread news and mail in the quieter info blue (UNITY-19).
        /// </summary>
        public static DsState BadgeState(NavBadgeKey key) => key switch
        {
            NavBadgeKey.UnreadNews => DsState.Info,
            NavBadgeKey.UnreadMail => DsState.Info,
            _ => DsState.Live,
        };

        /// <summary>Marks the link for <paramref name="screenId"/> as the current page.</summary>
        public void SetCurrent(string screenId)
        {
            currentScreenId = screenId;
            shell.SetCurrent(screenId);
        }

        private void Navigate(string id)
        {
            if (id == "main-menu") onMainMenu?.Invoke();
            else if (id == "settings") navigator.Go(ScreenIds.Settings);
            else navigator.Go(id);
        }

        /// <summary>A steady plate colour per promotion (until promotions carry their colour in the snapshot).</summary>
        private static string PlateColor(string name)
        {
            string[] palette = { "#2b6cb0", "#b45309", "#047857", "#7c3aed", "#be123c", "#0e7490", "#a16207", "#4338ca" };
            int hash = 17;
            foreach (char c in name ?? string.Empty) hash = unchecked(hash * 31 + c);
            return palette[Math.Abs(hash % palette.Length)];
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
