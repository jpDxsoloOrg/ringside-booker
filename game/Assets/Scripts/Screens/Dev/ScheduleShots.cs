using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.Screens.Schedule;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Day;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using GateHit = RingsideBooker.UI.Bridge.GateHit;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Dev
{
    /// <summary>
    /// A developer tour and smoke check of the schedule editor (EVT8): run the player with
    /// <c>-rbScheduleShots &lt;folder&gt;</c>. It starts a default-world game, opens the Calendar's New
    /// show menu, creates a weekly Thursday show through the editor (showing a refused slot count on
    /// the way), opens Manage shows and the edit sheet's "What changes", adds a one-off special,
    /// previews retiring a world show, then plays days until both new shows have run and checks
    /// that they did. A PNG per step; logs <c>[ScheduleShots]</c>; exit 0 when the check passes,
    /// 1 when it fails or times out. Its save slot is deleted on quit (TourSlots).
    /// </summary>
    public sealed class ScheduleShots : MonoBehaviour
    {
        public const string Argument = "-rbScheduleShots";
        private const string WeeklyName = "Thursday Thunder";
        private const string SpecialName = "Winter Warfare";

        private string folder;
        private int index;
        private bool failed;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void StartIfAsked()
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (!string.Equals(args[i], Argument, StringComparison.OrdinalIgnoreCase)) continue;
                if (Application.isBatchMode) return;
                var host = new GameObject("ScheduleShots");
                DontDestroyOnLoad(host);
                host.AddComponent<ScheduleShots>().folder = args[i + 1];
                return;
            }
        }

        private IEnumerator Start()
        {
            Invoke(nameof(GiveUp), 600f);
            Directory.CreateDirectory(folder);
            while (UnityEngine.SceneManagement.SceneManager.GetActiveScene().name != SceneFlow.TitleScene) yield return null;
            while (NewGameWizard.Last == null) yield return null;
            yield return Wait(1f);
            yield return Await(NewGameWizard.Last.UseDefaults(false));
            yield return Await(NewGameWizard.Last.StartGame());
            while (EngineGame.Current == null || ShellController.Current == null) yield return null;
            yield return Wait(2f);
            ShellNavigator nav = ShellController.Current.Navigator;
            EngineClient client = EngineGame.Current.Client;

            // ---- Calendar and the New show menu ----
            nav.Go(ShellRoute.With("calendar", "scope", "mine"));
            yield return WaitIdle(1.5f);
            yield return Capture("calendar");
            Click(Q<Button>(button => button.name == "schedule-new-show"));
            yield return Wait(0.6f);
            yield return Capture("new-show-menu");
            Click(Q<Button>(button => button.name == "schedule-new-recurring"));
            yield return WaitEditor();
            yield return Capture("new-weekly-empty");

            // ---- A weekly Thursday show ----
            DefinitionEditorSheet editor = DefinitionEditorSheet.Current;
            Check(editor != null, "the recurring show editor opened");
            if (editor == null) yield break;
            Q<TextField>(field => field.name == "show-name").value = WeeklyName;
            Click(Q<Button>(button => button.name == "show-recurrence-day-3"));
            Click(Q<Button>(button => button.name == "show-recurrence-day-4"));
            yield return WaitEditor();
            yield return Capture("new-weekly-filled");
            editor.SetMore(true);
            Q<TextField>(field => field.name == "show-slots-input").value = "2";
            yield return WaitEditor();
            yield return Capture("new-weekly-two-slots");
            Button save = Q<Button>(button => button.name == "show-save");
            Check(save != null && !save.enabledSelf, "Save is disabled with 2 slots");
            Q<TextField>(field => field.name == "show-slots-input").value = "7";
            yield return WaitEditor();
            yield return Capture("new-weekly-more");
            Check(save != null && save.enabledSelf, "Save is enabled with 7 slots");
            Task<string> saving = editor.SaveAsync();
            yield return Await(saving);
            Check(saving.Result == null, $"the weekly show saved ({saving.Result ?? "ok"})");
            yield return WaitIdle(1f);
            yield return Capture("new-weekly-saved");
            string definitionId = Kit.Str(editor.Saved, "eventDefinitionId");
            List<string> added = Kit.Arr(editor.Saved, "added").Select(date => (string)date).ToList();
            Log($"weekly show {definitionId}: {added.Count} dates, first {added.FirstOrDefault()}");
            Check(definitionId != null && added.Count > 0, "the weekly show has dates");
            editor.Close();
            yield return WaitIdle(1f);
            yield return Capture("calendar-with-weekly");

            // ---- Manage shows and an edit's "What changes" ----
            Click(Q<Button>(button => button.name == "schedule-manage"));
            yield return WaitManage();
            yield return Capture("manage-shows");
            Click(Q<Button>(button => button.name == "manage-edit-" + definitionId));
            yield return WaitEditor();
            editor = DefinitionEditorSheet.Current;
            if (editor != null)
            {
                Click(Q<Button>(button => button.name == "tab-everyNWeeks"));
                yield return WaitEditor();
                yield return Capture("edit-every-two-weeks");
                editor.Close();
            }
            ManageShowsSheet.Current?.Close();
            yield return Wait(0.5f);

            // ---- A one-off special ----
            Click(Q<Button>(button => button.name == "schedule-new-show"));
            yield return Wait(0.6f);
            Click(Q<Button>(button => button.name == "schedule-new-special"));
            yield return WaitSpecial();
            OneOffSheet special = OneOffSheet.Current;
            Check(special != null, "the special sheet opened");
            if (special == null) yield break;
            Q<TextField>(field => field.name == "special-name").value = SpecialName;
            yield return WaitSpecial();
            special.SetMore(true);
            yield return WaitSpecial();
            yield return Capture("new-special");
            string specialDate = special.Draft.Date;
            Task<string> creating = special.CreateAsync();
            yield return Await(creating);
            Check(creating.Result == null, $"the special was added ({creating.Result ?? "ok"})");
            string specialId = special.CreatedId;
            Log($"special {specialId} on {specialDate}");
            yield return WaitIdle(1.5f);
            yield return Capture("special-show-sheet");
            ShellController.Current.Overlay.CloseAll();

            // ---- Retire preview on a world show (not confirmed) ----
            Task<QueryResult<JToken>> definitions = client.Query("calendar.definitions", new JObject());
            yield return Await(definitions);
            JToken worldShow = Kit.Arr(definitions.Result?.Data).FirstOrDefault(row => Kit.Str(row, "eventDefinitionId") != definitionId && Kit.Bool(row, "editable"));
            if (worldShow != null)
            {
                RetireShowDialog.Open(new ScreenContext(ShellRoute.To("calendar"), nav, ShellController.Current.Overlay), worldShow);
                yield return WaitIdle(1.2f);
                yield return Capture("retire-preview");
                RetireShowDialog.Current?.Close();
            }

            // ---- Play until both new shows have run ----
            GameDate.TryParse(specialDate, out GameDate specialDay);
            GameDate today = EngineGame.Current.ShellData.Snapshot.Date;
            int days = Math.Max(today.DaysUntil(specialDay), 8) + 2;
            Log($"playing {days} days");
            Task playing = PlayDays(days);
            yield return Await(playing);
            yield return WaitIdle(1f);

            Task<QueryResult<JToken>> range = client.Query("calendar.range", new JObject { ["from"] = today.Iso, ["to"] = EngineGame.Current.ShellData.Snapshot.Date.Iso, ["scope"] = "mine" });
            yield return Await(range);
            List<JToken> shows = Kit.Arr(range.Result?.Data, "shows").ToList();
            int weeklyRun = shows.Count(show => Kit.Str(show, "definitionId") == definitionId && Kit.Str(show, "status") == "completed");
            bool specialRun = shows.Any(show => Kit.Str(show, "eventInstanceId") == specialId && Kit.Str(show, "status") == "completed");
            Log($"weekly shows run: {weeklyRun}; special run: {specialRun}");
            Check(weeklyRun > 0, $"{WeeklyName} ran at least once");
            Check(specialRun, $"{SpecialName} ran");

            nav.Go(ShellRoute.With("calendar", "month", specialDate.Substring(0, 7), "scope", "mine"));
            yield return WaitIdle(1.5f);
            yield return Capture("calendar-after");
            if (specialId != null)
            {
                nav.Go(ShellRoute.With(ScreenIds.ShowResults, "event", specialId));
                yield return WaitIdle(2f);
                yield return Capture("special-results");
            }

            Log(failed ? "FAILED" : "PASSED");
            Application.Quit(failed ? 1 : 0);
        }

        // ---- Playing days (as CreativeShots) --------------------------------------------------------

        private static async Task PlayDays(int days)
        {
            EngineGame game = EngineGame.Current;
            EngineDayControl day = game.DayControl;
            QueryResult<SimStatus> start = await game.Client.Query<SimStatus>(EngineQueries.SimStatus);
            string startDate = start.Data?.Date;
            for (int step = 0; step < days * 4; step++)
            {
                await SkipCheck.Settle();
                QueryResult<SimStatus> now = await game.Client.Query<SimStatus>(EngineQueries.SimStatus);
                if (GameDate.TryParse(startDate, out GameDate from) && GameDate.TryParse(now.Data?.Date, out GameDate to) && from.DaysUntil(to) >= days) break;
                IReadOnlyList<GateHit> gates = day.Gates;
                if (gates.Count == 0)
                {
                    day.NextDay();
                    await Task.Delay(200);
                    while (day.Advancing) await Task.Yield();
                    continue;
                }
                GateHit lead = DayControlLogic.LeadingGate(gates);
                if (lead.GateId == EngineGateActions.ShowsTonight) await SkipCheck.ShowNight(game, lead);
                else if (lead.GateId.StartsWith("contracts.", StringComparison.Ordinal)) await SkipCheck.ClearOnContracts(lead);
                else
                {
                    GateAction action = day.ActionsFor(lead).FirstOrDefault(entry => entry.Primary) ?? day.ActionsFor(lead).FirstOrDefault();
                    if (action != null) Log($"{lead.GateId}: {await action.Run() ?? "cleared"}");
                    else await SkipCheck.ClearStop(lead);
                }
            }
            ShellController.Current.Overlay.CloseAll();
        }

        // ---- Helpers --------------------------------------------------------------------------------

        private void Check(bool ok, string what)
        {
            if (!ok) failed = true;
            Debug.Log($"[ScheduleShots] {(ok ? "ok" : "FAIL")}: {what}");
        }

        private static void Log(string text) => Debug.Log("[ScheduleShots] " + text);

        private void GiveUp()
        {
            Debug.LogError("[ScheduleShots] timed out");
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
            if (found == null) Debug.LogWarning($"[ScheduleShots] no {typeof(T).Name} found");
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

        private static IEnumerator WaitIdle(float atLeast)
        {
            yield return new WaitForSecondsRealtime(0.4f);
            float until = Time.realtimeSinceStartup + 30f;
            while (EngineRuntime.Client != null && EngineRuntime.Client.IsBusy && Time.realtimeSinceStartup < until) yield return null;
            yield return new WaitForSecondsRealtime(atLeast);
        }

        private static IEnumerator WaitEditor()
        {
            yield return new WaitForSecondsRealtime(0.5f);
            float until = Time.realtimeSinceStartup + 20f;
            while ((DefinitionEditorSheet.Current == null || DefinitionEditorSheet.Current.Busy) && Time.realtimeSinceStartup < until) yield return null;
            yield return new WaitForSecondsRealtime(0.5f);
        }

        private static IEnumerator WaitSpecial()
        {
            yield return new WaitForSecondsRealtime(0.5f);
            float until = Time.realtimeSinceStartup + 20f;
            while ((OneOffSheet.Current == null || OneOffSheet.Current.Busy) && Time.realtimeSinceStartup < until) yield return null;
            yield return new WaitForSecondsRealtime(0.5f);
        }

        private static IEnumerator WaitManage()
        {
            yield return new WaitForSecondsRealtime(0.5f);
            float until = Time.realtimeSinceStartup + 20f;
            while ((ManageShowsSheet.Current == null || ManageShowsSheet.Current.Busy) && Time.realtimeSinceStartup < until) yield return null;
            yield return new WaitForSecondsRealtime(0.5f);
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
            Debug.Log($"[ScheduleShots] {path}");
        }
    }
}
