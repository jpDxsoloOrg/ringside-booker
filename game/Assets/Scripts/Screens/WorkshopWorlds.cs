using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.Import;
using RingsideBooker.Import.Pictures;
using RingsideBooker.Saves;
using RingsideBooker.UI.Bridge;
using UnityEngine;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// Workshop world mods for New game (UNITY-06's importer; UNITY-12's import sub-screen):
    /// <see cref="ScanAsync"/> lists the installed mods, <see cref="ImportAsync"/> imports one into
    /// the engine (<c>importWorldMod</c>) and stores the converted world on disk
    /// (<see cref="ImportedWorldStore"/>, UNITY-14), and as an <see cref="IWorldSource"/> this lists
    /// the worlds imported this session and every stored one, so New game offers them next to the
    /// bundled world after a restart too (a stored world goes back into the engine only when it is
    /// picked, so start-up does no work). It also
    /// remembers which mod folder each save came from (<c>Saves/world-mods.json</c>, slot id →
    /// folder) so <see cref="CurrentPictures"/> finds the portraits again after a load. Never logs a
    /// mod's names or data: item ids, counts and reason codes only.
    /// </summary>
    public sealed class WorkshopWorlds : IWorldSource
    {
        private const string MapFileName = "world-mods.json";
        public const string SourceLabel = "Imported workshop worlds";

        private static readonly Dictionary<string, WorkshopMod> ModsByPack = new Dictionary<string, WorkshopMod>();
        private static readonly Dictionary<string, bool> Imported = new Dictionary<string, bool>();
        private static readonly Dictionary<string, WorldModImportResult> Results = new Dictionary<string, WorldModImportResult>();
        private static string picturesSlot;
        private static PictureProvider pictures;

        /// <summary>The import screen's "Roster only (no pictures)" toggle: import people and companies without pictures.</summary>
        public static bool RosterOnly { get; set; }

        public string Label => SourceLabel;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Register() => WorldSources.Register(new WorkshopWorlds());

        /// <summary>Stage reported by <see cref="ImportAsync"/> while it stores the converted world for next time.</summary>
        public const string StageStoring = "storing";

        private static ImportedWorldStore store;

        /// <summary>The imported worlds kept on disk (<c>persistentDataPath/Worlds</c>).</summary>
        public static ImportedWorldStore Store
        {
            get => store ??= new ImportedWorldStore();
            set => store = value;
        }

        /// <summary>
        /// The worlds imported this session (the engine keeps them until the game quits) and the
        /// stored ones from earlier sessions (only the small index is read here).
        /// </summary>
        public async Task<IReadOnlyList<WorldChoice>> ListAsync(EngineClient client)
        {
            var choices = new List<WorldChoice>();
            WorldListResult worlds = await client.ListWorlds();
            Dictionary<string, StoredWorld> stored = (await Task.Run(() => Store.List())).ToDictionary(world => world.PackId);
            var listed = new HashSet<string>();
            foreach (JToken pack in worlds.Packs)
            {
                if (!Kit.Bool(pack, "imported")) continue;
                string packId = Kit.Str(pack, "id");
                listed.Add(packId);
                if (stored.TryGetValue(packId, out StoredWorld kept))
                {
                    choices.Add(StoredChoice(kept));
                    continue;
                }
                var choice = new WorldChoice(packId, Kit.Str(pack, "name") ?? packId,
                    "A workshop world mod, imported this session.", Detail(packId, Kit.Str(pack, "startDate")));
                if (Results.TryGetValue(packId, out WorldModImportResult result)) choice.Notice = Summary(result);
                choices.Add(choice);
            }
            foreach (StoredWorld kept in stored.Values.OrderByDescending(world => world.ImportedAt))
            {
                if (!listed.Contains(kept.PackId)) choices.Add(StoredChoice(kept));
            }
            return choices;
        }

        /// <summary>A stored world as a New game choice: it goes back into the engine when it is previewed or started.</summary>
        private static WorldChoice StoredChoice(StoredWorld world)
        {
            var choice = new WorldChoice(world.PackId, world.Name ?? $"Workshop item {world.ItemId}",
                "A workshop world mod, kept from an earlier import.", StoredDetail(world));
            string note = ModNote(world);
            choice.Notice = string.Join(" ", new[] { world.Summary, note }.Where(part => !string.IsNullOrEmpty(part)));
            if (choice.Notice.Length == 0) choice.Notice = null;
            choice.Preview = async client =>
            {
                string problem = await EnsureRegisteredAsync(client, world.PackId);
                if (problem != null) choice.Notice = problem;
                return await client.PreviewWorld(world.PackId);
            };
            choice.NewGame = async (client, options) =>
            {
                await EnsureRegisteredAsync(client, world.PackId);
                return await client.NewGame(options);
            };
            return choice;
        }

        /// <summary>"Imported 19 Nov 2026 · starts 2010-01-04 · 3,576 people · roster only" (no names).</summary>
        public static string StoredDetail(StoredWorld world)
        {
            var parts = new List<string> { $"Imported {world.ImportedAt.ToLocalTime():d MMM yyyy}" };
            if (world.StartDate != null) parts.Add($"starts {world.StartDate}");
            if (world.Counts != null && world.Counts.TryGetValue("person", out long people)) parts.Add($"{people:N0} people");
            if (world.Counts != null && world.Counts.TryGetValue("promotion", out long promotions)) parts.Add($"{promotions:N0} promotions");
            if (world.RosterOnly) parts.Add("roster only");
            return string.Join(" · ", parts);
        }

        /// <summary>A note when the world's mod has updated or is no longer installed; null when it is as imported.</summary>
        public static string ModNote(StoredWorld world)
        {
            switch (ImportedWorldStore.ModState(world))
            {
                case StoredModState.Missing:
                    return world.RosterOnly
                        ? "The mod is no longer installed; the world still plays."
                        : "The mod is no longer installed, so pictures show placeholders; the world still plays.";
                case StoredModState.Updated:
                    return "The mod has updated since this import. Re-import it under Import a workshop world… › Manage imported worlds to pick up the changes.";
                default:
                    return null;
            }
        }

        /// <summary>Stored worlds put back into the engine this session (the engine keeps them until the game quits).</summary>
        private static readonly HashSet<string> Registered = new HashSet<string>();

        /// <summary>
        /// Puts a stored world into the engine unless it is already there (imported or registered
        /// this session). Returns null when the world is ready, else a reason in words.
        /// </summary>
        public static async Task<string> EnsureRegisteredAsync(EngineClient client, string packId)
        {
            if (Imported.ContainsKey(packId) || Registered.Contains(packId)) return null;
            string problem = await Store.RegisterAsync(client, packId);
            if (problem == null) Registered.Add(packId);
            return problem;
        }

        /// <summary>Removes a stored world from disk and from the engine. Saves of it still load (a save carries its world).</summary>
        public static async Task RemoveStoredAsync(EngineClient client, string packId)
        {
            await Task.Run(() => Store.Remove(packId));
            Registered.Remove(packId);
            Imported.Remove(packId);
            Results.Remove(packId);
            if (client != null) await client.RemoveImportedWorld(packId);
            Debug.Log($"[WorkshopWorlds] removed stored world {packId}");
        }

        private static string Detail(string packId, string startDate)
        {
            var parts = new List<string> { "Imported workshop world" };
            if (startDate != null) parts.Add($"starts {startDate}");
            if (Results.TryGetValue(packId, out WorldModImportResult result) && result.Counts?["person"] != null)
            {
                parts.Add($"{(long)result.Counts["person"]:N0} people");
            }
            if (Imported.TryGetValue(packId, out bool rosterOnly) && rosterOnly) parts.Add("roster only");
            return string.Join(" · ", parts);
        }

        /// <summary>Installed workshop mods in every Steam library (scanned off the main thread).</summary>
        public static async Task<List<WorkshopMod>> ScanAsync()
        {
            List<WorkshopMod> mods = await Task.Run(() =>
            {
                try
                {
                    return WorkshopModScanner.FindInstalled();
                }
                catch (Exception exception)
                {
                    Debug.LogWarning($"[WorkshopWorlds] scan failed ({exception.GetType().Name})");
                    return new List<WorkshopMod>();
                }
            });
            foreach (WorkshopMod mod in mods) ModsByPack[mod.PackId] = mod;
            await Task.Run(() => Relocate(mods));
            Debug.Log($"[WorkshopWorlds] {mods.Count} workshop mods found, {mods.Count(mod => mod.IsWorld)} of them worlds");
            return mods;
        }

        /// <summary>A stored world whose mod is installed in another folder now (moved library) follows it.</summary>
        private static void Relocate(IEnumerable<WorkshopMod> mods)
        {
            try
            {
                foreach (StoredWorld world in Store.List())
                {
                    WorkshopMod mod = mods.FirstOrDefault(candidate => candidate.ItemId == world.ItemId);
                    if (mod == null || string.Equals(mod.DatabasePath, world.DatabasePath, StringComparison.OrdinalIgnoreCase)) continue;
                    world.ModFolder = mod.Folder;
                    world.DatabasePath = mod.DatabasePath;
                    world.PictureFolder = mod.PictureFolder;
                    Store.Update(world);
                    Debug.Log($"[WorkshopWorlds] stored world {world.PackId}: mod folder moved, updated");
                }
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[WorkshopWorlds] checking stored worlds failed ({exception.GetType().Name})");
            }
        }

        /// <summary>The stored world of <paramref name="mod"/>, or null.</summary>
        public static StoredWorld StoredFor(WorkshopMod mod) => mod == null ? null : Store.Find(mod.PackId);

        /// <summary>True when <paramref name="mod"/> is already imported (this session or stored) with the same roster-only choice.</summary>
        public static bool IsImported(WorkshopMod mod, bool rosterOnly)
        {
            if (mod == null) return false;
            if (Imported.TryGetValue(mod.PackId, out bool importedRosterOnly)) return importedRosterOnly == rosterOnly;
            StoredWorld stored = StoredFor(mod);
            return stored != null && stored.RosterOnly == rosterOnly;
        }

        /// <summary>
        /// Imports <paramref name="mod"/> (reads its database and converts it on a worker thread).
        /// <paramref name="onStage"/> hears <see cref="WorldModImporter.StageReading"/> and
        /// <see cref="WorldModImporter.StageConverting"/> on that thread. Never throws: a read
        /// failure comes back as a failed result whose <see cref="WorldModImportResult.ReasonCodes"/>
        /// name the exception type. Logs the outcome as counts and reason codes.
        /// </summary>
        /// <param name="keep">Store the converted world so New game lists it after a restart (the import check passes false).</param>
        public static async Task<WorldModImportResult> ImportAsync(EngineClient client, WorkshopMod mod, bool rosterOnly, Action<string> onStage = null, bool keep = true)
        {
            ModsByPack[mod.PackId] = mod;
            WorldModImportResult result;
            try
            {
                result = await Task.Run(() =>
                    WorldModImporter.Import(mod, rosterOnly, json => client.ImportWorldMod(json).GetAwaiter().GetResult(), onStage));
            }
            catch (Exception exception)
            {
                result = WorldModImportResult.Failed(mod.PackId, exception);
            }
            Results[mod.PackId] = result;
            if (result.Ok)
            {
                Imported[mod.PackId] = rosterOnly;
                Registered.Remove(mod.PackId);
                Debug.Log($"[WorkshopWorlds] import ok (item {mod.ItemId}): {CountsLine(result.Counts)}; {WarningCodes(result)}; read {result.ReadMs:0} ms, convert {result.ConvertMs:0} ms");
                if (keep)
                {
                    onStage?.Invoke(StageStoring);
                    await StoreImportedAsync(client, mod, rosterOnly, result);
                }
            }
            else
            {
                Imported.Remove(mod.PackId);
                Debug.LogWarning($"[WorkshopWorlds] import failed (item {mod.ItemId}): {result.ReasonCodes}; counts: {CountsLine(result.Counts)}; read {result.ReadMs:0} ms, convert {result.ConvertMs:0} ms");
            }
            return result;
        }

        /// <summary>Keeps a fresh import on disk so New game lists it after a restart. A failure only logs (the import still counts this session).</summary>
        private static async Task StoreImportedAsync(EngineClient client, WorkshopMod mod, bool rosterOnly, WorldModImportResult result)
        {
            try
            {
                JToken manifest = result.Response?["manifest"];
                var world = new StoredWorld
                {
                    PackId = mod.PackId,
                    Name = Kit.Str(manifest, "name") ?? mod.WorldName,
                    StartDate = Kit.Str(manifest, "startDate") ?? mod.StartDate,
                    ItemId = mod.ItemId,
                    ModFolder = mod.Folder,
                    DatabasePath = mod.DatabasePath,
                    PictureFolder = mod.PictureFolder,
                    RosterOnly = rosterOnly,
                    ImportedAt = DateTimeOffset.Now,
                    DatabaseModifiedUtc = File.Exists(mod.DatabasePath) ? File.GetLastWriteTimeUtc(mod.DatabasePath) : (DateTime?)null,
                    Counts = result.Counts?.Properties().Where(property => property.Value.Type == JTokenType.Integer)
                        .ToDictionary(property => property.Name, property => (long)property.Value) ?? new Dictionary<string, long>(),
                    Summary = Summary(result),
                    EngineVersion = Application.version,
                };
                await Store.StoreFromEngineAsync(client, world);
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[WorkshopWorlds] storing {mod.PackId} failed ({exception.GetType().Name}); it is listed this session only");
            }
        }

        /// <summary>The report's warning codes with counts (<c>code×n</c>), for the log.</summary>
        public static string WarningCodes(WorldModImportResult result)
        {
            if (!(result?.Response?["report"]?["warnings"] is JArray warnings) || warnings.Count == 0) return "no warnings";
            return "warnings: " + string.Join(", ", warnings.Select(warning => $"{Kit.Str(warning, "code")}x{Kit.Num(warning, "count")}"));
        }

        /// <summary>The import report in words: counts and how many warnings, no names.</summary>
        public static string Summary(WorldModImportResult result)
        {
            if (!result.Ok) return FailureText(result);
            JToken report = result.Response?["report"];
            int warnings = (report?["warnings"] as JArray)?.Sum(warning => (int?)warning["count"] ?? 0) ?? 0;
            int notImported = (report?["notImported"] as JArray)?.Count ?? 0;
            return $"Imported {PeopleLine(result.Counts)}. {warnings:N0} {(warnings == 1 ? "record was" : "records were")} skipped or adjusted; " +
                   $"{notImported} kinds of data have no place in the game yet.";
        }

        private static string PeopleLine(JObject counts)
        {
            if (counts == null) return "the world";
            string Count(string key, string noun) => counts[key] == null ? null : $"{(long)counts[key]:N0} {noun}";
            return string.Join(", ", new[]
            {
                Count("person", "people"), Count("promotion", "promotions"), Count("title", "titles"),
                Count("team", "tag teams"), Count("venue", "venues"), Count("eventDefinition", "shows"),
            }.Where(part => part != null));
        }

        /// <summary>A readable reason for a failed import (no mod names: fixed sentences and counts).</summary>
        public static string FailureText(WorldModImportResult result)
        {
            JObject response = result.Response;
            string stage = Kit.Str(response, "stage");
            if (result.Exception != null)
            {
                return $"The mod's database could not be read ({result.Exception.GetType().Name}). Check that the mod is fully downloaded, then try again.";
            }
            if (stage == "convert")
            {
                string errors = string.Join(" ", Kit.Arr(response, "errors").Select(error => error.ToString().TrimEnd('.') + "."));
                return $"This mod could not be turned into a world: {errors}";
            }
            if (stage == "load")
            {
                int count = (int?)response?["issueCount"] ?? 0;
                string rules = response?["ruleCounts"] is JObject ruleCounts && ruleCounts.HasValues
                    ? " (" + string.Join(", ", ruleCounts.Properties().Select(rule => $"{rule.Name} ×{rule.Value}")) + ")"
                    : string.Empty;
                return $"The converted world failed the game's checks with {count} {(count == 1 ? "problem" : "problems")}{rules}.";
            }
            string reasons = string.Join("; ", Kit.Arr(response, "reasons").Select(reason => Kit.Str(reason, "message")));
            return "The import did not run: " + (reasons.Length > 0 ? reasons : "unknown error") + ".";
        }

        /// <summary>
        /// Everything about an import for "Copy details": the outcome, reason codes, the engine's
        /// errors and first problems, warning codes, counts and timings. The player's own clipboard;
        /// never logged.
        /// </summary>
        public static string Details(WorkshopMod mod, WorldModImportResult result)
        {
            var text = new System.Text.StringBuilder();
            text.AppendLine($"Ringside Booker {Application.version} workshop world import");
            text.AppendLine($"Workshop item: {mod?.ItemId}");
            text.AppendLine($"Result: {(result.Ok ? "imported" : "failed")}{(result.Ok ? string.Empty : " - " + result.ReasonCodes)}");
            if (result.Exception != null) text.AppendLine($"Exception: {result.Exception.GetType().Name}: {result.Exception.Message}");
            foreach (JToken error in Kit.Arr(result.Response, "errors")) text.AppendLine($"Error: {error}");
            foreach (JToken reason in Kit.Arr(result.Response, "reasons")) text.AppendLine($"Reason: {Kit.Str(reason, "code")}: {Kit.Str(reason, "message")}");
            foreach (JToken issue in Kit.Arr(result.Response, "issues"))
            {
                text.AppendLine($"Problem ({Kit.Str(issue, "severity")}): {Kit.Str(issue, "kind")} {Kit.Str(issue, "recordKey")}: {Kit.Str(issue, "message")}");
            }
            text.AppendLine($"Counts: {CountsLine(result.Counts)}");
            text.AppendLine(WarningCodes(result));
            text.AppendLine($"Timing: read {result.ReadMs:0} ms, convert and check {result.ConvertMs:0} ms, {result.TablesJsonLength:N0} characters of table data");
            return text.ToString();
        }

        private static string CountsLine(JObject counts)
        {
            if (counts == null) return "no counts";
            return string.Join(", ", counts.Properties().Where(property => property.Value.Type == JTokenType.Integer)
                .Select(property => $"{property.Value} {property.Name}"));
        }

        /// <summary>Records which mod a new save's world came from (called by the wizard after the first save).</summary>
        public static void RememberForSlot(string slotId, string packId)
        {
            if (slotId == null || packId == null) return;
            JObject entry;
            if (ModsByPack.TryGetValue(packId, out WorkshopMod mod) && Imported.TryGetValue(packId, out bool rosterOnly))
            {
                entry = new JObject
                {
                    ["itemId"] = mod.ItemId,
                    ["folder"] = mod.Folder,
                    ["pictureFolder"] = mod.PictureFolder,
                    ["rosterOnly"] = rosterOnly,
                };
            }
            else if (Store.Find(packId) is StoredWorld stored)
            {
                entry = new JObject
                {
                    ["itemId"] = stored.ItemId,
                    ["folder"] = stored.ModFolder,
                    ["pictureFolder"] = stored.PictureFolder,
                    ["rosterOnly"] = stored.RosterOnly,
                };
            }
            else return;
            JObject map = ReadMap();
            map[slotId] = entry;
            try
            {
                Directory.CreateDirectory(MapDirectory);
                File.WriteAllText(Path.Combine(MapDirectory, MapFileName), map.ToString());
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[WorkshopWorlds] could not remember the mod folder ({exception.GetType().Name})");
            }
        }

        private static string packPicturesId;
        private static PictureProvider packPictures;

        /// <summary>
        /// Pictures of a workshop world imported this session (the New game wizard's promotion
        /// logos), or null for a built-in world, a roster-only import or an unknown pack.
        /// </summary>
        public static PictureProvider PicturesForPack(string packId)
        {
            if (packId == packPicturesId) return packPictures;
            packPictures?.Dispose();
            packPictures = null;
            packPicturesId = packId;
            if (packId == null) return null;
            string folder;
            if (Imported.TryGetValue(packId, out bool rosterOnly) && ModsByPack.TryGetValue(packId, out WorkshopMod mod))
            {
                folder = rosterOnly ? null : mod.PictureFolder;
            }
            else
            {
                StoredWorld stored = Store.Find(packId);
                folder = stored == null || stored.RosterOnly ? null : stored.PictureFolder;
            }
            if (folder == null || !Directory.Exists(folder)) return null;
            packPictures = new PictureProvider(folder, false);
            return packPictures;
        }

        /// <summary>
        /// Pictures for the running game's save, when it came from a workshop world mod with
        /// pictures; null otherwise (a world without pictures).
        /// </summary>
        public static PictureProvider CurrentPictures
        {
            get
            {
                string slot = GameSession.Current?.SlotId;
                if (slot == picturesSlot) return pictures;
                pictures?.Dispose();
                pictures = null;
                picturesSlot = slot;
                CurrentPicturesNote = null;
                if (slot == null || !(ReadMap()[slot] is JObject entry)) return null;
                string folder = (string)entry["pictureFolder"];
                bool rosterOnly = (bool?)entry["rosterOnly"] ?? false;
                if (folder != null && !Directory.Exists(folder))
                {
                    // The mod moved (another library) since this save: the stored world knows where it is now.
                    string itemId = (string)entry["itemId"];
                    StoredWorld stored = itemId == null ? null : Store.Find(WorkshopModScanner.PackIdFor(itemId));
                    folder = stored?.PictureFolder != null && Directory.Exists(stored.PictureFolder) ? stored.PictureFolder : null;
                    if (folder == null && !rosterOnly)
                    {
                        CurrentPicturesNote = "This world's workshop mod is not installed, so pictures show placeholders.";
                        return null;
                    }
                }
                if (folder == null) return null;
                pictures = new PictureProvider(folder, rosterOnly);
                return pictures;
            }
        }

        /// <summary>
        /// A note for screens with pictures when the running game's mod is missing (placeholders
        /// are shown instead); null otherwise. Set by <see cref="CurrentPictures"/>.
        /// </summary>
        public static string CurrentPicturesNote { get; private set; }

        private static string MapDirectory => Path.Combine(Application.persistentDataPath, "Saves");

        private static JObject ReadMap()
        {
            try
            {
                string path = Path.Combine(MapDirectory, MapFileName);
                return File.Exists(path) ? JObject.Parse(File.ReadAllText(path)) : new JObject();
            }
            catch (Exception)
            {
                return new JObject();
            }
        }
    }
}
