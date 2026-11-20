using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Demo;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Shell
{
    /// <summary>
    /// The Game scene's controller: wires Shell.uxml to the installed <see cref="IShellData"/> and
    /// <see cref="IDayControl"/> (the demo when nothing is installed), routes the sidebar to screens
    /// from <see cref="ScreenRegistry"/>, and handles the shell's keys (Shift+N, Escape).
    /// </summary>
    [RequireComponent(typeof(UIDocument))]
    public sealed class ShellController : MonoBehaviour
    {
        private IShellData data;
        private IDayControl day;
        private VisualElement root;
        private AppShell shell;
        private SidebarView sidebar;
        private TopBarView topBar;
        private DayControlView dayControl;
        private AdvanceSummaryView summary;
        private AdvanceProgressOverlay progressOverlay;

        /// <summary>The shell on screen, or null outside the Game scene.</summary>
        public static ShellController Current { get; private set; }

        public ShellNavigator Navigator { get; } = new ShellNavigator();

        /// <summary>The day control (its main button and the "Needs attention" sheet).</summary>
        public DayControlView DayControl => dayControl;

        /// <summary>The root overlay layer (<see cref="OverlayLayer.ElementName"/>) panels and sheets open into.</summary>
        public OverlayLayer Overlay { get; private set; }

        /// <summary>The redesigned frame (UNITY-11): sidebar, top bar, ticker and screen host.</summary>
        public AppShell Shell => shell;

        private void OnEnable()
        {
            if (!ShellServices.IsInstalled) DemoGame.Install();
            data = ShellServices.Data;
            day = ShellServices.Day;

            // UNITY-11: the frame is the design system's AppShell (sidebar with icons and collapse,
            // scoreboard top bar, news ticker), cloned into the document's root.
            root = GetComponent<UIDocument>().rootVisualElement;
            root.Clear();
            shell = new AppShell(root);
            Overlay = shell.Overlay;
            sidebar = new SidebarView(shell, Navigator, GoToMainMenu);
            topBar = new TopBarView(shell);
            SaveUi.LastSavedChip.Attach(shell);
            VisualElement dayHost = new VisualElement { name = "day-control" };
            dayHost.AddToClassList("day-control");
            shell.Actions.Add(dayHost);
            dayControl = new DayControlView(dayHost, Navigator, Overlay, OpenSkipDays);
            summary = new AdvanceSummaryView(shell.SummarySlot, Navigator, Overlay);
            progressOverlay = new AdvanceProgressOverlay(Overlay);

            Navigator.Navigated += ShowScreen;
            if (data is INavigationObserver dataObserver) Navigator.Navigated += dataObserver.OnNavigated;
            if (day is INavigationObserver dayObserver && !ReferenceEquals(day, data)) Navigator.Navigated += dayObserver.OnNavigated;
            data.Changed += RenderData;
            day.Changed += RenderDay;

            RenderData();
            RenderDay();
            Navigator.Go(NavigationModel.HomeItemId);
            Current = this;
        }

        private void OnDisable()
        {
            if (Current == this) Current = null;
            Navigator.Navigated -= ShowScreen;
            if (data is INavigationObserver dataObserver) Navigator.Navigated -= dataObserver.OnNavigated;
            if (day is INavigationObserver dayObserver) Navigator.Navigated -= dayObserver.OnNavigated;
            if (data != null) data.Changed -= RenderData;
            if (day != null) day.Changed -= RenderDay;
            Overlay?.CloseAll();
        }

        private void Update()
        {
            if (Overlay == null) return;
            if (Input.GetKeyDown(KeyCode.Escape))
            {
                Overlay.CloseTop();
                return;
            }
            // Ctrl+B collapses or expands the sidebar.
            bool ctrl = Input.GetKey(KeyCode.LeftControl) || Input.GetKey(KeyCode.RightControl);
            if (ctrl && Input.GetKeyDown(KeyCode.B) && !TypingInTextField()) shell.Collapsed = !shell.Collapsed;
            // Shift+N presses the day button from anywhere outside a text field or an open sheet.
            bool shift = Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift);
            if (shift && Input.GetKeyDown(KeyCode.N) && Overlay.Count == 0 && !TypingInTextField())
            {
                dayControl.RunPrimary();
            }
        }

        /// <summary>Opens the Skip days sheet (the » button), if a day can move.</summary>
        public void OpenSkipDays()
        {
            if (dayControl.State == null || !dayControl.State.SkipEnabled) return;
            SkipDaysSheet.Open(Overlay, data.Snapshot.Date, request => day.Skip(request),
                () => Navigator.Go(ShellRoute.With("news", "sheet", "alerts")));
        }

        private bool TypingInTextField()
        {
            var focused = root.panel?.focusController?.focusedElement as VisualElement;
            return focused is TextField || focused?.GetFirstAncestorOfType<TextField>() != null;
        }

        private void RenderData()
        {
            using var timing = Engine.EnginePerf.Measure("ui.shell.renderData");
            ShellSnapshot snapshot = data.Snapshot;
            sidebar.Render(snapshot);
            topBar.Render(snapshot);
            shell.SetTicker((data as IShellNews)?.Headlines);
            // A promotion screen disappears when the player loses the promotion.
            if (Navigator.Current != null && !snapshot.HasPromotion)
            {
                (NavSection section, NavItem _) = NavigationModel.Find(Navigator.Current.ScreenId);
                if (section != null && section.RequiresPromotion) Navigator.Go(NavigationModel.HomeItemId);
            }
        }

        private void RenderDay()
        {
            using var timing = Engine.EnginePerf.Measure("ui.shell.renderDay");
            dayControl.Render(day);
            // The bell: how many stops wait on the player; it opens the "Needs attention" list.
            int waiting = day.Gates.Count;
            shell.SetBell(waiting, () =>
            {
                if (day.Gates.Count > 0) dayControl.OpenWaitingSheet();
                else Navigator.Go("inbox");
            }, waiting > 0 ? "Needs attention" : "Nothing waiting: open the inbox");
            summary.Render(day);
            progressOverlay.Render(day);
        }

        private void ShowScreen(ShellRoute route)
        {
            using var timing = Engine.EnginePerf.Measure("ui.shell.showScreen");
            shell.Show(ScreenRegistry.Build(new ScreenContext(route, Navigator, Overlay)));
            sidebar.SetCurrent(route.ScreenId);
            topBar.SetLocation(route);
        }

        private void GoToMainMenu()
        {
            // Save first: the final save is queued on the engine thread before the bridge unloads the world.
            Saves.GameSession.EndCurrent();
            ShellServices.Clear();
            SceneFlow.LoadTitle();
        }
    }
}
