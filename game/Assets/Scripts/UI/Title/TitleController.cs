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
    /// settings panel; New game, Continue and Load show placeholders until the engine bridge
    /// (UNITY-04/09) can start, find and load games. New game offers the demo shell meanwhile.
    /// Up/Down move through the menu, Enter picks, Escape closes an open sheet.
    /// </summary>
    [RequireComponent(typeof(UIDocument))]
    public sealed class TitleController : MonoBehaviour
    {
        private readonly List<Button> menu = new List<Button>();
        private VisualElement panel;
        private OverlayLayer overlay;
        private Button current;

        private void OnEnable()
        {
            VisualElement root = GetComponent<UIDocument>().rootVisualElement;
            overlay = new OverlayLayer(root.Q<VisualElement>(OverlayLayer.ElementName));
            panel = root.Q<VisualElement>("title-panel");
            root.Q<VisualElement>("title-stripe").Add(GradientStripe.Flame(1f));
            root.Q<Label>("title-version").text = $"v{Application.version} · Unity {Application.unityVersion}";

            menu.Clear();
            Wire(root, "menu-new-game", ShowNewGame);
            Wire(root, "menu-continue", () => ShowPlaceholder("Continue",
                "Continue picks up your most recent save. Saves are files on disk; reading them arrives with the engine bridge (UNITY-04)."));
            Wire(root, "menu-load", () => ShowPlaceholder("Load",
                "Load lists your saves to choose from. It arrives with the engine bridge (UNITY-04)."));
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
            if (Input.GetKeyDown(KeyCode.Escape)) overlay?.CloseTop();
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
            VisualElement card = Ui.El("card", "placeholder__card").With(
                Ui.Text(TextFormat.Upper("Not built yet"), "section-label"),
                Ui.Text("Choosing a world (built-in or a workshop world mod) and the promotion you run arrives with the engine bridge. Until then, the demo game shows the in-game shell with sample data.", "placeholder__body"));
            Button demo = Ui.Btn("START DEMO GAME", StartDemo, "btn--primary");
            demo.name = "start-demo";
            demo.style.alignSelf = Align.FlexStart;
            demo.style.marginTop = 20;
            card.Add(demo);
            inner.Add(card);
        }

        private void ShowPlaceholder(string title, string body)
        {
            VisualElement inner = ResetPanel(title);
            inner.Add(Ui.El("card", "placeholder__card").With(
                Ui.Text(TextFormat.Upper("Not built yet"), "section-label"),
                Ui.Text(body, "placeholder__body")));
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
