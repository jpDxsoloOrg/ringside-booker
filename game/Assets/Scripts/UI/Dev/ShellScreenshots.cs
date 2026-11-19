using System;
using System.Collections;
using System.IO;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Demo;
using RingsideBooker.UI.Shell;
using UnityEngine;

namespace RingsideBooker.UI.Dev
{
    /// <summary>
    /// A developer smoke tour of the UI: run the player with <c>-rbShots &lt;folder&gt;</c> and it
    /// captures the title screen, the shell, a skip in progress, the Last advance summary, a stop's
    /// destination and the Skip days sheet as PNGs, then quits. Does nothing without the argument.
    /// Example (from game/): <c>Builds/Windows/RingsideBooker.exe -screen-width 1280 -screen-height 720
    /// -screen-fullscreen 0 -rbShots "C:\temp\shots"</c>.
    /// </summary>
    public sealed class ShellScreenshots : MonoBehaviour
    {
        public const string Argument = "-rbShots";

        private string folder;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void StartIfAsked()
        {
            string folder = ArgumentValue(Argument);
            if (string.IsNullOrEmpty(folder) || Application.isBatchMode) return;
            var host = new GameObject("ShellScreenshots");
            DontDestroyOnLoad(host);
            host.AddComponent<ShellScreenshots>().folder = folder;
        }

        private IEnumerator Start()
        {
            // A tour that breaks part-way must not leave the player running.
            Invoke(nameof(GiveUp), 90f);
            Directory.CreateDirectory(folder);
            yield return WaitForScene(SceneFlow.TitleScene);
            yield return new WaitForSecondsRealtime(1.5f);
            yield return Capture("01-title");

            DemoGame.Install();
            SceneFlow.LoadGame();
            yield return WaitForScene(SceneFlow.GameScene);
            yield return new WaitForSecondsRealtime(1f);
            yield return Capture("02-shell");
            // UNITY-11: the sidebar as an icon rail, then back (the setting is remembered).
            bool wasCollapsed = ShellController.Current.Shell.Collapsed;
            ShellController.Current.Shell.Collapsed = true;
            yield return new WaitForSecondsRealtime(0.6f);
            yield return Capture("02b-shell-collapsed");
            ShellController.Current.Shell.Collapsed = wasCollapsed;
            yield return new WaitForSecondsRealtime(0.4f);

            IDayControl day = ShellServices.Day;
            ShellController.Current.OpenSkipDays();
            yield return new WaitForSecondsRealtime(0.6f);
            yield return Capture("03-skip-days");
            ShellController.Current.Overlay.CloseAll();

            day.Skip(new AdvanceRequest(30));
            yield return new WaitForSecondsRealtime(0.15f);
            yield return Capture("04-advancing");
            while (day.Advancing) yield return null;
            yield return new WaitForSecondsRealtime(0.5f);
            yield return Capture("05-stopped");

            ShellController.Current.Navigator.Go("contracts");
            yield return new WaitForSecondsRealtime(0.5f);
            yield return Capture("06-placeholder");

            ShellController.Current.Navigator.Go("settings");
            yield return new WaitForSecondsRealtime(0.5f);
            yield return Capture("07-settings");

            Debug.Log($"[ShellScreenshots] done: {folder}");
            Application.Quit(0);
        }

        private void GiveUp()
        {
            Debug.LogError("[ShellScreenshots] timed out");
            Application.Quit(1);
        }

        private IEnumerator Capture(string name)
        {
            yield return new WaitForEndOfFrame();
            string path = Path.Combine(folder, $"{name}-{Screen.width}x{Screen.height}.png");
            ScreenCapture.CaptureScreenshot(path);
            yield return null;
            yield return null;
            Debug.Log($"[ShellScreenshots] {path}");
        }

        private static IEnumerator WaitForScene(string sceneName)
        {
            while (UnityEngine.SceneManagement.SceneManager.GetActiveScene().name != sceneName) yield return null;
        }

        private static string ArgumentValue(string name)
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int index = 0; index < args.Length - 1; index++)
            {
                if (string.Equals(args[index], name, StringComparison.OrdinalIgnoreCase)) return args[index + 1];
            }
            return null;
        }
    }
}
