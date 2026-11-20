using System.Collections.Generic;
using RingsideBooker.Release;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.WhatsNew
{
    /// <summary>
    /// The What's new side sheet (POL9-01): this build's line, the items new since the last release
    /// (only when the build is newer than it), then the release's Added / Changed / Fixed / Balance /
    /// Heads up lists. Opened from the title screen's version line, Settings › About, and by itself
    /// once per new version (<see cref="WhatsNewState"/>).
    /// </summary>
    public static class WhatsNewSheet
    {
        public const string BodyName = "whats-new";

        public static OverlayHandle Open(VisualElement anyElement) => Open(anyElement, ReleaseNotes.ForThisBuild(), ReleaseInfo.Current);

        public static OverlayHandle Open(VisualElement anyElement, ReleaseNotes.Notes notes, ReleaseInfo.Stamp stamp)
        {
            WhatsNewStyles.Apply(anyElement?.panel?.visualTree);
            return DsOverlay.SideSheet(anyElement, "What's new", Build(notes, stamp), eyebrow: stamp.ChannelName.ToUpperInvariant(), width: 520f);
        }

        /// <summary>The sheet's body (public for tests).</summary>
        public static VisualElement Build(ReleaseNotes.Notes notes, ReleaseInfo.Stamp stamp)
        {
            VisualElement body = Ui.El("wn-body").Named(BodyName);
            body.Add(Ui.Text(BuildLine(stamp), "wn-build-line").Named("whats-new-build"));

            if (notes == null || !notes.HasContent)
            {
                body.Add(Ds.Empty("sparkles", "No notes for this build yet.", "Notes come with each packaged build.").Named("whats-new-empty"));
                return body;
            }

            if (notes.SinceRelease != null && !notes.SinceRelease.IsEmpty)
            {
                string since = notes.Current != null ? $"New since {notes.Current.Version}" : "New in this build";
                body.Add(Group(since, Items(notes.SinceRelease), false).Named("whats-new-since"));
            }
            if (notes.Current != null && !notes.Current.IsEmpty)
            {
                VisualElement release = Ui.El("wn-release").Named("whats-new-release");
                string heading = string.IsNullOrEmpty(notes.Current.Date)
                    ? $"Version {notes.Current.Version}"
                    : $"Version {notes.Current.Version} · {Day(notes.Current.Date)}";
                release.Add(Ui.Text(heading, "wn-release__title"));
                foreach (ReleaseNotes.Section section in notes.Current.Sections)
                {
                    if (section.Items.Count == 0) continue;
                    release.Add(Group(section.Title, section.Items, section.IsHeadsUp));
                }
                body.Add(release);
            }
            return body;
        }

        /// <summary>"Version 0.1.0-alpha.1 · build 1a2b3c4d · 20 Nov 2026" (parts left out when unknown).</summary>
        public static string BuildLine(ReleaseInfo.Stamp stamp)
        {
            var parts = new List<string> { $"Version {stamp.SemVer}" };
            if (!string.IsNullOrEmpty(stamp.ShortCommit)) parts.Add($"build {stamp.ShortCommit}");
            if (!string.IsNullOrEmpty(stamp.BuiltDay)) parts.Add(stamp.BuiltDay);
            return string.Join(" · ", parts);
        }

        private static string Day(string isoDate)
        {
            return System.DateTime.TryParseExact(isoDate, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.None, out System.DateTime day)
                ? day.ToString("d MMM yyyy", System.Globalization.CultureInfo.InvariantCulture)
                : isoDate;
        }

        private static List<string> Items(ReleaseNotes.Release release)
        {
            var items = new List<string>();
            foreach (ReleaseNotes.Section section in release.Sections) items.AddRange(section.Items);
            return items;
        }

        private static VisualElement Group(string title, List<string> items, bool headsUp)
        {
            VisualElement group = Ui.El("wn-group");
            if (headsUp)
            {
                group.AddToClassList("wn-group--heads-up");
                group.Add(Ds.Pill(DsState.Warn, title, "warning"));
            }
            else
            {
                group.Add(Ds.SectionHeader(title));
            }
            foreach (string item in items)
            {
                VisualElement row = Ui.El("wn-item");
                row.Add(Ui.El("wn-item__dot"));
                row.Add(Ui.Text(item, "wn-item__text"));
                group.Add(row);
            }
            return group;
        }
    }

    /// <summary>Adds the What's new / channel badge stylesheet to a panel once.</summary>
    public static class WhatsNewStyles
    {
        private const string Resource = "WhatsNew/WhatsNew";

        public static void Apply(VisualElement root)
        {
            if (root == null) return;
            StyleSheet sheet = UnityEngine.Resources.Load<StyleSheet>(Resource);
            if (sheet != null && !root.styleSheets.Contains(sheet)) root.styleSheets.Add(sheet);
        }
    }

    /// <summary>
    /// The quiet channel badge (POL9-10): "ALPHA" or "BETA" next to the logo on the title screen and in
    /// the sidebar header. Nothing for release builds or local builds.
    /// </summary>
    public static class ChannelBadge
    {
        public const string ClassName = "rb-channel-badge";

        /// <summary>The badge for this build, or null when the channel gets none.</summary>
        public static Label Create(string extraClass = null) => Create(ReleaseInfo.Current, extraClass);

        public static Label Create(ReleaseInfo.Stamp stamp, string extraClass = null)
        {
            if (stamp == null) return null;
            if (stamp.Channel != ReleaseInfo.ChannelAlpha && stamp.Channel != ReleaseInfo.ChannelBeta) return null;
            Label badge = Ui.Text(stamp.ChannelName.ToUpperInvariant(), ClassName, $"{ClassName}--{stamp.Channel}");
            badge.name = "channel-badge";
            if (extraClass != null) badge.AddToClassList(extraClass);
            badge.tooltip = stamp.Channel == ReleaseInfo.ChannelAlpha
                ? $"An early test build ({stamp.SemVer}). Things will change, and saves may need a fresh start between versions."
                : $"A test build ({stamp.SemVer}).";
            return badge;
        }
    }
}
