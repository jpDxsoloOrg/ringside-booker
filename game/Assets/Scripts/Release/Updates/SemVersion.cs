using System;
using System.Collections.Generic;
using System.Globalization;

namespace RingsideBooker.Release.Updates
{
    /// <summary>
    /// A semantic version (semver 2.0 precedence) for the update check (POL9-11):
    /// <c>0.1.0-alpha.2 &gt; 0.1.0-alpha.1</c>, <c>0.1.0-alpha.10 &gt; 0.1.0-alpha.9</c>,
    /// <c>0.1.0-beta.1 &gt; 0.1.0-alpha.9</c>, <c>0.1.0 &gt; 0.1.0-beta.3</c>. A leading <c>v</c> (a git
    /// tag) and build metadata (<c>+sha</c>) are ignored. Pure; <see cref="TryParse"/> never throws.
    /// </summary>
    public sealed class SemVersion : IComparable<SemVersion>
    {
        public int Major { get; private set; }
        public int Minor { get; private set; }
        public int Patch { get; private set; }

        /// <summary>The dot-separated pre-release identifiers (<c>alpha</c>, <c>2</c>); empty for a release.</summary>
        public IReadOnlyList<string> PreRelease { get; private set; } = Array.Empty<string>();

        public bool IsPreRelease => PreRelease.Count > 0;

        /// <summary>The first pre-release identifier in lower case (<c>alpha</c>, <c>beta</c>, <c>rc</c>), or "".</summary>
        public string PreLabel => IsPreRelease ? PreRelease[0].ToLowerInvariant() : string.Empty;

        /// <summary><c>0.1.0-alpha.2</c> (no <c>v</c>, no build metadata).</summary>
        public override string ToString()
        {
            string core = $"{Major}.{Minor}.{Patch}";
            return IsPreRelease ? core + "-" + string.Join(".", PreRelease) : core;
        }

        public static SemVersion Parse(string text) => TryParse(text, out SemVersion version) ? version : null;

        public static bool TryParse(string text, out SemVersion version)
        {
            version = null;
            if (string.IsNullOrWhiteSpace(text)) return false;
            string value = text.Trim();
            if (value.StartsWith("v", StringComparison.OrdinalIgnoreCase)) value = value.Substring(1);
            int plus = value.IndexOf('+');
            if (plus >= 0) value = value.Substring(0, plus);
            string pre = null;
            int dash = value.IndexOf('-');
            if (dash >= 0)
            {
                pre = value.Substring(dash + 1);
                value = value.Substring(0, dash);
            }

            string[] core = value.Split('.');
            if (core.Length != 3) return false;
            if (!Number(core[0], out int major) || !Number(core[1], out int minor) || !Number(core[2], out int patch)) return false;

            string[] identifiers = Array.Empty<string>();
            if (pre != null)
            {
                identifiers = pre.Split('.');
                foreach (string identifier in identifiers)
                {
                    if (identifier.Length == 0) return false;
                    foreach (char c in identifier)
                    {
                        if (!(char.IsLetterOrDigit(c) && c < 128) && c != '-') return false;
                    }
                }
            }

            version = new SemVersion { Major = major, Minor = minor, Patch = patch, PreRelease = identifiers };
            return true;
        }

        private static bool Number(string text, out int number)
        {
            number = 0;
            if (text.Length == 0) return false;
            foreach (char c in text)
            {
                if (c < '0' || c > '9') return false;
            }
            return int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out number);
        }

        /// <summary>Semver 2.0 precedence (build metadata already dropped).</summary>
        public int CompareTo(SemVersion other)
        {
            if (other == null) return 1;
            int result = Major.CompareTo(other.Major);
            if (result != 0) return result;
            result = Minor.CompareTo(other.Minor);
            if (result != 0) return result;
            result = Patch.CompareTo(other.Patch);
            if (result != 0) return result;

            // A release is newer than any of its pre-releases.
            if (!IsPreRelease) return other.IsPreRelease ? 1 : 0;
            if (!other.IsPreRelease) return -1;

            int count = Math.Min(PreRelease.Count, other.PreRelease.Count);
            for (int i = 0; i < count; i++)
            {
                result = CompareIdentifier(PreRelease[i], other.PreRelease[i]);
                if (result != 0) return result;
            }
            return PreRelease.Count.CompareTo(other.PreRelease.Count);
        }

        private static int CompareIdentifier(string left, string right)
        {
            bool leftNumber = Number(left, out int leftValue);
            bool rightNumber = Number(right, out int rightValue);
            if (leftNumber && rightNumber) return leftValue.CompareTo(rightValue);
            if (leftNumber) return -1;
            if (rightNumber) return 1;
            return Math.Sign(string.CompareOrdinal(left.ToLowerInvariant(), right.ToLowerInvariant()));
        }

        public static bool IsNewer(SemVersion candidate, SemVersion current) => candidate != null && candidate.CompareTo(current) > 0;
    }
}
