using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Day;
using RingsideBooker.UI.Shell;
using Unity.Profiling;
using UnityEngine;
using Debug = UnityEngine.Debug;
using AdvanceReport = RingsideBooker.UI.Bridge.AdvanceReport;
using AdvanceRequest = RingsideBooker.UI.Bridge.AdvanceRequest;
using GateHit = RingsideBooker.UI.Bridge.GateHit;

namespace RingsideBooker.Screens.Dev
{
    /// <summary>
    /// Where a skip's time goes in the player (UNITY-23). <c>-rbProfileSkip &lt;days&gt;</c> starts a
    /// game with the wizard's defaults and Show night on Auto, then skips that many days through the
    /// shell's Skip (the real day control, top bar and Office screen redraw as they would for a
    /// player) and clears every stop with engine commands, without opening a screen: a show night
    /// gets Auto-fill, Auto results and Run the show; any other stop gets the main action of
    /// "Needs attention". It logs a <c>[ProfileSkip]</c> summary (wall time against the engine's own
    /// time, every bridge call, UI refreshes, frames) and the world hash, then quits (exit 0).
    ///
    /// <para>Options: <c>-rbProfileSkipWorkshop &lt;item id&gt;</c> imports that workshop world first,
    /// <c>-rbProfileSkipStored &lt;item id&gt;</c> plays it as stored by an earlier import, and
    /// <c>-rbSeed &lt;seed&gt;</c> fixes the seed (the wizard's), so two builds can be compared by the
    /// hash. The skip check takes <c>-rbProfile</c> to log the same summary
    /// (<see cref="SkipProfile"/>). Logs gate ids and counts only, never names from a world.</para>
    /// </summary>
    public sealed class ProfileSkip : MonoBehaviour
    {
        public const string Argument = "-rbProfileSkip";
        public const string WorkshopArgument = "-rbProfileSkipWorkshop";
        public const string StoredArgument = "-rbProfileSkipStored";
        private const int MaxSteps = 2000;

        private int days = 90;
        private string workshopItem;
        private string storedItem;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void StartIfAsked()
        {
            string[] args = Environment.GetCommandLineArgs();
            int at = Array.FindIndex(args, arg => string.Equals(arg, Argument, StringComparison.OrdinalIgnoreCase));
            if (at < 0 || Application.isBatchMode) return;
            var host = new GameObject("ProfileSkip");
            DontDestroyOnLoad(host);
            ProfileSkip profile = host.AddComponent<ProfileSkip>();
            if (at + 1 < args.Length && int.TryParse(args[at + 1], out int asked) && asked > 0) profile.days = asked;
            profile.workshopItem = DevArgs.Value(args, WorkshopArgument);
            profile.storedItem = DevArgs.Value(args, StoredArgument);
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
                Debug.LogError($"[ProfileSkip] FAILED: {exception}");
            }
            Application.Quit(exitCode);
        }

        private async Task<bool> Run()
        {
            while (UnityEngine.SceneManagement.SceneManager.GetActiveScene().name != SceneFlow.TitleScene) await Task.Yield();
            while (NewGameWizard.Last == null) await Task.Yield();
            NewGameWizard wizard = NewGameWizard.Last;
            string world = "default";
            if (storedItem != null)
            {
                if (!await wizard.UseStored(Import.WorkshopModScanner.PackIdFor(storedItem))) return Fail("that stored workshop world is not listed in New game");
                world = "stored workshop world";
            }
            else if (workshopItem != null)
            {
                if (!await wizard.UseDefaults(true, workshopItem)) return Fail("that workshop world did not import");
                world = "imported workshop world";
            }
            else
            {
                await wizard.UseDefaults(false);
            }
            if (!wizard.SetSetting("showNight", "auto")) Debug.LogWarning("[ProfileSkip] this world has no Show night setting");
            string seed = wizard.Seed;
            await wizard.StartGame();
            while (EngineGame.Current == null || ShellController.Current == null) await Task.Yield();
            EngineGame game = EngineGame.Current;
            await Idle(game);

            GameDate start = await Today(game);
            GameDate target = start.AddDays(days);
            Debug.Log($"[ProfileSkip] {world}, seed {seed}: skipping {days} days from {start.Iso} (Show night on Auto)");

            SkipProfile profile = SkipProfile.Begin();
            var stops = new SortedDictionary<string, int>();
            int skips = 0;
            int shows = 0;
            string lastStop = null;
            int sameStop = 0;
            for (int step = 0; step < MaxSteps; step++)
            {
                await Idle(game);
                IReadOnlyList<GateHit> gates = game.DayControl.Gates;
                if (gates.Count == 0)
                {
                    GameDate today = Date(game);
                    if (today >= target)
                    {
                        await profile.Finish("ProfileSkip", game,
                            $"{world}: {start.Iso} → {today.Iso} ({start.DaysUntil(today)} days) in {skips} skips, {shows} show nights; stops: " +
                            (stops.Count == 0 ? "none" : string.Join(", ", stops.Select(pair => $"{pair.Key} ×{pair.Value}"))));
                        return true;
                    }
                    skips++;
                    AdvanceReport report = await Skip(game.DayControl, today.DaysUntil(target));
                    if (report.Refused) return Fail("the skip was refused: " + string.Join("; ", report.RefusalReasons));
                    continue;
                }

                GateHit lead = DayControlLogic.LeadingGate(gates);
                string key = $"{lead.GateId}|{lead.Subject?.Id}|{lead.Reason}";
                sameStop = key == lastStop ? sameStop + 1 : 0;
                lastStop = key;
                if (sameStop >= 3) return Fail($"stuck on {lead.GateId}");
                if (sameStop == 0) stops[lead.GateId] = stops.TryGetValue(lead.GateId, out int seen) ? seen + 1 : 1;

                if (lead.GateId == EngineGateActions.ShowsTonight)
                {
                    if (!await RunShow(game, lead)) return Fail("a show night would not run");
                    if (sameStop == 0) shows++;
                    continue;
                }

                GateAction action = EngineGateActions.For(game, lead).FirstOrDefault(candidate => candidate.Primary);
                if (action == null) return Fail($"no action clears {lead.GateId}");
                string problem = await action.Run();
                if (problem != null) Debug.LogWarning($"[ProfileSkip] {lead.GateId} refused");
            }
            return Fail("too many steps");
        }

        private static bool Fail(string why)
        {
            Debug.LogError($"[ProfileSkip] FAILED: {why}");
            return false;
        }

        /// <summary>
        /// Waits (a frame at a time) until nothing is queued on the engine and the shell has read the
        /// day's state, the way a player sees the screen settle.
        /// </summary>
        internal static async Task Idle(EngineGame game)
        {
            await Task.Yield();
            while (game.Client.IsBusy || game.DayControl.Advancing || game.DayControl.Refreshing || game.ShellData.Refreshing)
            {
                await Task.Yield();
            }
        }

        private static GameDate Date(EngineGame game)
        {
            GameDate.TryParse(game.ShellData.Status?.Date, out GameDate date);
            return date;
        }

        private static async Task<GameDate> Today(EngineGame game)
        {
            QueryResult<SimStatus> status = await game.Client.Query<SimStatus>(EngineQueries.SimStatus);
            return GameDate.Parse(status.Data.Date);
        }

        internal static async Task<AdvanceReport> Skip(EngineDayControl day, int maxDays)
        {
            var done = new TaskCompletionSource<AdvanceReport>();
            void Finished(AdvanceReport report) => done.TrySetResult(report);
            day.AdvanceFinished += Finished;
            try
            {
                day.Skip(new AdvanceRequest(Math.Max(1, Math.Min(maxDays, AdvanceOptions.MaxAllowedDays))));
                return await done.Task;
            }
            finally
            {
                day.AdvanceFinished -= Finished;
            }
        }

        /// <summary>Show night on Auto, by command only: Auto-fill, Auto results, Run the show.</summary>
        private static async Task<bool> RunShow(EngineGame game, GateHit lead)
        {
            string eventId = lead.Subject?.Id;
            if (eventId == null) return false;
            EngineClient client = game.Client;
            var args = new JObject { ["eventInstanceId"] = eventId };
            JToken live = (await client.Query("shows.liveState", args)).Data;
            if ((string)live?["stage"] == "live")
            {
                return (await client.Command("shows.runRestOfShow", args)).Ok
                       && (await client.Command("shows.finishShow", args)).Ok;
            }

            QueryResult<JToken> card = await client.Query("booking.card", args);
            if (card.Ok && card.Data?["canEdit"]?.Type == JTokenType.Boolean && (bool)card.Data["canEdit"])
            {
                CommandResult<JToken> fill = await client.Command("aip.autoFillCard", new JObject { ["eventInstanceId"] = eventId, ["keepFilledSlots"] = true });
                if (!fill.Ok) Debug.LogWarning("[ProfileSkip] auto-fill refused");
                await BookingScreen.PlanAutoResults(eventId);
            }
            CommandResult<JToken> run = await client.Command("shows.runTonight", args);
            if (!run.Ok) Debug.LogError($"[ProfileSkip] run the show refused: {string.Join(", ", run.Reasons.Select(reason => reason.Code))}");
            return run.Ok;
        }
    }

    /// <summary>
    /// The timing summary shared by <see cref="ProfileSkip"/> and the skip check's <c>-rbProfile</c>:
    /// turns <see cref="EnginePerf"/> on, samples frames, and logs wall time against the engine's own
    /// time when the run ends.
    /// </summary>
    public sealed class SkipProfile
    {
        public const string Argument = "-rbProfile";

        private readonly Stopwatch clock = Stopwatch.StartNew();
        private FrameSampler sampler;

        /// <summary>True when the command line asks for timing (<c>-rbProfile</c> or <c>-rbProfileSkip</c>).</summary>
        public static bool Asked =>
            Environment.GetCommandLineArgs().Any(arg =>
                string.Equals(arg, Argument, StringComparison.OrdinalIgnoreCase) ||
                string.Equals(arg, ProfileSkip.Argument, StringComparison.OrdinalIgnoreCase));

        /// <summary>Clears the numbers, turns timing on and starts the clock and the frame sampler.</summary>
        public static SkipProfile Begin()
        {
            EnginePerf.Reset();
            EnginePerf.Enabled = true;
            var profile = new SkipProfile();
            var host = new GameObject("SkipProfileFrames");
            UnityEngine.Object.DontDestroyOnLoad(host);
            profile.sampler = host.AddComponent<FrameSampler>();
            return profile;
        }

        /// <summary>Stops timing and logs the summary and the world hash under <c>[tag]</c>.</summary>
        public async Task Finish(string tag, EngineGame game, string outcome)
        {
            double wallMs = clock.Elapsed.TotalMilliseconds;
            if (sampler != null) UnityEngine.Object.Destroy(sampler.gameObject);
            EnginePerf.Enabled = false;
            string hash = (await game.Client.WorldHash()).Hash;

            EnginePerf.Stat advance = EnginePerf.Find("call advanceDays");
            double pipelineMs = EnginePerf.Find("advance.dayPipeline (V8)")?.TotalMs ?? 0;
            double callbacksMs = EnginePerf.Find("advance.progressCallbacks")?.TotalMs ?? 0;
            int dayCount = EnginePerf.Find("advance.days")?.Count ?? 0;
            double commandsV8 = V8Of("call command ");
            double queriesV8 = V8Of("call query ");
            double saveV8 = V8Of("call save");
            double callsMs = EnginePerf.TotalMs("call ");
            double engineOwnMs = pipelineMs + commandsV8;
            string Ms(double ms) => (ms / 1000.0).ToString("0.00", CultureInfo.InvariantCulture) + " s";
            string Ratio(double ms) => ms <= 0 ? "-" : (wallMs / ms).ToString("0.00", CultureInfo.InvariantCulture) + "×";

            Debug.Log($"[{tag}] DONE: {outcome}");
            Debug.Log($"[{tag}] world hash {hash}; {await game.Client.HeapSummary()}");
            Debug.Log($"[{tag}] wall {Ms(wallMs)}; day pipeline in V8 {Ms(pipelineMs)} for {dayCount} days ({Ratio(pipelineMs)}); " +
                      $"engine's own work (day pipeline + commands) {Ms(engineOwnMs)} ({Ratio(engineOwnMs)})");
            Debug.Log($"[{tag}] engine thread busy {Ms(callsMs - (advance == null ? 0 : callbacksMs))} of {Ms(wallMs)}: advances {Ms(advance?.TotalMs ?? 0)} " +
                      $"(progress callbacks {Ms(callbacksMs)}), commands V8 {Ms(commandsV8)}, queries V8 {Ms(queriesV8)}, saves V8 {Ms(saveV8)}, " +
                      $"JSON marshalling {Ms(callsMs - V8Of("call "))}");
            Debug.Log($"[{tag}] main thread: {sampler?.Describe() ?? "no frames"}; engine events {Ms(EnginePerf.TotalMs("main."))}, shell renders {Ms(EnginePerf.TotalMs("ui.shell."))}");
            Debug.Log($"[{tag}] table (call rows: total = run time on the engine thread, v8 = inside V8, json = the rest, wait = time queued):\n{EnginePerf.Summary()}");
        }

        private static double V8Of(string prefix) => EnginePerf.V8Ms(prefix);

        /// <summary>Frame times while profiling: all frames, and the main thread's own time when Unity reports it.</summary>
        private sealed class FrameSampler : MonoBehaviour
        {
            private ProfilerRecorder mainThread;
            private int frames;
            private double totalMs;
            private double maxMs;
            private double mainMs;
            private double mainMaxMs;
            private int slowFrames;

            private void OnEnable() => mainThread = ProfilerRecorder.StartNew(ProfilerCategory.Internal, "Main Thread", 1);

            private void OnDisable() => mainThread.Dispose();

            private void Update()
            {
                double delta = Time.unscaledDeltaTime * 1000.0;
                frames++;
                totalMs += delta;
                if (delta > maxMs) maxMs = delta;
                if (delta > 50) slowFrames++;
                if (mainThread.Valid && mainThread.LastValue > 0)
                {
                    double main = mainThread.LastValue / 1e6;
                    mainMs += main;
                    if (main > mainMaxMs) mainMaxMs = main;
                }
            }

            public string Describe()
            {
                string main = mainMs > 0
                    ? $"main thread CPU {mainMs / 1000.0:0.00} s (avg {mainMs / Math.Max(1, frames):0.0} ms, max {mainMaxMs:0} ms)"
                    : "main thread CPU n/a";
                return string.Format(CultureInfo.InvariantCulture,
                    "{0} frames, avg {1:0.0} ms, max {2:0} ms, {3} over 50 ms; {4}",
                    frames, totalMs / Math.Max(1, frames), maxMs, slowFrames, main);
            }
        }
    }

    /// <summary>Command-line helpers for the dev flags.</summary>
    internal static class DevArgs
    {
        public static string Value(string[] args, string name)
        {
            int at = Array.FindIndex(args, arg => string.Equals(arg, name, StringComparison.OrdinalIgnoreCase));
            return at >= 0 && at + 1 < args.Length ? args[at + 1] : null;
        }
    }
}
