using System;
using System.Diagnostics;
using System.IO;
using UnityEngine.Networking;
using Debug = UnityEngine.Debug;

namespace RingsideBooker.Release.Updates
{
    /// <summary>
    /// Downloads a release's installer (POL9-11) to <c>%TEMP%\RingsideBooker-Update\</c> with
    /// progress, then checks the file's size against the release's. Poll <see cref="Progress"/> and
    /// <see cref="IsDone"/> from the UI (main thread). <see cref="Problem"/> is null on success.
    /// </summary>
    public sealed class UpdateDownload
    {
        public const string FolderName = "RingsideBooker-Update";

        private UnityWebRequest request;
        private bool cancelled;

        public ReleaseAsset Asset { get; }
        public string FilePath { get; }
        public bool IsDone { get; private set; }
        public string Problem { get; private set; }
        public bool Ok => IsDone && Problem == null;

        /// <summary>0–1 while downloading.</summary>
        public float Progress => IsDone ? 1f : request != null ? Math.Max(0f, request.downloadProgress) : 0f;

        public long BytesSoFar => IsDone ? Asset.Size : request != null ? (long)request.downloadedBytes : 0;

        public static string Folder => Path.Combine(Path.GetTempPath(), FolderName);

        private UpdateDownload(ReleaseAsset asset, string path)
        {
            Asset = asset;
            FilePath = path;
        }

        public static UpdateDownload Start(ReleaseAsset asset)
        {
            if (asset == null || !UpdateFeed.IsInstallerName(asset.Name) || string.IsNullOrEmpty(asset.Url))
            {
                var none = new UpdateDownload(asset, null);
                none.Fail("This release has no Windows installer to download.");
                return none;
            }

            string path = Path.Combine(Folder, Path.GetFileName(asset.Name));
            var download = new UpdateDownload(asset, path);
            try
            {
                Directory.CreateDirectory(Folder);
                // Older downloads (an earlier version, a failed try) go first.
                foreach (string old in Directory.GetFiles(Folder, UpdateFeed.InstallerPrefix + "*.exe")) File.Delete(old);
                download.request = new UnityWebRequest(asset.Url, UnityWebRequest.kHttpVerbGET)
                {
                    downloadHandler = new DownloadHandlerFile(path) { removeFileOnAbort = true },
                };
                download.request.SetRequestHeader("User-Agent", UpdateFeed.UserAgent(ReleaseInfo.SemVer));
                download.request.SendWebRequest().completed += _ => download.Finish();
                Debug.Log($"[Update] downloading {asset.Name} ({asset.Size} bytes) to %TEMP%\\{FolderName}");
            }
            catch (Exception error)
            {
                download.Fail($"The download couldn't start ({error.Message}).");
            }
            return download;
        }

        public void Cancel()
        {
            if (IsDone || request == null) return;
            cancelled = true;
            request.Abort();
        }

        private void Finish()
        {
            UnityWebRequest done = request;
            try
            {
                if (done.result != UnityWebRequest.Result.Success)
                {
                    Fail(cancelled ? "Download cancelled." : "The download didn't finish. Check your internet connection.");
                    Debug.Log($"[Update] download failed: {done.result} {done.responseCode} {done.error}");
                    return;
                }
                long actual = File.Exists(FilePath) ? new FileInfo(FilePath).Length : -1;
                string problem = UpdateFeed.CheckSize(actual, Asset.Size);
                if (problem != null)
                {
                    Debug.Log($"[Update] size check failed: {actual} bytes, release says {Asset.Size}");
                    TryDelete();
                    Fail(problem);
                    return;
                }
                Debug.Log($"[Update] downloaded {actual} bytes; size matches");
                IsDone = true;
            }
            finally
            {
                done.Dispose();
                request = null;
            }
        }

        private void Fail(string problem)
        {
            Problem = problem;
            IsDone = true;
        }

        private void TryDelete()
        {
            try
            {
                if (FilePath != null && File.Exists(FilePath)) File.Delete(FilePath);
            }
            catch (Exception)
            {
                // A locked temp file is harmless; the next download clears the folder.
            }
        }
    }

    /// <summary>
    /// Starts the downloaded Inno Setup installer (POL9-11). The game saves first and quits right
    /// after (the UI does that), so the installer can replace its files.
    /// <para><b>Flags:</b> <c>/SILENT</c> (a progress window, no wizard pages: the licence and the
    /// folder were chosen at the first install, and Inno reuses the folder and the per-user/all-users
    /// choice), <c>/CLOSEAPPLICATIONS</c> (if the game is still closing, the Restart Manager closes it;
    /// the save is already on disk), <c>/NORESTART</c>, and <c>/RBUPDATE</c>, our own switch: the
    /// installer starts the game again when it is done (RingsideBooker.iss, [Run]). Not
    /// <c>/VERYSILENT</c>: the player should see that something is installing.</para>
    /// </summary>
    public static class InstallerLauncher
    {
        public const string Arguments = "/SILENT /CLOSEAPPLICATIONS /NORESTART /RBUPDATE";

        /// <summary>Starts <paramref name="path"/>; returns null when it started, else the problem. Fake runs only log.</summary>
        public static string Launch(string path)
        {
            if (UpdateService.IsFake)
            {
                Debug.Log($"[Update] (fake) would start {Path.GetFileName(path)} {Arguments}");
                return null;
            }
            try
            {
                if (!File.Exists(path)) return "The downloaded installer is missing.";
                var start = new ProcessStartInfo(path, Arguments)
                {
                    UseShellExecute = true,
                    WorkingDirectory = Path.GetDirectoryName(path) ?? string.Empty,
                };
                Process.Start(start);
                Debug.Log($"[Update] started {Path.GetFileName(path)} {Arguments}");
                return null;
            }
            catch (Exception error)
            {
                // E.g. the player said no to Windows' "Do you want to allow…" prompt.
                Debug.Log($"[Update] installer did not start: {error.Message}");
                return "The installer didn't start.";
            }
        }
    }
}
