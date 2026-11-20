using System;
using System.Collections;
using System.IO;
using System.Threading.Tasks;
using RingsideBooker.Release;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Title;
using RingsideBooker.UI.WhatsNew;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Dev
{
    /// <summary>
    /// A developer tour of the release labels (POL9-01/10): run the player with
    /// <c>-rbReleaseShots &lt;folder&gt;</c> and it captures the title screen (ALPHA badge, version line),
    /// What's new from the build's own CHANGELOG.md, then fixture states (a release with every section
    /// plus newer items, Unreleased only, empty), Settings › About on the title screen, and in a new
    /// default-world game the sidebar header and Settings › About. Exits 0 when done, 1 on a timeout.
    /// </summary>
    public sealed class ReleaseShots : MonoBehaviour
    {
        public const string Argument = "-rbReleaseShots";

        private const string FixtureChangelog = @"## Unreleased

### Fixed

- I fixed the day button skipping past a title match.

## [0.1.0-alpha.2] - 2026-11-26

### Added

- I added a Send feedback button to Settings.
- I added the version and build to Settings › About.

### Changed

- I made the ALPHA badge quieter in the sidebar.

### Fixed

- I fixed long show names running under the close button.

### Balance

- Crowds tire of the same main event a little sooner.

### Heads up

- Saves from 0.1.0-alpha.1 may not load in this version. Start a new game.
";

        private const string UnreleasedOnly = @"## Unreleased

### Added

- I added a Send feedback button to Settings.

### Fixed

- I fixed long show names running under the close button.
";

        private string folder;
        private int index;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void StartIfAsked()
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (!string.Equals(args[i], Argument, StringComparison.OrdinalIgnoreCase)) continue;
                if (Application.isBatchMode) return;
                var host = new GameObject("ReleaseShots");
                DontDestroyOnLoad(host);
                host.AddComponent<ReleaseShots>().folder = args[i + 1];
                return;
            }
        }

        private IEnumerator Start()
        {
            Invoke(nameof(GiveUp), 240f);
            Directory.CreateDirectory(folder);
            Debug.Log($"[ReleaseShots] {ReleaseInfo.Version} channel {ReleaseInfo.Channel}, window title '{ReleaseInfo.WindowTitle}'");
            while (UnityEngine.SceneManagement.SceneManager.GetActiveScene().name != SceneFlow.TitleScene) yield return null;
            yield return Wait(1.5f);
            VisualElement title = FindFirstObjectByType<TitleController>().GetComponent<UIDocument>().rootVisualElement;
            Label version = title.Q<Label>("title-version");
            yield return Capture("title");

            OverlayHandle sheet = WhatsNewSheet.Open(version);
            yield return Wait(0.8f);
            yield return Capture("whats-new-this-build");
            sheet?.Close();

            ReleaseInfo.Stamp newer = ReleaseInfo.Stamp.Parse(
                "{\"version\":\"0.1.0-alpha.3+1a2b3c4d\",\"channel\":\"alpha\",\"commit\":\"1a2b3c4d\",\"built\":\"2026-11-28T10:00:00Z\"}", null);
            sheet = WhatsNewSheet.Open(version, ReleaseNotes.For(ReleaseNotes.Parse(FixtureChangelog), newer.SemVer), newer);
            yield return Wait(0.8f);
            yield return Capture("whats-new-fixture-all-sections");
            sheet?.Close();

            sheet = WhatsNewSheet.Open(version, ReleaseNotes.For(ReleaseNotes.Parse(UnreleasedOnly), ReleaseInfo.SemVer), ReleaseInfo.Current);
            yield return Wait(0.8f);
            yield return Capture("whats-new-fixture-unreleased-only");
            sheet?.Close();

            sheet = WhatsNewSheet.Open(version, new ReleaseNotes.Notes(), ReleaseInfo.Current);
            yield return Wait(0.8f);
            yield return Capture("whats-new-fixture-empty");
            sheet?.Close();

            Click(title.Q<Button>("menu-settings"));
            yield return Wait(0.8f);
            VisualElement about = title.Q<VisualElement>("settings-about");
            about?.GetFirstAncestorOfType<ScrollView>()?.ScrollTo(about);
            yield return Wait(0.5f);
            yield return Capture("title-settings-about");
            Click(title.Q<Button>("menu-new-game"));
            yield return Wait(0.8f);

            while (NewGameWizard.Last == null) yield return null;
            NewGameWizard wizard = NewGameWizard.Last;
            while (wizard.SelectedWorldId == null) yield return null;
            yield return Await(wizard.UseDefaults(false));
            yield return Await(wizard.StartGame());
            while (EngineGame.Current == null || ShellController.Current == null) yield return null;
            yield return Wait(2.5f);
            yield return Capture("game-sidebar");
            ShellController.Current.Shell.Collapsed = true;
            yield return Wait(0.5f);
            yield return Capture("game-sidebar-collapsed");
            ShellController.Current.Shell.Collapsed = false;
            ShellController.Current.Navigator.Go(ShellRoute.To("settings"));
            yield return Wait(1.2f);
            VisualElement gameRoot = ShellController.Current.GetComponent<UIDocument>().rootVisualElement;
            VisualElement gameAbout = gameRoot.Q<VisualElement>("settings-about");
            if (gameAbout != null) ShellController.Current.Shell.Scroll.ScrollTo(gameAbout);
            yield return Wait(0.5f);
            yield return Capture("game-settings-about");
            Button whatsNew = gameRoot.Q<Button>("about-whats-new");
            Click(whatsNew);
            yield return Wait(0.8f);
            yield return Capture("game-whats-new");

            Debug.Log($"[ReleaseShots] done: {folder}");
            Application.Quit(0);
        }

        private void GiveUp()
        {
            Debug.LogError("[ReleaseShots] timed out");
            Application.Quit(1);
        }

        private static void Click(Button button)
        {
            if (button == null)
            {
                Debug.LogWarning("[ReleaseShots] button not found");
                return;
            }
            using (NavigationSubmitEvent submit = NavigationSubmitEvent.GetPooled())
            {
                submit.target = button;
                button.SendEvent(submit);
            }
        }

        private static IEnumerator Wait(float seconds)
        {
            yield return new WaitForSecondsRealtime(seconds);
        }

        private static IEnumerator Await(Task task)
        {
            while (!task.IsCompleted) yield return null;
            if (task.IsFaulted) Debug.LogException(task.Exception);
        }

        private IEnumerator Capture(string name)
        {
            yield return new WaitForEndOfFrame();
            index++;
            string path = Path.Combine(folder, $"{index:00}-{name}-{Screen.width}x{Screen.height}.png");
            ScreenCapture.CaptureScreenshot(path);
            yield return null;
            yield return null;
            Debug.Log($"[ReleaseShots] {path}");
        }
    }
}
