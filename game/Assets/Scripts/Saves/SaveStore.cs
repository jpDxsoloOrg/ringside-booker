using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using RingsideBooker.Engine;
using UnityEngine;

namespace RingsideBooker.Saves
{
    /// <summary>What an import did.</summary>
    public sealed class ImportResult
    {
        public bool Ok { get; private set; }

        /// <summary>The new slot when <see cref="Ok"/>.</summary>
        public SaveSlotInfo Slot { get; private set; }

        /// <summary>Why the file was not imported.</summary>
        public string Problem { get; private set; }

        public static ImportResult Imported(SaveSlotInfo slot) => new ImportResult { Ok = true, Slot = slot };

        public static ImportResult Failed(string problem) => new ImportResult { Problem = problem };
    }

    /// <summary>
    /// Save slots as files: <c>Saves/&lt;slot&gt;.rbsave</c> is the engine's save as it is (gzipped
    /// canonical JSON, the same file the web app exports, so either side imports the other's) and
    /// <c>&lt;slot&gt;.json</c> the slot's header (<see cref="SaveSlotInfo"/>) so listing never opens a
    /// world. Each write moves the save it replaces into the slot's rotating backups,
    /// <c>Saves/Backups/&lt;slot&gt;/&lt;backup id&gt;.rbsave</c> + <c>.json</c>, and keeps the newest
    /// <see cref="KeepBackups"/> (UNITY-27). Every write is atomic (<see cref="AtomicFile"/>) and read
    /// back before it replaces anything (POL1-04). Thread-safe; file work is meant to run off the
    /// main thread.
    /// </summary>
    public sealed class SaveStore
    {
        public const string SaveExtension = ".rbsave";
        /// <summary>The one backup older builds kept (<c>&lt;slot&gt;.rbsave.bak</c>); moved into the backups folder on first use.</summary>
        public const string BackupSuffix = ".bak";
        public const string BackupsFolderName = "Backups";
        public const string HeaderExtension = ".json";
        public const string FolderName = "Saves";

        private const int MaxSlotIdStem = 40;

        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);

        private static readonly JsonSerializerSettings IndexJson = new JsonSerializerSettings
        {
            Formatting = Formatting.Indented,
            NullValueHandling = NullValueHandling.Include,
            DateParseHandling = DateParseHandling.DateTimeOffset,
        };

        private readonly object gate = new object();

        /// <param name="directory">The saves folder; null for <see cref="DefaultDirectory"/>.</param>
        public SaveStore(string directory = null)
        {
            Directory = directory ?? DefaultDirectory;
        }

        /// <summary><c>%USERPROFILE%\AppData\LocalLow\&lt;company&gt;\Ringside Booker\Saves</c> on Windows.</summary>
        public static string DefaultDirectory => Path.Combine(Application.persistentDataPath, FolderName);

        public string Directory { get; }

        /// <summary>How many backups each slot keeps; null follows <see cref="SaveSettings.BackupsPerSlot"/>.</summary>
        public int? BackupsToKeep { get; set; }

        /// <summary>The number of backups a write keeps (oldest are deleted).</summary>
        public int KeepBackups => SaveSettings.Clamp(BackupsToKeep ?? SaveSettings.BackupsPerSlot);

        public string SavePath(string slotId) => Path.Combine(Directory, slotId + SaveExtension);

        /// <summary>The single backup file of older builds.</summary>
        public string LegacyBackupPath(string slotId) => SavePath(slotId) + BackupSuffix;

        /// <summary><c>Saves/Backups/&lt;slot&gt;</c>.</summary>
        public string BackupFolder(string slotId) => Path.Combine(Directory, BackupsFolderName, slotId);

        public string BackupPath(string slotId, string backupId) => Path.Combine(BackupFolder(slotId), backupId + SaveExtension);

        public string BackupHeaderPath(string slotId, string backupId) => Path.Combine(BackupFolder(slotId), backupId + HeaderExtension);

        public string HeaderPath(string slotId) => Path.Combine(Directory, slotId + HeaderExtension);

        /// <summary>
        /// Every slot, newest save first, from the header files only. A save with no readable header
        /// comes back with <see cref="SaveSlotInfo.NeedsInspect"/> (use <see cref="ListAsync"/> to fix it).
        /// </summary>
        public IReadOnlyList<SaveSlotInfo> List()
        {
            lock (gate)
            {
                if (!System.IO.Directory.Exists(Directory)) return Array.Empty<SaveSlotInfo>();
                var slots = new List<SaveSlotInfo>();
                foreach (string file in System.IO.Directory.GetFiles(Directory, "*" + SaveExtension))
                {
                    string slotId = Path.GetFileNameWithoutExtension(file);
                    slots.Add(ReadInfo(slotId, file));
                }

                return slots.OrderByDescending(slot => slot.SavedAt).ThenBy(slot => slot.SlotId, StringComparer.Ordinal).ToList();
            }
        }

        /// <summary>
        /// <see cref="List"/>, then reads the header of any save that has none (<c>inspectSave</c>, no
        /// world built) and writes it, so a <c>.rbsave</c> copied into the folder shows up properly.
        /// </summary>
        public async Task<IReadOnlyList<SaveSlotInfo>> ListAsync(EngineClient engine)
        {
            IReadOnlyList<SaveSlotInfo> slots = await Task.Run(() => List());
            if (engine == null || slots.All(slot => !slot.NeedsInspect)) return slots;

            foreach (SaveSlotInfo slot in slots.Where(slot => slot.NeedsInspect))
            {
                byte[] bytes = await Task.Run(() => File.ReadAllBytes(SavePath(slot.SlotId)));
                LoadResult inspected = await engine.InspectSave(bytes);
                if (!inspected.Ok) continue;
                slot.ApplyHeader(inspected.Header);
                slot.EngineVersion = inspected.EngineVersion;
                slot.FormatVersion = inspected.FormatVersion;
                slot.NeedsInspect = false;
                await Task.Run(() => WriteInfo(slot));
            }

            return await Task.Run(() => List());
        }

        /// <summary>The most recently saved slot, or null when there are none.</summary>
        public SaveSlotInfo Latest() => List().FirstOrDefault();

        /// <summary>The slot's header, or null when the slot does not exist.</summary>
        public SaveSlotInfo Find(string slotId)
        {
            lock (gate)
            {
                string file = SavePath(slotId);
                return File.Exists(file) ? ReadInfo(slotId, file) : null;
            }
        }

        /// <summary>
        /// Writes a save into a slot. The bytes go to a temp file that is read back and compared
        /// (verify-after-write); only then does the temp file replace the save, and the save it
        /// replaces becomes the newest backup in the same step. Then the backup's header and the
        /// slot's header are written and backups beyond <see cref="KeepBackups"/> are deleted, oldest
        /// first. A write that fails or does not read back throws and leaves the save and every
        /// backup as they were (<see cref="SaveVerifyException"/> for a bad read-back).
        /// </summary>
        /// <param name="info">The header; its SlotId names the slot, SizeBytes is filled in.</param>
        public SaveSlotInfo Write(SaveSlotInfo info, byte[] bytes)
        {
            if (info == null) throw new ArgumentNullException(nameof(info));
            if (bytes == null) throw new ArgumentNullException(nameof(bytes));
            ValidateSlotId(info.SlotId);
            lock (gate)
            {
                System.IO.Directory.CreateDirectory(Directory);
                string slotId = info.SlotId;
                string path = SavePath(slotId);
                MigrateLegacyBackup(slotId);
                SaveSlotInfo previous = File.Exists(path) ? ReadInfo(slotId, path) : null;
                string backupId = null;
                string backupPath = null;
                if (previous != null)
                {
                    System.IO.Directory.CreateDirectory(BackupFolder(slotId));
                    backupId = NewBackupId(slotId, DateTime.UtcNow);
                    backupPath = BackupPath(slotId, backupId);
                }

                AtomicFile.WriteAllBytes(path, bytes, backupPath, verify: true);
                if (previous != null && !previous.NeedsInspect) WriteBackupHeader(slotId, backupId, previous);
                info.SizeBytes = bytes.LongLength;
                info.NeedsInspect = false;
                WriteInfo(info);
                PruneBackups(slotId, KeepBackups);
                info.BackupCount = CountBackups(slotId);
                return info;
            }
        }

        /// <summary>The slot's save bytes, or (with <paramref name="backup"/>) its newest backup's.</summary>
        public byte[] Read(string slotId, bool backup = false)
        {
            ValidateSlotId(slotId);
            if (!backup) return File.ReadAllBytes(SavePath(slotId));
            SaveBackupInfo newest = ListBackups(slotId).FirstOrDefault();
            if (newest == null) throw new FileNotFoundException("The save has no backup.", BackupFolder(slotId));
            return LoadBackup(slotId, newest.BackupId);
        }

        /// <summary>
        /// The slot's backups, newest first (UNITY-27). A backup whose header was lost comes back with
        /// <see cref="SaveBackupInfo.NeedsInspect"/> (use <see cref="ListBackupsAsync"/> to read it).
        /// </summary>
        public IReadOnlyList<SaveBackupInfo> ListBackups(string slotId)
        {
            ValidateSlotId(slotId);
            lock (gate)
            {
                MigrateLegacyBackup(slotId);
                string folder = BackupFolder(slotId);
                if (!System.IO.Directory.Exists(folder)) return Array.Empty<SaveBackupInfo>();
                return System.IO.Directory.GetFiles(folder, "*" + SaveExtension)
                    .Select(file => ReadBackupInfo(slotId, Path.GetFileNameWithoutExtension(file), file))
                    .OrderByDescending(backup => backup.BackupId, StringComparer.Ordinal)
                    .ToList();
            }
        }

        /// <summary><see cref="ListBackups"/>, reading the header of any backup that lost it with <c>inspectSave</c>.</summary>
        public async Task<IReadOnlyList<SaveBackupInfo>> ListBackupsAsync(EngineClient engine, string slotId)
        {
            IReadOnlyList<SaveBackupInfo> backups = await Task.Run(() => ListBackups(slotId));
            if (engine == null || backups.All(backup => !backup.NeedsInspect)) return backups;
            foreach (SaveBackupInfo backup in backups.Where(backup => backup.NeedsInspect))
            {
                byte[] bytes = await Task.Run(() => LoadBackup(slotId, backup.BackupId));
                LoadResult inspected = await engine.InspectSave(bytes);
                if (!inspected.Ok) continue;
                SaveSlotInfo info = backup.Info;
                info.ApplyHeader(inspected.Header);
                info.EngineVersion = inspected.EngineVersion;
                info.FormatVersion = inspected.FormatVersion;
                info.NeedsInspect = false;
                await Task.Run(() => WriteBackupHeader(slotId, backup.BackupId, info));
            }

            return await Task.Run(() => ListBackups(slotId));
        }

        /// <summary>The bytes of one backup (from <see cref="ListBackups"/>), for <c>EngineClient.Load</c>; <see cref="GameSession.OpenBackupAsync"/> does the whole load.</summary>
        public byte[] LoadBackup(string slotId, string backupId)
        {
            ValidateSlotId(slotId);
            ValidateSlotId(backupId);
            return File.ReadAllBytes(BackupPath(slotId, backupId));
        }

        /// <summary>Removes the slot: save, header and every backup.</summary>
        public void Delete(string slotId)
        {
            ValidateSlotId(slotId);
            lock (gate)
            {
                foreach (string path in new[] { SavePath(slotId), LegacyBackupPath(slotId), HeaderPath(slotId), SavePath(slotId) + AtomicFile.TempSuffix })
                {
                    if (File.Exists(path)) File.Delete(path);
                }

                string folder = BackupFolder(slotId);
                if (System.IO.Directory.Exists(folder)) System.IO.Directory.Delete(folder, true);
            }
        }

        /// <summary>Copies the slot's save to <paramref name="destinationPath"/> (a <c>.rbsave</c> the web app imports too).</summary>
        public void Export(string slotId, string destinationPath)
        {
            byte[] bytes = Read(slotId);
            AtomicFile.WriteAllBytes(destinationPath, bytes);
        }

        /// <summary>
        /// Imports a save file into a new slot after checking its header with <c>inspectSave</c>
        /// (a file that is not a save is refused). The slot is named after the save's label.
        /// </summary>
        public async Task<ImportResult> ImportAsync(EngineClient engine, string sourcePath)
        {
            if (engine == null) throw new ArgumentNullException(nameof(engine));
            byte[] bytes;
            try
            {
                bytes = await Task.Run(() => File.ReadAllBytes(sourcePath));
            }
            catch (Exception error) when (error is IOException || error is UnauthorizedAccessException || error is ArgumentException || error is NotSupportedException)
            {
                return ImportResult.Failed("Could not read the file: " + error.Message);
            }

            LoadResult inspected = await engine.InspectSave(bytes);
            if (!inspected.Ok)
            {
                return ImportResult.Failed("This file is not a save Ringside Booker can read (" + inspected.ProblemText + ").");
            }

            var info = new SaveSlotInfo
            {
                SavedAt = DateTimeOffset.UtcNow,
                EngineVersion = inspected.EngineVersion,
                FormatVersion = inspected.FormatVersion,
            };
            info.ApplyHeader(inspected.Header);
            info.Label = info.Label ?? Path.GetFileNameWithoutExtension(sourcePath);
            info.SlotId = NewSlotId(info.Label);
            SaveSlotInfo slot = await Task.Run(() => Write(info, bytes));
            return ImportResult.Imported(slot);
        }

        /// <summary>A new, unused slot id from a label: <c>my-career-20261119-142233</c>.</summary>
        public string NewSlotId(string label)
        {
            string stem = Slug(label);
            string stamp = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss", System.Globalization.CultureInfo.InvariantCulture);
            string slotId = stem + "-" + stamp;
            for (int suffix = 2; File.Exists(SavePath(slotId)) || File.Exists(HeaderPath(slotId)); suffix++)
            {
                slotId = stem + "-" + stamp + "-" + suffix;
            }

            return slotId;
        }

        private static string Slug(string label)
        {
            var builder = new StringBuilder();
            foreach (char character in (label ?? string.Empty).ToLowerInvariant())
            {
                if ((character >= 'a' && character <= 'z') || (character >= '0' && character <= '9'))
                {
                    builder.Append(character);
                }
                else if (builder.Length > 0 && builder[builder.Length - 1] != '-')
                {
                    builder.Append('-');
                }

                if (builder.Length >= MaxSlotIdStem) break;
            }

            string slug = builder.ToString().Trim('-');
            return slug.Length == 0 ? "save" : slug;
        }

        private static void ValidateSlotId(string slotId)
        {
            if (string.IsNullOrEmpty(slotId) || slotId.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || slotId.Contains(".."))
            {
                throw new ArgumentException("Not a slot id: " + slotId, nameof(slotId));
            }
        }

        private SaveSlotInfo ReadInfo(string slotId, string savePath)
        {
            SaveSlotInfo info = null;
            string headerPath = HeaderPath(slotId);
            if (File.Exists(headerPath))
            {
                try
                {
                    info = JsonConvert.DeserializeObject<SaveSlotInfo>(File.ReadAllText(headerPath, Utf8), IndexJson);
                }
                catch (JsonException error)
                {
                    Debug.LogWarning($"SaveStore: unreadable header {headerPath}: {error.Message}");
                }
                catch (IOException error)
                {
                    Debug.LogWarning($"SaveStore: could not read {headerPath}: {error.Message}");
                }
            }

            var file = new FileInfo(savePath);
            if (info == null)
            {
                info = new SaveSlotInfo
                {
                    Label = slotId,
                    SavedAt = new DateTimeOffset(file.LastWriteTimeUtc, TimeSpan.Zero),
                    NeedsInspect = true,
                };
            }

            info.SlotId = slotId;
            info.SizeBytes = file.Length;
            info.BackupCount = CountBackups(slotId);
            return info;
        }

        private SaveBackupInfo ReadBackupInfo(string slotId, string backupId, string file)
        {
            SaveSlotInfo info = null;
            string headerPath = BackupHeaderPath(slotId, backupId);
            if (File.Exists(headerPath))
            {
                try
                {
                    info = JsonConvert.DeserializeObject<SaveSlotInfo>(File.ReadAllText(headerPath, Utf8), IndexJson);
                }
                catch (Exception error) when (error is JsonException || error is IOException)
                {
                    Debug.LogWarning($"SaveStore: unreadable backup header {headerPath}: {error.Message}");
                }
            }

            var fileInfo = new FileInfo(file);
            if (info == null)
            {
                info = new SaveSlotInfo
                {
                    SavedAt = new DateTimeOffset(fileInfo.LastWriteTimeUtc, TimeSpan.Zero),
                    NeedsInspect = true,
                };
            }

            info.SlotId = slotId;
            info.SizeBytes = fileInfo.Length;
            return new SaveBackupInfo { BackupId = backupId, SlotId = slotId, Info = info };
        }

        private void WriteBackupHeader(string slotId, string backupId, SaveSlotInfo header)
        {
            lock (gate)
            {
                SaveSlotInfo copy = header.Clone();
                copy.SlotId = slotId;
                string json = JsonConvert.SerializeObject(copy, IndexJson);
                AtomicFile.WriteAllBytes(BackupHeaderPath(slotId, backupId), Utf8.GetBytes(json));
            }
        }

        private int CountBackups(string slotId)
        {
            string folder = BackupFolder(slotId);
            int count = System.IO.Directory.Exists(folder) ? System.IO.Directory.GetFiles(folder, "*" + SaveExtension).Length : 0;
            return count + (File.Exists(LegacyBackupPath(slotId)) ? 1 : 0);
        }

        // A backup id is the UTC time it became a backup; ids sort oldest first.
        private string NewBackupId(string slotId, DateTime utc)
        {
            string stamp = utc.ToString("yyyyMMdd-HHmmss-fff", System.Globalization.CultureInfo.InvariantCulture);
            string backupId = stamp;
            for (int suffix = 2; File.Exists(BackupPath(slotId, backupId)); suffix++)
            {
                backupId = stamp + "-" + suffix;
            }

            return backupId;
        }

        // Older builds kept one <slot>.rbsave.bak: it becomes the oldest rotating backup.
        private void MigrateLegacyBackup(string slotId)
        {
            string legacy = LegacyBackupPath(slotId);
            if (!File.Exists(legacy)) return;
            try
            {
                System.IO.Directory.CreateDirectory(BackupFolder(slotId));
                string backupId = NewBackupId(slotId, File.GetLastWriteTimeUtc(legacy));
                File.Move(legacy, BackupPath(slotId, backupId));
            }
            catch (IOException error)
            {
                Debug.LogWarning($"SaveStore: could not move the old backup {legacy}: {error.Message}");
            }
        }

        private void PruneBackups(string slotId, int keep)
        {
            string folder = BackupFolder(slotId);
            if (!System.IO.Directory.Exists(folder)) return;
            IEnumerable<string> old = System.IO.Directory.GetFiles(folder, "*" + SaveExtension)
                .Select(Path.GetFileNameWithoutExtension)
                .OrderByDescending(id => id, StringComparer.Ordinal)
                .Skip(keep);
            foreach (string backupId in old.ToList())
            {
                try
                {
                    File.Delete(BackupPath(slotId, backupId));
                    string header = BackupHeaderPath(slotId, backupId);
                    if (File.Exists(header)) File.Delete(header);
                }
                catch (IOException error)
                {
                    Debug.LogWarning($"SaveStore: could not delete the old backup {backupId}: {error.Message}");
                }
            }
        }

        private void WriteInfo(SaveSlotInfo info)
        {
            lock (gate)
            {
                string json = JsonConvert.SerializeObject(info, IndexJson);
                AtomicFile.WriteAllBytes(HeaderPath(info.SlotId), Utf8.GetBytes(json));
            }
        }
    }
}
