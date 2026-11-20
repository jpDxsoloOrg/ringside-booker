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
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Dev
{
    /// <summary>
    /// A smoke check that Manage shows and the Calendar agree (UNITY-40): run the player with
    /// <c>-rbManageShowsShots &lt;folder&gt;</c>. It starts a default-world game, then for every
    /// promotion checks that each recurring show's Next date in <c>calendar.definitions</c> is a show
    /// <c>calendar.range</c> has, and that a show without one says why. It opens Manage shows for your
    /// promotion and the Calendar on the month of its next show, then Manage shows for a promotion
    /// with a show past the calendar's reach and the Calendar on that show's month (where it is not,
    /// and the sheet says "Not yet"). A PNG per step; logs <c>[ManageShowsShots]</c>; exit 0 when
    /// every check passes. Its save slot is deleted on quit (TourSlots).
    /// </summary>
    public sealed class ManageShowsShots : MonoBehaviour
    {
        public const string Argument = "-rbManageShowsShots";

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
                var host = new GameObject("ManageShowsShots");
                DontDestroyOnLoad(host);
                host.AddComponent<ManageShowsShots>().folder = args[i + 1];
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
            ShellNavigator nav = ShellController.Current.Navigator;
            EngineClient client = EngineGame.Current.Client;
            string own = ScheduleEditor.OwnPromotionId;
            GameDate today = EngineGame.Current.ShellData.Snapshot.Date;

            // ---- Every promotion: each Next date is a stored show; a show without one says why ----
            Task<QueryResult<JToken>> promotions = client.Query("promotions.list", new JObject());
            yield return Await(promotions);
            var rowsByPromotion = new Dictionary<string, List<JToken>>();
            foreach (JToken promotion in Kit.Arr(promotions.Result?.Data))
            {
                string promotionId = Kit.Str(promotion, "promotionId");
                Task<QueryResult<JToken>> definitions = client.Query("calendar.definitions", new JObject { ["promotionId"] = promotionId });
                yield return Await(definitions);
                rowsByPromotion[promotionId] = Kit.Arr(definitions.Result?.Data).ToList();
            }
            var stored = new Dictionary<string, string>();
            for (GameDate from = today; from.CompareTo(today.AddDays(400)) <= 0; from = from.AddDays(200))
            {
                Task<QueryResult<JToken>> range = client.Query("calendar.range", new JObject { ["from"] = from.Iso, ["to"] = from.AddDays(199).Iso, ["scope"] = "world" });
                yield return Await(range);
                foreach (JToken show in Kit.Arr(range.Result?.Data, "shows"))
                    stored[$"{Kit.Str(show, "definitionId")}|{Kit.Str(show, "date")}"] = Kit.Str(show, "eventInstanceId");
            }
            int dated = 0, later = 0, blocked = 0, unexplained = 0, missing = 0;
            foreach (JToken row in rowsByPromotion.Values.SelectMany(rows => rows))
            {
                if (Kit.Str(row, "state") == "retired") continue;
                string id = Kit.Str(row, "eventDefinitionId");
                if (Kit.Str(row, "nextDate") is string next)
                {
                    dated++;
                    if (!stored.ContainsKey($"{id}|{next}")) missing++;
                    continue;
                }
                string status = Kit.Str(row, "scheduling.status");
                if (status == "later") later++;
                else if (ManageShowsSheet.IsBlocked(row)) blocked++;
                if (string.IsNullOrEmpty(Kit.Str(row, "scheduling.text"))) unexplained++;
            }
            Log($"recurring shows: {dated} with a date on the calendar, {later} added later, {blocked} that cannot be scheduled");
            Check(missing == 0, $"every Next date is on the calendar ({missing} missing)");
            Check(unexplained == 0, $"every show without a Next date says why ({unexplained} without words)");

            // ---- Your promotion: Manage shows and the Calendar on its next show's month ----
            var context = new ScreenContext(ShellRoute.To("calendar"), nav, ShellController.Current.Overlay);
            List<JToken> ownRows = own != null && rowsByPromotion.TryGetValue(own, out List<JToken> found) ? found : new List<JToken>();
            JToken ownNext = ownRows.Where(row => Kit.Str(row, "nextDate") != null).OrderBy(row => Kit.Str(row, "nextDate")).FirstOrDefault();
            Check(ownNext != null, "your promotion has a show on the calendar");
            nav.Go(ShellRoute.With("calendar", "scope", "mine"));
            yield return WaitIdle(1f);
            ManageShowsSheet.Open(context, own);
            yield return WaitManage();
            yield return Capture("manage-own");
            ManageShowsSheet.Current?.Close();
            yield return Wait(0.5f);
            if (ownNext != null)
            {
                string month = Kit.Str(ownNext, "nextDate").Substring(0, 7);
                nav.Go(ShellRoute.With("calendar", "month", month, "scope", "mine"));
                yield return WaitIdle(1.5f);
                yield return Capture("calendar-own-month");
                stored.TryGetValue($"{Kit.Str(ownNext, "eventDefinitionId")}|{Kit.Str(ownNext, "nextDate")}", out string instanceId);
                Check(instanceId != null && Q<Button>(chip => chip.name == "calendar-show-" + instanceId) != null, $"the Calendar shows your next show on {Kit.Str(ownNext, "nextDate")}");
            }

            // ---- A rival with a show past the calendar's reach ----
            KeyValuePair<string, List<JToken>> rival = rowsByPromotion.FirstOrDefault(pair => pair.Key != own && pair.Value.Any(row => Kit.Str(row, "scheduling.status") == "later"));
            if (rival.Key != null)
            {
                JToken lateRow = rival.Value.First(row => Kit.Str(row, "scheduling.status") == "later");
                string ruleDate = Kit.Str(lateRow, "scheduling.ruleDate");
                Log($"a show past the calendar's reach runs on {ruleDate}");
                ManageShowsSheet.Open(context, rival.Key);
                yield return WaitManage();
                Label cell = Q<Label>(label => label.name == "manage-next-" + Kit.Str(lateRow, "eventDefinitionId"));
                Check(cell != null && cell.text == "Not yet", "Manage shows says \"Not yet\" for it");
                yield return Capture("manage-rival-later");
                ManageShowsSheet.Current?.Close();
                yield return Wait(0.5f);
                nav.Go(ShellRoute.With("calendar", "month", ruleDate.Substring(0, 7), "scope", "world"));
                yield return WaitIdle(1.5f);
                yield return Capture("calendar-later-month");
                Check(!stored.ContainsKey($"{Kit.Str(lateRow, "eventDefinitionId")}|{ruleDate}"), "and the Calendar does not have it yet");
            }

            Log(failed ? "FAILED" : "PASSED");
            Application.Quit(failed ? 1 : 0);
        }

        // ---- Helpers --------------------------------------------------------------------------------

        private void Check(bool ok, string what)
        {
            if (!ok) failed = true;
            Debug.Log($"[ManageShowsShots] {(ok ? "ok" : "FAIL")}: {what}");
        }

        private static void Log(string text) => Debug.Log("[ManageShowsShots] " + text);

        private void GiveUp()
        {
            Debug.LogError("[ManageShowsShots] timed out");
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

        private static IEnumerator WaitManage()
        {
            yield return new WaitForSecondsRealtime(0.5f);
            float until = Time.realtimeSinceStartup + 20f;
            while ((ManageShowsSheet.Current == null || ManageShowsSheet.Current.Busy) && Time.realtimeSinceStartup < until) yield return null;
            yield return new WaitForSecondsRealtime(0.8f);
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
            Debug.Log($"[ManageShowsShots] {path}");
        }
    }
}
