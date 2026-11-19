using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Day;
using RingsideBooker.UI.Shell;
using UnityEngine;
using UnityEngine.UIElements;
using Debug = UnityEngine.Debug;
using AdvanceReport = RingsideBooker.UI.Bridge.AdvanceReport;
using GateHit = RingsideBooker.UI.Bridge.GateHit;
using AdvanceRequest = RingsideBooker.UI.Bridge.AdvanceRequest;

namespace RingsideBooker.Screens.Dev
{
    /// <summary>
    /// "A skip must never get stuck" (UNITY-10): run the player with <c>-rbSkipCheck [days]</c>
    /// (default 90) and it starts a default-world game with the wizard's defaults, then skips until
    /// that many days have passed, dealing with every stop the way a player would in this build:
    /// show nights through Booking (Auto-fill, Auto results) and then live (run a segment, sim the
    /// rest) or auto (Run the show); every other stop by pressing the day button and, when it opens
    /// "Needs attention", that sheet's main button. Logs each stop (<c>[SkipCheck]</c> lines) and a
    /// summary, then quits: exit 0 when the days all passed, 1 when a stop could not be cleared.
    /// <c>-rbSkipCheckShots &lt;folder&gt;</c> also saves the first three "Needs attention" sheets as PNGs.
    /// </summary>
    public sealed class SkipCheck : MonoBehaviour
    {
        public const string Argument = "-rbSkipCheck";
        private const int MaxSteps = 400;

        public const string ShotsArgument = "-rbSkipCheckShots";

        /// <summary><c>-rbSkipCheckWorkshop &lt;item id&gt;</c>: import that workshop world mod first and play it (UNITY-12).</summary>
        public const string WorkshopArgument = "-rbSkipCheckWorkshop";
        private static string workshopItem;

        /// <summary><c>-rbSkipCheckStored &lt;item id&gt;</c>: play that workshop world as stored by an earlier import, without importing (UNITY-14).</summary>
        public const string StoredArgument = "-rbSkipCheckStored";
        private static string storedItem;

        private int days = 90;
        private static string shots;
        private static int shotCount;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void StartIfAsked()
        {
            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length; i++)
            {
                if (!string.Equals(args[i], Argument, StringComparison.OrdinalIgnoreCase)) continue;
                if (Application.isBatchMode) return;
                var host = new GameObject("SkipCheck");
                DontDestroyOnLoad(host);
                SkipCheck check = host.AddComponent<SkipCheck>();
                if (i + 1 < args.Length && int.TryParse(args[i + 1], out int asked) && asked > 0) check.days = asked;
                int shotsAt = Array.FindIndex(args, arg => string.Equals(arg, ShotsArgument, StringComparison.OrdinalIgnoreCase));
                if (shotsAt >= 0 && shotsAt + 1 < args.Length) shots = args[shotsAt + 1];
                int workshopAt = Array.FindIndex(args, arg => string.Equals(arg, WorkshopArgument, StringComparison.OrdinalIgnoreCase));
                if (workshopAt >= 0 && workshopAt + 1 < args.Length) workshopItem = args[workshopAt + 1];
                int storedAt = Array.FindIndex(args, arg => string.Equals(arg, StoredArgument, StringComparison.OrdinalIgnoreCase));
                if (storedAt >= 0 && storedAt + 1 < args.Length) storedItem = args[storedAt + 1];
                return;
            }
        }

        private async void Start()
        {
            int exitCode = 1;
            try
            {
                exitCode = await Run() ? 0 : 1;
            }
            catch (Exception exception)
            {
                Debug.LogError($"[SkipCheck] FAILED: {exception}");
            }
            Application.Quit(exitCode);
        }

        private static async Task CaptureAsync(string name)
        {
            System.IO.Directory.CreateDirectory(shots);
            string path = System.IO.Path.Combine(shots, $"{name}-{Screen.width}x{Screen.height}.png");
            ScreenCapture.CaptureScreenshot(path);
            await Task.Delay(500);
            Debug.Log($"[SkipCheck] {path}");
        }

        private async Task<bool> Run()
        {
            var clock = Stopwatch.StartNew();
            while (UnityEngine.SceneManagement.SceneManager.GetActiveScene().name != SceneFlow.TitleScene) await Task.Yield();
            while (NewGameWizard.Last == null) await Task.Yield();
            await Task.Delay(1000);
            if (storedItem != null)
            {
                var stored = Stopwatch.StartNew();
                if (shots != null)
                {
                    // The world list and "Manage imported worlds" after a restart (UNITY-14), as PNGs.
                    await Task.Delay(1500);
                    await CaptureAsync("new-game-stored-world");
                    NewGameWizard.Last.OpenManage();
                    await Task.Delay(4000);
                    await CaptureAsync("manage-imported-worlds");
                    NewGameWizard.Last.HandleBack();
                    NewGameWizard.Last.HandleBack();
                    stored.Restart();
                }
                if (!await NewGameWizard.Last.UseStored(Import.WorkshopModScanner.PackIdFor(storedItem)))
                {
                    return Fail($"stored workshop item {storedItem} is not listed in New game");
                }
                Debug.Log($"[SkipCheck] playing stored workshop item {storedItem}: listed and previewed in {stored.ElapsedMilliseconds} ms after the title");
            }
            else if (workshopItem != null)
            {
                if (!await NewGameWizard.Last.UseDefaults(true, workshopItem)) return Fail($"workshop item {workshopItem} did not import");
                Debug.Log($"[SkipCheck] playing imported workshop item {workshopItem}");
            }
            else
            {
                await NewGameWizard.Last.UseDefaults(false);
            }
            await NewGameWizard.Last.StartGame();
            while (EngineGame.Current == null || ShellController.Current == null) await Task.Yield();
            await Settle();

            EngineGame game = EngineGame.Current;
            EngineDayControl day = game.DayControl;
            GameDate start = await Today(game);
            GameDate target = start.AddDays(days);
            Debug.Log($"[SkipCheck] new game on {start.Iso}; skipping {days} days to {target.Iso}");
            SkipProfile profile = SkipProfile.Asked ? SkipProfile.Begin() : null;

            var stops = new SortedDictionary<string, int>();
            int skips = 0;
            int liveShows = 0;
            int autoShows = 0;
            string lastStop = null;
            int sameStop = 0;

            for (int step = 0; step < MaxSteps; step++)
            {
                await Settle();
                GameDate today = await Today(game);
                IReadOnlyList<GateHit> gates = day.Gates;
                if (gates.Count == 0)
                {
                    if (today >= target)
                    {
                        string summary = string.Join(", ", stops.Select(pair => $"{pair.Key} ×{pair.Value}"));
                        Debug.Log($"[SkipCheck] PASSED: {start.Iso} → {today.Iso} ({start.DaysUntil(today)} days) in {skips} skips, " +
                                  $"{liveShows} live and {autoShows} auto show nights; stops: {(summary.Length == 0 ? "none" : summary)}; " +
                                  $"{clock.Elapsed.TotalSeconds:0.0} s");
                        if (profile != null)
                        {
                            await profile.Finish("SkipCheck", game, $"{start.DaysUntil(today)} days in {skips} skips, {liveShows} live and {autoShows} auto show nights");
                        }
                        return true;
                    }
                    int remaining = today.DaysUntil(target);
                    skips++;
                    AdvanceReport report = await Skip(day, remaining);
                    Debug.Log($"[SkipCheck] skip {remaining} days from {today.Iso}: {report.DaysAdvanced} days, " +
                              $"{(report.Refused ? "refused: " + string.Join("; ", report.RefusalReasons) : report.StoppedBy.ToString())}" +
                              $"{(report.StopHits.Count > 0 ? " at " + string.Join(" | ", report.StopHits.Select(hit => $"{hit.GateId}: {hit.Reason}")) : string.Empty)}");
                    if (report.Refused) return Fail("the skip was refused");
                    continue;
                }

                GateHit lead = DayControlLogic.LeadingGate(gates);
                string key = $"{lead.GateId}|{lead.Reason}";
                sameStop = key == lastStop ? sameStop + 1 : 0;
                lastStop = key;
                if (sameStop >= 3) return Fail($"stuck on {lead.GateId}: {lead.Reason}");
                if (sameStop == 0) stops[lead.GateId] = stops.TryGetValue(lead.GateId, out int seen) ? seen + 1 : 1;

                if (lead.GateId == EngineGateActions.ShowsTonight)
                {
                    bool? live = await ShowNight(game, lead);
                    if (live == null) return Fail($"show night could not run: {lead.Reason}");
                    if (sameStop == 0)
                    {
                        if (live == true) liveShows++;
                        else autoShows++;
                    }
                }
                else
                {
                    await ClearStop(lead);
                }
            }
            return Fail("too many steps");
        }

        private static bool Fail(string why)
        {
            Debug.LogError($"[SkipCheck] FAILED: {why}");
            return false;
        }

        /// <summary>
        /// Waits for the engine to go idle and the day control to read today's stops again (frame by
        /// frame, no fixed delays: UNITY-23 found the old 0.6 s per step was most of a run's time).
        /// </summary>
        private static async Task Settle()
        {
            EngineGame game = EngineGame.Current;
            if (game == null) return;
            await ProfileSkip.Idle(game);
            game.DayControl.Refresh();
            await ProfileSkip.Idle(game);
        }

        private static async Task<GameDate> Today(EngineGame game)
        {
            QueryResult<SimStatus> status = await game.Client.Query<SimStatus>(EngineQueries.SimStatus);
            return GameDate.Parse(status.Data.Date);
        }

        private static async Task<AdvanceReport> Skip(EngineDayControl day, int maxDays)
        {
            var done = new TaskCompletionSource<AdvanceReport>();
            void Finished(AdvanceReport report) => done.TrySetResult(report);
            day.AdvanceFinished += Finished;
            try
            {
                day.Skip(new AdvanceRequest(Math.Min(maxDays, AdvanceOptions.MaxAllowedDays)));
                return await done.Task;
            }
            finally
            {
                day.AdvanceFinished -= Finished;
            }
        }

        /// <summary>
        /// A stop other than the show: press the day button; when it opens "Needs attention", press
        /// that row's main button (else the button went to the stop's screen, which clears it).
        /// </summary>
        private static async Task ClearStop(GateHit lead)
        {
            DayControlView control = ShellController.Current.DayControl;
            control.RunPrimary();
            await Task.Yield();
            Sheet sheet = control.WaitingSheet;
            if (sheet == null)
            {
                Debug.Log($"[SkipCheck] {lead.GateId}: \"{lead.Reason}\" → opened {ShellController.Current.Navigator.Current?.ScreenId}");
                return;
            }
            Button button = sheet.Root.Q<Button>($"waiting-action-{lead.GateId}-0");
            if (button == null)
            {
                Debug.LogWarning($"[SkipCheck] {lead.GateId}: \"{lead.Reason}\" → Needs attention has no action for it");
                sheet.Close();
                return;
            }
            Debug.Log($"[SkipCheck] {lead.GateId}: \"{lead.Reason}\" → Needs attention › {button.text}");
            if (shots != null && shotCount < 3)
            {
                System.IO.Directory.CreateDirectory(shots);
                shotCount++;
                ScreenCapture.CaptureScreenshot(System.IO.Path.Combine(shots, $"needs-attention-{shotCount}-{lead.GateId}-{Screen.width}x{Screen.height}.png"));
                await Task.Delay(500);
            }
            using (NavigationSubmitEvent submit = NavigationSubmitEvent.GetPooled())
            {
                submit.target = button;
                button.SendEvent(submit);
            }
            await Settle();
            control.WaitingSheet?.Close();
        }

        /// <summary>
        /// Show night: open it from the day button, Auto-fill the card with Auto results, then go live
        /// (run one segment, sim the rest) or run it (auto shows). True for live, false for auto, null
        /// when it would not run.
        /// </summary>
        private static async Task<bool?> ShowNight(EngineGame game, GateHit lead)
        {
            string eventId = lead.Subject?.Id;
            if (eventId == null) return null;
            ShellController.Current.DayControl.RunPrimary();
            EngineClient client = game.Client;
            var args = new JObject { ["eventInstanceId"] = eventId };

            JToken live = (await client.Query("shows.liveState", args)).Data;
            string stage = (string)live?["stage"];
            bool goesLive = (string)live?["mode"] == "live" || stage == "live";
            if (stage != "live")
            {
                QueryResult<JToken> card = await client.Query("booking.card", args);
                if (card.Ok && card.Data?["canEdit"]?.Type == JTokenType.Boolean && (bool)card.Data["canEdit"])
                {
                    CommandResult<JToken> fill = await client.Command("aip.autoFillCard", new JObject { ["eventInstanceId"] = eventId, ["keepFilledSlots"] = true });
                    if (!fill.Ok) Debug.LogWarning($"[SkipCheck] auto-fill refused: {fill.ReasonText}");
                    await BookingScreen.PlanAutoResults(eventId);
                }
            }

            CommandResult<JToken> run;
            if (goesLive)
            {
                if (stage != "live")
                {
                    run = await client.Command("shows.runNextSegment", args);
                    if (!run.Ok) return Refused("run next segment", run);
                }
                run = await client.Command("shows.runRestOfShow", args);
                if (!run.Ok) return Refused("sim the rest", run);
                JToken after = (await client.Query("shows.liveState", args)).Data;
                if (after != null && after.Type != JTokenType.Null && (string)after["stage"] == "live")
                {
                    run = await client.Command("shows.finishShow", args);
                    if (!run.Ok) return Refused("finish the show", run);
                }
            }
            else
            {
                run = await client.Command("shows.runTonight", args);
                if (!run.Ok) return Refused("run the show", run);
            }
            Debug.Log($"[SkipCheck] {lead.GateId}: \"{lead.Reason}\" → {(goesLive ? "live" : "auto")} show run");
            await Settle();
            ShellController.Current.Overlay.CloseAll();
            return goesLive;
        }

        private static bool? Refused(string what, CommandResult<JToken> run)
        {
            Debug.LogError($"[SkipCheck] {what} refused: {run.ReasonText}");
            return null;
        }
    }
}
