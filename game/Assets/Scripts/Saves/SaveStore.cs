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
    /// canonical JSON, the same file the web app exports, so either side imports the other's),
    /// <c>&lt;slot&gt;.rbsave.bak</c> the save before it, and <c>&lt;slot&gt;.json</c> the slot's header
    /// (<see cref="SaveSlotInfo"/>) so listing never opens a world. Every write is atomic
    /// (<see cref="AtomicFile"/>). Thread-safe; file work is meant to run off the main thread.
    /// </summary>
    public sealed class SaveStore
    {
        public const string SaveExtension = ".rbsave";
        public const string BackupSuffix = ".bak";
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

        public string SavePath(string slotId) => Path.Combine(Directory, slotId + SaveExtension);

        public string BackupPath(string slotId) => SavePath(slotId) + BackupSuffix;

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
        /// Writes a save into a slot: the previous save becomes the backup, then the header is
        /// rewritten. Both writes are atomic.
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
                string path = SavePath(info.SlotId);
                AtomicFile.WriteAllBytes(path, bytes, BackupPath(info.SlotId));
                info.SizeBytes = bytes.LongLength;
                info.NeedsInspect = false;
                WriteInfo(info);
                info.HasBackup = File.Exists(BackupPath(info.SlotId));
                return info;
            }
        }

        /// <summary>The slot's save bytes (or its backup's).</summary>
        public byte[] Read(string slotId, bool backup = false)
        {
            ValidateSlotId(slotId);
            return File.ReadAllBytes(backup ? BackupPath(slotId) : SavePath(slotId));
        }

        /// <summary>Removes the slot: save, backup and header.</summary>
        public void Delete(string slotId)
        {
            ValidateSlotId(slotId);
            lock (gate)
            {
                foreach (string path in new[] { SavePath(slotId), BackupPath(slotId), HeaderPath(slotId), SavePath(slotId) + AtomicFile.TempSuffix })
                {
                    if (File.Exists(path)) File.Delete(path);
                }
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
            info.HasBackup = File.Exists(BackupPath(slotId));
            return info;
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
