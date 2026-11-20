using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Settings;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Shell
{
    /// <summary>
    /// The Settings screen (in game) and panel (title screen): UI scale and window mode, and in a game
    /// the world's Big world speed.
    /// </summary>
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
            panel.Add(BackupsGroup());
            // A world setting: only while a game is running (the title screen has no world).
            if (EngineGame.Current != null) panel.Add(BigWorldSpeedGroup(EngineGame.Current));
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

        /// <summary>Backups per save (UNITY-27): how many earlier versions each save slot keeps.</summary>
        private static VisualElement BackupsGroup()
        {
            VisualElement group = Ui.El("card", "settings-group").Named("settings-backups");
            VisualElement chips = Ui.El("chip-row");
            group.With(
                Ui.Text(TextFormat.Upper("Backups per save"), "settings-group__title"),
                Ui.Text("Each save keeps its last few versions, so you can go back to one from Load. More backups use more disk space.", "field-hint", "settings-group__hint"),
                chips);

            void Refresh()
            {
                foreach (VisualElement chip in chips.Children())
                {
                    chip.EnableInClassList("choice-chip--selected", (int)chip.userData == RingsideBooker.Saves.SaveSettings.BackupsPerSlot);
                }
            }

            foreach (int choice in RingsideBooker.Saves.SaveSettings.BackupChoices)
            {
                int value = choice;
                Button chip = Ui.Button(string.Empty, () =>
                {
                    RingsideBooker.Saves.SaveSettings.BackupsPerSlot = value;
                    Refresh();
                }, "choice-chip");
                chip.name = $"backups-per-save-{value}";
                chip.userData = value;
                chip.Add(Ui.Text(value.ToString(System.Globalization.CultureInfo.InvariantCulture), "choice-chip__label"));
                chip.style.flexGrow = 0;
                chip.style.minWidth = 72;
                chips.Add(chip);
            }
            Refresh();
            return group;
        }

        /// <summary>Big world speed's choices: the engine's value and the button text.</summary>
        private static readonly (string Value, string Label)[] BigWorldSpeeds =
        {
            ("full", "Full detail"),
            ("fast", "Fast"),
        };

        /// <summary>
        /// Big world speed (POL4-13): Full detail or Fast, read with <c>world.bigWorldSpeed</c> and
        /// changed with <c>world.setBigWorldSpeed</c>. The change is saved with the game.
        /// </summary>
        private static VisualElement BigWorldSpeedGroup(EngineGame game)
        {
            VisualElement group = Ui.El("card", "settings-group").Named("settings-big-world-speed");
            VisualElement chips = Ui.El("chip-row");
            Label note = Ui.Text(string.Empty, "field-hint", "t-wrap");
            note.SetShown(false);
            group.With(
                Ui.Text(TextFormat.Upper("Big world speed"), "settings-group__title"),
                Ui.Text("Full detail simulates every show in the world in full. Fast simulates rival shows far from you more lightly, so long skips in big worlds are quicker; their results, titles, money and news still happen.",
                    "field-hint", "settings-group__hint", "t-wrap"),
                Ui.Text("Changing it changes how the future plays out. The days already played stay as they are.",
                    "field-hint", "settings-group__hint", "t-wrap"),
                chips,
                note);

            string current = null;

            void Refresh()
            {
                foreach (VisualElement chip in chips.Children())
                {
                    chip.EnableInClassList("choice-chip--selected", (string)chip.userData == current);
                }
            }

            async Task Pick(string value)
            {
                if (value == current) return;
                CommandResult<JToken> result = await game.Client.Command("world.setBigWorldSpeed", new { speed = value });
                if (result.Ok) current = value;
                note.text = result.Ok ? string.Empty : $"Could not change it: {result.ReasonText}";
                note.SetShown(!result.Ok);
                Refresh();
            }

            async Task Load()
            {
                QueryResult<JToken> read = await game.Client.Query("world.bigWorldSpeed");
                current = read.Ok ? (string)read.Data?["speed"] : null;
                Refresh();
            }

            foreach ((string value, string label) in BigWorldSpeeds)
            {
                string speed = value;
                Button chip = Ui.Button(string.Empty, async () => await Pick(speed), "choice-chip");
                chip.name = $"big-world-speed-{speed}";
                chip.userData = speed;
                chip.Add(Ui.Text(TextFormat.Upper(label), "choice-chip__label"));
                chip.style.flexGrow = 0;
                chip.style.minWidth = 140;
                chips.Add(chip);
            }
            _ = Load();
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
