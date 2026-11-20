using System;
using System.IO;
using UnityEngine;

namespace RingsideBooker.Release
{
    /// <summary>
    /// Which build this is (POL9-01/10): read once from <c>StreamingAssets/version.json</c>, which
    /// game/tools/package-windows.sh writes:
    /// <c>{ "version": "0.1.0-alpha.N+&lt;sha&gt;", "channel": "alpha", "commit": "&lt;sha&gt;", "built": "&lt;iso&gt;" }</c>.
    /// Without the file (an editor session or a plain dev build) the version is
    /// <c>Application.version</c> and the channel is <c>local</c>. Nothing else in the game hard-codes
    /// a version or a channel.
    /// </summary>
    public static class ReleaseInfo
    {
        public const string FileName = "version.json";
        public const string ChannelAlpha = "alpha";
        public const string ChannelBeta = "beta";
        public const string ChannelRelease = "release";
        public const string ChannelLocal = "local";

        private static Stamp current;

        /// <summary>Full version with build metadata, e.g. <c>0.1.0-alpha.1+1a2b3c4d</c>.</summary>
        public static string Version => Current.Version;

        /// <summary><c>alpha</c>, <c>beta</c>, <c>release</c> or <c>local</c> (no version.json).</summary>
        public static string Channel => Current.Channel;

        public static bool IsAlpha => Current.Channel == ChannelAlpha;

        /// <summary>The git commit the build came from (as written by the package script), or "".</summary>
        public static string Commit => Current.Commit;

        /// <summary>Short commit for display (8 characters), or "".</summary>
        public static string ShortCommit => Current.ShortCommit;

        /// <summary>The build time as written (ISO 8601 UTC), or "".</summary>
        public static string Built => Current.Built;

        /// <summary>The version without build metadata, e.g. <c>0.1.0-alpha.1</c>.</summary>
        public static string SemVer => Current.SemVer;

        /// <summary>Quiet label, e.g. "Alpha 0.1.0 (1)"; see <see cref="Stamp.Label"/>.</summary>
        public static string Label => Current.Label;

        /// <summary>"Ringside Booker — Alpha 0.1.0 (1)" (just "Ringside Booker" on the release channel).</summary>
        public static string WindowTitle => Current.WindowTitle;

        /// <summary>The parsed stamp (loaded on first use).</summary>
        public static Stamp Current => current ??= LoadFromStreamingAssets();

        /// <summary>Tests and tools: replace the stamp (null = load again from StreamingAssets).</summary>
        public static void Override(Stamp stamp) => current = stamp;

        private static Stamp LoadFromStreamingAssets()
        {
            string fallback = Application.version;
            try
            {
                string path = Path.Combine(Application.streamingAssetsPath, FileName);
                if (File.Exists(path)) return Stamp.Parse(File.ReadAllText(path), fallback);
            }
            catch (Exception error)
            {
                Debug.LogWarning($"[ReleaseInfo] Could not read {FileName}: {error.Message}");
            }
            return Stamp.Local(fallback);
        }

        /// <summary>One build's stamp. Pure; <see cref="Parse"/> never throws.</summary>
        [Serializable]
        public sealed class Stamp
        {
            public string Version = "";
            public string Channel = ChannelLocal;
            public string Commit = "";
            public string Built = "";

            public static Stamp Local(string version) => new Stamp { Version = version ?? "", Channel = ChannelLocal };

            /// <summary>Reads version.json text; anything missing or broken falls back to a local stamp.</summary>
            public static Stamp Parse(string json, string fallbackVersion)
            {
                Raw raw = null;
                try
                {
                    if (!string.IsNullOrWhiteSpace(json)) raw = JsonUtility.FromJson<Raw>(json);
                }
                catch (Exception)
                {
                    raw = null;
                }
                if (raw == null || string.IsNullOrWhiteSpace(raw.version)) return Local(fallbackVersion);
                return new Stamp
                {
                    Version = raw.version.Trim(),
                    Channel = NormaliseChannel(raw.channel),
                    Commit = (raw.commit ?? "").Trim(),
                    Built = (raw.built ?? "").Trim(),
                };
            }

            /// <summary>alpha/beta/release as given (any case); anything else is local.</summary>
            public static string NormaliseChannel(string channel)
            {
                string value = (channel ?? "").Trim().ToLowerInvariant();
                return value == ChannelAlpha || value == ChannelBeta || value == ChannelRelease ? value : ChannelLocal;
            }

            public string SemVer
            {
                get
                {
                    int plus = Version.IndexOf('+');
                    return plus < 0 ? Version : Version.Substring(0, plus);
                }
            }

            /// <summary>Core version, e.g. <c>0.1.0</c> from <c>0.1.0-alpha.3+abc</c>.</summary>
            public string Core
            {
                get
                {
                    string semVer = SemVer;
                    int dash = semVer.IndexOf('-');
                    return dash < 0 ? semVer : semVer.Substring(0, dash);
                }
            }

            /// <summary>The N of <c>-alpha.N</c> / <c>-beta.N</c>, or null.</summary>
            public int? PreReleaseNumber
            {
                get
                {
                    string semVer = SemVer;
                    int dash = semVer.IndexOf('-');
                    if (dash < 0) return null;
                    string pre = semVer.Substring(dash + 1);
                    int dot = pre.LastIndexOf('.');
                    if (dot < 0) return null;
                    return int.TryParse(pre.Substring(dot + 1), out int number) ? number : (int?)null;
                }
            }

            public string ShortCommit => Commit.Length > 8 ? Commit.Substring(0, 8) : Commit;

            public bool IsAlpha => Channel == ChannelAlpha;

            /// <summary>"Alpha", "Beta", "Release" or "This computer".</summary>
            public string ChannelName => Channel switch
            {
                ChannelAlpha => "Alpha",
                ChannelBeta => "Beta",
                ChannelRelease => "Release",
                _ => "This computer",
            };

            /// <summary>"Alpha 0.1.0 (3)", "Beta 0.2.0 (1)", "0.3.0" (release) or "0.1.0-dev (this computer)".</summary>
            public string Label
            {
                get
                {
                    switch (Channel)
                    {
                        case ChannelAlpha:
                        case ChannelBeta:
                            int? number = PreReleaseNumber;
                            return number.HasValue ? $"{ChannelName} {Core} ({number})" : $"{ChannelName} {SemVer}";
                        case ChannelRelease:
                            return SemVer;
                        default:
                            return $"{SemVer} (this computer)";
                    }
                }
            }

            public string WindowTitle => Channel == ChannelRelease ? "Ringside Booker" : $"Ringside Booker — {Label}";

            /// <summary>The built date at day precision ("20 Nov 2026"), or "" when unknown.</summary>
            public string BuiltDay
            {
                get
                {
                    if (!DateTime.TryParse(Built, System.Globalization.CultureInfo.InvariantCulture,
                            System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal,
                            out DateTime when)) return "";
                    return when.ToString("d MMM yyyy", System.Globalization.CultureInfo.InvariantCulture);
                }
            }

            [Serializable]
            private sealed class Raw
            {
                public string version;
                public string channel;
                public string commit;
                public string built;
            }
        }
    }
}
