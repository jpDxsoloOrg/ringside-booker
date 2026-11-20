using System;
using System.Collections;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Screens.Contracts;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Day;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Dev
{
    /// <summary>
    /// A developer tour of offering someone a different job (UNITY-38): run the player with
    /// <c>-rbJobShots &lt;folder&gt;</c>. It starts a default-world game, opens a manager's contract,
    /// presses Offer a different job, offers them a wrestling job and captures their answer, sends it,
    /// plays a day, opens their answer, and shows the roster. Then it shows a wrestler's answer to
    /// the announcer job (not sent). A PNG per step; logs <c>[JobShots]</c>; exit 0 when done, 1 on a
    /// time-out. The save slot it creates is deleted when it quits (<see cref="TourSlots"/>).
    /// </summary>
    public sealed class JobChangeShots : MonoBehaviour
    {
        public const string Argument = "-rbJobShots";

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
                var host = new GameObject("JobChangeShots");
                DontDestroyOnLoad(host);
                host.AddComponent<JobChangeShots>().folder = args[i + 1];
                return;
            }
        }

        private IEnumerator Start()
        {
            Invoke(nameof(GiveUp), 300f);
            Directory.CreateDirectory(folder);
            while (UnityEngine.SceneManagement.SceneManager.GetActiveScene().name != SceneFlow.TitleScene) yield return null;
            while (NewGameWizard.Last == null) yield return null;
            yield return Wait(1f);
            yield return Await(NewGameWizard.Last.UseDefaults(false));
            yield return Await(NewGameWizard.Last.StartGame());
            while (EngineGame.Current == null || ShellController.Current == null) yield return null;
            yield return Wait(2f);

            ShellController.Current.Navigator.Go(ShellRoute.To(ContractsScreen.ScreenId));
            yield return WaitIdle(1.5f);
            ContractsView view = ContractsScreen.Current;
            JToken manager = view.ShownRows.FirstOrDefault(row => Kit.Str(row, "role") == "manager");
            if (manager == null)
            {
                Debug.LogError("[JobShots] no manager on the roster");
                Application.Quit(1);
                yield break;
            }
            string ringName = Kit.Str(manager, "ringName");
            string employmentId = Kit.Str(manager, "employmentId");
            Log($"manager {ringName} ({employmentId})");

            // The contract sheet: Offer a different job (or Renew, inside the window).
            view.OpenContract(employmentId);
            yield return WaitIdle(1.5f);
            yield return Capture("contract-sheet");
            Button job = Q<Button>(button => button.name == "contract-job");
            NegotiationView talks;
            if (job != null)
            {
                Click(job);
                yield return WaitIdle(1f);
                talks = NegotiationSheet.Current;
            }
            else
            {
                ShellController.Current.Overlay.CloseAll();
                talks = NegotiationSheet.Open(view.Root, NegotiationTarget.JobChange(employmentId));
            }
            yield return WaitFor(() => talks?.Preview != null, 15f);
            yield return Wait(0.6f);
            yield return Capture("job-choice");

            // A wrestling job: their answer comes back in plain words with a quiet Why?.
            yield return Await(talks.OfferJob("wrestler"));
            yield return WaitFor(() => Kit.Str(talks.Preview, "jobChange.to") == "wrestler", 15f);
            yield return Wait(0.8f);
            yield return Capture("manager-to-wrestler");
            Log($"answer: {Kit.Str(talks.Preview, "jobChange.answer")} (willing {Kit.Bool(talks.Preview, "jobChange.willing")}, reaction {Kit.Str(talks.Preview, "reaction")})");

            // The other managers' answers; send the job to the first who is up for it (else the first).
            if (!Kit.Bool(talks.Preview, "jobChange.willing"))
            {
                foreach (JToken other in view.ShownRows.Where(row => Kit.Str(row, "role") == "manager" && Kit.Str(row, "employmentId") != employmentId).Take(6).ToList())
                {
                    ShellController.Current.Overlay.CloseAll();
                    NegotiationView next = NegotiationSheet.Open(view.Root, NegotiationTarget.JobChange(Kit.Str(other, "employmentId")));
                    yield return WaitFor(() => next?.Preview != null, 15f);
                    yield return Await(next.OfferJob("wrestler"));
                    yield return WaitFor(() => Kit.Str(next.Preview, "jobChange.to") == "wrestler", 15f);
                    yield return Wait(0.6f);
                    Log($"{Kit.Str(other, "ringName")}: {Kit.Str(next.Preview, "jobChange.answer")}");
                    if (!Kit.Bool(next.Preview, "jobChange.willing")) continue;
                    yield return Capture("manager-says-yes");
                    talks = next;
                    ringName = Kit.Str(other, "ringName");
                    employmentId = Kit.Str(other, "employmentId");
                    break;
                }
                // No manager wants to wrestle: look for a wrestler who would take the manager job.
                if (talks != NegotiationSheet.Current)
                {
                    foreach (JToken other in view.ShownRows.Where(row => Kit.Str(row, "role") == "wrestler").Take(30).ToList())
                    {
                        ShellController.Current.Overlay.CloseAll();
                        NegotiationView next = NegotiationSheet.Open(view.Root, NegotiationTarget.JobChange(Kit.Str(other, "employmentId")));
                        yield return WaitFor(() => next?.Preview != null, 15f);
                        yield return Await(next.OfferJob("manager"));
                        yield return WaitFor(() => Kit.Str(next.Preview, "jobChange.to") == "manager", 15f);
                        if (!Kit.Bool(next.Preview, "jobChange.willing")) continue;
                        yield return Wait(0.6f);
                        Log($"{Kit.Str(other, "ringName")}: {Kit.Str(next.Preview, "jobChange.answer")}");
                        yield return Capture("wrestler-says-yes");
                        talks = next;
                        ringName = Kit.Str(other, "ringName");
                        employmentId = Kit.Str(other, "employmentId");
                        break;
                    }
                }
                if (talks != NegotiationSheet.Current)
                {
                    ShellController.Current.Overlay.CloseAll();
                    talks = NegotiationSheet.Open(view.Root, NegotiationTarget.JobChange(employmentId));
                    yield return WaitFor(() => talks?.Preview != null, 15f);
                    yield return Await(talks.OfferJob("wrestler"));
                    yield return WaitFor(() => Kit.Str(talks.Preview, "jobChange.to") == "wrestler", 15f);
                }
            }
            Log($"sending to {ringName}");

            yield return Await(talks.SubmitOffer());
            yield return WaitIdle(1f);
            yield return Capture("job-offer-sent");
            Log($"sent: phase {talks.Phase} ({talks.Target})");
            ShellController.Current.Overlay.CloseAll();

            // Play a day or two until they answer, and follow the day button to their answer.
            EngineDayControl day = EngineGame.Current.DayControl;
            bool answered = false;
            for (int step = 0; step < 8 && !answered; step++)
            {
                yield return Await(SkipCheck.Settle());
                var lead = day.Gates.Count == 0 ? null : DayControlLogic.LeadingGate(day.Gates);
                if (lead == null)
                {
                    day.NextDay();
                    yield return Wait(0.3f);
                    while (day.Advancing) yield return null;
                    continue;
                }
                if (lead.GateId == "contracts.offerAnswered")
                {
                    ShellController.Current.DayControl.RunPrimary();
                    yield return WaitIdle(2f);
                    yield return Capture("their-answer");
                    Log($"answer stop: {lead.Reason}");
                    answered = true;
                    continue;
                }
                if (lead.GateId == EngineGateActions.ShowsTonight)
                {
                    yield return Await(SkipCheck.ShowNight(EngineGame.Current, lead));
                    continue;
                }
                if (lead.GateId.StartsWith("contracts.", StringComparison.Ordinal))
                {
                    yield return Await(SkipCheck.ClearOnContracts(lead));
                    continue;
                }
                yield return Await(SkipCheck.ClearStop(lead));
            }
            ShellController.Current.Overlay.CloseAll();
            yield return Wait(0.5f);

            Task<RingsideBooker.Engine.QueryResult<JToken>> detail = EngineGame.Current.Client.Query("contracts.detail", new JObject { ["employmentId"] = employmentId });
            yield return Await(detail);
            JToken now = detail.IsCompletedSuccessfully ? detail.Result.Data : null;
            Log($"{ringName} now: {Kit.Str(now, "role")}, {Kit.Str(now, "push")}");
            string tab = Kit.Str(now, "role") == "wrestler" ? "wrestlers" : "managers";
            ShellController.Current.Navigator.Go(ShellRoute.With("roster", "tab", tab));
            yield return WaitIdle(1.5f);
            yield return Capture("roster-" + tab);

            // A wrestler offered the announcer job: their answer only (not sent).
            ShellController.Current.Navigator.Go(ShellRoute.To(ContractsScreen.ScreenId));
            yield return WaitIdle(1.5f);
            view = ContractsScreen.Current;
            JToken wrestler = view.ShownRows.FirstOrDefault(row => Kit.Str(row, "role") == "wrestler" && Kit.Str(row, "employmentId") != employmentId);
            if (wrestler != null)
            {
                NegotiationView other = NegotiationSheet.Open(view.Root, NegotiationTarget.JobChange(Kit.Str(wrestler, "employmentId")));
                yield return WaitFor(() => other?.Preview != null, 15f);
                yield return Await(other.OfferJob("announcer"));
                yield return WaitFor(() => Kit.Str(other.Preview, "jobChange.to") == "announcer", 15f);
                yield return Wait(0.8f);
                yield return Capture("wrestler-to-announcer");
                Log($"{Kit.Str(wrestler, "ringName")}: {Kit.Str(other.Preview, "jobChange.answer")}");
                ShellController.Current.Overlay.CloseAll();
            }

            Log($"done: {folder}");
            Application.Quit(0);
        }

        private static void Log(string text) => Debug.Log("[JobShots] " + text);

        private void GiveUp()
        {
            Debug.LogError("[JobShots] timed out");
            Application.Quit(1);
        }

        private static T Q<T>(Func<T, bool> match) where T : VisualElement
        {
            VisualElement root = ShellController.Current?.GetComponent<UIDocument>().rootVisualElement;
            T found = null;
            root?.Query<T>().ForEach(element =>
            {
                if (found == null && match(element)) found = element;
            });
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

        private static IEnumerator WaitFor(Func<bool> done, float timeout)
        {
            float until = Time.realtimeSinceStartup + timeout;
            while (!done() && Time.realtimeSinceStartup < until) yield return null;
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
            Debug.Log($"[JobShots] {path}");
        }
    }
}
