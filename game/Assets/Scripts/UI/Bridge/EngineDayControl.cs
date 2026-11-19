using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI.Day;
using RingsideBooker.UI.Navigation;
using UnityEngine;
using EngineAdvanceProgress = RingsideBooker.Engine.AdvanceProgress;
using EngineAdvanceReport = RingsideBooker.Engine.AdvanceReport;
using EngineGateHit = RingsideBooker.Engine.GateHit;

namespace RingsideBooker.UI.Bridge
{
    /// <summary>
    /// <see cref="IDayControl"/> over the engine: gates from <c>sim.pendingGates</c> (and
    /// <c>shows.liveState</c> for tonight's show), Next day and Skip through <c>advanceDays</c>,
    /// Stop through <c>cancelAdvance</c>, and the last advance's report with the shows it completed
    /// (<c>shows.completedSince</c>). Everything runs on the main thread.
    /// </summary>
    public sealed class EngineDayControl : IDayControl, INavigationObserver
    {
        private readonly EngineGame game;
        private IReadOnlyList<GateHit> gates = Array.Empty<GateHit>();
        private bool attached = true;
        private bool refreshing;
        private bool refreshAgain;

        internal EngineDayControl(EngineGame game)
        {
            this.game = game;
            game.Client.OnStateChanged += OnStateChanged;
            game.Client.OnAdvanceProgress += OnProgress;
        }

        public IReadOnlyList<GateHit> Gates => gates;
        public ShowNightRoute ShowNight { get; private set; }
        public bool Advancing { get; private set; }
        public bool Stopping { get; private set; }
        public AdvanceProgress Progress { get; private set; }
        public AdvanceReport LastReport { get; private set; }

        public event Action Changed;

        /// <summary>Raised after an advance finished and its report is ready (the screenshot tour waits on it).</summary>
        public event Action<AdvanceReport> AdvanceFinished;

        public void NextDay() => Start(new AdvanceOptions { MaxDays = 1 });

        public void Skip(AdvanceRequest request)
        {
            if (request == null) return;
            Start(new AdvanceOptions
            {
                MaxDays = Math.Max(1, Math.Min(AdvanceOptions.MaxAllowedDays, request.MaxDays)),
                StopAtDate = request.StopAtDate?.Iso,
            });
        }

        public void Cancel()
        {
            if (!Advancing || Stopping) return;
            Stopping = true;
            game.Client.CancelAdvance();
            Changed?.Invoke();
        }

        public void DismissReport()
        {
            if (LastReport == null) return;
            LastReport = null;
            Changed?.Invoke();
        }

        /// <summary>
        /// Screens the Unity game does not have yet still have to clear their stops: opening News
        /// (where a news alert sends the player) marks the alerts seen, as the web's alert sheet does.
        /// </summary>
        public void OnNavigated(ShellRoute route)
        {
            if (route.ScreenId == "news" && gates.Any(hit => hit.ActionHint == GateHints.News))
            {
                game.Client.Command(EngineCommands.AckNewsAlerts).Then(_ => { }, error => Debug.LogWarning(error.Message));
            }
        }

        /// <summary>Reads the gates waiting today again and raises <see cref="Changed"/>.</summary>
        public async void Refresh()
        {
            if (!attached || Advancing) return;
            if (refreshing)
            {
                refreshAgain = true;
                return;
            }
            refreshing = true;
            try
            {
                do
                {
                    refreshAgain = false;
                    QueryResult<PendingGates> pending = await game.Client.Query<PendingGates>(EngineQueries.PendingGates);
                    if (!attached) return;
                    List<GateHit> hits = pending.Ok && pending.Data != null
                        ? pending.Data.Hits.Select(Map).ToList()
                        : new List<GateHit>();
                    GateHit show = hits.FirstOrDefault(hit => hit.ActionHint == GateHints.ShowNight);
                    ShowNightRoute route = show == null ? null : await RouteFor(show);
                    if (!attached) return;
                    gates = hits;
                    ShowNight = route;
                    Changed?.Invoke();
                }
                while (refreshAgain && attached);
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[EngineDayControl] gates: {exception.Message}");
            }
            finally
            {
                refreshing = false;
            }
        }

        internal void Detach()
        {
            attached = false;
            game.Client.OnStateChanged -= OnStateChanged;
            game.Client.OnAdvanceProgress -= OnProgress;
        }

        private void OnStateChanged(long revision) => Refresh();

        private void OnProgress(EngineAdvanceProgress progress)
        {
            if (!attached || !Advancing) return;
            GameDate.TryParse(progress.CurrentDate ?? progress.Date, out GameDate date);
            Progress = new AdvanceProgress(date, progress.DaysDone, progress.DaysRequested);
            Changed?.Invoke();
        }

        private async void Start(AdvanceOptions options)
        {
            if (Advancing || !attached) return;
            Advancing = true;
            Stopping = false;
            GameDate.TryParse(game.ShellData.Status?.Date, out GameDate today);
            Progress = new AdvanceProgress(today, 0, options.MaxDays);
            Changed?.Invoke();

            AdvanceReport report;
            try
            {
                EngineAdvanceReport result = await game.Client.AdvanceDays(options);
                report = await BuildReport(result, options.MaxDays);
            }
            catch (Exception exception)
            {
                Debug.LogError($"[EngineDayControl] advance: {exception}");
                report = AdvanceReport.Refusal(new[] { exception.Message });
            }

            if (!attached) return;
            Advancing = false;
            Stopping = false;
            Progress = null;
            LastReport = report;
            Changed?.Invoke();
            AdvanceFinished?.Invoke(report);
            Refresh();
        }

        private async Task<AdvanceReport> BuildReport(EngineAdvanceReport result, int requested)
        {
            if (!result.Ok)
            {
                IReadOnlyList<string> reasons = result.Reasons.Select(reason => reason.Message).ToList();
                return AdvanceReport.Refusal(reasons);
            }

            GameDate.TryParse(result.StartDate, out GameDate start);
            GameDate.TryParse(result.EndDate, out GameDate end);
            AdvanceStop stop = result.StoppedBy?.Kind == Engine.AdvanceStop.Gate ? AdvanceStop.Gate
                : result.StoppedBy?.Kind == Engine.AdvanceStop.Cancelled ? AdvanceStop.Cancelled
                : AdvanceStop.Completed;
            List<GateHit> hits = result.GateHits.Select(Map).ToList();
            List<AdvanceFailure> failures = result.Failures.Select(failure =>
            {
                GameDate.TryParse(failure.Date, out GameDate date);
                return new AdvanceFailure(date, failure.StepId, failure.Message);
            }).ToList();

            AdvanceReport report = AdvanceReport.Advanced(start, end, result.DaysAdvanced, requested, stop, hits, failures);
            report.Results = await CompletedShows(start, end);
            GateHit tonight = hits.FirstOrDefault(hit => hit.ActionHint == GateHints.ShowNight);
            if (tonight != null)
            {
                report.Tonight = tonight;
                report.TonightRoute = await RouteFor(tonight);
            }
            return report;
        }

        /// <summary>The player's shows completed between two dates, newest first.</summary>
        private async Task<IReadOnlyList<ShowResultLink>> CompletedShows(GameDate start, GameDate end)
        {
            if (end <= start) return Array.Empty<ShowResultLink>();
            QueryResult<JToken> shows = await game.Client.Query("shows.completedSince",
                new JObject { ["from"] = start.Iso, ["to"] = end.Iso, ["scope"] = "mine" });
            if (!shows.Ok || !(shows.Data is JArray rows)) return Array.Empty<ShowResultLink>();
            return rows
                .Select(row => new ShowResultLink((string)row["eventInstanceId"], (string)row["name"]))
                .Reverse()
                .ToList();
        }

        /// <summary>Whether tonight's show goes live, and whether it is under way (the web's useShowNightRoute).</summary>
        private async Task<ShowNightRoute> RouteFor(GateHit show)
        {
            if (show.Subject == null || show.Subject.Kind != "eventInstance") return new ShowNightRoute(false, false);
            QueryResult<JToken> live = await game.Client.Query("shows.liveState", new JObject { ["eventInstanceId"] = show.Subject.Id });
            if (!live.Ok || live.Data == null || live.Data.Type == JTokenType.Null) return new ShowNightRoute(false, false);
            bool underWay = (string)live.Data["stage"] == "live";
            return new ShowNightRoute((string)live.Data["mode"] == "live" || underWay, underWay);
        }

        private static GateHit Map(EngineGateHit hit) =>
            new GateHit(hit.GateId, hit.Reason, hit.ActionHint,
                hit.Subject == null ? null : new GateSubject(hit.Subject.Kind, hit.Subject.Id));
    }
}
