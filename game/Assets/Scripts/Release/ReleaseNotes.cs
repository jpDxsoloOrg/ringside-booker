using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using UnityEngine;

namespace RingsideBooker.Release
{
    /// <summary>
    /// The release notes the What's new sheet shows (POL9-01), read from CHANGELOG.md. The build copies
    /// the repo's CHANGELOG.md into StreamingAssets (BuildScripts); in the editor the repo copy is read.
    /// Format: <c>## Unreleased</c>, then <c>## [0.1.0-alpha.1] - 2026-11-19</c> per release, with
    /// <c>### Added</c> / <c>Changed</c> / <c>Fixed</c> / <c>Balance</c> / <c>Heads up</c> sections of
    /// <c>- item</c> lines. Anything else (the header, notes between sections) is ignored.
    /// </summary>
    public static class ReleaseNotes
    {
        public const string FileName = "CHANGELOG.md";
        public const string HeadsUp = "Heads up";

        /// <summary>The order sections are shown in; unknown section names go last, as written.</summary>
        public static readonly string[] SectionOrder = { "Added", "Changed", "Fixed", "Balance", HeadsUp };

        public sealed class Section
        {
            public string Title;
            public readonly List<string> Items = new List<string>();
            public bool IsHeadsUp => string.Equals(Title, HeadsUp, StringComparison.OrdinalIgnoreCase);
        }

        public sealed class Release
        {
            /// <summary>Null for the Unreleased section.</summary>
            public string Version;
            /// <summary>"2026-11-19" as written, or "".</summary>
            public string Date = "";
            public readonly List<Section> Sections = new List<Section>();
            public bool IsUnreleased => Version == null;
            public bool IsEmpty => Sections.All(section => section.Items.Count == 0);
        }

        /// <summary>What the sheet shows for one build.</summary>
        public sealed class Notes
        {
            /// <summary>The release this build is (or the newest release before it), or null.</summary>
            public Release Current;
            /// <summary>Unreleased items, when this build is newer than <see cref="Current"/>; else null.</summary>
            public Release SinceRelease;
            public bool HasContent => (Current != null && !Current.IsEmpty) || (SinceRelease != null && !SinceRelease.IsEmpty);
        }

        /// <summary>Parses CHANGELOG.md text. Never throws; null or empty text gives no releases.</summary>
        public static List<Release> Parse(string text)
        {
            var releases = new List<Release>();
            if (string.IsNullOrEmpty(text)) return releases;
            Release release = null;
            Section section = null;
            foreach (string rawLine in text.Replace("\r\n", "\n").Split('\n'))
            {
                string line = rawLine.TrimEnd();
                if (line.StartsWith("## "))
                {
                    release = ParseHeading(line.Substring(3).Trim());
                    releases.Add(release);
                    section = null;
                }
                else if (line.StartsWith("### ") && release != null)
                {
                    section = new Section { Title = line.Substring(4).Trim() };
                    release.Sections.Add(section);
                }
                else if (section != null && (line.StartsWith("- ") || line.StartsWith("* ")))
                {
                    section.Items.Add(line.Substring(2).Trim());
                }
                else if (section != null && section.Items.Count > 0 && line.StartsWith("  ") && line.Trim().Length > 0)
                {
                    // A wrapped item: join it to the item above.
                    int last = section.Items.Count - 1;
                    section.Items[last] = section.Items[last] + " " + line.Trim();
                }
            }
            foreach (Release each in releases) each.Sections.Sort((a, b) => Rank(a.Title).CompareTo(Rank(b.Title)));
            return releases;
        }

        private static int Rank(string title)
        {
            int index = Array.FindIndex(SectionOrder, name => string.Equals(name, title, StringComparison.OrdinalIgnoreCase));
            return index < 0 ? SectionOrder.Length : index;
        }

        private static Release ParseHeading(string heading)
        {
            if (heading.StartsWith("Unreleased", StringComparison.OrdinalIgnoreCase)) return new Release();
            string version = heading;
            string date = "";
            int dash = heading.IndexOf(" - ", StringComparison.Ordinal);
            if (dash >= 0)
            {
                version = heading.Substring(0, dash).Trim();
                date = heading.Substring(dash + 3).Trim();
            }
            version = version.Trim('[', ']', ' ');
            if (version.StartsWith("v")) version = version.Substring(1);
            return new Release { Version = version, Date = date };
        }

        /// <summary>
        /// The notes for <paramref name="semVer"/> (no build metadata). When a release has that version,
        /// that release alone. Otherwise the build is newer than its last release: the newest release
        /// plus the Unreleased items.
        /// </summary>
        public static Notes For(IReadOnlyList<Release> releases, string semVer)
        {
            var notes = new Notes();
            if (releases == null || releases.Count == 0) return notes;
            Release exact = releases.FirstOrDefault(release => !release.IsUnreleased && release.Version == semVer);
            if (exact != null)
            {
                notes.Current = exact;
                return notes;
            }
            notes.Current = releases.FirstOrDefault(release => !release.IsUnreleased);
            Release unreleased = releases.FirstOrDefault(release => release.IsUnreleased);
            if (unreleased != null && !unreleased.IsEmpty) notes.SinceRelease = unreleased;
            return notes;
        }

        private static List<Release> loaded;

        /// <summary>The notes for this build (<see cref="ReleaseInfo.SemVer"/>), loaded once. A missing file gives empty notes.</summary>
        public static Notes ForThisBuild() => For(Load(), ReleaseInfo.SemVer);

        /// <summary>Tests and tours: replace the loaded changelog (null = read the file again).</summary>
        public static void Override(List<Release> releases) => loaded = releases;

        public static List<Release> Load()
        {
            if (loaded != null) return loaded;
            loaded = new List<Release>();
            foreach (string path in Candidates())
            {
                try
                {
                    if (!File.Exists(path)) continue;
                    loaded = Parse(File.ReadAllText(path));
                    break;
                }
                catch (Exception error)
                {
                    Debug.LogWarning($"[ReleaseNotes] Could not read {path}: {error.Message}");
                }
            }
            return loaded;
        }

        private static IEnumerable<string> Candidates()
        {
            yield return Path.Combine(Application.streamingAssetsPath, FileName);
#if UNITY_EDITOR
            // The repo's own CHANGELOG.md (game/Assets → repo root).
            yield return Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", FileName));
#endif
        }
    }
}
