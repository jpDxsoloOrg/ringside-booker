using System;
using System.Collections;
using System.IO;
using System.Threading.Tasks;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Why;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Dev
{
    /// <summary>
    /// A developer tour of the core loop with the real engine (UNITY-09), alongside UNITY-07's
    /// <c>-rbShots</c> shell tour: run the player with <c>-rbLoopShots &lt;folder&gt;</c> and it starts a
    /// new game with the wizard's defaults, visits Office, Roster (and Set push), Calendar, Booking
    /// (Auto-fill, the segment editor), goes live (run one segment, sim the rest), opens the results
    /// and a Why?, then presses Next day, saving a PNG at each step, and quits (exit 1 on a failure).
    /// </summary>
    public sealed class LoopScreenshots : MonoBehaviour
    {
        public const string Argument = "-rbLoopShots";

        private string folder;
        private bool workshop;
        private int index;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void StartIfAsked()
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (!string.Equals(args[i], Argument, StringComparison.OrdinalIgnoreCase)) continue;
                if (Application.isBatchMode) return;
                var host = new GameObject("LoopScreenshots");
                DontDestroyOnLoad(host);
                LoopScreenshots tour = host.AddComponent<LoopScreenshots>();
                tour.folder = args[i + 1];
                tour.workshop = Array.Exists(args, arg => string.Equals(arg, "-rbLoopWorkshop", StringComparison.OrdinalIgnoreCase));
                return;
            }
        }

        private IEnumerator Start()
        {
            Invoke(nameof(GiveUp), workshop ? 600f : 240f);
            Directory.CreateDirectory(folder);
            while (UnityEngine.SceneManagement.SceneManager.GetActiveScene().name != SceneFlow.TitleScene) yield return null;
            yield return Wait(1.5f);
            yield return Capture("title-new-game");

            while (NewGameWizard.Last == null) yield return null;
            yield return Await(NewGameWizard.Last.UseDefaults(workshop));
            yield return Wait(0.5f);
            yield return Capture("new-game-options");
            if (workshop) Debug.Log($"[LoopScreenshots] import report: {(NewGameWizard.Last.ImportNotice ?? "none")}");
            yield return Await(NewGameWizard.Last.StartGame());

            while (EngineGame.Current == null || ShellController.Current == null) yield return null;
            yield return Wait(2f);
            yield return Capture("office");

            Go(ShellRoute.To("roster"));
            yield return Wait(1.5f);
            yield return Capture("roster");
            Click(Q<Button>(button => button.name.StartsWith("set-push-emp")));
            yield return Wait(0.6f);
            yield return Capture("set-push");
            ShellController.Current.Overlay.CloseAll();

            Go(ShellRoute.To("calendar"));
            yield return Wait(1.5f);
            yield return Capture("calendar");

            Go(ShellRoute.To("booking"));
            yield return Wait(1.5f);
            yield return Capture("booking-empty");
            Click(Q<Button>(button => button.name == "booking-autofill"));
            yield return WaitIdle(4f);
            yield return Capture("booking-filled");
            Click(Q<Button>(button => button.name == "edit-0"));
            yield return Wait(1.2f);
            yield return Capture("segment-editor");
            ShellController.Current.Overlay.CloseAll();

            Click(Q<Button>(button => button.name == "booking-run"));
            yield return Wait(1.5f);
            yield return Capture("show-night-ready");
            Click(Q<Button>(button => button.name == "show-run-next"));
            yield return WaitIdle(2f);
            yield return Capture("show-night-live");
            Click(Q<Button>(button => button.name == "show-sim-rest"));
            yield return WaitIdle(3f);
            yield return Capture("show-over");
            Click(Q<Button>(button => button.name == "show-see-results"));
            yield return Wait(2.5f);
            yield return Capture("results");
            Q<WhyButton>(button => true)?.OpenPanel();
            yield return Wait(1f);
            yield return Capture("results-why");
            WhyPanelHost.CloseCurrent();
            ShellController.Current.Overlay.CloseAll();

            IDayControl day = ShellServices.Day;
            day.NextDay();
            yield return Wait(0.3f);
            while (day.Advancing) yield return null;
            yield return Wait(1.5f);
            yield return Capture("next-day");

            Debug.Log($"[LoopScreenshots] done: {folder}");
            Application.Quit(0);
        }

        private void GiveUp()
        {
            Debug.LogError("[LoopScreenshots] timed out");
            Application.Quit(1);
        }

        private static void Go(ShellRoute route) => ShellController.Current.Navigator.Go(route);

        private static T Q<T>(Func<T, bool> match) where T : VisualElement
        {
            VisualElement root = ShellController.Current != null
                ? ShellController.Current.GetComponent<UIDocument>().rootVisualElement
                : null;
            T found = null;
            root?.Query<T>().ForEach(element =>
            {
                if (found == null && match(element)) found = element;
            });
            if (found == null) Debug.LogWarning($"[LoopScreenshots] no {typeof(T).Name} found");
            return found;
        }

        private static void Click(Button button)
        {
            if (button == null) return;
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

        /// <summary>Waits until the engine is idle (commands done), then a little longer for the redraw.</summary>
        private static IEnumerator WaitIdle(float atLeast)
        {
            yield return new WaitForSecondsRealtime(0.5f);
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
            Debug.Log($"[LoopScreenshots] {path}");
        }
    }
}
