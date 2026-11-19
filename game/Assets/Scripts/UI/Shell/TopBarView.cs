using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Shell
{
    /// <summary>
    /// The bar above the content: "Section › Page" at the start; the status chips (date and season,
    /// cash, popularity) and the day control at the end; a red-orange stripe along its bottom edge.
    /// </summary>
    public sealed class TopBarView
    {
        /// <summary>The cash chip's element name: a Why? panel (UNITY-08) can attach to it; its userData is the cash trace ref.</summary>
        public const string CashChipName = "cash-chip";

        /// <summary>
        /// Called after the cash chip is drawn, to add to it (the engine bridge adds the cash Why?
        /// button, UNITY-09). Null draws the chip alone.
        /// </summary>
        public static System.Action<VisualElement, ShellSnapshot> CashChipDecorator { get; set; }

        private readonly Label crumbSection;
        private readonly Label crumbSeparator;
        private readonly Label crumbPage;
        private readonly VisualElement chips;

        public TopBarView(VisualElement root)
        {
            crumbSection = root.Q<Label>("crumb-section");
            crumbSeparator = root.Q<Label>("crumb-separator");
            crumbPage = root.Q<Label>("crumb-page");
            chips = root.Q<VisualElement>("status-chips");
            root.Q<VisualElement>("top-bar-stripe").Add(GradientStripe.Flame());
        }

        /// <summary>"Section › Page" for a sidebar screen; just the page for any other.</summary>
        public void SetLocation(ShellRoute route)
        {
            (NavSection section, NavItem item) = NavigationModel.Find(route.ScreenId);
            bool inSection = section != null && item != null;
            crumbSection.SetShown(inSection);
            crumbSeparator.SetShown(inSection);
            crumbSection.text = inSection ? TextFormat.Upper(section.Label) : string.Empty;
            crumbPage.text = TextFormat.Upper(NavigationModel.ScreenLabel(route.ScreenId));
        }

        public void Render(ShellSnapshot snapshot)
        {
            chips.Clear();
            chips.Add(Chip("date-chip", "Date", snapshot.Date.Short, snapshot.SeasonLabel, "status-chip--date"));
            chips[0].tooltip = snapshot.Date.Long;
            if (!snapshot.HasPromotion) return;

            VisualElement cash = Chip(CashChipName, "Cash", TextFormat.Money(snapshot.CashCents), null, null);
            cash.userData = snapshot.CashTraceRef;
            if (snapshot.CashCents < 0) cash.Q<Label>(className: "status-chip__value").AddToClassList("status-chip__value--negative");
            chips.Add(cash);
            CashChipDecorator?.Invoke(cash, snapshot);

            if (snapshot.Popularity.HasValue)
            {
                string prestige = snapshot.Prestige.HasValue ? $"Prestige {TextFormat.Number(snapshot.Prestige.Value)}" : null;
                chips.Add(Chip("popularity-chip", "Popularity", TextFormat.Number(snapshot.Popularity.Value), prestige, null));
            }
        }

        private static VisualElement Chip(string name, string label, string value, string secondary, string modifier)
        {
            VisualElement chip = Ui.El("status-chip").Named(name);
            if (modifier != null) chip.AddToClassList(modifier);
            chip.Add(Ui.Text(TextFormat.Upper(label), "status-chip__label"));
            chip.Add(Ui.Text(TextFormat.Upper(value), "status-chip__value"));
            if (!string.IsNullOrEmpty(secondary)) chip.Add(Ui.Text(secondary, "status-chip__secondary"));
            return chip;
        }
    }
}
