using System;
using System.Collections.Generic;
using RingsideBooker.Release;
using RingsideBooker.UI.Demo;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.WhatsNew;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Title
{
    /// <summary>
    /// The title screen: New game, Continue, Load, Settings, Quit. Quit quits; Settings shows the
    /// settings panel; Continue loads the latest save and Load lists the save slots
    /// (<see cref="TitleSaves"/>). New game offers a quick default-world game and the demo shell
    /// until the new-game wizard (UNITY-09) arrives.
    /// Up/Down move through the menu, Enter picks, Escape closes an open sheet.
    /// </summary>
    [RequireComponent(typeof(UIDocument))]
    public sealed class TitleController : MonoBehaviour
    {
        private readonly List<Button> menu = new List<Button>();
        private VisualElement panel;
        private OverlayLayer overlay;
        private Button current;
        private TitleSaves saves;

        private void OnEnable()
        {
            VisualElement root = GetComponent<UIDocument>().rootVisualElement;
            overlay = new OverlayLayer(root.Q<VisualElement>(OverlayLayer.ElementName));
            panel = root.Q<VisualElement>("title-panel");
            root.Q<VisualElement>("title-stripe").Add(GradientStripe.Flame(1f));
            SetUpRelease(root);

            saves = new TitleSaves(ResetPanel, overlay, GoToNewGame);

            menu.Clear();
            Wire(root, "menu-new-game", ShowNewGame);
            Wire(root, "menu-continue", () => saves.Continue());
            Wire(root, "menu-load", () => saves.ShowLoad());
            Wire(root, "menu-settings", ShowSettings);
            if (root.Q<Button>("menu-help") != null) Wire(root, "menu-help", ShowHelp);
            Wire(root, "menu-quit", SceneFlow.Quit);

            VisualElement menuRoot = root.Q<VisualElement>("title-menu");
            menuRoot.RegisterCallback<NavigationMoveEvent>(OnMenuMove, TrickleDown.TrickleDown);

            Select(menu[0]);
            ShowNewGame();
            // After a crash loop (or the crash screen's Start safe), open on the safe-start choices.
            if (Diagnostics.CrashGuard.ShouldOfferSafeStart) ShowSafeStart();
            Crash.FeedbackUi.AddToTitle(root);
            Updates.UpdateUi.AddToTitle(root);
            menu[0].schedule.Execute(() => menu[0].Focus());
        }

        /// <summary>
        /// The channel badge next to the wordmark, the version line (a link to What's new), and What's
        /// new opening by itself once per new version (POL9-01/10).
        /// </summary>
        private void SetUpRelease(VisualElement root)
        {
            WhatsNewStyles.Apply(root);
            Label badge = ChannelBadge.Create("rb-channel-badge--title");
            if (badge != null) root.Q<VisualElement>(className: "title-wordmark")?.Add(badge);
            // The app icon (ring B) above the wordmark.
            VisualElement wordmark = root.Q<VisualElement>(className: "title-wordmark");
            VisualElement icon = RingsideBooker.UI.Design.BrandIcon.Create(RingsideBooker.UI.Design.BrandIcon.Large, 96, "title-icon");
            if (icon != null && wordmark?.parent != null) wordmark.parent.Insert(wordmark.parent.IndexOf(wordmark), icon);

            Label version = root.Q<Label>("title-version");
            ReleaseInfo.Stamp stamp = ReleaseInfo.Current;
            version.text = TitleVersionLine(stamp);
            version.tooltip = "What's new in this version";
            version.focusable = true;
            version.AddToClassList("title-version--link");
            version.AddManipulator(new Clickable(() => WhatsNewSheet.Open(version)));
            version.RegisterCallback<KeyDownEvent>(evt =>
            {
                if (evt.keyCode != KeyCode.Return && evt.keyCode != KeyCode.KeypadEnter && evt.keyCode != KeyCode.Space) return;
                WhatsNewSheet.Open(version);
                evt.StopPropagation();
            });

            if (!WhatsNewState.IsDevRun && WhatsNewState.CheckOnStart(ReleaseNotes.ForThisBuild().HasContent))
            {
                version.schedule.Execute(() => WhatsNewSheet.Open(version)).ExecuteLater(300);
            }
        }

        /// <summary>"Alpha 0.1.0 (1) · 1a2b3c4d · What's new" (no commit on a local build).</summary>
        public static string TitleVersionLine(ReleaseInfo.Stamp stamp)
        {
            string commit = string.IsNullOrEmpty(stamp.ShortCommit) ? string.Empty : $" · {stamp.ShortCommit}";
            return $"{stamp.Label}{commit} · What's new";
        }

        private void Update()
        {
            if (!Input.GetKeyDown(KeyCode.Escape)) return;
            // An open sheet first; then the New game import sub-screen goes back to the world list.
            if (overlay != null && overlay.Count > 0) overlay.CloseTop();
            else RingsideBooker.Screens.NewGameWizard.Active?.HandleBack();
        }

        private void Wire(VisualElement root, string name, Action show)
        {
            Button button = root.Q<Button>(name);
            button.clicked += () =>
            {
                Select(button);
                show();
            };
            menu.Add(button);
        }

        private void GoToNewGame()
        {
            Button button = menu.Find(item => item.name == "menu-new-game");
            if (button == null) return;
            Select(button);
            ShowNewGame();
            button.Focus();
        }

        private void Select(Button button)
        {
            current = button;
            foreach (Button item in menu) item.EnableInClassList("menu-button--current", item == button);
        }

        /// <summary>Up and Down move focus through the menu (wrapping); Left and Right do nothing here.</summary>
        private void OnMenuMove(NavigationMoveEvent evt)
        {
            int step = evt.direction == NavigationMoveEvent.Direction.Down ? 1
                : evt.direction == NavigationMoveEvent.Direction.Up ? -1 : 0;
            if (step == 0) return;
            int index = menu.IndexOf(evt.target as Button);
            if (index < 0) index = menu.IndexOf(current);
            menu[(index + step + menu.Count) % menu.Count].Focus();
            evt.StopPropagation();
        }

        private VisualElement ResetPanel(string title)
        {
            panel.Clear();
            panel.RemoveFromClassList("title-panel--wizard");
            VisualElement inner = Ui.El("title-panel__inner");
            inner.Add(Ui.Text(TextFormat.Upper(title), "screen-heading"));
            panel.Add(inner);
            return inner;
        }

        private void ShowNewGame()
        {
            VisualElement inner = ResetPanel("New game");
            // The wizard fills the panel's height and scrolls its step inside it (UNITY-13).
            panel.AddToClassList("title-panel--wizard");
            inner.AddToClassList("title-panel__inner--wizard");
            inner.Add(RingsideBooker.Screens.NewGameWizard.Build());
            Button demo = Ui.Btn("Or look around the demo game (sample data)", StartDemo, "btn--link");
            demo.name = "start-demo";
            demo.style.marginTop = 16;
            inner.Add(demo);
        }

        private void ShowSafeStart()
        {
            VisualElement inner = ResetPanel("Start safe");
            inner.Add(Crash.SafeStartPanel.Build(GoToNewGame));
        }

        private void ShowSettings()
        {
            VisualElement inner = ResetPanel("Settings");
            // Top-aligned like the wizard, and the groups scroll inside the panel instead of
            // squeezing into each other on a short window (2000×840).
            panel.AddToClassList("title-panel--wizard");
            inner.AddToClassList("title-panel__inner--wizard");
            var scroll = new ScrollView(ScrollViewMode.Vertical) { name = "title-settings-scroll", horizontalScrollerVisibility = ScrollerVisibility.Hidden };
            scroll.AddToClassList("title-settings-scroll");
            scroll.Add(SettingsScreen.BuildPanel());
            inner.Add(scroll);
        }

        /// <summary>The Help center before a game is loaded (POL5-02): screen links are plain text here.</summary>
        private void ShowHelp()
        {
            VisualElement inner = ResetPanel("Help");
            panel.AddToClassList("title-panel--wizard");
            inner.AddToClassList("title-panel__inner--wizard");
            inner.Add(RingsideBooker.Help.HelpScreen.BuildOutOfGame().Root);
        }

        private static void StartDemo()
        {
            DemoGame.Install();
            SceneFlow.LoadGame();
        }
    }
}
