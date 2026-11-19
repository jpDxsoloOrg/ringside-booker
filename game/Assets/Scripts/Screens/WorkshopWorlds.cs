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
    /// the engine (<c>importWorldMod</c>), and as an <see cref="IWorldSource"/> this lists the worlds
    /// already imported this session, so New game offers them next to the bundled world. It also
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

        /// <summary>The worlds imported this session (the engine keeps them until the game quits).</summary>
        public async Task<IReadOnlyList<WorldChoice>> ListAsync(EngineClient client)
        {
            var choices = new List<WorldChoice>();
            WorldListResult worlds = await client.ListWorlds();
            foreach (JToken pack in worlds.Packs)
            {
                if (!Kit.Bool(pack, "imported")) continue;
                string packId = Kit.Str(pack, "id");
                var choice = new WorldChoice(packId, Kit.Str(pack, "name") ?? packId,
                    "A workshop world mod, imported this session.", Detail(packId, Kit.Str(pack, "startDate")));
                if (Results.TryGetValue(packId, out WorldModImportResult result)) choice.Notice = Summary(result);
                choices.Add(choice);
            }
            return choices;
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
            Debug.Log($"[WorkshopWorlds] {mods.Count} workshop mods found, {mods.Count(mod => mod.IsWorld)} of them worlds");
            return mods;
        }

        /// <summary>True when <paramref name="mod"/> is already imported this session with the same roster-only choice.</summary>
        public static bool IsImported(WorkshopMod mod, bool rosterOnly) =>
            mod != null && Imported.TryGetValue(mod.PackId, out bool importedRosterOnly) && importedRosterOnly == rosterOnly;

        /// <summary>
        /// Imports <paramref name="mod"/> (reads its database and converts it on a worker thread).
        /// <paramref name="onStage"/> hears <see cref="WorldModImporter.StageReading"/> and
        /// <see cref="WorldModImporter.StageConverting"/> on that thread. Never throws: a read
        /// failure comes back as a failed result whose <see cref="WorldModImportResult.ReasonCodes"/>
        /// name the exception type. Logs the outcome as counts and reason codes.
        /// </summary>
        public static async Task<WorldModImportResult> ImportAsync(EngineClient client, WorkshopMod mod, bool rosterOnly, Action<string> onStage = null)
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
                Debug.Log($"[WorkshopWorlds] import ok (item {mod.ItemId}): {CountsLine(result.Counts)}; {WarningCodes(result)}; read {result.ReadMs:0} ms, convert {result.ConvertMs:0} ms");
            }
            else
            {
                Imported.Remove(mod.PackId);
                Debug.LogWarning($"[WorkshopWorlds] import failed (item {mod.ItemId}): {result.ReasonCodes}; counts: {CountsLine(result.Counts)}; read {result.ReadMs:0} ms, convert {result.ConvertMs:0} ms");
            }
            return result;
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
            if (slotId == null || packId == null || !ModsByPack.TryGetValue(packId, out WorkshopMod mod)) return;
            JObject map = ReadMap();
            map[slotId] = new JObject
            {
                ["itemId"] = mod.ItemId,
                ["folder"] = mod.Folder,
                ["pictureFolder"] = mod.PictureFolder,
                ["rosterOnly"] = Imported.TryGetValue(packId, out bool rosterOnly) && rosterOnly,
            };
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
            if (packId == null || !ModsByPack.TryGetValue(packId, out WorkshopMod mod)) return null;
            if (!Imported.TryGetValue(packId, out bool rosterOnly) || rosterOnly || mod.PictureFolder == null) return null;
            packPictures = new PictureProvider(mod.PictureFolder, false);
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
                if (slot == null || !(ReadMap()[slot] is JObject entry)) return null;
                string folder = (string)entry["pictureFolder"];
                if (folder == null || !Directory.Exists(folder)) return null;
                pictures = new PictureProvider(folder, (bool?)entry["rosterOnly"] ?? false);
                return pictures;
            }
        }

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
