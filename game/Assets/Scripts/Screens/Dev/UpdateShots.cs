using System;
using System.Collections;
using System.IO;
using System.Threading.Tasks;
using RingsideBooker.Release;
using RingsideBooker.Release.Updates;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Title;
using RingsideBooker.UI.Updates;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Dev
{
    /// <summary>
    /// A developer tour of the update check (POL9-11): run the player with
    /// <c>-rbUpdateShots &lt;folder&gt;</c>. It writes a fake release list and a fake installer (a
    /// dummy file, never run) into <c>&lt;folder&gt;/fake-feed</c>, feeds them to
    /// <see cref="UpdateService.UseFakeFeed"/> (no network), and captures: the title chip, the sheet,
    /// the downloaded-and-checked step, a size-check failure, Settings › About (title), Skip this
    /// version, then in a new default-world game Settings › About and the "Save and install" step.
    /// It ends by pressing Save and install: the game saves through its normal save, logs the
    /// installer it would start (fake runs never start one) and quits through the normal quit.
    /// Exit 0 = every check passed; 1 = a check failed or the tour timed out.
    /// </summary>
    public sealed class UpdateShots : MonoBehaviour
    {
        public const string Argument = "-rbUpdateShots";

        private string folder;
        private int index;
        private int failures;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void StartIfAsked()
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (!string.Equals(args[i], Argument, StringComparison.OrdinalIgnoreCase)) continue;
                if (Application.isBatchMode) return;
                var host = new GameObject("UpdateShots");
                DontDestroyOnLoad(host);
                host.AddComponent<UpdateShots>().folder = args[i + 1];
                return;
            }
        }

        /// <summary>The next alpha after this build (0.1.0-alpha.2 → 0.1.0-alpha.3), so the fake release is newer.</summary>
        private static string NextVersion()
        {
            SemVersion current = SemVersion.Parse(ReleaseInfo.SemVer) ?? SemVersion.Parse("0.1.0-alpha.1");
            string core = $"{current.Major}.{current.Minor}.{current.Patch}";
            if (current.IsPreRelease && int.TryParse(current.PreRelease[current.PreRelease.Count - 1], out int number))
            {
                return $"{core}-{current.PreLabel}.{number + 1}";
            }
            return $"{current.Major}.{current.Minor}.{current.Patch + 1}-alpha.1";
        }

        private static string Feed(string version, string installerName, long size) =>
            "[{\"tag_name\":\"v" + version + "\",\"name\":\"Ringside Booker " + version + "\",\"draft\":false,\"prerelease\":true," +
            "\"html_url\":\"https://github.com/jpDxsoloOrg/ringside-booker/releases/tag/v" + version + "\"," +
            "\"published_at\":\"2026-11-27T18:30:00Z\"," +
            "\"body\":\"### Added\\n\\n- I added an update check: a quiet chip on the title screen and in Settings › About.\\n- I added Download and install, which saves your game first.\\n\\n### Fixed\\n\\n- I fixed long show names running under the close button.\\n\\n### Heads up\\n\\n- This is a fake release for the screenshot tour.\"," +
            "\"assets\":[{\"name\":\"" + installerName + "\",\"size\":" + size + ",\"browser_download_url\":\"" + installerName + "\"}]}," +
            "{\"tag_name\":\"v9.9.9-alpha.1\",\"name\":\"A draft\",\"draft\":true,\"prerelease\":true,\"html_url\":\"\",\"published_at\":null,\"body\":\"\",\"assets\":[]}]";

        private IEnumerator Start()
        {
            Invoke(nameof(GiveUp), 240f);
            Directory.CreateDirectory(folder);
            string feedFolder = Path.Combine(folder, "fake-feed");
            Directory.CreateDirectory(feedFolder);
            string next = NextVersion();
            string installerName = $"RingsideBooker-Setup-{next}+fake0000.exe";
            // A dummy payload, never run: fake runs only log the installer they would start.
            var payload = new byte[3 * 1024 * 1024];
            for (int i = 0; i < payload.Length; i++) payload[i] = (byte)(i * 31);
            File.WriteAllBytes(Path.Combine(feedFolder, installerName), payload);
            string goodFeed = Path.Combine(feedFolder, "releases.json");
            string badFeed = Path.Combine(feedFolder, "releases-wrong-size.json");
            File.WriteAllText(goodFeed, Feed(next, installerName, payload.Length));
            File.WriteAllText(badFeed, Feed(next, installerName, payload.Length + 4096));

            Debug.Log($"[UpdateShots] {ReleaseInfo.Version} channel {ReleaseInfo.Channel}; fake release {next}");
            while (UnityEngine.SceneManagement.SceneManager.GetActiveScene().name != SceneFlow.TitleScene) yield return null;
            UpdatePrefs.Skipped = string.Empty;
            UpdateService.UseFakeFeed(goodFeed);
            yield return Wait(1.5f);
            VisualElement title = FindAnyObjectByType<TitleController>().GetComponent<UIDocument>().rootVisualElement;

            Button chip = title.Q<Button>(UpdateUi.ChipName);
            Check(chip != null && chip.resolvedStyle.display == DisplayStyle.Flex, "title chip shows");
            Check(chip != null && chip.Q<Label>().text == $"Update available: v{next}", "chip text");
            yield return Capture("title-chip");

            Click(chip);
            yield return Wait(0.8f);
            Check(UpdateSheet.Current?.Stage == UpdateSheet.Stage.Offer, "sheet opens on the offer");
            yield return Capture("sheet-offer");

            UpdateSheet.Current?.StartDownload();
            yield return null;
            yield return Capture("sheet-downloading");
            yield return WaitForStage(UpdateSheet.Stage.Ready);
            Check(UpdateSheet.Current?.Stage == UpdateSheet.Stage.Ready, "download ok and size checked");
            Check(title.Q<Button>("update-install")?.Q<Label>()?.text == "INSTALL NOW", "no game: Install now");
            yield return Capture("sheet-ready-title");
            CloseTop(title);
            yield return Wait(0.5f);

            UpdateService.UseFakeFeed(badFeed);
            Click(title.Q<Button>(UpdateUi.ChipName));
            yield return Wait(0.6f);
            UpdateSheet.Current?.StartDownload();
            yield return WaitForStage(UpdateSheet.Stage.Failed);
            Check(UpdateSheet.Current?.Stage == UpdateSheet.Stage.Failed, "size mismatch fails");
            Check(title.Q<Button>("update-open-page") != null, "failure offers the download page");
            yield return Capture("sheet-size-mismatch");
            Click(title.Q<Button>("update-open-page"));
            CloseTop(title);
            UpdateService.UseFakeFeed(goodFeed);
            yield return Wait(0.5f);

            Click(title.Q<Button>("menu-settings"));
            yield return Wait(0.8f);
            VisualElement about = title.Q<VisualElement>("settings-about");
            about?.GetFirstAncestorOfType<ScrollView>()?.ScrollTo(title.Q<VisualElement>("settings-update") ?? about);
            yield return Wait(0.5f);
            Check(title.Q<Button>("update-automatic") != null, "About has the automatic setting");
            Check(title.Q<Label>("update-status")?.text == $"Version {next} is out.", "About status");
            yield return Capture("title-settings-about");

            // Skip this version hides both chips; a manual Check now brings it back.
            Click(title.Q<Button>(UpdateUi.ChipName));
            yield return Wait(0.6f);
            Click(title.Q<Button>("update-skip"));
            yield return Wait(0.6f);
            Check(!UpdateService.ShowChip, "skip hides the chip");
            yield return Capture("title-settings-skipped");
            Click(title.Q<Button>("update-check-now"));
            yield return Wait(0.6f);
            Check(UpdateService.ShowChip, "Check now forgets the skip");

            Click(title.Q<Button>("menu-new-game"));
            yield return Wait(0.8f);
            while (NewGameWizard.Last == null) yield return null;
            NewGameWizard wizard = NewGameWizard.Last;
            while (wizard.SelectedWorldId == null) yield return null;
            yield return Await(wizard.UseDefaults(false));
            yield return Await(wizard.StartGame());
            while (EngineGame.Current == null || ShellController.Current == null) yield return null;
            yield return Wait(2.5f);
            VisualElement gameRoot = ShellController.Current.GetComponent<UIDocument>().rootVisualElement;
            Check(gameRoot.Q<Button>(UpdateUi.ChipName) == null, "no chip or popup on the game's screens");
            ShellController.Current.Navigator.Go(ShellRoute.To("settings"));
            yield return Wait(1.2f);
            VisualElement gameUpdate = gameRoot.Q<VisualElement>("settings-update");
            if (gameUpdate != null) ShellController.Current.Shell.Scroll.ScrollTo(gameUpdate);
            yield return Wait(0.5f);
            yield return Capture("game-settings-about");

            Click(gameRoot.Q<Button>(UpdateUi.ChipName));
            yield return Wait(0.8f);
            UpdateSheet.Current?.StartDownload();
            yield return WaitForStage(UpdateSheet.Stage.Ready);
            Check(gameRoot.Q<Button>("update-install")?.Q<Label>()?.text == "SAVE AND INSTALL", "a game is open: Save and install");
            yield return Capture("game-sheet-ready");

            if (failures > 0)
            {
                Debug.LogError($"[UpdateShots] FAILED ({failures} checks)");
                Application.Quit(1);
                yield break;
            }
            Debug.Log($"[UpdateShots] PASSED; pressing Save and install (fake: saves, logs, quits): {folder}");
            Click(gameRoot.Q<Button>("update-install"));
        }

        private IEnumerator WaitForStage(UpdateSheet.Stage stage)
        {
            float until = Time.realtimeSinceStartup + 20f;
            while (UpdateSheet.Current != null && UpdateSheet.Current.Stage != stage && Time.realtimeSinceStartup < until) yield return null;
            yield return Wait(0.4f);
        }

        private void Check(bool ok, string what)
        {
            if (ok)
            {
                Debug.Log($"[UpdateShots] ok: {what}");
                return;
            }
            failures++;
            Debug.LogError($"[UpdateShots] FAILED: {what}");
        }

        private static void CloseTop(VisualElement root)
        {
            OverlayLayer layer = OverlayLayer.Of(root.Q<VisualElement>(OverlayLayer.ElementName) ?? root);
            if (layer != null && layer.Count > 0) layer.CloseTop();
        }

        private void GiveUp()
        {
            Debug.LogError("[UpdateShots] timed out");
            Application.Quit(1);
        }

        private static void Click(Button button)
        {
            if (button == null)
            {
                Debug.LogWarning("[UpdateShots] button not found");
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
            Debug.Log($"[UpdateShots] {path}");
        }
    }
}
