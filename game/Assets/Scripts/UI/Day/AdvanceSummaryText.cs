using System.Collections.Generic;
using System.Linq;
using RingsideBooker.UI.Bridge;

namespace RingsideBooker.UI.Day
{
    /// <summary>The words of the "Last advance" banner (a port of the web's <c>advanceSummaryText.ts</c>).</summary>
    public sealed class AdvanceSummaryText
    {
        public const int MaxResultsLinks = 3;
        public const int MaxContractLines = 3;

        private AdvanceSummaryText(string headline, string reason, string failures)
        {
            Headline = headline;
            Reason = reason;
            Failures = failures;
            Announcement = string.Join(" ", new[] { headline, reason, failures }.Where(part => part != null).Select(TextFormat.Sentence));
        }

        /// <summary>"Advanced 30 days to Friday, March 14, 2031".</summary>
        public string Headline { get; }
        /// <summary>Why it stopped early, or null when it ran every day asked for.</summary>
        public string Reason { get; }
        /// <summary>"3 background steps failed", or null.</summary>
        public string Failures { get; }
        /// <summary>All of it as sentences (for a screen reader or a log line).</summary>
        public string Announcement { get; }

        public static AdvanceSummaryText Describe(AdvanceReport report)
        {
            if (report.Refused)
            {
                string reasons = string.Join(" ", report.RefusalReasons);
                return new AdvanceSummaryText("The game couldn't move forward", reasons.Length == 0 ? null : reasons, null);
            }
            string date = report.EndDate.Long;
            string headline = report.DaysAdvanced > 0
                ? $"Advanced {TextFormat.DayCount(report.DaysAdvanced)} to {date}"
                : $"Stayed on {date}";
            string failures = report.Failures.Count > 0 ? FailureCountLabel(report.Failures.Count) : null;
            return new AdvanceSummaryText(headline, StopReason(report), failures);
        }

        /// <summary>Why an advance stopped, in the player's words; for a gate, the leading gate's reason.</summary>
        public static string StopReason(AdvanceReport report)
        {
            switch (report.StoppedBy)
            {
                case AdvanceStop.Gate:
                    return DayControlLogic.LeadingGate(report.StopHits)?.Reason ?? "Something needs your attention";
                case AdvanceStop.Cancelled:
                    return "Stopped by you";
                default:
                    return null;
            }
        }

        /// <summary>True when the advance stopped for a news alert (its reason sits after the results links).</summary>
        public static bool StoppedForNews(AdvanceReport report) =>
            !report.Refused && report.StoppedBy == AdvanceStop.Gate &&
            DayControlLogic.LeadingGate(report.StopHits)?.ActionHint == GateHints.News;

        public static string FailureCountLabel(int count) =>
            $"{TextFormat.Number(count)} background {(count == 1 ? "step" : "steps")} failed";

        public static string SeeResultsText(ShowResultLink show) => $"See results: {show.Name}";

        /// <summary>"and 2 more" for the results the banner had no room to link, or null.</summary>
        public static string MoreText(int total, int shown)
        {
            int hidden = total - shown;
            return hidden > 0 ? $"and {TextFormat.Number(hidden)} more" : null;
        }

        /// <summary>
        /// Whether a report earns the banner. A plain Next day that ran its one day is not shown (the
        /// date chip already moved) unless it ran or reached one of your shows or moved your
        /// contracts; anything longer, stopped early, failed or refused is.
        /// </summary>
        public static bool NeedsBanner(AdvanceReport report)
        {
            if (report == null) return false;
            if (report.Refused) return true;
            return report.Results.Count > 0 ||
                   report.Tonight != null ||
                   report.ContractLines.Count > 0 ||
                   report.OfferLines.Count > 0 ||
                   report.DaysRequested > 1 ||
                   report.StoppedBy != AdvanceStop.Completed ||
                   report.Failures.Count > 0;
        }

        /// <summary>The failures as plain text for "Copy details": one line per failed step.</summary>
        public static string FailuresToText(IEnumerable<AdvanceFailure> failures) =>
            string.Join("\n", failures.Select(failure => $"{failure.Date.Iso}  {failure.StepId}  {failure.Message}"));
    }
}
