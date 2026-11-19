using System;
using System.Collections.Generic;
using RingsideBooker.UI.Demo;
using RingsideBooker.UI.Shell;
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
            root.Q<Label>("title-version").text = $"v{Application.version} · Unity {Application.unityVersion}";

            saves = new TitleSaves(ResetPanel, overlay, GoToNewGame);

            menu.Clear();
            Wire(root, "menu-new-game", ShowNewGame);
            Wire(root, "menu-continue", () => saves.Continue());
            Wire(root, "menu-load", () => saves.ShowLoad());
            Wire(root, "menu-settings", ShowSettings);
            Wire(root, "menu-quit", SceneFlow.Quit);

            VisualElement menuRoot = root.Q<VisualElement>("title-menu");
            menuRoot.RegisterCallback<NavigationMoveEvent>(OnMenuMove, TrickleDown.TrickleDown);

            Select(menu[0]);
            ShowNewGame();
            menu[0].schedule.Execute(() => menu[0].Focus());
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
            VisualElement inner = Ui.El("title-panel__inner");
            inner.Add(Ui.Text(TextFormat.Upper(title), "screen-heading"));
            panel.Add(inner);
            return inner;
        }

        private void ShowNewGame()
        {
            VisualElement inner = ResetPanel("New game");
            inner.Add(RingsideBooker.Screens.NewGameWizard.Build());
            Button demo = Ui.Btn("Or look around the demo game (sample data)", StartDemo, "btn--link");
            demo.name = "start-demo";
            demo.style.marginTop = 16;
            inner.Add(demo);
        }

        private void ShowSettings()
        {
            VisualElement inner = ResetPanel("Settings");
            inner.Add(SettingsScreen.BuildPanel());
        }

        private static void StartDemo()
        {
            DemoGame.Install();
            SceneFlow.LoadGame();
        }
    }
}
