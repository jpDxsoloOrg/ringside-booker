using System;
using System.Collections.Generic;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Navigation;

namespace RingsideBooker.UI.Day
{
    /// <summary>The engine's route hints (the <c>*_ACTION_HINT</c> constants) and gate ids the day control knows.</summary>
    public static class GateHints
    {
        public const string Inbox = "inbox";
        public const string ShowNight = "showNight";
        public const string Roster = "roster";
        public const string Contracts = "contracts";
        public const string OfferAnswered = "offerAnswered";
        public const string News = "news";
        /// <summary>DRF-02: the draft before day 1 (<c>draft.unfinished</c>, "Finish the draft").</summary>
        public const string Draft = "draft";

        public const string CounterWaitingGateId = "contracts.counterWaiting";
        public const string ReleaseRequestedGateId = "contracts.releaseRequested";
    }

    public enum DayPrimaryKind
    {
        /// <summary>Nothing waits: advance one day.</summary>
        Next,
        /// <summary>A gate waits: the button names it and goes where it is dealt with.</summary>
        Gate,
        /// <summary>Days are advancing.</summary>
        Busy,
    }

    /// <summary>What the day control's main button does (the web's <c>DayPrimaryAction</c>).</summary>
    public sealed class DayPrimaryAction
    {
        public static readonly DayPrimaryAction Next = new DayPrimaryAction(DayPrimaryKind.Next, DayControlLogic.NextDayLabel, null, null, null);
        public static readonly DayPrimaryAction Busy = new DayPrimaryAction(DayPrimaryKind.Busy, DayControlLogic.NextDayLabel, null, null, null);

        public DayPrimaryAction(DayPrimaryKind kind, string label, string shortLabel, string reason, ShellRoute destination)
        {
            Kind = kind;
            Label = label;
            ShortLabel = shortLabel;
            Reason = reason;
            Destination = destination;
        }

        public DayPrimaryKind Kind { get; }
        /// <summary>The button's words: "Next day", "Go live", "2 decisions waiting".</summary>
        public string Label { get; }
        /// <summary>A shorter label for tight layouts, or null.</summary>
        public string ShortLabel { get; }
        /// <summary>The leading gate's reason (the button's tooltip), for <see cref="DayPrimaryKind.Gate"/>.</summary>
        public string Reason { get; }
        /// <summary>Where the gate button goes, or null when no screen deals with the gate (opens "Waiting on you").</summary>
        public ShellRoute Destination { get; }
    }

    public sealed class DayControlState
    {
        public DayControlState(DayPrimaryAction primary, bool skipEnabled)
        {
            Primary = primary;
            SkipEnabled = skipEnabled;
        }

        public DayPrimaryAction Primary { get; }
        /// <summary>Skip days is offered only when a day can actually move.</summary>
        public bool SkipEnabled { get; }
    }

    /// <summary>
    /// A port of the web's <c>dayControlState.ts</c>: which gate leads, what the day button says and
    /// where it goes. Pure: the same gates always give the same button.
    /// </summary>
    public static class DayControlLogic
    {
        public const string NextDayLabel = "Next day";
        public const string GoToShowLabel = "Go to the show";
        public const string ShowTonightShortLabel = "Tonight";
        public const string GoLiveLabel = "Go live";
        public const string BackToShowLabel = "Back to the show";
        public const string RosterLabel = "Roster";
        public const string ContractsLabel = "Contracts";
        public const string OfferAnsweredLabel = "Offer answered";
        public const string OpenNewsLabel = "Open news";
        public const string GenericGateLabel = "Needs attention";
        public const string FinishDraftLabel = "Finish the draft";
        public const string DraftScreenId = ScreenIds.Draft;
        public const string InjuriesTabId = "injuries";

        /// <summary>
        /// Hints in the order they win when several gates hit at once: the draft (nothing moves
        /// before it is finished), decisions, then the show,
        /// then a new injury, contract stops, an answered offer, and a news alert last. Hints not
        /// listed keep the engine's registration order, after these.
        /// </summary>
        public static readonly IReadOnlyList<string> HintPriority = new[]
        {
            GateHints.Draft,
            GateHints.Inbox,
            GateHints.ShowNight,
            GateHints.Roster,
            GateHints.Contracts,
            GateHints.OfferAnswered,
            GateHints.News,
        };

        private delegate ShellRoute RouteFor(GateHit hit);

        private sealed class GateRoute
        {
            public Func<int, string> Label;
            public Func<int, string> ShortLabel;
            public RouteFor To;
        }

        private static readonly Dictionary<string, GateRoute> Routes = new Dictionary<string, GateRoute>
        {
            [GateHints.Inbox] = new GateRoute
            {
                Label = count => $"{count} {(count == 1 ? "decision" : "decisions")} waiting",
                ShortLabel = count => $"{count} waiting",
                To = _ => ShellRoute.With("inbox", "filter", "decisions"),
            },
            [GateHints.ShowNight] = new GateRoute
            {
                Label = _ => GoToShowLabel,
                ShortLabel = _ => ShowTonightShortLabel,
                To = hit => ShellRoute.With("booking", "event", SubjectId(hit, "eventInstance")),
            },
            [GateHints.Roster] = new GateRoute { Label = _ => RosterLabel, To = InjuryDestination },
            [GateHints.Draft] = new GateRoute { Label = _ => FinishDraftLabel, To = _ => ShellRoute.To(DraftScreenId) },
            [GateHints.Contracts] = new GateRoute { Label = _ => ContractsLabel, To = ContractsDestination },
            [GateHints.OfferAnswered] = new GateRoute
            {
                Label = _ => OfferAnsweredLabel,
                To = hit => ShellRoute.With("contracts", "tab", "offers", "negotiation", SubjectId(hit, "negotiation")),
            },
            [GateHints.News] = new GateRoute
            {
                Label = _ => OpenNewsLabel,
                To = hit => SubjectId(hit, "news") is string id
                    ? ShellRoute.With("news", "story", id, "alert", "1")
                    : ShellRoute.To("news"),
            },
        };

        /// <summary>True once the roster has an Injuries tab; until then the injury stop opens the worker's Health tab.</summary>
        public static bool RosterInjuriesTabAvailable { get; set; }

        private static string SubjectId(GateHit hit, string kind) =>
            hit.Subject != null && hit.Subject.Kind == kind && !string.IsNullOrEmpty(hit.Subject.Id) ? hit.Subject.Id : null;

        /// <summary>The roster's Injuries tab, else the hurt worker's Health tab, else everyone injured.</summary>
        public static ShellRoute InjuryDestination(GateHit hit)
        {
            if (RosterInjuriesTabAvailable) return ShellRoute.With("roster", "tab", InjuriesTabId);
            string personId = SubjectId(hit, "person");
            return personId != null
                ? ShellRoute.With(ScreenIds.Worker, "id", personId, "tab", "health")
                : ShellRoute.With("workers", "availability", "injured");
        }

        /// <summary>A counter-offer opens Offers; a release request the Active tab; an expiring contract the Expiring tab.</summary>
        public static ShellRoute ContractsDestination(GateHit hit)
        {
            if (hit.GateId == GateHints.CounterWaitingGateId)
            {
                return ShellRoute.With("contracts", "tab", "offers", "negotiation", SubjectId(hit, "negotiation"));
            }
            if (hit.GateId == GateHints.ReleaseRequestedGateId)
            {
                return ShellRoute.With("contracts", "tab", "active", "wantsToLeave", "1", "employment", SubjectId(hit, "employment"));
            }
            return ShellRoute.With("contracts", "tab", "expiring");
        }

        private static GateRoute LiveShowRoute(bool underWay) => new GateRoute
        {
            Label = _ => underWay ? BackToShowLabel : GoLiveLabel,
            ShortLabel = underWay ? (Func<int, string>)(_ => ShowTonightShortLabel) : null,
            To = hit => SubjectId(hit, "eventInstance") is string id
                ? ShellRoute.With(ScreenIds.ShowNight, "event", id)
                : ShellRoute.To("booking"),
        };

        private static int HintRank(GateHit hit)
        {
            int rank = -1;
            if (hit.ActionHint != null)
            {
                for (int index = 0; index < HintPriority.Count; index++)
                {
                    if (HintPriority[index] == hit.ActionHint)
                    {
                        rank = index;
                        break;
                    }
                }
            }
            return rank == -1 ? HintPriority.Count : rank;
        }

        /// <summary>The gate that decides the button: the best-ranked hint, then registration order.</summary>
        public static GateHit LeadingGate(IReadOnlyList<GateHit> gates)
        {
            GateHit leading = null;
            if (gates == null) return null;
            foreach (GateHit hit in gates)
            {
                if (leading == null || HintRank(hit) < HintRank(leading)) leading = hit;
            }
            return leading;
        }

        private static GateRoute RouteForHit(GateHit hit, ShowNightRoute showNight)
        {
            if (hit.ActionHint == null || !Routes.TryGetValue(hit.ActionHint, out GateRoute route)) return null;
            if (hit.ActionHint == GateHints.ShowNight && showNight != null && showNight.GoesLive)
            {
                return LiveShowRoute(showNight.UnderWay);
            }
            return route;
        }

        private static int SameHintCount(IReadOnlyList<GateHit> gates, GateHit hit)
        {
            int count = 0;
            foreach (GateHit other in gates)
            {
                if (other.ActionHint == hit.ActionHint) count++;
            }
            return Math.Max(count, 1);
        }

        /// <summary>Where a gate's button goes and what it says, or null when no screen deals with it.</summary>
        public static (string label, ShellRoute to)? GateDestination(GateHit hit, IReadOnlyList<GateHit> gates = null, ShowNightRoute showNight = null)
        {
            GateRoute route = RouteForHit(hit, showNight);
            if (route == null) return null;
            int count = SameHintCount(gates ?? new[] { hit }, hit);
            return (route.Label(count), route.To(hit));
        }

        /// <summary>
        /// The day control's state: busy while advancing; "Next day" with Skip on when nothing waits;
        /// otherwise the leading gate's label and destination, with Skip off.
        /// </summary>
        public static DayControlState Derive(IReadOnlyList<GateHit> gates, bool advancing, ShowNightRoute showNight = null)
        {
            if (advancing) return new DayControlState(DayPrimaryAction.Busy, false);
            GateHit leading = LeadingGate(gates);
            if (leading == null) return new DayControlState(DayPrimaryAction.Next, true);

            GateRoute route = RouteForHit(leading, showNight);
            if (route == null)
            {
                return new DayControlState(
                    new DayPrimaryAction(DayPrimaryKind.Gate, GenericGateLabel, null, leading.Reason, null),
                    false);
            }
            int count = SameHintCount(gates, leading);
            return new DayControlState(
                new DayPrimaryAction(DayPrimaryKind.Gate, route.Label(count), route.ShortLabel?.Invoke(count), leading.Reason, route.To(leading)),
                false);
        }
    }
}
