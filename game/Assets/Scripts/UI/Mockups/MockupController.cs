using System;
using System.Collections.Generic;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Mockups
{
    /// <summary>The mockup screens, in the order the number keys (1–9) and the screenshot tour use.</summary>
    public static class MockupScreens
    {
        public const string Office = "office";
        public const string Roster = "roster";
        public const string Booking = "booking";
        public const string ShowNight = "show-night";
        public const string Results = "results";
        public const string StyleGuide = "style-guide";
        public const string Components = "components";

        public static readonly string[] Order = { Office, Roster, Booking, ShowNight, Results, StyleGuide, Components };
    }

    /// <summary>
    /// The UNITY-11 mockups for the owner's review: the redesigned shell (<see cref="AppShell"/>) with
    /// Office, Roster, Booking, Show night and Results built from the design system's components and
    /// sample data from the default world (<see cref="MockupData"/>), plus the style guide and the
    /// component gallery. Nothing here touches the engine or the real screens.
    /// Open with <c>RingsideBooker.exe -rbMockups</c> (or the Mockups scene in the editor). Keys: 1–7
    /// switch screens, Ctrl+B collapses the sidebar, Escape closes the top sheet.
    /// </summary>
    [RequireComponent(typeof(UIDocument))]
    public sealed class MockupController : MonoBehaviour
    {
        public const string SceneName = "Mockups";

        private readonly Dictionary<string, Func<VisualElement>> builders = new Dictionary<string, Func<VisualElement>>();

        public static MockupController Current { get; private set; }

        public AppShell Shell { get; private set; }
        public string CurrentScreen { get; private set; }

        /// <summary>Roster view state (the tour switches it): "cards" or "table".</summary>
        public string RosterView { get; set; } = "cards";

        private void OnEnable()
        {
            VisualElement root = GetComponent<UIDocument>().rootVisualElement;
            root.Clear();
            Shell = new AppShell(root);
            Shell.SetPromotion(MockupData.Promotion, "Market leader · Northeast", MockupData.PromotionShort, MockupData.PromotionColor);
            Shell.SetNav(NavigationModel.Visible(true), Go, new Dictionary<string, int>
            {
                ["dashboard"] = 3,
                ["inbox"] = 2,
                ["contracts"] = 1,
            });
            Shell.SetScore(new ShellScore
            {
                Date = "Mon 25 Jan 2027",
                Season = "Season 1 · Week 4",
                Cash = "$40.62M",
                CashWords = "+$1.10M this month",
                CashState = DsState.Good,
                Popularity = "75",
                PopularityWords = "Big in the Northeast",
                CashWhy = MockupWhy.Cash,
                PopularityWhy = MockupWhy.Popularity,
            });
            Shell.SetActions("Go to the show", () => Go("booking"), 3,
                () => DsOverlay.Toast(Shell.Root, "Skip days opens here", DsState.Info, "Not part of the mockups."),
                () => DsOverlay.Toast(Shell.Root, "3 things need you today", DsState.Warn, "They're listed on the Office page."));

            builders[MockupScreens.Office] = () => OfficeMockup.Build(this);
            builders[MockupScreens.Roster] = () => RosterMockup.Build(this);
            builders[MockupScreens.Booking] = () => BookingMockup.Build(this);
            builders[MockupScreens.ShowNight] = () => ShowNightMockup.Build(this);
            builders[MockupScreens.Results] = () => ResultsMockup.Build(this);
            builders[MockupScreens.StyleGuide] = () => StyleGuideMockup.Build(this);
            builders[MockupScreens.Components] = () => ComponentsMockup.Build(this);

            Current = this;
            Show(MockupScreens.Office);
        }

        private void OnDisable()
        {
            if (Current == this) Current = null;
        }

        private void Update()
        {
            if (Shell == null) return;
            if (Input.GetKeyDown(KeyCode.Escape))
            {
                Shell.Overlay.CloseTop();
                return;
            }
            bool ctrl = Input.GetKey(KeyCode.LeftControl) || Input.GetKey(KeyCode.RightControl);
            if (ctrl && Input.GetKeyDown(KeyCode.B)) Shell.Collapsed = !Shell.Collapsed;
            for (int index = 0; index < MockupScreens.Order.Length; index++)
            {
                if (Input.GetKeyDown(KeyCode.Alpha1 + index) && Shell.Overlay.Count == 0) Show(MockupScreens.Order[index]);
            }
        }

        /// <summary>A sidebar id or a mockup screen id.</summary>
        public void Go(string id)
        {
            switch (id)
            {
                case "dashboard":
                    Show(MockupScreens.Office);
                    break;
                case "roster":
                case "booking":
                    Show(id);
                    break;
                default:
                    if (builders.ContainsKey(id)) Show(id);
                    else Placeholder(id);
                    break;
            }
        }

        public void Show(string screen)
        {
            Shell.Overlay.CloseAll();
            CurrentScreen = screen;
            (string section, string page, string nav) = screen switch
            {
                MockupScreens.Office => ("Office", "Dashboard", "dashboard"),
                MockupScreens.Roster => ("Your promotion", "Roster", "roster"),
                MockupScreens.Booking => ("Your promotion", "Booking", "booking"),
                MockupScreens.ShowNight => ("Show night", "Altura Showcase", "booking"),
                MockupScreens.Results => ("Show night", "Results", "booking"),
                MockupScreens.StyleGuide => ("Design system", "Style guide", null),
                _ => ("Design system", "Components", null),
            };
            Shell.SetCrumbs(section, page);
            Shell.SetCurrent(nav);
            Shell.Show(builders[screen]());
        }

        private void Placeholder(string id)
        {
            CurrentScreen = id;
            Shell.SetCrumbs(null, NavigationModel.ScreenLabel(id));
            Shell.SetCurrent(id);
            VisualElement panel = Ds.Panel(null, null, null, "mk-placeholder");
            panel.Add(Ds.Empty("layers", $"{NavigationModel.ScreenLabel(id)} isn't in the mockups",
                "Phase 1 mocks up Office, Roster, Booking, Show night and Results. The rest follow the same components once the owner signs off.",
                "Back to the Office", () => Show(MockupScreens.Office)));
            Shell.Show(panel);
        }
    }
}
