using System;
using System.Collections;
using System.IO;
using System.Linq;
using RingsideBooker.UI.Design;
using UnityEngine;
using UnityEngine.SceneManagement;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Mockups
{
    /// <summary>
    /// Opens the mockups and, with a folder, takes the screenshot tour for the owner's review:
    /// <c>RingsideBooker.exe -screen-width 1920 -screen-height 1080 -screen-fullscreen 0 -rbMockupShots "&lt;win dir&gt;"</c>
    /// saves one PNG per mockup state (shell, Office, Roster cards and table, Booking, Show night,
    /// Results, the style guide and components) and quits. <c>-rbMockups</c> just opens them.
    /// </summary>
    public sealed class MockupShots : MonoBehaviour
    {
        public const string OpenArgument = "-rbMockups";
        public const string ShotsArgument = "-rbMockupShots";

        private string folder;
        private int index;

        /// <summary>True during the tour: tickers and reveals hold still so the shots are stable.</summary>
        public static bool Running { get; private set; }

        /// <summary>True when the command line asks for the mockups (Boot opens them instead of the title).</summary>
        public static bool Requested
        {
            get
            {
                string[] args = Environment.GetCommandLineArgs();
                return args.Any(arg => string.Equals(arg, OpenArgument, StringComparison.OrdinalIgnoreCase) ||
                                       string.Equals(arg, ShotsArgument, StringComparison.OrdinalIgnoreCase));
            }
        }

        public static void OpenScene() => SceneManager.LoadScene(MockupController.SceneName);

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void StartIfAsked()
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (!string.Equals(args[i], ShotsArgument, StringComparison.OrdinalIgnoreCase)) continue;
                if (Application.isBatchMode) return;
                var host = new GameObject("MockupShots");
                DontDestroyOnLoad(host);
                host.AddComponent<MockupShots>().folder = args[i + 1];
                Running = true;
                return;
            }
        }

        private IEnumerator Start()
        {
            Invoke(nameof(GiveUp), 180f);
            Directory.CreateDirectory(folder);
            while (MockupController.Current == null) yield return null;
            MockupController mock = MockupController.Current;
            yield return Wait(1.5f);

            yield return Capture("office");
            mock.Shell.Collapsed = true;
            yield return Wait(0.6f);
            yield return Capture("office-sidebar-collapsed");
            mock.Shell.Collapsed = false;
            yield return Wait(0.6f);
            yield return HoverWhy(mock.Shell.Root.Q<VisualElement>("score-cash"), MockupWhy.Cash);
            yield return Capture("office-why-hover");
            Unhover(mock.Shell.Root.Q<VisualElement>("score-cash"));

            mock.RosterView = "cards";
            mock.Show(MockupScreens.Roster);
            yield return Wait(1f);
            yield return Capture("roster-cards");

            mock.RosterView = "table";
            mock.Show(MockupScreens.Roster);
            yield return Wait(0.6f);
            MockWorker voss = MockupData.Get("Calder Voss");
            RosterMockup.LastTable.SetExpanded(voss, true);
            yield return Wait(0.6f);
            VisualElement popularityCell = RosterMockup.LastTable.Query<VisualElement>(className: "mk-pop-cell").First();
            yield return HoverWhy(popularityCell, MockupWhy.WorkerPopularity(voss));
            yield return Capture("roster-table-expanded-why");
            Unhover(popularityCell);

            RosterMockup.LastTable.OpenColumnPicker(RosterMockup.LastTable.Q<Button>("table-columns"));
            yield return Wait(0.6f);
            yield return Capture("roster-table-column-picker");
            mock.Shell.Overlay.CloseAll();

            RosterMockup.OpenWorker(mock, MockupData.Get("Sable Whitcombe"));
            yield return Wait(0.8f);
            yield return Capture("roster-worker-sheet");
            mock.Shell.Overlay.CloseAll();

            mock.Show(MockupScreens.Booking);
            yield return Wait(1f);
            yield return Capture("booking-fight-card");
            BookingMockup.OpenChecklist(BookingMockup.LastChecklist, MockupData.ShowcaseCard());
            yield return Wait(0.6f);
            yield return Capture("booking-checklist-problem");
            mock.Shell.Overlay.CloseAll();

            mock.Show(MockupScreens.ShowNight);
            yield return Wait(1f);
            yield return Capture("show-night");

            mock.Show(MockupScreens.Results);
            yield return Wait(1.2f);
            yield return Capture("results");
            DsOverlay.OpenWhy(ResultsMockup.GradeWhyHost, MockupWhy.ShowGrade);
            yield return Wait(0.8f);
            yield return Capture("results-why-sheet");
            mock.Shell.Overlay.CloseAll();

            mock.Show(MockupScreens.StyleGuide);
            yield return Wait(1f);
            yield return Capture("style-guide");

            mock.Show(MockupScreens.Components);
            yield return Wait(0.8f);
            yield return HoverWhy(ComponentsMockup.WhyDemoHost, MockupWhy.Attendance);
            yield return Capture("components");
            DsTooltip.Hide();
            ComponentsMockup.OpenModal(mock);
            DsOverlay.Toast(mock.Shell.Root, "Card saved", DsState.Good, "Altura Showcase: 9 of 9 booked.", 0);
            yield return Wait(0.8f);
            yield return Capture("components-modal-toast");
            mock.Shell.Overlay.CloseAll();

            Debug.Log($"[MockupShots] done: {folder}");
            Application.Quit(0);
        }

        /// <summary>Shows a host's quiet Why? as if hovered, with its tooltip.</summary>
        private static IEnumerator HoverWhy(VisualElement host, WhyBreakdown why)
        {
            if (host == null) yield break;
            host.AddToClassList("ds-why-host--hover");
            yield return Wait(0.3f);
            Button button = host.Q<Button>(className: "ds-why");
            if (button != null) DsTooltip.ShowNow(button, why.Preview, $"Why {why.ValueText}?");
            yield return Wait(0.5f);
        }

        private static void Unhover(VisualElement host)
        {
            host?.RemoveFromClassList("ds-why-host--hover");
            DsTooltip.Hide();
        }

        private void GiveUp()
        {
            Debug.LogError("[MockupShots] timed out");
            Application.Quit(1);
        }

        private static IEnumerator Wait(float seconds)
        {
            yield return new WaitForSecondsRealtime(seconds);
        }

        private IEnumerator Capture(string name)
        {
            yield return new WaitForEndOfFrame();
            index++;
            string path = Path.Combine(folder, $"{index:00}-{name}-{Screen.width}x{Screen.height}.png");
            ScreenCapture.CaptureScreenshot(path);
            yield return null;
            yield return null;
            Debug.Log($"[MockupShots] {path}");
        }
    }
}
