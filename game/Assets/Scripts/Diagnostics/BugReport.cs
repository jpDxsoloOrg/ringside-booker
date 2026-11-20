using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.Release;
using RingsideBooker.Saves;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Settings;
using UnityEngine;

namespace RingsideBooker.Diagnostics
{
    /// <summary>One file in the bug report zip: copied from disk, or written from text.</summary>
    public sealed class BugReportEntry
    {
        private BugReportEntry(string name, string sourcePath, string text)
        {
            Name = name;
            SourcePath = sourcePath;
            Text = text;
        }

        /// <summary>The path inside the zip (forward slashes).</summary>
        public string Name { get; }

        /// <summary>The file to copy, or null for <see cref="Text"/>.</summary>
        public string SourcePath { get; }

        public string Text { get; }

        public static BugReportEntry FromFile(string name, string sourcePath) => new BugReportEntry(name, sourcePath, null);

        public static BugReportEntry FromText(string name, string text) => new BugReportEntry(name, null, text ?? string.Empty);
    }

    /// <summary>
    /// The one-file bug report (POL1-02, Alpha scope): a zip of the game's log (Player.log and the
    /// previous run's), the current save and its header, version.json and the settings, plus a
    /// report.txt that says what happened and what the zip holds. Saved in
    /// <c>persistentDataPath/BugReports/</c> (the newest <see cref="KeepReports"/> are kept).
    /// Nothing personal beyond what the log already holds: no computer or user name is added, and
    /// nothing typed into the game.
    /// </summary>
    public static class BugReport
    {
        public const string FolderName = "BugReports";
        public const int KeepReports = 10;
        public const string ReportEntry = "report.txt";
        public const string SettingsEntry = "settings.json";
        public const string VersionEntry = "version.json";

        /// <summary>Where the zips go.</summary>
        public static string Directory => Path.Combine(Application.persistentDataPath, FolderName);

        /// <summary>The newest zip made this session, or null.</summary>
        public static string LastZip { get; private set; }

        /// <summary><c>ringside-bug-report-2026-11-19-1432-05.zip</c> for a local time.</summary>
        public static string FileName(DateTime localNow) =>
            "ringside-bug-report-" + localNow.ToString("yyyy-MM-dd-HHmm-ss", CultureInfo.InvariantCulture) + ".zip";

        /// <summary>Builds the zip and returns its path (main thread; the copy is quick, a few MB).</summary>
        public static string CreateZip(EngineFault fault = null)
        {
            List<BugReportEntry> entries = Gather(fault ?? EngineRuntime.LastFault);
            string path = NewZipPath();
            WriteZip(path, entries);
            Finish(path);
            return path;
        }

        /// <summary><see cref="CreateZip"/> with the file work on the thread pool. Call on the main thread.</summary>
        public static async Task<string> CreateZipAsync(EngineFault fault = null)
        {
            List<BugReportEntry> entries = Gather(fault ?? EngineRuntime.LastFault);
            string path = NewZipPath();
            await Task.Run(() => WriteZip(path, entries));
            Finish(path);
            return path;
        }

        /// <summary>
        /// Writes <paramref name="entries"/> to a new zip at <paramref name="path"/>. A source file that
        /// is missing or unreadable becomes <c>&lt;name&gt;.missing.txt</c> with the reason; only a
        /// zip that can't be written at all throws. Log files still being written are read shared.
        /// </summary>
        public static void WriteZip(string path, IEnumerable<BugReportEntry> entries)
        {
            System.IO.Directory.CreateDirectory(Path.GetDirectoryName(path));
            string temp = path + ".part";
            using (var file = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None))
            using (var zip = new ZipArchive(file, ZipArchiveMode.Create))
            {
                foreach (BugReportEntry entry in entries)
                {
                    if (entry.SourcePath == null)
                    {
                        AddText(zip, entry.Name, entry.Text);
                        continue;
                    }

                    try
                    {
                        using (var source = new FileStream(entry.SourcePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                        using (Stream target = zip.CreateEntry(entry.Name, System.IO.Compression.CompressionLevel.Optimal).Open())
                        {
                            source.CopyTo(target);
                        }
                    }
                    catch (Exception error) when (error is IOException || error is UnauthorizedAccessException)
                    {
                        AddText(zip, entry.Name + ".missing.txt", $"Could not add {Path.GetFileName(entry.SourcePath)}: {error.Message}");
                    }
                }
            }

            if (File.Exists(path)) File.Delete(path);
            File.Move(temp, path);
        }

        /// <summary>The report.txt text: what happened, the build, the game, and what the zip holds.</summary>
        public static string Summary(BugReportFacts facts)
        {
            var text = new StringBuilder();
            text.AppendLine($"Ringside Booker bug report ({facts.ChannelName} {facts.Version})");
            text.AppendLine($"Made: {facts.MadeAt.ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture)} UTC");
            text.AppendLine($"Build: version {facts.Version}, channel {facts.Channel}, commit {facts.Commit ?? "unknown"}, built {facts.Built ?? "unknown"}");
            text.AppendLine($"Engine: {facts.EngineVersion ?? "unknown"}");
            text.AppendLine($"System: {facts.System}");
            text.AppendLine();
            if (facts.Fault != null)
            {
                text.AppendLine(facts.Fault.AtStart ? "What happened: the simulation could not start." : "What happened: the simulation stopped.");
                text.AppendLine($"Call: {facts.Fault.Call}");
                text.AppendLine($"Error: {facts.Fault.Message}");
                text.AppendLine($"At: {facts.Fault.At.ToUniversalTime().ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture)} UTC");
            }
            else
            {
                text.AppendLine("What happened: sent from the game (no engine error this session).");
            }

            text.AppendLine();
            if (facts.SlotId != null)
            {
                text.AppendLine($"Save: {facts.SlotLabel ?? facts.SlotId} ({facts.SlotId}), game date {facts.GameDate ?? "unknown"}, saved {facts.SavedAt ?? "unknown"}");
            }
            else
            {
                text.AppendLine("Save: none (no game has been saved yet).");
            }

            text.AppendLine();
            text.AppendLine("In this zip:");
            text.AppendLine("- report.txt: this summary");
            text.AppendLine("- Player.log (and Player-prev.log): the game's log for this run and the one before");
            text.AppendLine(facts.SlotId != null ? "- save/: the current save and its header, so the problem can be replayed" : "- no save");
            text.AppendLine("- version.json: the build's version");
            text.AppendLine("- settings.json: the game's settings and the computer's screen, graphics and memory");
            if (facts.Fault?.Detail != null)
            {
                text.AppendLine();
                text.AppendLine("Error details:");
                text.AppendLine(facts.Fault.Detail);
            }

            return text.ToString();
        }

        /// <summary>The words for a release channel ("Alpha", "Beta"; empty for a release).</summary>
        public static string ChannelName(string channel)
        {
            if (string.IsNullOrEmpty(channel) || string.Equals(channel, "release", StringComparison.OrdinalIgnoreCase)) return string.Empty;
            return char.ToUpperInvariant(channel[0]) + channel.Substring(1).ToLowerInvariant();
        }

        /// <summary>Deletes all but the newest <paramref name="keep"/> zips in <paramref name="directory"/>.</summary>
        public static void Prune(string directory, int keep)
        {
            if (!System.IO.Directory.Exists(directory)) return;
            foreach (FileInfo old in new DirectoryInfo(directory).GetFiles("ringside-bug-report-*.zip")
                         .OrderByDescending(file => file.LastWriteTimeUtc).Skip(keep))
            {
                try
                {
                    old.Delete();
                }
                catch (IOException)
                {
                    // In use: next time.
                }
            }
        }

        // Windows paths read and paste better with one kind of slash (persistentDataPath uses '/').
        private static string NewZipPath()
        {
            string path = Path.Combine(Directory, FileName(DateTime.Now));
            return Application.platform == RuntimePlatform.WindowsPlayer || Application.platform == RuntimePlatform.WindowsEditor
                ? path.Replace('/', '\\')
                : path;
        }

        private static void Finish(string path)
        {
            LastZip = path;
            Prune(Directory, KeepReports);
            Debug.Log("[BugReport] saved " + path);
        }

        // Main thread: Unity's values and the file list.
        private static List<BugReportEntry> Gather(EngineFault fault)
        {
            var entries = new List<BugReportEntry>();
            SaveSlotInfo slot = CurrentSlot(out SaveStore store);
            EngineClient client = EngineRuntime.Client;
            EngineInfo info = client != null && client.Ready.IsCompleted && !client.Ready.IsFaulted ? client.Ready.Result : null;
            var facts = new BugReportFacts
            {
                Version = ReleaseInfo.Version,
                Channel = ReleaseInfo.Channel,
                ChannelName = ChannelName(ReleaseInfo.Channel),
                Commit = ReleaseInfo.Commit,
                Built = ReleaseInfo.Built,
                EngineVersion = info?.EngineVersion,
                System = $"{SystemInfo.operatingSystem}; {SystemInfo.processorType} ×{SystemInfo.processorCount}; {SystemInfo.systemMemorySize} MB; {SystemInfo.graphicsDeviceName}",
                MadeAt = DateTimeOffset.Now,
                Fault = fault,
                SlotId = slot?.SlotId,
                SlotLabel = slot?.Label,
                GameDate = slot?.GameDate,
                SavedAt = slot?.SavedAt.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture),
            };
            entries.Add(BugReportEntry.FromText(ReportEntry, Summary(facts)));

            string log = Application.consoleLogPath;
            if (!string.IsNullOrEmpty(log))
            {
                entries.Add(BugReportEntry.FromFile(Path.GetFileName(log), log));
                string previous = Path.Combine(Path.GetDirectoryName(log) ?? string.Empty, Path.GetFileNameWithoutExtension(log) + "-prev" + Path.GetExtension(log));
                if (File.Exists(previous)) entries.Add(BugReportEntry.FromFile(Path.GetFileName(previous), previous));
            }

            if (slot != null)
            {
                entries.Add(BugReportEntry.FromFile("save/" + slot.SlotId + SaveStore.SaveExtension, store.SavePath(slot.SlotId)));
                entries.Add(BugReportEntry.FromFile("save/" + slot.SlotId + SaveStore.HeaderExtension, store.HeaderPath(slot.SlotId)));
            }

            entries.Add(File.Exists(ReleaseInfo.FilePath)
                ? BugReportEntry.FromFile(VersionEntry, ReleaseInfo.FilePath)
                : BugReportEntry.FromText(VersionEntry, new JObject
                {
                    ["version"] = ReleaseInfo.Version,
                    ["channel"] = ReleaseInfo.Channel,
                    ["commit"] = ReleaseInfo.Commit,
                    ["built"] = ReleaseInfo.Built,
                    ["note"] = "This build has no version.json; the values come from the player settings.",
                }.ToString(Formatting.Indented)));
            entries.Add(BugReportEntry.FromText(SettingsEntry, SettingsJson(info).ToString(Formatting.Indented)));
            return entries;
        }

        // The save the report carries: the running game's, else the one the engine stopped in, else the newest.
        private static SaveSlotInfo CurrentSlot(out SaveStore store)
        {
            store = GameSession.Current?.Store ?? new SaveStore();
            string slotId = GameSession.Current?.SlotId ?? CrashGuard.LastSlotId;
            try
            {
                return (slotId != null ? store.Find(slotId) : null) ?? store.Latest();
            }
            catch (Exception error) when (error is IOException || error is UnauthorizedAccessException || error is JsonException)
            {
                Debug.LogWarning("[BugReport] could not read the saves: " + error.Message);
                return null;
            }
        }

        private static JObject SettingsJson(EngineInfo info)
        {
            return new JObject
            {
                ["game"] = new JObject
                {
                    ["uiScale"] = UiSettings.Scale,
                    ["sidebarCollapsed"] = PlayerPrefs.GetInt("rb.ui.sidebarCollapsed", 0) == 1,
                    ["engineVersion"] = info?.EngineVersion,
                    ["saveFormatVersion"] = info?.SaveFormatVersion,
                    ["unity"] = Application.unityVersion,
                    ["language"] = Application.systemLanguage.ToString(),
                },
                ["screen"] = new JObject
                {
                    ["window"] = $"{Screen.width}x{Screen.height}",
                    ["mode"] = Screen.fullScreenMode.ToString(),
                    ["display"] = $"{Screen.currentResolution.width}x{Screen.currentResolution.height}",
                    ["dpi"] = Screen.dpi,
                    ["quality"] = QualitySettings.names.Length > 0 ? QualitySettings.names[QualitySettings.GetQualityLevel()] : null,
                },
                ["system"] = new JObject
                {
                    ["os"] = SystemInfo.operatingSystem,
                    ["cpu"] = SystemInfo.processorType,
                    ["cores"] = SystemInfo.processorCount,
                    ["memoryMb"] = SystemInfo.systemMemorySize,
                    ["gpu"] = SystemInfo.graphicsDeviceName,
                    ["gpuApi"] = SystemInfo.graphicsDeviceType.ToString(),
                    ["gpuMemoryMb"] = SystemInfo.graphicsMemorySize,
                },
            };
        }

        private static void AddText(ZipArchive zip, string name, string text)
        {
            using (var writer = new StreamWriter(zip.CreateEntry(name).Open(), new UTF8Encoding(false)))
            {
                writer.Write(text);
            }
        }
    }

    /// <summary>What report.txt says (gathered on the main thread; plain values so tests can make one).</summary>
    public sealed class BugReportFacts
    {
        public string Version { get; set; }
        public string Channel { get; set; }
        public string ChannelName { get; set; }
        public string Commit { get; set; }
        public string Built { get; set; }
        public string EngineVersion { get; set; }
        public string System { get; set; }
        public DateTimeOffset MadeAt { get; set; }
        public EngineFault Fault { get; set; }
        public string SlotId { get; set; }
        public string SlotLabel { get; set; }
        public string GameDate { get; set; }
        public string SavedAt { get; set; }
    }
}
