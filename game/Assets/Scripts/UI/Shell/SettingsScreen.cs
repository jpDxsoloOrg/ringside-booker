using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Settings;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Shell
{
    /// <summary>The Settings screen (in game) and panel (title screen): UI scale and window mode.</summary>
    public static class SettingsScreen
    {
        /// <summary>The in-game screen: heading, a back button, then the settings panel.</summary>
        public static VisualElement Build(ScreenContext context)
        {
            VisualElement screen = Ui.El("settings-screen").Named("screen-settings");
            screen.Add(Ui.Text(TextFormat.Upper("Settings"), "screen-heading"));
            if (context.Navigator.CanGoBack)
            {
                Button back = Ui.Btn("‹ BACK", () => context.Navigator.Back(), "btn--ghost");
                back.style.alignSelf = Align.FlexStart;
                back.style.marginBottom = 16;
                screen.Add(back);
            }
            screen.Add(BuildPanel());
            return screen;
        }

        /// <summary>The settings themselves, shared by the title screen and the game.</summary>
        public static VisualElement BuildPanel()
        {
            var panel = new VisualElement();
            panel.Add(ScaleGroup());
            panel.Add(WindowGroup());
            return panel;
        }

        private static VisualElement ScaleGroup()
        {
            VisualElement group = Ui.El("card", "settings-group");
            Label current = Ui.Text(string.Empty, "t-data", "t-display-bold", "t-lg");
            VisualElement chips = Ui.El("chip-row");
            group.With(
                Ui.Text(TextFormat.Upper("UI scale"), "settings-group__title"),
                Ui.Text("Grows or shrinks every screen's text and spacing together. The layout already scales with the window from 1280×720 up to 4K; this multiplies it.", "field-hint", "settings-group__hint"),
                chips,
                current);

            void Refresh()
            {
                current.text = $"Current: {UiSettings.Percent(UiSettings.Scale)}";
                foreach (VisualElement chip in chips.Children())
                {
                    chip.EnableInClassList("choice-chip--selected", Mathf.Approximately((float)chip.userData, UiSettings.Scale));
                }
            }

            foreach (float preset in UiSettings.ScalePresets)
            {
                float value = preset;
                Button chip = Ui.Button(string.Empty, () =>
                {
                    UiSettings.Scale = value;
                    Refresh();
                }, "choice-chip");
                chip.userData = value;
                chip.Add(Ui.Text(UiSettings.Percent(value), "choice-chip__label"));
                chip.style.flexGrow = 0;
                chip.style.minWidth = 72;
                chips.Add(chip);
            }
            Refresh();
            return group;
        }

        private static VisualElement WindowGroup()
        {
            VisualElement group = Ui.El("card", "settings-group");
            VisualElement chips = Ui.El("chip-row");
            group.With(
                Ui.Text(TextFormat.Upper("Window"), "settings-group__title"),
                Ui.Text("Fullscreen uses the desktop's resolution; windowed can be resized.", "field-hint", "settings-group__hint"),
                chips);

            void Refresh()
            {
                foreach (VisualElement chip in chips.Children())
                {
                    chip.EnableInClassList("choice-chip--selected", (FullScreenMode)chip.userData == Screen.fullScreenMode);
                }
            }

            void AddMode(string text, FullScreenMode mode)
            {
                Button chip = Ui.Button(string.Empty, () =>
                {
                    Screen.fullScreenMode = mode;
                    chips.schedule.Execute(Refresh).ExecuteLater(100);
                    Refresh();
                }, "choice-chip");
                chip.userData = mode;
                chip.Add(Ui.Text(TextFormat.Upper(text), "choice-chip__label"));
                chip.style.flexGrow = 0;
                chip.style.minWidth = 140;
                chips.Add(chip);
            }

            AddMode("Fullscreen", FullScreenMode.FullScreenWindow);
            AddMode("Windowed", FullScreenMode.Windowed);
            Refresh();
            return group;
        }
    }
}
