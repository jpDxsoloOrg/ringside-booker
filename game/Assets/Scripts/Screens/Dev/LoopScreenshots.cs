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
            ResultsScreen.InstantReveal = true;
            while (UnityEngine.SceneManagement.SceneManager.GetActiveScene().name != SceneFlow.TitleScene) yield return null;
            yield return Wait(1.5f);
            yield return Capture("title-new-game");
            yield return TitleCredits();

            while (NewGameWizard.Last == null) yield return null;
            NewGameWizard wizard = NewGameWizard.Last;
            while (wizard.SelectedWorldId == null) yield return null;
            yield return Wait(0.5f);
            if (!workshop) yield return Capture("new-game-world");
            yield return Await(wizard.UseDefaults(workshop));
            yield return Wait(0.5f);
            // Every wizard step (UNITY-13): promotion, options (top and scrolled to the end) and
            // the options with Advanced open.
            wizard.ShowStep(1);
            yield return Wait(0.5f);
            yield return Capture("new-game-promotion");
            wizard.ShowFoundExample();
            yield return Wait(0.5f);
            yield return Capture("new-game-found");
            yield return ScrollToEnd(wizard.Body);
            yield return Capture("new-game-found-end");
            bool foundGame = Array.Exists(Environment.GetCommandLineArgs(), arg => string.Equals(arg, "-rbLoopFound", StringComparison.OrdinalIgnoreCase));
            if (!foundGame) wizard.ShowTakeOver();
            yield return Wait(0.3f);
            wizard.ShowStep(2);
            yield return Wait(0.5f);
            yield return Capture("new-game-options");
            yield return ScrollToEnd(wizard.Body);
            yield return Capture("new-game-options-end");
            wizard.ShowStep(2, advanced: true);
            yield return Wait(0.3f);
            yield return ScrollToEnd(wizard.Body);
            yield return Capture("new-game-options-advanced");
            wizard.ShowStep(2);
            yield return Wait(0.3f);
            if (Array.Exists(Environment.GetCommandLineArgs(), arg => string.Equals(arg, "-rbLoopWizardOnly", StringComparison.OrdinalIgnoreCase)))
            {
                Debug.Log($"[LoopScreenshots] done (wizard only): {folder}");
                Application.Quit(0);
                yield break;
            }
            if (workshop) Debug.Log($"[LoopScreenshots] import report: {(NewGameWizard.Last.ImportNotice ?? "none")}");
            yield return Await(NewGameWizard.Last.StartGame());

            while (EngineGame.Current == null || ShellController.Current == null) yield return null;
            yield return Wait(2f);
            yield return Capture("office");
            if (Array.Exists(Environment.GetCommandLineArgs(), arg => string.Equals(arg, "-rbLoopFound", StringComparison.OrdinalIgnoreCase)))
            {
                // A founded promotion (UNITY-20): its office and its first show's empty card, then stop.
                Go(ShellRoute.To("booking"));
                yield return Wait(2f);
                yield return Capture("found-booking");
                Debug.Log($"[LoopScreenshots] done (founded promotion {EngineGame.Current?.PromotionId}): {folder}");
                Application.Quit(0);
                yield break;
            }

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
            ClickNamed("booking-venue");
            yield return WaitIdle(2f);
            yield return Capture("booking-venue-picker");
            ShellController.Current.Overlay.CloseAll();
            ClickNamed("booking-autofill");
            yield return WaitIdle(4f);
            yield return Capture("booking-filled");
            ClickNamed("booking-checklist");
            yield return Wait(0.8f);
            yield return Capture("booking-checklist");
            ShellController.Current.Overlay.CloseAll();
            ClickNamed("slot-card-main-0");
            yield return Wait(0.6f);
            ClickNamed("booking-more");
            yield return WaitIdle(1.5f);
            yield return Capture("booking-more-options");
            ClickNamed("booking-edit");
            yield return WaitIdle(1.5f);
            yield return Capture("segment-editor");
            if (SegmentEditor.Current != null)
            {
                ClickNamed("editor-add-team-0");
                yield return Wait(0.8f);
                yield return Capture("team-picker");
                ShellController.Current.Overlay.CloseAll();
            }
            ShellController.Current.Overlay.CloseAll();
            // A talking segment's beats editor, on the first talking segment the card has.
            VisualElement angleCard = Q<VisualElement>(element => element.name != null && element.name.StartsWith("slot-card-") &&
                element.Q<VisualElement>(className: "ds-match__segment-gap") != null);
            if (angleCard != null)
            {
                ClickNamed(angleCard.name);
                yield return Wait(0.6f);
                yield return Capture("booking-angle-details");
                ClickNamed("booking-edit");
                yield return WaitIdle(2f);
                yield return Capture("angle-editor");
                ShellController.Current.Overlay.CloseAll();
            }
            yield return Wait(0.5f);

            ClickNamed("booking-run");
            yield return Wait(1.5f);
            yield return Capture("show-night-ready");
            ClickNamed("show-run-next");
            yield return WaitIdle(2f);
            yield return Capture("show-night-live");
            ClickNamed("show-sim-rest");
            yield return WaitIdle(3f);
            yield return Capture("show-over");
            ClickNamed("show-see-results");
            yield return WaitIdle(3f);
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

        /// <summary>Title › Settings › Credits &amp; licences with the notices summary open, then back to New game.</summary>
        private IEnumerator TitleCredits()
        {
            VisualElement root = FindAnyObjectByType<UI.Title.TitleController>()?.GetComponent<UIDocument>().rootVisualElement;
            if (root == null) yield break;
            Click(root.Q<Button>("menu-settings"));
            yield return Wait(0.6f);
            VisualElement credits = root.Q<VisualElement>("settings-credits");
            Button first = credits?.Q<Button>(className: "choice-chip");
            Click(first);
            yield return Wait(0.6f);
            yield return Wait(0.4f);
            yield return Capture("title-credits");
            Click(root.Q<Button>("menu-new-game"));
            yield return Wait(1f);
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

        /// <summary>Presses any element by name (buttons, skewed CTAs, cards) with a submit event.</summary>
        private static void ClickNamed(string name)
        {
            VisualElement element = Q<VisualElement>(candidate => candidate.name == name);
            if (element == null) return;
            if (element is Button button)
            {
                Click(button);
                return;
            }
            using (NavigationSubmitEvent submit = NavigationSubmitEvent.GetPooled())
            {
                submit.target = element;
                element.SendEvent(submit);
            }
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

        private static IEnumerator ScrollToEnd(ScrollView scroll)
        {
            yield return Wait(0.3f);
            if (scroll == null) yield break;
            scroll.scrollOffset = new Vector2(0, Mathf.Max(0, scroll.contentContainer.layout.height - scroll.contentViewport.layout.height));
            yield return Wait(0.4f);
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
