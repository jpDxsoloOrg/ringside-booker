using System;
using System.Collections;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Threading.Tasks;
using RingsideBooker.Diagnostics;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Crash;
using RingsideBooker.UI.Shell;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Dev
{
    /// <summary>
    /// A developer tour of crash safety (UNITY-24, POL1-02): run the player with
    /// <c>-rbCrashShots &lt;folder&gt;</c>. Mail drafts are logged, not opened. It captures the title's
    /// Send feedback, starts a default-world game, shows the load notice banner (sample text, closed
    /// and open), forces an engine fault (as <c>-rbForceEngineFault</c> does) and captures the
    /// engine-stopped screen, its error details and Send feedback (logging the zip's entries), reloads
    /// the last save, forces a second fault, picks Start safe and captures the safe-start panel, then
    /// Settings' Feedback group. Logs <c>[CrashShots]</c>; exit 0 when every step passed, 1 otherwise.
    /// </summary>
    public sealed class CrashShots : MonoBehaviour
    {
        public const string Argument = "-rbCrashShots";

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
                var host = new GameObject("CrashShots");
                DontDestroyOnLoad(host);
                host.AddComponent<CrashShots>().folder = args[i + 1];
                return;
            }
        }

        private IEnumerator Start()
        {
            Invoke(nameof(GiveUp), 300f);
            Directory.CreateDirectory(folder);
            MailtoFeedback.Opener = url => Log("mail draft (not opened): " + url.Substring(0, Math.Min(url.Length, 160)) + "…");
            while (SceneManager.GetActiveScene().name != SceneFlow.TitleScene) yield return null;
            while (NewGameWizard.Last == null) yield return null;
            yield return Wait(1.5f);

            // A crash streak left by earlier runs would open the title on Start safe: not for this tour.
            if (Find("safe-start") != null) Log("note: the title opened on Start safe (crash streak " + CrashGuard.Streak + ")");

            // Title: Send feedback under the menu.
            yield return Capture("title");
            Click("title-feedback-send");
            yield return WaitFor(() => Find("title-feedback-path") != null, 20f, "title feedback result");
            yield return Wait(0.5f);
            yield return Capture("title-feedback");
            CheckZip(BugReport.LastZip, false);

            // A default-world game.
            yield return Await(NewGameWizard.Last.UseDefaults(false));
            yield return Await(NewGameWizard.Last.StartGame());
            while (EngineGame.Current == null || ShellController.Current == null) yield return null;
            yield return WaitIdle(2f);
            yield return Await(Saves.GameSession.Current?.SaveNowAsync() ?? Task.CompletedTask);
            yield return WaitIdle(1f);

            // The load notice banner (sample text: a real upgrade needs a save from an older format).
            LoadNotice.Show(new LoadNotice(
                new[] { "Adds venue capacity to old shows", "Moves contract bonuses into the ledger" },
                new[] { "tunables.match.injuryRate: this version no longer has this setting, so it was left out" }));
            yield return Wait(1f);
            Check(Find(LoadNoticeView.ElementName) != null, "load notice shown");
            yield return Capture("load-notice");
            Click("load-notice-toggle");
            yield return Wait(0.5f);
            yield return Capture("load-notice-details");
            Click("load-notice-dismiss");
            yield return Wait(0.5f);
            Check(Find(LoadNoticeView.ElementName) == null, "load notice dismissed");

            // First fault: the engine-stopped screen.
            var firstClient = EngineRuntime.Client;
            CrashDev.ForceFault();
            yield return WaitFor(() => EngineStoppedScreen.Root != null, 20f, "engine-stopped screen");
            yield return Wait(1f);
            Check(firstClient.IsStopped, "first client stopped");
            Check(Find("stopped-reload") != null, "Reload last save offered");
            Check(FindPrefix("stopped-backup-") != null, "Load a backup offered");
            yield return Capture("engine-stopped");
            Click("stopped-details-toggle");
            yield return Wait(0.5f);
            yield return Capture("engine-stopped-details");
            Click("stopped-details-toggle");
            Click("stopped-feedback-send");
            yield return WaitFor(() => Find("stopped-feedback-path") != null, 20f, "crash feedback result");
            yield return Wait(0.5f);
            yield return Capture("engine-stopped-feedback");
            CheckZip(BugReport.LastZip, true);

            // Reload last save: a fresh engine, the same slot.
            Click("stopped-reload");
            yield return WaitFor(() => !EngineStoppedScreen.IsShowing && EngineGame.Current != null && ShellController.Current != null, 40f, "reload");
            yield return WaitIdle(2f);
            Check(EngineRuntime.Client != null && EngineRuntime.Client != firstClient && !EngineRuntime.Client.IsStopped, "reloaded on a new engine");
            yield return Capture("reloaded");

            // Second fault: Start safe.
            CrashDev.ForceFault();
            yield return WaitFor(() => EngineStoppedScreen.Root != null, 20f, "second engine-stopped screen");
            yield return Wait(1f);
            Click("stopped-safe");
            yield return WaitFor(() => SceneManager.GetActiveScene().name == SceneFlow.TitleScene && Find(SafeStartPanel.ElementName) != null, 20f, "safe start");
            yield return Wait(1.5f);
            Check(FindPrefix("safe-backup-") != null, "safe start offers the backup");
            yield return Capture("safe-start");

            // Settings: Feedback & bug reports.
            Click("menu-settings");
            yield return Wait(1f);
            VisualElement group = Find("settings-feedback");
            Check(group != null, "settings feedback group");
            ScrollTo(group);
            Click("settings-feedback-save-report");
            yield return WaitFor(() => Find("settings-feedback-path") != null, 20f, "settings bug report");
            yield return Wait(0.5f);
            ScrollTo(Find("settings-feedback"));
            yield return Wait(0.3f);
            yield return Capture("settings-feedback");

            // The tour's forced faults must not leave the player's next start on Start safe.
            CrashGuard.Clear();
            Log(failures == 0 ? "PASSED" : $"FAILED ({failures} checks)");
            Application.Quit(failures == 0 ? 0 : 1);
        }

        private void CheckZip(string path, bool expectSave)
        {
            if (path == null || !File.Exists(path))
            {
                Check(false, "bug report zip exists");
                return;
            }

            using (var zip = new ZipArchive(File.OpenRead(path), ZipArchiveMode.Read))
            {
                string[] names = zip.Entries.Select(entry => entry.FullName).ToArray();
                Log($"zip {Path.GetFileName(path)} ({new FileInfo(path).Length / 1024} KB): {string.Join(", ", names)}");
                Check(names.Contains(BugReport.ReportEntry) && names.Contains(BugReport.VersionEntry) && names.Contains(BugReport.SettingsEntry), "zip has report, version and settings");
                Check(names.Any(name => name.EndsWith(".log", StringComparison.OrdinalIgnoreCase)), "zip has the log");
                if (expectSave) Check(names.Any(name => name.StartsWith("save/") && name.EndsWith(Saves.SaveStore.SaveExtension)), "zip has the save");
            }
        }

        private void Check(bool ok, string what)
        {
            if (!ok) failures++;
            Log((ok ? "ok: " : "FAIL: ") + what);
        }

        private static VisualElement Find(string name)
        {
            foreach (UIDocument document in FindObjectsByType<UIDocument>())
            {
                VisualElement found = document.rootVisualElement?.Q(name);
                if (found != null) return found;
            }

            return null;
        }

        private static VisualElement FindPrefix(string prefix)
        {
            foreach (UIDocument document in FindObjectsByType<UIDocument>())
            {
                VisualElement found = document.rootVisualElement?.Query<VisualElement>().Where(element => element.name != null && element.name.StartsWith(prefix, StringComparison.Ordinal)).First();
                if (found != null) return found;
            }

            return null;
        }

        private void Click(string name)
        {
            if (!(Find(name) is Button button))
            {
                Check(false, "button " + name);
                return;
            }

            using (NavigationSubmitEvent submit = NavigationSubmitEvent.GetPooled())
            {
                submit.target = button;
                button.SendEvent(submit);
            }
        }

        private static void ScrollTo(VisualElement element)
        {
            ScrollView scroll = element?.GetFirstAncestorOfType<ScrollView>();
            if (scroll == null) return;
            Vector2 local = scroll.contentContainer.WorldToLocal(element.worldBound.position);
            scroll.scrollOffset = new Vector2(0, Mathf.Max(0, local.y - 12));
        }

        private IEnumerator WaitFor(Func<bool> done, float seconds, string what)
        {
            float until = Time.realtimeSinceStartup + seconds;
            while (!done() && Time.realtimeSinceStartup < until) yield return null;
            Check(done(), what);
        }

        private static IEnumerator Wait(float seconds)
        {
            yield return new WaitForSecondsRealtime(seconds);
        }

        private static IEnumerator WaitIdle(float atLeast)
        {
            yield return new WaitForSecondsRealtime(0.4f);
            float until = Time.realtimeSinceStartup + 30f;
            while (EngineRuntime.Client != null && EngineRuntime.Client.IsBusy && Time.realtimeSinceStartup < until) yield return null;
            yield return new WaitForSecondsRealtime(atLeast);
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
            Log(path);
        }

        private static void Log(string text) => Debug.Log("[CrashShots] " + text);

        private void GiveUp()
        {
            Debug.LogError("[CrashShots] timed out");
            CrashGuard.Clear();
            Application.Quit(1);
        }
    }
}
