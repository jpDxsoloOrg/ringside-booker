using System;
using System.Collections.Generic;

namespace RingsideBooker.UI.Bridge
{
    /// <summary>What a gate is about: <c>{ kind: 'eventInstance', id: 'evi_…' }</c> in the engine.</summary>
    public sealed class GateSubject
    {
        public GateSubject(string kind, string id)
        {
            Kind = kind;
            Id = id;
        }

        public string Kind { get; }
        public string Id { get; }
    }

    /// <summary>
    /// One stop waiting today (the engine's <c>GateHit</c> from <c>sim.pendingGates</c>): a day will
    /// not move until it is dealt with.
    /// </summary>
    public sealed class GateHit
    {
        public GateHit(string gateId, string reason, string actionHint = null, GateSubject subject = null)
        {
            GateId = gateId;
            Reason = reason;
            ActionHint = actionHint;
            Subject = subject;
        }

        public string GateId { get; }
        /// <summary>The player-facing reason, such as "Tonight: Altura Mainstage".</summary>
        public string Reason { get; }
        /// <summary>The route hint (<see cref="Day.GateHints"/>), or null.</summary>
        public string ActionHint { get; }
        public GateSubject Subject { get; }
    }

    /// <summary>How tonight's show is run (EVT10-02), for the show night button's words.</summary>
    public sealed class ShowNightRoute
    {
        public ShowNightRoute(bool goesLive, bool underWay)
        {
            GoesLive = goesLive;
            UnderWay = underWay;
        }

        /// <summary>The show is run live ("Go live") rather than auto-simulated ("Go to the show").</summary>
        public bool GoesLive { get; }
        /// <summary>The live show is part-way through ("Back to the show").</summary>
        public bool UnderWay { get; }
    }

    /// <summary>An advance to start: the engine's <c>{ maxDays, stopAtDate? }</c>.</summary>
    public sealed class AdvanceRequest
    {
        public AdvanceRequest(int maxDays, GameDate? stopAtDate = null)
        {
            MaxDays = maxDays;
            StopAtDate = stopAtDate;
        }

        public int MaxDays { get; }
        public GameDate? StopAtDate { get; }
    }

    /// <summary>Where a running advance has got to (one update per simulated day).</summary>
    public sealed class AdvanceProgress
    {
        public AdvanceProgress(GameDate currentDate, int daysDone, int daysRequested)
        {
            CurrentDate = currentDate;
            DaysDone = daysDone;
            DaysRequested = daysRequested;
        }

        public GameDate CurrentDate { get; }
        public int DaysDone { get; }
        public int DaysRequested { get; }
    }

    public enum AdvanceStop
    {
        /// <summary>Ran every day asked for.</summary>
        Completed,
        /// <summary>Stopped on a gate (<see cref="AdvanceReport.StopHits"/>).</summary>
        Gate,
        /// <summary>The player pressed Stop.</summary>
        Cancelled,
    }

    /// <summary>A background step that failed on one day (its changes were undone).</summary>
    public sealed class AdvanceFailure
    {
        public AdvanceFailure(GameDate date, string stepId, string message)
        {
            Date = date;
            StepId = stepId;
            Message = message;
        }

        public GameDate Date { get; }
        public string StepId { get; }
        public string Message { get; }
    }

    /// <summary>One of your shows the advance completed, for a "See results" link.</summary>
    public sealed class ShowResultLink
    {
        public ShowResultLink(string eventInstanceId, string name)
        {
            EventInstanceId = eventInstanceId;
            Name = name;
        }

        public string EventInstanceId { get; }
        public string Name { get; }
    }

    /// <summary>
    /// The outcome of the last advance, for the "Last advance" summary banner. Either refused (the
    /// engine would not start) or advanced. The bridge also fills the extras the web banner queries
    /// separately: results, tonight's show, contract and offer lines (already in words).
    /// </summary>
    public sealed class AdvanceReport
    {
        private static readonly IReadOnlyList<string> NoLines = Array.Empty<string>();

        private AdvanceReport() { }

        public bool Refused { get; private set; }
        /// <summary>The engine's reasons, in words, when <see cref="Refused"/>.</summary>
        public IReadOnlyList<string> RefusalReasons { get; private set; } = NoLines;

        public GameDate StartDate { get; private set; }
        public GameDate EndDate { get; private set; }
        public int DaysAdvanced { get; private set; }
        public int DaysRequested { get; private set; }
        public AdvanceStop StoppedBy { get; private set; }
        /// <summary>The gates it stopped on (only for <see cref="AdvanceStop.Gate"/>).</summary>
        public IReadOnlyList<GateHit> StopHits { get; private set; } = Array.Empty<GateHit>();
        public IReadOnlyList<AdvanceFailure> Failures { get; private set; } = Array.Empty<AdvanceFailure>();

        /// <summary>Your shows it completed, newest first.</summary>
        public IReadOnlyList<ShowResultLink> Results { get; set; } = Array.Empty<ShowResultLink>();
        /// <summary>The show-night gate the advance stopped on, if any ("Tonight: …").</summary>
        public GateHit Tonight { get; set; }
        public ShowNightRoute TonightRoute { get; set; }
        /// <summary>Contracts that ended or workers who asked to leave, in words (ECO4-04).</summary>
        public IReadOnlyList<string> ContractLines { get; set; } = NoLines;
        /// <summary>Contract talks that moved, in words (ECO5-06).</summary>
        public IReadOnlyList<string> OfferLines { get; set; } = NoLines;

        public static AdvanceReport Refusal(IReadOnlyList<string> reasons) =>
            new AdvanceReport { Refused = true, RefusalReasons = reasons ?? NoLines };

        public static AdvanceReport Advanced(
            GameDate startDate,
            GameDate endDate,
            int daysAdvanced,
            int daysRequested,
            AdvanceStop stoppedBy,
            IReadOnlyList<GateHit> stopHits = null,
            IReadOnlyList<AdvanceFailure> failures = null) =>
            new AdvanceReport
            {
                StartDate = startDate,
                EndDate = endDate,
                DaysAdvanced = daysAdvanced,
                DaysRequested = daysRequested,
                StoppedBy = stoppedBy,
                StopHits = stopHits ?? Array.Empty<GateHit>(),
                Failures = failures ?? Array.Empty<AdvanceFailure>(),
            };
    }

    /// <summary>
    /// The game's clock, as the day control sees it. UNITY-04's bridge implements it over
    /// <c>sim.pendingGates</c>, <c>advanceDays</c> and <c>cancelAdvance</c>; <see cref="Demo.DemoGame"/>
    /// fakes it until then. The day control derives its button from <see cref="Gates"/> with
    /// <see cref="Day.DayControlLogic.Derive"/>. Events are raised on Unity's main thread.
    /// </summary>
    public interface IDayControl
    {
        /// <summary>The gates waiting today, in the engine's registration order.</summary>
        IReadOnlyList<GateHit> Gates { get; }

        /// <summary>How tonight's show runs, when a show-night gate waits; null otherwise.</summary>
        ShowNightRoute ShowNight { get; }

        /// <summary>True while an advance (or the autosave after it) runs.</summary>
        bool Advancing { get; }

        /// <summary>True after <see cref="Cancel"/> until the advance stops.</summary>
        bool Stopping { get; }

        /// <summary>The running advance's progress, or null when idle.</summary>
        AdvanceProgress Progress { get; }

        /// <summary>The last advance's report until dismissed or replaced; null when none.</summary>
        AdvanceReport LastReport { get; }

        /// <summary>Raised whenever any property above changes.</summary>
        event Action Changed;

        /// <summary>Advances one day (the "Next day" button and Shift+N). Ignored while advancing.</summary>
        void NextDay();

        /// <summary>Starts a multi-day skip from the Skip days sheet. Ignored while advancing.</summary>
        void Skip(AdvanceRequest request);

        /// <summary>Asks the running advance to stop after the current day.</summary>
        void Cancel();

        /// <summary>Clears <see cref="LastReport"/> (the banner's Dismiss).</summary>
        void DismissReport();
    }
}
