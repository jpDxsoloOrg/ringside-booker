using System;
using System.Globalization;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Shell
{
    /// <summary>
    /// The top bar over the redesigned <see cref="AppShell"/> (UNITY-11): "Section › Page" at the
    /// start; the scoreboard (date and season, cash, popularity), the bell and the day control at
    /// the end; a red-orange stripe along its bottom edge.
    /// </summary>
    public sealed class TopBarView
    {
        /// <summary>The cash cell's element name: its userData is the cash trace ref (a Why? hook).</summary>
        public const string CashChipName = "cash-chip";

        /// <summary>
        /// Called after the cash cell is drawn, to add to it (the engine bridge adds the cash Why?
        /// button, UNITY-09). Null draws the cell alone.
        /// </summary>
        public static Action<VisualElement, ShellSnapshot> CashChipDecorator { get; set; }

        /// <summary>
        /// Called after the screen title is drawn, to add to it (the Help center adds the screen's
        /// quiet "?", POL5-02). Null draws the title alone.
        /// </summary>
        public static Action<VisualElement, ShellRoute> CrumbsDecorator { get; set; }

        private readonly AppShell shell;

        public TopBarView(AppShell shell) => this.shell = shell;

        /// <summary>"Section › Page" for a sidebar screen; just the page for any other.</summary>
        public void SetLocation(ShellRoute route)
        {
            (NavSection section, NavItem item) = NavigationModel.Find(route.ScreenId);
            bool inSection = section != null && item != null;
            shell.SetCrumbs(inSection ? section.Label : null, NavigationModel.ScreenLabel(route.ScreenId));
            CrumbsDecorator?.Invoke(shell.Crumbs, route);
        }

        public void Render(ShellSnapshot snapshot)
        {
            bool promotion = snapshot.HasPromotion;
            shell.SetScore(new ShellScore
            {
                Date = snapshot.Date.DayMonthYear,
                Season = snapshot.SeasonLabel,
                Cash = promotion ? CompactMoney(snapshot.CashCents) : null,
                CashWords = promotion && snapshot.CashCents < 0 ? "In debt" : null,
                CashState = promotion && snapshot.CashCents < 0 ? DsState.Bad : DsState.Neutral,
                Popularity = promotion && snapshot.Popularity.HasValue ? TextFormat.Number(snapshot.Popularity.Value) : null,
                PopularityWords = snapshot.Popularity.HasValue ? PopularityWord(snapshot.Popularity.Value) : null,
            });
            VisualElement date = shell.ScoreCell("date");
            if (date != null) date.tooltip = snapshot.Date.Long;

            VisualElement cash = shell.ScoreCell("cash");
            if (cash != null)
            {
                cash.name = CashChipName;
                cash.userData = snapshot.CashTraceRef;
                cash.tooltip = TextFormat.Money(snapshot.CashCents);
                CashChipDecorator?.Invoke(cash, snapshot);
            }
            VisualElement popularity = shell.ScoreCell("popularity");
            if (popularity != null && snapshot.Prestige.HasValue) popularity.tooltip = $"Prestige {TextFormat.Number(snapshot.Prestige.Value)}";
        }

        /// <summary>Cents as a short amount for the scoreboard: $40.62M, $125K, $900 (the tooltip has the exact figure).</summary>
        public static string CompactMoney(long cents)
        {
            double dollars = Math.Abs(cents) / 100.0;
            string body = dollars >= 1_000_000 ? "$" + (dollars / 1_000_000).ToString("0.00", CultureInfo.InvariantCulture) + "M"
                : dollars >= 10_000 ? "$" + (dollars / 1_000).ToString("0", CultureInfo.InvariantCulture) + "K"
                : "$" + dollars.ToString("N0", CultureInfo.InvariantCulture);
            return cents < 0 && dollars >= 0.5 ? TextFormat.Minus + body : body;
        }

        /// <summary>Plain words for home-region popularity (words before numbers).</summary>
        public static string PopularityWord(int popularity) =>
            popularity >= 70 ? "Huge at home" : popularity >= 55 ? "Big at home" : popularity >= 40 ? "Known at home" : popularity >= 25 ? "Small following" : "Unknown";
    }
}
