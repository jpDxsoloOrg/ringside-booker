using System;
using System.Collections;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.Screens.MatchLab;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Dev
{
    /// <summary>
    /// A developer tour of the UNITY-21 screens: run the player with <c>-rbLabShots &lt;folder&gt;</c> and
    /// it starts a default-world game, captures the Office (day one, then with the next card filled),
    /// then the Match lab: empty, a singles match run once, the same match over 50 runs (results,
    /// physical toll and aftermath scrolled into view), the More options panel and Angle mode with
    /// two beats run. Exits 0 when done, 1 on a timeout.
    /// </summary>
    public sealed class LabOfficeShots : MonoBehaviour
    {
        public const string Argument = "-rbLabShots";

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
                var host = new GameObject("LabOfficeShots");
                DontDestroyOnLoad(host);
                host.AddComponent<LabOfficeShots>().folder = args[i + 1];
                return;
            }
        }

        private IEnumerator Start()
        {
            Invoke(nameof(GiveUp), 300f);
            Directory.CreateDirectory(folder);
            while (UnityEngine.SceneManagement.SceneManager.GetActiveScene().name != SceneFlow.TitleScene) yield return null;
            yield return Wait(1.5f);
            while (NewGameWizard.Last == null) yield return null;
            NewGameWizard wizard = NewGameWizard.Last;
            while (wizard.SelectedWorldId == null) yield return null;
            yield return Await(wizard.UseDefaults(false));
            yield return Await(wizard.StartGame());
            while (EngineGame.Current == null || ShellController.Current == null) yield return null;
            yield return Wait(2.5f);
            yield return Capture("office-day-one");

            // Fill the next show's card so the lead story has a main event to show.
            EngineClient client = EngineGame.Current.Client;
            Task<QueryResult<JToken>> next = client.Query("calendar.nextShow", new JObject { ["scope"] = "mine" });
            yield return Await(next);
            string eventId = Kit.Str(next.Result.Data, "show.eventInstanceId");
            if (eventId != null)
            {
                yield return Await(client.Command("aip.autoFillCard", new JObject { ["eventInstanceId"] = eventId, ["keepFilledSlots"] = true }));
                yield return WaitIdle(2f);
                yield return Capture("office-card-booked");
            }

            Go(ShellRoute.To(MatchLabScreen.ScreenId));
            yield return Wait(1.5f);
            while (MatchLabScreen.Current == null || !MatchLabScreen.Current.Loaded) yield return null;
            yield return Wait(0.5f);
            yield return Capture("lab-empty");
            if (MatchLabScreen.Current.State.Sides[0].Count == 0)
            {
                Click(Q<Button>(button => button.name == "lab-add-0"));
                yield return Wait(1.5f);
                yield return Capture("lab-picker");
                ShellController.Current.Overlay.CloseAll();
            }

            LabView lab = MatchLabScreen.Current;
            LabState state = lab.State;
            Task<QueryResult<JToken>> workers = client.Query("match.labWorkers", new JObject { ["scope"] = "mine", ["regionId"] = state.RegionId });
            yield return Await(workers);
            var people = Kit.Arr(workers.Result.Data, "rows").Where(row => Kit.Bool(row, "available") && Kit.Str(row, "style") != "nonWrestler").Take(4).ToList();
            if (people.Count >= 2)
            {
                state.AddPerson(0, LabPerson.FromRow(people[0]));
                state.AddPerson(1, LabPerson.FromRow(people[1]));
            }
            state.SlotRole = "mainEvent";
            lab.Render();
            yield return Wait(0.5f);
            yield return Capture("lab-sides");
            yield return Await(lab.RunAsync());
            yield return Wait(1f);
            yield return Capture("lab-run-once");

            state.Runs = 50;
            lab.Render();
            yield return Await(lab.RunAsync());
            yield return Wait(1f);
            yield return Capture("lab-run-50");
            yield return ScrollTo("lab-physical");
            yield return Capture("lab-physical-aftermath");
            Click(Q<Button>(button => button.name == "lab-more"));
            yield return ScrollTo("lab-setup-panel");
            yield return Capture("lab-more-options");


            state.Kind = "angle";
            lab.Render();
            yield return Wait(0.3f);
            if (state.AngleTypeKey == null)
            {
                Go(ShellRoute.With(MatchLabScreen.ScreenId, "mode", "angle"));
                yield return Wait(1.5f);
                lab = MatchLabScreen.Current;
            }
            if (state.Beats.Count > 0 && people.Count >= 4)
            {
                if (state.Beats[0].GroupOne.Count == 0) state.Beats[0].GroupOne.Add(people[0].Value<string>("personId"));
                state.People[people[2].Value<string>("personId")] = LabPerson.FromRow(people[2]);
                var second = new LabBeat { BeatKey = state.Beats[0].BeatKey };
                second.GroupOne.Add(people[2].Value<string>("personId"));
                state.Beats.Add(second);
            }
            lab.Render();
            yield return Await(lab.RunAsync());
            yield return Wait(1f);
            yield return ScrollTo("lab-beats");
            yield return Capture("lab-angle");
            yield return ScrollTo("lab-beat-scores");
            yield return Capture("lab-angle-beats");

            Debug.Log($"[LabOfficeShots] done: {folder}");
            Application.Quit(0);
        }

        private void GiveUp()
        {
            Debug.LogError("[LabOfficeShots] timed out");
            Application.Quit(1);
        }

        private static VisualElement Root => ShellController.Current.GetComponent<UIDocument>().rootVisualElement;

        private static void Go(ShellRoute route) => ShellController.Current.Navigator.Go(route);

        private static T Q<T>(Func<T, bool> match) where T : VisualElement
        {
            T found = null;
            Root?.Query<T>().ForEach(element =>
            {
                if (found == null && match(element)) found = element;
            });
            if (found == null) Debug.LogWarning($"[LabOfficeShots] no {typeof(T).Name} found");
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

        private static IEnumerator ScrollTo(string elementName)
        {
            yield return Wait(0.3f);
            VisualElement target = Root.Q<VisualElement>(elementName);
            ScrollView scroll = ShellController.Current.Shell?.Scroll;
            if (target != null && scroll != null) scroll.ScrollTo(target);
            yield return Wait(0.5f);
        }

        private static IEnumerator Wait(float seconds)
        {
            yield return new WaitForSecondsRealtime(seconds);
        }

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
            Debug.Log($"[LabOfficeShots] {path}");
        }
    }
}
