using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;
using RingsideBooker.Engine;
using UnityEngine;

namespace RingsideBooker.Saves
{
    /// <summary>One imported workshop world kept on disk (an entry of <c>Worlds/index.json</c>).</summary>
    public sealed class StoredWorld
    {
        /// <summary>The world pack id (<c>wm-&lt;item id&gt;</c>), the engine's <c>rootPackId</c>.</summary>
        public string PackId { get; set; }
        /// <summary>The world's name (from the mod; shown to the player, never logged).</summary>
        public string Name { get; set; }
        public string StartDate { get; set; }
        /// <summary>The workshop item id the world came from.</summary>
        public string ItemId { get; set; }
        /// <summary>The mod's folder, database and picture folder when it was imported (pictures load from there in place).</summary>
        public string ModFolder { get; set; }
        public string DatabasePath { get; set; }
        public string PictureFolder { get; set; }
        /// <summary>Imported without pictures.</summary>
        public bool RosterOnly { get; set; }
        public DateTimeOffset ImportedAt { get; set; }
        /// <summary>The mod database's last write time (UTC) at import: a later one means the mod updated.</summary>
        public DateTime? DatabaseModifiedUtc { get; set; }
        /// <summary>Record counts of the converted world (person, promotion, …).</summary>
        public Dictionary<string, long> Counts { get; set; } = new Dictionary<string, long>();
        /// <summary>The import report in words (counts only), shown again in New game.</summary>
        public string Summary { get; set; }
        /// <summary>The engine version that converted it.</summary>
        public string EngineVersion { get; set; }
        /// <summary>Size of the stored, gzipped pack.</summary>
        public long PackFileBytes { get; set; }
    }

    /// <summary>Where a stored world's mod stands now.</summary>
    public enum StoredModState
    {
        /// <summary>The mod's database is where it was, unchanged since the import.</summary>
        Unchanged,
        /// <summary>The database changed after the import (the mod updated): re-import to pick it up.</summary>
        Updated,
        /// <summary>The mod is not at its folder (unsubscribed or moved): pictures show placeholders.</summary>
        Missing,
    }

    /// <summary>
    /// Imported workshop worlds kept across restarts (UNITY-14). Each world is the converted world
    /// pack as the engine exported it, gzipped, at <c>Worlds/&lt;pack id&gt;/pack.json.gz</c>, plus
    /// a small index (<c>Worlds/index.json</c>: name, mod item id and folders, roster-only, import
    /// date, counts) that New game lists without opening any pack. A stored world goes back into the
    /// engine with <see cref="RegisterAsync"/> only when it is picked (no work at start-up), without
    /// the mod and without converting again. Pictures still load in place from the mod's folder.
    /// Every write is atomic (<see cref="AtomicFile"/>). Thread-safe; file work runs on the thread pool.
    /// Never logs a world's names: pack ids, sizes and timings only.
    /// </summary>
    public sealed class ImportedWorldStore
    {
        public const string FolderName = "Worlds";
        public const string IndexFileName = "index.json";
        public const string PackFileName = "pack.json.gz";
        private const string ExportPrefix = "{\"ok\":true,";

        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);

        private static readonly JsonSerializerSettings IndexJson = new JsonSerializerSettings
        {
            Formatting = Formatting.Indented,
            NullValueHandling = NullValueHandling.Ignore,
            DateParseHandling = DateParseHandling.DateTimeOffset,
            ContractResolver = new CamelCasePropertyNamesContractResolver(),
        };

        private readonly object gate = new object();

        /// <param name="directory">The worlds folder; null for <see cref="DefaultDirectory"/>.</param>
        public ImportedWorldStore(string directory = null)
        {
            Directory = directory ?? DefaultDirectory;
        }

        public static string DefaultDirectory => Path.Combine(Application.persistentDataPath, FolderName);

        public string Directory { get; }

        private string IndexPath => Path.Combine(Directory, IndexFileName);

        /// <summary>The pack file of a world (whether or not it exists).</summary>
        public string PackPath(string packId) => Path.Combine(Directory, SafeName(packId), PackFileName);

        /// <summary>The stored worlds, newest import first; entries whose pack file is gone are left out.</summary>
        public IReadOnlyList<StoredWorld> List()
        {
            lock (gate)
            {
                return ReadIndex().Where(world => File.Exists(PackPath(world.PackId)))
                    .OrderByDescending(world => world.ImportedAt).ToList();
            }
        }

        public StoredWorld Find(string packId) => packId == null ? null : List().FirstOrDefault(world => world.PackId == packId);

        /// <summary>
        /// Stores a world: <paramref name="exportJson"/> is the engine's <c>exportImportedWorld</c>
        /// answer, written gzipped as it is (nothing parsed). Replaces a world with the same pack id.
        /// </summary>
        public StoredWorld Save(StoredWorld world, string exportJson)
        {
            if (world?.PackId == null) throw new ArgumentException("A world with a pack id is needed", nameof(world));
            if (exportJson == null || !exportJson.StartsWith(ExportPrefix, StringComparison.Ordinal))
            {
                throw new ArgumentException("Not an exported world pack", nameof(exportJson));
            }
            string path = PackPath(world.PackId);
            AtomicFile.Write(path, stream =>
            {
                using (var gzip = new GZipStream(stream, System.IO.Compression.CompressionLevel.Fastest, true))
                using (var writer = new StreamWriter(gzip, Utf8, 1 << 16))
                {
                    writer.Write(exportJson);
                }
            });
            world.PackFileBytes = new FileInfo(path).Length;
            lock (gate)
            {
                List<StoredWorld> index = ReadIndex().Where(entry => entry.PackId != world.PackId).ToList();
                index.Add(world);
                WriteIndex(index);
            }
            return world;
        }

        /// <summary>Updates a world's index entry (its mod moved, say); does nothing when it is not stored.</summary>
        public void Update(StoredWorld world)
        {
            lock (gate)
            {
                List<StoredWorld> index = ReadIndex();
                int at = index.FindIndex(entry => entry.PackId == world.PackId);
                if (at < 0) return;
                index[at] = world;
                WriteIndex(index);
            }
        }

        /// <summary>The stored pack's JSON text (the export answer), or null when it is not stored.</summary>
        public string ReadPack(string packId)
        {
            string path = PackPath(packId);
            if (!File.Exists(path)) return null;
            using (var file = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 16))
            using (var gzip = new GZipStream(file, CompressionMode.Decompress))
            using (var reader = new StreamReader(gzip, Utf8))
            {
                return reader.ReadToEnd();
            }
        }

        /// <summary>Forgets a stored world (its pack file and index entry). Saves of it still load: a save carries its world.</summary>
        public bool Remove(string packId)
        {
            lock (gate)
            {
                List<StoredWorld> index = ReadIndex();
                int removed = index.RemoveAll(entry => entry.PackId == packId);
                string folder = Path.Combine(Directory, SafeName(packId));
                bool hadFiles = System.IO.Directory.Exists(folder);
                if (hadFiles) System.IO.Directory.Delete(folder, true);
                if (removed > 0) WriteIndex(index);
                return removed > 0 || hadFiles;
            }
        }

        /// <summary>Where the world's mod stands now: unchanged, updated since the import, or missing.</summary>
        public static StoredModState ModState(StoredWorld world)
        {
            if (world?.DatabasePath == null || !File.Exists(world.DatabasePath)) return StoredModState.Missing;
            if (world.DatabaseModifiedUtc == null) return StoredModState.Unchanged;
            DateTime now = File.GetLastWriteTimeUtc(world.DatabasePath);
            return Math.Abs((now - world.DatabaseModifiedUtc.Value).TotalSeconds) > 2 ? StoredModState.Updated : StoredModState.Unchanged;
        }

        /// <summary>
        /// Exports an imported world from the engine and stores it (the export on the engine
        /// thread, the gzip and write on the thread pool). Returns the stored entry with its size.
        /// </summary>
        public async Task<StoredWorld> StoreFromEngineAsync(EngineClient client, StoredWorld world)
        {
            var clock = Stopwatch.StartNew();
            string exported = await client.ExportImportedWorld(world.PackId).ConfigureAwait(false);
            double exportMs = clock.Elapsed.TotalMilliseconds;
            StoredWorld stored = await Task.Run(() => Save(world, exported)).ConfigureAwait(false);
            UnityEngine.Debug.Log($"[ImportedWorlds] stored {world.PackId}: {exported.Length / 1048576.0:0.0} MB JSON → {stored.PackFileBytes / 1048576.0:0.00} MB on disk; " +
                                  $"export {exportMs:0} ms, write {clock.Elapsed.TotalMilliseconds - exportMs:0} ms");
            return stored;
        }

        /// <summary>
        /// Puts a stored world back into the engine (read and unzip on the thread pool, register on
        /// the engine thread). Returns null when it worked, else a reason in words.
        /// </summary>
        public async Task<string> RegisterAsync(EngineClient client, string packId)
        {
            var clock = Stopwatch.StartNew();
            string json;
            try
            {
                json = await Task.Run(() => ReadPack(packId)).ConfigureAwait(false);
            }
            catch (Exception exception)
            {
                UnityEngine.Debug.LogWarning($"[ImportedWorlds] reading {packId} failed ({exception.GetType().Name})");
                return "The stored world could not be read. Remove it and import the mod again.";
            }
            if (json == null) return "The stored world is missing. Import the mod again.";
            double readMs = clock.Elapsed.TotalMilliseconds;
            string answer = await client.RegisterImportedWorld(json).ConfigureAwait(false);
            JObject parsed = EngineClient.ParseToken(answer) as JObject;
            bool ok = (bool?)parsed?["ok"] ?? false;
            UnityEngine.Debug.Log($"[ImportedWorlds] registered {packId}: {(ok ? "ok" : "refused")}; read {readMs:0} ms, register {clock.Elapsed.TotalMilliseconds - readMs:0} ms");
            if (ok) return null;
            string reasons = string.Join("; ", (parsed?["reasons"] as JArray ?? new JArray()).Select(reason => (string)reason["message"]));
            return "The stored world was refused" + (reasons.Length > 0 ? ": " + reasons : string.Empty) + ". Import the mod again.";
        }

        private List<StoredWorld> ReadIndex()
        {
            try
            {
                if (!File.Exists(IndexPath)) return new List<StoredWorld>();
                var index = JsonConvert.DeserializeObject<IndexFile>(File.ReadAllText(IndexPath, Utf8), IndexJson);
                return index?.Worlds?.Where(world => world?.PackId != null).ToList() ?? new List<StoredWorld>();
            }
            catch (Exception exception)
            {
                UnityEngine.Debug.LogWarning($"[ImportedWorlds] index unreadable ({exception.GetType().Name}); listing none");
                return new List<StoredWorld>();
            }
        }

        private void WriteIndex(List<StoredWorld> worlds)
        {
            string json = JsonConvert.SerializeObject(new IndexFile { Version = 1, Worlds = worlds }, IndexJson);
            AtomicFile.WriteAllBytes(IndexPath, Utf8.GetBytes(json));
        }

        private static string SafeName(string packId)
        {
            var name = new StringBuilder(packId.Length);
            foreach (char character in packId) name.Append(char.IsLetterOrDigit(character) || character == '-' || character == '_' || character == '.' ? character : '_');
            return name.ToString();
        }

        private sealed class IndexFile
        {
            public int Version { get; set; }
            public List<StoredWorld> Worlds { get; set; }
        }
    }
}
