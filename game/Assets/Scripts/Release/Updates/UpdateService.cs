using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using UnityEngine;
using UnityEngine.Networking;

namespace RingsideBooker.Release.Updates
{
    public enum UpdateStatus
    {
        /// <summary>No check this session (and none cached).</summary>
        Idle,
        Checking,
        /// <summary>The last check found nothing newer.</summary>
        UpToDate,
        /// <summary>A newer release is waiting (<see cref="UpdateService.Offer"/>).</summary>
        Available,
        /// <summary>The last check could not reach GitHub (offline, rate limit, bad answer).</summary>
        Failed,
    }

    /// <summary>
    /// The update check (POL9-11). At start-up, at most once a day (<see cref="UpdateSchedule"/>), and
    /// only when "Check for updates automatically" is on, it asks the public GitHub Releases API
    /// (<see cref="UpdateFeed.ApiUrl"/>, no auth, a generic User-Agent, nothing personal) for the newest
    /// published release on this build's channel. Offline or any error: nothing is shown. The last offer
    /// is cached in <c>persistentDataPath/update-check.json</c>, so the chip still shows on a day with
    /// no check. Local builds (no version.json) and dev runs (<c>-rb…</c>) never check by themselves.
    /// <para>Dev: <c>-rbFakeUpdate &lt;releases json&gt;</c> reads the release list from that file
    /// instead of the network, and the installer is never started (see <see cref="InstallerLauncher"/>).</para>
    /// Events are raised on the main thread.
    /// </summary>
    public static class UpdateService
    {
        public const string FakeArgument = "-rbFakeUpdate";
        public const string CacheFileName = "update-check.json";
        public const int TimeoutSeconds = 15;

        private static UnityWebRequest request;

        public static UpdateStatus Status { get; private set; } = UpdateStatus.Idle;

        /// <summary>The newest release this build may take, or null.</summary>
        public static ReleaseEntry Offer { get; private set; }

        /// <summary>When the last successful check ran (this computer), or null.</summary>
        public static DateTime? LastCheckUtc => UpdatePrefs.LastCheckUtc;

        /// <summary>True when the release list comes from <see cref="FakeArgument"/> (no network, no installer).</summary>
        public static bool IsFake => fakeFeedPath != null;

        private static string fakeFeedPath;

        /// <summary>Raised on the main thread when <see cref="Status"/> or <see cref="Offer"/> changes.</summary>
        public static event Action Changed;

        /// <summary>The chip shows: a newer release that the player hasn't skipped.</summary>
        public static bool ShowChip => Offer != null && !UpdatePrefs.IsSkipped(Offer.Version);

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void StartUp()
        {
            Status = UpdateStatus.Idle;
            Offer = null;
            fakeFeedPath = null;
            if (Application.isBatchMode) return;

            string[] args = Environment.GetCommandLineArgs();
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (string.Equals(args[i], FakeArgument, StringComparison.OrdinalIgnoreCase))
                {
                    UseFakeFeed(args[i + 1]);
                    return;
                }
            }

            if (WhatsNewState.IsDevRun || ReleaseInfo.Channel == ReleaseInfo.ChannelLocal) return;
            LoadCache();
            if (UpdateSchedule.ShouldCheck(UpdatePrefs.Automatic, UpdatePrefs.LastCheckUtc, DateTime.UtcNow)) CheckNow(manual: false);
        }

        /// <summary>Dev and tours: read the release list from a file from now on (and check at once).</summary>
        public static void UseFakeFeed(string path)
        {
            fakeFeedPath = path;
            Debug.Log($"[Update] fake release list: {path} (no network; the installer is never started)");
            CheckNow(manual: false);
        }

        /// <summary>
        /// Checks now. A manual check (Settings › About › Check now) also forgets a skipped version, so
        /// the player who asks sees the newest release again. Does nothing while a check is running.
        /// </summary>
        public static void CheckNow(bool manual)
        {
            if (Status == UpdateStatus.Checking) return;
            if (manual) UpdatePrefs.Skipped = string.Empty;

            if (fakeFeedPath != null)
            {
                string text;
                try
                {
                    text = File.ReadAllText(fakeFeedPath);
                }
                catch (Exception error)
                {
                    Debug.LogWarning($"[Update] fake release list unreadable: {error.Message}");
                    SetStatus(UpdateStatus.Failed);
                    return;
                }
                List<ReleaseEntry> fake = UpdateFeed.Parse(text);
                ResolveFakeAssets(fake, Path.GetDirectoryName(Path.GetFullPath(fakeFeedPath)));
                Apply(fake, cache: false);
                return;
            }

            SetStatus(UpdateStatus.Checking);
            try
            {
                request = UnityWebRequest.Get(UpdateFeed.ApiUrl);
                request.timeout = TimeoutSeconds;
                request.SetRequestHeader("User-Agent", UpdateFeed.UserAgent(ReleaseInfo.SemVer));
                request.SetRequestHeader("Accept", "application/vnd.github+json");
                request.SendWebRequest().completed += _ => Finish(request);
            }
            catch (Exception error)
            {
                Debug.Log($"[Update] check not started: {error.Message}");
                request = null;
                SetStatus(UpdateStatus.Failed);
            }
        }

        // A fake list may name its installer by a path relative to the list (a local file:// download).
        private static void ResolveFakeAssets(List<ReleaseEntry> releases, string folder)
        {
            foreach (ReleaseEntry release in releases)
            {
                foreach (ReleaseAsset asset in release.Assets)
                {
                    if (string.IsNullOrEmpty(asset.Url) || asset.Url.Contains("://")) continue;
                    asset.Url = new Uri(Path.Combine(folder, asset.Url)).AbsoluteUri;
                }
            }
        }

        private static void Finish(UnityWebRequest done)
        {
            if (done != request) return;
            request = null;
            try
            {
                if (done.result != UnityWebRequest.Result.Success)
                {
                    // Offline, DNS, rate limit (403), anything: stay quiet; the chip keeps any cached offer.
                    Debug.Log($"[Update] check failed: {done.result} {done.responseCode}");
                    SetStatus(UpdateStatus.Failed);
                    return;
                }
                List<ReleaseEntry> releases = UpdateFeed.Parse(done.downloadHandler.text);
                UpdatePrefs.LastCheckUtc = DateTime.UtcNow;
                Apply(releases, cache: true);
            }
            finally
            {
                done.Dispose();
            }
        }

        private static void Apply(List<ReleaseEntry> releases, bool cache)
        {
            ReleaseEntry newest = UpdateFeed.Newest(releases, ReleaseInfo.SemVer, ReleaseInfo.Channel);
            Offer = newest;
            Debug.Log(newest != null
                ? $"[Update] {releases.Count} releases; newer on {ReleaseInfo.Channel}: {newest.Version} (installer {(newest.Installer != null ? UpdateFeed.Megabytes(newest.Installer.Size) : "missing")})"
                : $"[Update] {releases.Count} releases; {ReleaseInfo.SemVer} is the newest on {ReleaseInfo.Channel}");
            if (cache) SaveCache(newest);
            SetStatus(newest != null ? UpdateStatus.Available : UpdateStatus.UpToDate);
        }

        /// <summary>"Skip this version": the chip stays hidden until a newer one (or a manual check).</summary>
        public static void Skip(ReleaseEntry release)
        {
            if (release?.Version == null) return;
            UpdatePrefs.Skipped = release.Version.ToString();
            Changed?.Invoke();
        }

        private static void SetStatus(UpdateStatus status)
        {
            Status = status;
            Changed?.Invoke();
        }

        private static string CachePath => Path.Combine(Application.persistentDataPath, CacheFileName);

        private static void LoadCache()
        {
            try
            {
                if (!File.Exists(CachePath)) return;
                // The cached release is re-checked against this build: after an update it is no longer newer.
                ReleaseEntry cached = UpdateFeed.Newest(UpdateFeed.Parse(File.ReadAllText(CachePath)), ReleaseInfo.SemVer, ReleaseInfo.Channel);
                if (cached == null) return;
                Offer = cached;
                Status = UpdateStatus.Available;
            }
            catch (Exception error)
            {
                Debug.Log($"[Update] cache unreadable: {error.Message}");
            }
        }

        private static void SaveCache(ReleaseEntry offer)
        {
            try
            {
                if (offer == null)
                {
                    if (File.Exists(CachePath)) File.Delete(CachePath);
                    return;
                }
                File.WriteAllText(CachePath, UpdateFeed.ToJson(offer));
            }
            catch (Exception error)
            {
                Debug.Log($"[Update] cache not written: {error.Message}");
            }
        }

        /// <summary>The page to send the player to when the in-game update can't finish.</summary>
        public static string DownloadPage(ReleaseEntry release) =>
            release != null && release.HtmlUrl.StartsWith("https://github.com/", StringComparison.Ordinal) ? release.HtmlUrl : UpdateFeed.ReleasesPage;

        /// <summary>Opens <see cref="DownloadPage"/> in the browser (only logged on a fake run).</summary>
        public static void OpenDownloadPage(ReleaseEntry release)
        {
            string url = DownloadPage(release);
            if (IsFake)
            {
                Debug.Log($"[Update] (fake) would open {url}");
                return;
            }
            Application.OpenURL(url);
        }

        /// <summary>Tests and tours: set the state directly.</summary>
        public static void OverrideForTesting(ReleaseEntry offer, UpdateStatus status)
        {
            Offer = offer;
            SetStatus(status);
        }
    }

    /// <summary>The update settings, kept on this computer (PlayerPrefs), never in a save.</summary>
    public static class UpdatePrefs
    {
        public const string AutomaticKey = "rb.update.automatic";
        public const string LastCheckKey = "rb.update.lastCheckUtc";
        public const string SkippedKey = "rb.update.skippedVersion";

        /// <summary>Settings › About › "Check for updates automatically" (on by default).</summary>
        public static bool Automatic
        {
            get => Get(() => PlayerPrefs.GetInt(AutomaticKey, 1) != 0, true);
            set => Set(() => PlayerPrefs.SetInt(AutomaticKey, value ? 1 : 0));
        }

        public static DateTime? LastCheckUtc
        {
            get
            {
                string text = Get(() => PlayerPrefs.GetString(LastCheckKey, string.Empty), string.Empty);
                return DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out DateTime when)
                    ? when
                    : (DateTime?)null;
            }
            set => Set(() => PlayerPrefs.SetString(LastCheckKey, value?.ToString("o", CultureInfo.InvariantCulture) ?? string.Empty));
        }

        /// <summary>The version the player chose to skip (<c>0.1.0-alpha.2</c>), or "".</summary>
        public static string Skipped
        {
            get => Get(() => PlayerPrefs.GetString(SkippedKey, string.Empty), string.Empty);
            set => Set(() => PlayerPrefs.SetString(SkippedKey, value ?? string.Empty));
        }

        public static bool IsSkipped(SemVersion version) => version != null && Skipped == version.ToString();

        private static T Get<T>(Func<T> read, T fallback)
        {
            try
            {
                return read();
            }
            catch (Exception)
            {
                return fallback;
            }
        }

        private static void Set(Action write)
        {
            try
            {
                write();
                PlayerPrefs.Save();
            }
            catch (Exception error)
            {
                Debug.LogWarning($"[Update] setting not saved: {error.Message}");
            }
        }
    }
}
