using System.Collections.Generic;
using System.Text;

namespace RingsideBooker.UI.Why
{
    /// <summary>
    /// A breakdown as indented plain text, for bug reports (the panel's Copy as text): a port of
    /// the web's <c>traceToText.ts</c>. Two spaces per level, one line per row, in the same words
    /// the panel shows. Checks that changed nothing are included, since a report should hold
    /// everything.
    /// </summary>
    public static class TraceText
    {
        private const string Indent = "  ";

        /// <summary>The notice shown in place of a breakdown that has been summarised.</summary>
        public const string SummarisedNotice = "Full breakdown is only kept for recent results";

        /// <summary>The notice for a result that was only ever kept as a summary: another promotion's.</summary>
        public const string SummaryOnlyNotice = "Only a summary is kept for other promotions' results";

        /// <summary>What the panel says when a stored result has no breakdown.</summary>
        public const string NoStoredBreakdownText = "No breakdown is kept for this result.";

        /// <summary>What a lazily built panel says when its query answers null.</summary>
        public const string NoBreakdownText = "There is no breakdown for this number any more.";

        /// <summary>The start of the message for a breakdown that failed to load.</summary>
        public const string LoadFailedText = "The breakdown could not be loaded.";

        /// <summary>Which notice a summary shows: why its full breakdown is not there.</summary>
        public static string SummaryNotice(TraceEntry summary) =>
            summary.SummaryOnly ? SummaryOnlyNotice : SummarisedNotice;

        /// <summary>The big line at the top of the panel: what the number is and its value.</summary>
        public static string Headline(TraceNode root) => $"{root.Label}: {TraceWording.ValueText(root)}";

        /// <summary>
        /// The rows under the headline: a formula's steps, or any other root as a row of its own,
        /// so its details are not lost.
        /// </summary>
        public static IReadOnlyList<TraceNode> TopLevelNodes(TraceNode root) =>
            root.Kind == TraceKinds.Formula ? root.ChildList : new[] { root };

        /// <summary>The whole trace as text: the headline, then every row indented under its parent.</summary>
        public static string ToText(TraceNode givenRoot)
        {
            TraceNode root = TraceStepUnits.WithStepUnits(givenRoot);
            var lines = new List<string> { Headline(root) };
            foreach (TraceNode node in TopLevelNodes(root)) AppendNode(lines, node, 1);
            return string.Join("\n", lines);
        }

        private static void AppendNode(List<string> lines, TraceNode node, int level)
        {
            TraceLine line = TraceWording.Describe(node);
            lines.Add(Repeat(level) + TraceWording.LineText(line));
            foreach (string item in line.Items) lines.Add(Repeat(level + 1) + item);
            foreach (TraceNode child in node.ChildList) AppendNode(lines, child, level + 1);
        }

        private static string Repeat(int level)
        {
            var builder = new StringBuilder(level * Indent.Length);
            for (int index = 0; index < level; index++) builder.Append(Indent);
            return builder.ToString();
        }

        /// <summary>One of a summary's top contributors: <c>−2,100 Promotion popularity</c>.</summary>
        public static string ContributorText(TraceContributor contributor, string unit) =>
            $"{TraceFormat.Delta(contributor.Effect, unit)} {contributor.Label}";

        /// <summary>The headline of a summarised result.</summary>
        public static string SummaryHeadline(TraceEntry summary) =>
            $"{summary.Label}: {TraceFormat.Value(summary.Value, summary.Unit)}";

        /// <summary>The date line of a summarised result.</summary>
        public static string SummaryDateText(TraceEntry summary) => $"Recorded {TraceFormat.GameDate(summary.Date)}";

        /// <summary>A summarised result as text: headline, the notice, the date and what moved it most.</summary>
        public static string SummaryToText(TraceEntry summary)
        {
            var lines = new List<string>
            {
                SummaryHeadline(summary),
                Indent + SummaryNotice(summary),
                Indent + SummaryDateText(summary),
            };
            foreach (TraceContributor contributor in summary.TopContributors ?? new List<TraceContributor>())
            {
                lines.Add(Indent + ContributorText(contributor, summary.Unit));
            }
            return string.Join("\n", lines);
        }

        /// <summary>A stored entry as text: the trace, or the summary.</summary>
        public static string EntryToText(TraceEntry entry) =>
            entry.IsFullTrace ? ToText(entry.Trace) : SummaryToText(entry);
    }
}
