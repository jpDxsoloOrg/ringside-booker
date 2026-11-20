using System;
using System.Collections;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Why;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Dev
{
    /// <summary>
    /// A developer tour of the world screens (UNITY-15): run the player with
    /// <c>-rbWorldShots &lt;folder&gt; [-rbWorldShotsDays N]</c>. It starts a default-world game with the
    /// wizard's defaults, plays N days (default 21: show nights get Auto-fill and Auto results, other
    /// stops are cleared) so there is history, then saves a PNG of Roster (cards, table, an expanded
    /// row, the column picker, filters, the quick look, Set push, Injuries), Workers (table, filters,
    /// cards), a worker's profile tabs, a worker with a bio and moves when there is one, Promotions, a rival's profile tabs, Event history, the
    /// Calendar (yours, the world, a show sheet) and a rival show's results, then quits (exit 1 on a
    /// time-out).
    /// </summary>
    public sealed class WorldScreenshots : MonoBehaviour
    {
        public const string Argument = "-rbWorldShots";

        private string folder;
        private int days = 21;
        private int index;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void StartIfAsked()
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (!string.Equals(args[i], Argument, StringComparison.OrdinalIgnoreCase)) continue;
                if (Application.isBatchMode) return;
                var host = new GameObject("WorldScreenshots");
                DontDestroyOnLoad(host);
                WorldScreenshots tour = host.AddComponent<WorldScreenshots>();
                tour.folder = args[i + 1];
                int dayIndex = Array.FindIndex(args, arg => string.Equals(arg, "-rbWorldShotsDays", StringComparison.OrdinalIgnoreCase));
                if (dayIndex >= 0 && dayIndex + 1 < args.Length && int.TryParse(args[dayIndex + 1], out int parsed)) tour.days = parsed;
                return;
            }
        }

        private IEnumerator Start()
        {
            Invoke(nameof(GiveUp), 420f);
            Directory.CreateDirectory(folder);
            while (UnityEngine.SceneManagement.SceneManager.GetActiveScene().name != UI.SceneFlow.TitleScene) yield return null;
            yield return Wait(1f);
            while (NewGameWizard.Last == null) yield return null;
            NewGameWizard wizard = NewGameWizard.Last;
            while (wizard.SelectedWorldId == null) yield return null;
            yield return Wait(0.3f);
            yield return Await(wizard.UseDefaults(false));
            yield return Await(NewGameWizard.Last.StartGame());
            while (EngineGame.Current == null || ShellController.Current == null) yield return null;
            yield return Wait(1.5f);

            EngineGame game = EngineGame.Current;
            yield return Await(Play(game, days));
            yield return Wait(1f);

            // ---- Roster ----
            Go(ShellRoute.With("roster", "view", "cards"));
            yield return Wait(2f);
            yield return Capture("roster-cards");
            Go(ShellRoute.With("roster", "view", "table"));
            yield return Wait(2f);
            yield return Capture("roster-table");
            RosterScreen.Entry first = null;
            System.Collections.Generic.List<RosterScreen.Entry> rosterShown = null;
            if (RosterScreen.LastTable != null)
            {
                first = RosterScreen.LastShown?.FirstOrDefault();
                rosterShown = RosterScreen.LastShown?.ToList();
                if (first != null) RosterScreen.LastTable.SetExpanded(first, true);
                yield return Wait(1.2f);
                yield return Capture("roster-table-expanded");
                Button pick = RosterScreen.LastTable.Q<Button>("table-columns");
                if (pick != null) RosterScreen.LastTable.OpenColumnPicker(pick);
                yield return Wait(0.6f);
                yield return Capture("roster-column-picker");
                Overlay.CloseAll();
            }
            Click(Q<Button>(b => b.name == "roster-filter"));
            yield return Wait(0.6f);
            yield return Capture("roster-filter");
            Overlay.CloseAll();
            if (first != null)
            {
                WorkerSheet.Open(Context(), first.PersonId, first.Row);
                yield return Wait(1.2f);
                yield return Capture("worker-sheet");
                Overlay.CloseAll();
            }
            Click(Q<Button>(b => b.name.StartsWith("set-push-emp", StringComparison.Ordinal)));
            yield return Wait(0.8f);
            yield return Capture("set-push");
            Overlay.CloseAll();
            Go(ShellRoute.With("roster", "tab", "injuries"));
            yield return Wait(1.5f);
            yield return Capture("roster-injuries");

            // ---- Workers ----
            Go(ShellRoute.With("workers", "view", "table"));
            yield return Wait(2.5f);
            yield return Capture("workers-table");
            Click(Q<Button>(b => b.name == "workers-filter"));
            yield return Wait(0.6f);
            yield return Capture("workers-filter");
            Overlay.CloseAll();
            Go(ShellRoute.With("workers", "view", "cards"));
            yield return Wait(2.5f);
            yield return Capture("workers-cards");
            Go(ShellRoute.With("workers", "view", "table"));
            yield return Wait(1f);

            string personId = first?.PersonId;
            foreach (string tab in new[] { "overview", "career", "health", "contract", "form" })
            {
                Go(ShellRoute.With(ScreenIds.Worker, "id", personId, "tab", tab));
                yield return Wait(1.8f);
                yield return Capture("worker-" + tab);
            }

            // A worker with a bio and named moves (the league roster), when the roster has one.
            foreach (RosterScreen.Entry entry in rosterShown ?? new System.Collections.Generic.List<RosterScreen.Entry>())
            {
                Task<QueryResult<JToken>> profile = game.Client.Query("workers.profile", new JObject { ["personId"] = entry.PersonId });
                yield return Await(profile);
                if (!profile.Result.Ok || Kit.Str(profile.Result.Data, "bio") == null || !Kit.Arr(profile.Result.Data, "moves.finishers").Any()) continue;
                Go(ShellRoute.With(ScreenIds.Worker, "id", entry.PersonId, "tab", "overview"));
                yield return Wait(1.8f);
                yield return Capture("worker-overview-bio");
                break;
            }

            // ---- Promotions ----
            Go(ShellRoute.To("promotions"));
            yield return Wait(1.8f);
            yield return Capture("promotions");
            Task<QueryResult<JToken>> list = game.Client.Query("promotions.list");
            yield return Await(list);
            string rival = Kit.Arr(list.Result.Data).Where(p => Kit.Str(p, "controlledBy") == "computer" && Kit.Str(p, "status") == "active")
                .OrderByDescending(p => Kit.Num(p, "size.reach") ?? 0).Select(p => Kit.Str(p, "promotionId")).FirstOrDefault();
            foreach (string tab in new[] { "roster", "shows", "titles", "decisions" })
            {
                Go(ShellRoute.With(ScreenIds.Promotion, "id", rival, "tab", tab));
                yield return Wait(1.8f);
                yield return Capture("promotion-" + tab);
            }

            // ---- Event history ----
            Go(ShellRoute.To("event-history"));
            yield return Wait(2f);
            yield return Capture("event-history");
            Button rivalResults = Q<Button>(b => b.name.StartsWith("history-results-", StringComparison.Ordinal));

            // ---- Calendar ----
            Go(ShellRoute.To("calendar"));
            yield return Wait(1.8f);
            yield return Capture("calendar");
            Go(ShellRoute.With("calendar", "scope", "world"));
            yield return Wait(2f);
            yield return Capture("calendar-world");
            Button chip = Q<Button>(b => b.name.StartsWith("calendar-show-", StringComparison.Ordinal) && b.ClassListContains("wl-show-chip--done"));
            if (chip != null)
            {
                ShowSheet.Open(Context(), chip.name.Substring("calendar-show-".Length));
                yield return Wait(1.2f);
                yield return Capture("show-sheet");
                Overlay.CloseAll();
            }

            Go(ShellRoute.To("event-history"));
            yield return Wait(2f);
            rivalResults = Q<Button>(b => b.name.StartsWith("history-results-", StringComparison.Ordinal));
            Click(rivalResults);
            yield return Wait(2.5f);
            yield return Capture("history-results");

            Debug.Log($"[WorldScreenshots] done: {folder}");
            Application.Quit(0);
        }

        /// <summary>Plays days with the engine: show nights booked by Auto-fill with Auto results, other stops cleared.</summary>
        private static async Task Play(EngineGame game, int total)
        {
            EngineClient client = game.Client;
            int left = total;
            int guard = 0;
            int stuck = 0;
            while (left > 0 && guard++ < 200)
            {
                Engine.AdvanceReport report = await client.AdvanceDays(AdvanceOptions.Days(left));
                if (!report.Ok)
                {
                    Debug.LogWarning($"[WorldScreenshots] advance refused: {report.ReasonText}");
                    return;
                }
                left -= report.DaysAdvanced;
                stuck = report.DaysAdvanced == 0 ? stuck + 1 : 0;
                if (stuck > 3)
                {
                    Debug.LogWarning("[WorldScreenshots] the same stop keeps coming back; playing on stops here");
                    break;
                }
                Debug.Log($"[WorldScreenshots] advanced {report.DaysAdvanced} to {report.EndDate}: {report.StoppedBy?.Kind} {string.Join(",", report.GateHits.Select(h => h.GateId))}");
                foreach (Engine.GateHit hit in report.GateHits)
                {
                    string subject = hit.Subject?.Id;
                    switch (hit.GateId)
                    {
                        case "shows.tonight":
                            await RunShow(client, subject);
                            break;
                        case "news.alert":
                            await client.Command("news.ackAlerts", new JObject());
                            break;
                        case "contracts.expiringSoon":
                            await client.Command("contracts.acknowledgeExpiries", new JObject { ["employmentIds"] = "all" });
                            break;
                        case "contracts.offerAnswered":
                            await client.Command("contracts.markOffersSeen", new JObject());
                            break;
                        case "contracts.releaseRequested":
                            await client.Command("contracts.answerReleaseRequest", new JObject { ["employmentId"] = subject, ["answer"] = "refuse" });
                            break;
                        case "health.ownWorkerInjured":
                            QueryResult<JToken> health = await client.Query("health.report", new JObject { ["promotionId"] = game.PromotionId });
                            await RosterScreen.Acknowledge(health.Data);
                            break;
                        default:
                            Debug.LogWarning($"[WorldScreenshots] stop {hit.GateId} not handled; playing on stops here");
                            left = 0;
                            break;
                    }
                }
            }
            Debug.Log($"[WorldScreenshots] played to {(await client.Query<ClockView>("clock.get")).Data?.Date}");
        }

        private static async Task RunShow(EngineClient client, string eventId)
        {
            if (eventId == null) return;
            var args = new JObject { ["eventInstanceId"] = eventId };
            await client.Command("aip.autoFillCard", new JObject { ["eventInstanceId"] = eventId, ["keepFilledSlots"] = true });
            await BookingScreen.PlanAutoResults(eventId);
            JToken live = (await client.Query("shows.liveState", args)).Data;
            if ((string)live?["mode"] == "live")
            {
                await client.Command("shows.runNextSegment", args);
                await client.Command("shows.runRestOfShow", args);
                JToken after = (await client.Query("shows.liveState", args)).Data;
                if (after != null && after.Type != JTokenType.Null && (string)after["stage"] == "live") await client.Command("shows.finishShow", args);
            }
            else await client.Command("shows.runTonight", args);
        }

        private void GiveUp()
        {
            Debug.LogError("[WorldScreenshots] timed out");
            Application.Quit(1);
        }

        private static OverlayLayer Overlay => ShellController.Current.Overlay;

        private static ScreenContext Context() =>
            new ScreenContext(ShellRoute.To("roster"), ShellController.Current.Navigator, ShellController.Current.Overlay);

        private static void Go(ShellRoute route)
        {
            Overlay.CloseAll();
            WhyPanelHost.CloseCurrent();
            ShellController.Current.Navigator.Go(route);
        }

        private static T Q<T>(Func<T, bool> match) where T : VisualElement
        {
            VisualElement root = ShellController.Current != null ? ShellController.Current.GetComponent<UIDocument>().rootVisualElement : null;
            T found = null;
            root?.Query<T>().ForEach(element =>
            {
                if (found == null && match(element)) found = element;
            });
            if (found == null) Debug.LogWarning($"[WorldScreenshots] no {typeof(T).Name} found");
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
            Debug.Log($"[WorldScreenshots] {path}");
        }
    }
}
