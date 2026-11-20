using System;
using System.Collections.Generic;
using System.Globalization;
using Newtonsoft.Json.Linq;

namespace RingsideBooker.Release.Updates
{
    /// <summary>One file attached to a GitHub release.</summary>
    public sealed class ReleaseAsset
    {
        public string Name = string.Empty;
        public long Size;
        public string Url = string.Empty;
    }

    /// <summary>One release from the GitHub Releases API, reduced to what the update check needs.</summary>
    public sealed class ReleaseEntry
    {
        public string Tag = string.Empty;
        public string Name = string.Empty;
        public string Body = string.Empty;
        public bool Draft;
        public bool Prerelease;
        public string HtmlUrl = string.Empty;
        public string PublishedAt = string.Empty;
        public List<ReleaseAsset> Assets = new List<ReleaseAsset>();

        /// <summary>The version from the tag (<c>v0.1.0-alpha.2</c>), else from the name; null when neither parses.</summary>
        public SemVersion Version;

        /// <summary><c>alpha</c>, <c>beta</c> or <c>release</c> (see <see cref="UpdateFeed.ChannelOf"/>).</summary>
        public string Channel = ReleaseInfo.ChannelRelease;

        /// <summary>The <c>RingsideBooker-Setup-*.exe</c> asset, or null when the release has none.</summary>
        public ReleaseAsset Installer
        {
            get
            {
                foreach (ReleaseAsset asset in Assets)
                {
                    if (UpdateFeed.IsInstallerName(asset.Name)) return asset;
                }
                return null;
            }
        }

        /// <summary>The published day ("27 Nov 2026"), or "" when unknown.</summary>
        public string PublishedDay
        {
            get
            {
                return DateTime.TryParse(PublishedAt, CultureInfo.InvariantCulture,
                    DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out DateTime when)
                    ? when.ToString("d MMM yyyy", CultureInfo.InvariantCulture)
                    : string.Empty;
            }
        }
    }

    /// <summary>
    /// The update check's pure rules (POL9-11): read the Releases API's JSON, keep the published
    /// releases a build's channel may take, and pick the newest one above the running version. No
    /// network here; <see cref="UpdateService"/> fetches.
    /// </summary>
    public static class UpdateFeed
    {
        public const string Repository = "jpDxsoloOrg/ringside-booker";

        /// <summary>
        /// The newest ten releases, drafts included only for people who can edit the repo (the game
        /// asks without auth, so GitHub never sends drafts; they are skipped here as well). Not
        /// <c>/releases/latest</c>: that one ignores prereleases, and every Alpha is a prerelease.
        /// </summary>
        public const string ApiUrl = "https://api.github.com/repos/" + Repository + "/releases?per_page=10";

        /// <summary>Where "Open the download page" goes when a release has no page of its own.</summary>
        public const string ReleasesPage = "https://github.com/" + Repository + "/releases";

        public const string InstallerPrefix = "RingsideBooker-Setup-";

        /// <summary>The generic User-Agent GitHub requires: <c>RingsideBooker/0.1.0-alpha.1</c>. Nothing personal.</summary>
        public static string UserAgent(string semVer) => "RingsideBooker/" + (string.IsNullOrEmpty(semVer) ? "dev" : semVer);

        public static bool IsInstallerName(string name) =>
            !string.IsNullOrEmpty(name)
            && name.StartsWith(InstallerPrefix, StringComparison.OrdinalIgnoreCase)
            && name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
            && name.IndexOfAny(new[] { '/', '\\' }) < 0;

        /// <summary>
        /// Reads the API's array of releases. Never throws: broken JSON gives an empty list, and an entry
        /// without a readable version is kept with <see cref="ReleaseEntry.Version"/> null (never offered).
        /// </summary>
        public static List<ReleaseEntry> Parse(string json)
        {
            var releases = new List<ReleaseEntry>();
            JArray array;
            try
            {
                array = JToken.Parse(json ?? string.Empty) as JArray;
            }
            catch (Exception)
            {
                return releases;
            }
            if (array == null) return releases;

            foreach (JToken token in array)
            {
                if (!(token is JObject item)) continue;
                var entry = new ReleaseEntry
                {
                    Tag = Str(item, "tag_name"),
                    Name = Str(item, "name"),
                    Body = Str(item, "body"),
                    Draft = Bool(item, "draft"),
                    Prerelease = Bool(item, "prerelease"),
                    HtmlUrl = Str(item, "html_url"),
                    PublishedAt = Str(item, "published_at"),
                };
                if (item["assets"] is JArray assets)
                {
                    foreach (JToken assetToken in assets)
                    {
                        if (!(assetToken is JObject asset)) continue;
                        entry.Assets.Add(new ReleaseAsset
                        {
                            Name = Str(asset, "name"),
                            Size = asset["size"] != null && asset["size"].Type == JTokenType.Integer ? (long)asset["size"] : 0,
                            Url = Str(asset, "browser_download_url"),
                        });
                    }
                }
                entry.Version = SemVersion.Parse(entry.Tag) ?? SemVersion.Parse(entry.Name);
                entry.Channel = ChannelOf(entry.Version, entry.Prerelease);
                releases.Add(entry);
            }
            return releases;
        }

        /// <summary>
        /// A release's channel from its version: <c>-alpha.N</c> is alpha; any other pre-release
        /// (<c>-beta.N</c>, <c>-rc.N</c>) is beta; a plain version is a release, unless GitHub marks it
        /// a prerelease, which makes it beta.
        /// </summary>
        public static string ChannelOf(SemVersion version, bool prereleaseFlag)
        {
            if (version == null) return prereleaseFlag ? ReleaseInfo.ChannelBeta : ReleaseInfo.ChannelRelease;
            if (version.PreLabel == ReleaseInfo.ChannelAlpha) return ReleaseInfo.ChannelAlpha;
            if (version.IsPreRelease || prereleaseFlag) return ReleaseInfo.ChannelBeta;
            return ReleaseInfo.ChannelRelease;
        }

        /// <summary>
        /// Which releases a build may take: an alpha build takes alpha, beta and full releases; a beta
        /// build takes beta and full releases; a release build only full releases. A local build (no
        /// version.json) is treated like alpha, but never checks by itself (<see cref="UpdateService"/>).
        /// </summary>
        public static bool Accepts(string buildChannel, string releaseChannel)
        {
            int Rank(string channel) => channel switch
            {
                ReleaseInfo.ChannelAlpha => 0,
                ReleaseInfo.ChannelBeta => 1,
                ReleaseInfo.ChannelRelease => 2,
                _ => 0,
            };
            if (releaseChannel != ReleaseInfo.ChannelAlpha && releaseChannel != ReleaseInfo.ChannelBeta && releaseChannel != ReleaseInfo.ChannelRelease) return false;
            return Rank(releaseChannel) >= Rank(buildChannel);
        }

        /// <summary>
        /// The newest published release on <paramref name="buildChannel"/> that is newer than
        /// <paramref name="currentVersion"/>, or null. Drafts and releases without a version never count.
        /// </summary>
        public static ReleaseEntry Newest(IEnumerable<ReleaseEntry> releases, string currentVersion, string buildChannel)
        {
            SemVersion current = SemVersion.Parse(currentVersion);
            if (current == null || releases == null) return null;
            ReleaseEntry best = null;
            foreach (ReleaseEntry release in releases)
            {
                if (release == null || release.Draft || release.Version == null) continue;
                if (!Accepts(buildChannel, release.Channel)) continue;
                if (!SemVersion.IsNewer(release.Version, current)) continue;
                if (best == null || release.Version.CompareTo(best.Version) > 0) best = release;
            }
            return best;
        }

        /// <summary>The release as JSON (the API's field names), so it can be cached and read back with <see cref="Parse"/>.</summary>
        public static string ToJson(ReleaseEntry release)
        {
            var assets = new JArray();
            foreach (ReleaseAsset asset in release.Assets)
            {
                assets.Add(new JObject { ["name"] = asset.Name, ["size"] = asset.Size, ["browser_download_url"] = asset.Url });
            }
            var item = new JObject
            {
                ["tag_name"] = release.Tag,
                ["name"] = release.Name,
                ["body"] = release.Body,
                ["draft"] = release.Draft,
                ["prerelease"] = release.Prerelease,
                ["html_url"] = release.HtmlUrl,
                ["published_at"] = release.PublishedAt,
                ["assets"] = assets,
            };
            return new JArray { item }.ToString(Newtonsoft.Json.Formatting.None);
        }

        /// <summary>A size check for a finished download: null when it matches, else the problem in plain words.</summary>
        public static string CheckSize(long actualBytes, long expectedBytes)
        {
            if (expectedBytes <= 0) return "The release didn't say how big the installer is, so the download can't be checked.";
            if (actualBytes == expectedBytes) return null;
            return actualBytes < expectedBytes
                ? "The download stopped before the end."
                : "The download is bigger than the release says.";
        }

        /// <summary>"38.4 MB": one decimal, 1 MB = 1 048 576 bytes (as Windows Explorer counts).</summary>
        public static string Megabytes(long bytes) =>
            (bytes / 1048576.0).ToString("0.0", CultureInfo.InvariantCulture) + " MB";

        private static string Str(JObject item, string key)
        {
            JToken value = item[key];
            return value == null || value.Type == JTokenType.Null ? string.Empty : value.ToString();
        }

        private static bool Bool(JObject item, string key)
        {
            JToken value = item[key];
            return value != null && value.Type == JTokenType.Boolean && (bool)value;
        }
    }

    /// <summary>When the automatic check runs: at most once a day (pure).</summary>
    public static class UpdateSchedule
    {
        public static readonly TimeSpan Interval = TimeSpan.FromHours(24);

        public static bool ShouldCheck(bool automatic, DateTime? lastCheckUtc, DateTime nowUtc)
        {
            if (!automatic) return false;
            if (lastCheckUtc == null) return true;
            // A clock moved backwards counts as due, so a bad stamp can't block checks for good.
            if (lastCheckUtc.Value > nowUtc) return true;
            return nowUtc - lastCheckUtc.Value >= Interval;
        }
    }
}
