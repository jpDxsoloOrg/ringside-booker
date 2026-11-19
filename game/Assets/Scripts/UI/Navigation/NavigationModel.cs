using System.Collections.Generic;
using System.Linq;
using RingsideBooker.UI.Bridge;

namespace RingsideBooker.UI.Navigation
{
    /// <summary>One sidebar entry (the web's <c>NavItem</c>). Its id is also its screen id.</summary>
    public sealed class NavItem
    {
        public NavItem(string id, string label, string icon, NavBadgeKey? badgeKey = null)
        {
            Id = id;
            Label = label;
            Icon = icon;
            BadgeKey = badgeKey;
        }

        /// <summary>Stable id, unique across every section; also the <see cref="ShellRoute.ScreenId"/>.</summary>
        public string Id { get; }
        /// <summary>Text in the sidebar and the screen's title.</summary>
        public string Label { get; }
        /// <summary>The web's icon name; the shell draws a glyph for it (<see cref="Shell.NavGlyphs"/>).</summary>
        public string Icon { get; }
        public NavBadgeKey? BadgeKey { get; }
    }

    public sealed class NavSection
    {
        public NavSection(string id, string label, bool requiresPromotion, params NavItem[] items)
        {
            Id = id;
            Label = label;
            RequiresPromotion = requiresPromotion;
            Items = items;
        }

        public string Id { get; }
        public string Label { get; }
        /// <summary>Hidden while the player runs no promotion (unemployed).</summary>
        public bool RequiresPromotion { get; }
        public IReadOnlyList<NavItem> Items { get; }
    }

    /// <summary>
    /// The in-game navigation as data, ported from the web's <c>navigation.ts</c>. The sidebar, the
    /// top bar's "Section › Page" title and the screen host read it, so adding a screen means
    /// adding an item here (if it belongs in the sidebar) and registering its screen in
    /// <see cref="ScreenRegistry"/>. Items with no registered screen show a placeholder.
    /// </summary>
    public static class NavigationModel
    {
        public const string HomeItemId = "dashboard";

        public static readonly IReadOnlyList<NavSection> Sections = new[]
        {
            new NavSection("office", "Office", false,
                new NavItem("dashboard", "Dashboard", "office", NavBadgeKey.PendingDecisions),
                new NavItem("inbox", "Inbox", "inbox", NavBadgeKey.UnreadMail),
                new NavItem("news", "News", "newspaper", NavBadgeKey.UnreadNews)),
            new NavSection("world", "World", false,
                new NavItem("workers", "Workers", "user-search"),
                new NavItem("promotions", "Promotions", "building"),
                new NavItem("event-history", "Event history", "history")),
            new NavSection("your-promotion", "Your promotion", true,
                new NavItem("roster", "Roster", "roster"),
                new NavItem("booking", "Booking", "booking"),
                new NavItem("calendar", "Calendar", "calendar"),
                new NavItem("match-lab", "Match lab", "lab")),
            new NavSection("creative", "Creative", true,
                new NavItem("titles", "Titles", "titles"),
                new NavItem("storylines", "Storylines", "storylines"),
                new NavItem("teams", "Teams & stables", "link"),
                new NavItem("tournaments", "Tournaments", "bracket"),
                new NavItem("brands", "Brands", "layers")),
            new NavSection("business", "Business", true,
                new NavItem("finances", "Finances", "finance"),
                new NavItem("contracts", "Contracts", "contracts", NavBadgeKey.WantsToLeave),
                new NavItem("networks", "Networks", "tv"),
                new NavItem("production", "Production", "video")),
        };

        /// <summary>Labels for screens outside the sidebar (their placeholder titles).</summary>
        private static readonly Dictionary<string, string> OtherScreenLabels = new Dictionary<string, string>
        {
            [ScreenIds.Settings] = "Settings",
            [ScreenIds.ShowNight] = "Show night",
            [ScreenIds.ShowResults] = "Show results",
            [ScreenIds.Worker] = "Worker",
            [ScreenIds.Promotion] = "Promotion",
        };

        /// <summary>The sections the player can see: promotion sections drop out while unemployed.</summary>
        public static IReadOnlyList<NavSection> Visible(bool hasPromotion) =>
            Sections.Where(section => hasPromotion || !section.RequiresPromotion).ToList();

        /// <summary>The section and item that own a screen id, or nulls for a screen outside the sidebar.</summary>
        public static (NavSection section, NavItem item) Find(string screenId)
        {
            foreach (NavSection section in Sections)
            {
                foreach (NavItem item in section.Items)
                {
                    if (item.Id == screenId) return (section, item);
                }
            }
            return (null, null);
        }

        /// <summary>The words for a screen: its nav label, a known other screen's label, or the id.</summary>
        public static string ScreenLabel(string screenId)
        {
            (NavSection _, NavItem item) = Find(screenId);
            if (item != null) return item.Label;
            return OtherScreenLabels.TryGetValue(screenId, out string label) ? label : screenId;
        }
    }
}
