using System.IO;
using System.Linq;
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
            panel.Add(CreditsGroup());
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

        /// <summary>The licences folder the build stages (BuildScripts.StageLicenses).</summary>
        public static string LicensesFolder => Path.Combine(Application.streamingAssetsPath, "licenses");

        /// <summary>
        /// Credits &amp; licences: the version, then one button per third-party notice the build
        /// ships (StreamingAssets/licenses); a button shows that notice's text below.
        /// </summary>
        private static VisualElement CreditsGroup()
        {
            VisualElement group = Ui.El("card", "settings-group").Named("settings-credits");
            VisualElement chips = Ui.El("chip-row");
            var text = new ScrollView(ScrollViewMode.Vertical) { name = "licence-text" };
            text.style.maxHeight = 360;
            text.style.marginTop = 12;
            text.SetShown(false);
            group.With(
                Ui.Text(TextFormat.Upper("Credits & licences"), "settings-group__title"),
                Ui.Text($"Ringside Booker {Application.version}. Built with Unity {Application.unityVersion}. " +
                        "The game runs its simulation on ClearScript and V8, reads workshop world mods with SQLite and uses the Barlow Condensed and Inter fonts. " +
                        "Their notices:", "field-hint", "settings-group__hint", "t-wrap"),
                chips,
                text);

            string[] files = Directory.Exists(LicensesFolder)
                ? Directory.GetFiles(LicensesFolder, "*.txt").OrderBy(path => Path.GetFileName(path) == "THIRD-PARTY-NOTICES.txt" ? 0 : 1).ThenBy(path => path).ToArray()
                : new string[0];
            if (files.Length == 0)
            {
                group.Add(Ui.Text("The notices are added by the Windows build (licenses folder).", "field-hint"));
                return group;
            }

            foreach (string file in files)
            {
                string path = file;
                Button chip = Ui.Button(string.Empty, () =>
                {
                    text.Clear();
                    // One label per paragraph: a single label cannot hold a long licence.
                    foreach (string paragraph in File.ReadAllText(path).Replace("\r\n", "\n").Split(new[] { "\n\n" }, System.StringSplitOptions.RemoveEmptyEntries))
                    {
                        Label label = Ui.Text(paragraph, "t-sm", "t-wrap", "mono");
                        label.style.marginBottom = 8;
                        text.Add(label);
                    }
                    text.SetShown(true);
                    text.scrollOffset = Vector2.zero;
                }, "choice-chip");
                chip.Add(Ui.Text(Path.GetFileNameWithoutExtension(path), "choice-chip__label"));
                chip.style.flexGrow = 0;
                chips.Add(chip);
            }
            return group;
        }
    }
}
