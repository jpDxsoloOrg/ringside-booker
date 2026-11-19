using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Screens.Contracts;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Day;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Dev
{
    /// <summary>
    /// A developer tour of the Contracts screen (UNITY-17): run the player with
    /// <c>-rbContractsShots &lt;folder&gt;</c>. It starts a default-world game, visits every tab, the
    /// column picker, the filters, the Negotiation sheet (makes a low offer so the worker answers),
    /// then plays days until a contract stop comes up, follows the day button to the Contracts screen,
    /// captures it and clears it there, and ends on a contract sheet and the release preview. A PNG
    /// per step; logs <c>[ContractsShots]</c>; exit 1 on a time-out.
    /// </summary>
    public sealed class ContractsShots : MonoBehaviour
    {
        public const string Argument = "-rbContractsShots";

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
                var host = new GameObject("ContractsShots");
                DontDestroyOnLoad(host);
                host.AddComponent<ContractsShots>().folder = args[i + 1];
                return;
            }
        }

        private IEnumerator Start()
        {
            Invoke(nameof(GiveUp), 420f);
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
            yield return Capture("active");
            Log($"active rows {view.ShownRows.Count}");

            Click(Q<Button>(button => button.name == "table-columns"));
            yield return Wait(0.6f);
            yield return Capture("column-picker");
            ShellController.Current.Overlay.CloseAll();

            view.Table?.SortBy("wage", true);
            yield return Wait(0.4f);
            yield return Capture("active-by-wage");

            foreach (string tab in new[] { ContractsScreen.TabExpiring, ContractsScreen.TabLeaving, ContractsScreen.TabEnded })
            {
                view.SelectTab(tab);
                yield return WaitIdle(1f);
                yield return Capture(tab);
            }

            view.SelectTab(ContractsScreen.TabFreeAgents);
            yield return WaitIdle(2f);
            yield return Capture("free-agents");
            Log($"free agents {view.ShownRows.Count}");
            Click(Q<Button>(button => button.name == "contracts-filter"));
            yield return Wait(0.6f);
            yield return Capture("free-agents-filters");
            ShellController.Current.Overlay.CloseAll();

            // A low offer to the first free agent we may approach, so an answer comes back.
            JToken target = view.ShownRows.FirstOrDefault(row => Kit.Str(row, "openNegotiationId") == null && Kit.Str(row, "cooldownUntil") == null && ContractText.AskText(row) != null);
            if (target != null)
            {
                NegotiationView talks = NegotiationSheet.Open(view.Root, NegotiationTarget.Signing(Kit.Str(target, "personId")));
                yield return WaitFor(() => talks.Preview != null, 10f);
                yield return Wait(0.6f);
                yield return Capture("negotiation-new");
                string payField = talks.Draft.PerAppearance ? "perAppearanceFee" : "monthlyWage";
                TextField pay = talks.Root.Q<TextField>("offer-pay");
                if (pay != null) pay.value = ContractText.DollarsText(talks.Draft.Money(payField) * 0.8);
                yield return Wait(1.2f);
                yield return Capture("negotiation-low-offer");
                Click(talks.Root.Q<Button>("offer-more-terms"));
                yield return Wait(0.8f);
                yield return Capture("negotiation-more-terms");
                Click(Q<Button>(button => button.name == "negotiation-submit"));
                yield return WaitIdle(1.5f);
                yield return Capture("negotiation-sent");
                Log($"offer phase {talks.Phase} ({talks.Target})");
                ShellController.Current.Overlay.CloseAll();
            }

            view = ContractsScreen.Current;
            view.SelectTab(ContractsScreen.TabOffers);
            yield return WaitIdle(1f);
            yield return Capture("offers");

            // Play on until a contract stop comes up, and clear it on the Contracts screen.
            var seen = new HashSet<string>();
            EngineDayControl day = EngineGame.Current.DayControl;
            for (int step = 0; step < 40 && seen.Count < 3; step++)
            {
                yield return Await(SkipCheck.Settle());
                IReadOnlyList<GateHit> gates = day.Gates;
                if (gates.Count == 0)
                {
                    day.NextDay();
                    yield return Wait(0.3f);
                    while (day.Advancing) yield return null;
                    continue;
                }
                GateHit lead = DayControlLogic.LeadingGate(gates);
                if (lead.GateId == EngineGateActions.ShowsTonight)
                {
                    Task<bool?> show = SkipCheck.ShowNight(EngineGame.Current, lead);
                    yield return Await(show);
                    continue;
                }
                if (lead.GateId.StartsWith("contracts.", StringComparison.Ordinal))
                {
                    ShellController.Current.DayControl.RunPrimary();
                    yield return WaitIdle(2f);
                    if (seen.Add(lead.GateId)) yield return Capture("stop-" + lead.GateId.Replace("contracts.", string.Empty));
                    Log($"stop {lead.GateId}: {lead.Reason} → {ShellController.Current.Navigator.Current}");
                    yield return Await(SkipCheck.ClearOnContracts(lead));
                    continue;
                }
                yield return Await(SkipCheck.ClearStop(lead));
            }

            ShellController.Current.Navigator.Go(ShellRoute.To(ContractsScreen.ScreenId));
            yield return WaitIdle(1.5f);
            view = ContractsScreen.Current;
            yield return Capture("contracts-later");
            JToken first = view.ShownRows.FirstOrDefault();
            if (first != null)
            {
                view.OpenContract(Kit.Str(first, "employmentId"));
                yield return WaitIdle(1.5f);
                yield return Capture("contract-sheet");
                Click(Q<Button>(button => button.name == "contract-release"));
                yield return WaitIdle(1.5f);
                yield return Capture("release-preview");
                ShellController.Current.Overlay.CloseAll();
            }

            Log($"done: {folder}");
            Application.Quit(0);
        }

        private static void Log(string text) => Debug.Log("[ContractsShots] " + text);

        private void GiveUp()
        {
            Debug.LogError("[ContractsShots] timed out");
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
            if (found == null) Debug.LogWarning($"[ContractsShots] no {typeof(T).Name} found");
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
            Debug.Log($"[ContractsShots] {path}");
        }
    }
}
