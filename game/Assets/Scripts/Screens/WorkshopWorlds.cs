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
    /// The "Workshop mods" world source for the New game wizard (UNITY-06's importer behind
    /// UNITY-09's <see cref="IWorldSource"/>): lists the installed workshop world mods, imports the
    /// one picked into the engine (<c>importWorldMod</c>) when the wizard previews it, and remembers
    /// which mod folder each save came from (<c>Saves/world-mods.json</c>, slot id → folder) so
    /// <see cref="CurrentPictures"/> finds the portraits again after a load. Never logs a mod's
    /// names or data: only counts.
    /// </summary>
    public sealed class WorkshopWorlds : IWorldSource
    {
        private const string MapFileName = "world-mods.json";

        private static readonly Dictionary<string, WorkshopMod> ModsByPack = new Dictionary<string, WorkshopMod>();
        private static readonly Dictionary<string, bool> Imported = new Dictionary<string, bool>();
        private static string picturesSlot;
        private static PictureProvider pictures;

        /// <summary>The wizard's "Roster only (no pictures)" toggle: import people and companies without pictures.</summary>
        public static bool RosterOnly { get; set; }

        public string Label => "Workshop mods";

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Register() => WorldSources.Register(new WorkshopWorlds());

        public async Task<IReadOnlyList<WorldChoice>> ListAsync(EngineClient client)
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
            var choices = new List<WorldChoice>();
            foreach (WorkshopMod mod in mods)
            {
                ModsByPack[mod.PackId] = mod;
                WorkshopMod captured = mod;
                var choice = new WorldChoice(mod.PackId, mod.WorldName ?? $"Workshop item {mod.ItemId}",
                    "A workshop world mod, imported into a Ringside Booker world when you pick it.",
                    mod.StartDate == null ? "Workshop world mod" : $"Workshop world mod · starts {mod.StartDate}");
                choice.Preview = async engine => await Preview(engine, captured, choice);
                choices.Add(choice);
            }
            Debug.Log($"[WorkshopWorlds] {choices.Count} workshop world mods found");
            return choices;
        }

        private static async Task<WorldPreviewResult> Preview(EngineClient client, WorkshopMod mod, WorldChoice choice)
        {
            bool rosterOnly = RosterOnly;
            if (!Imported.TryGetValue(mod.PackId, out bool importedRosterOnly) || importedRosterOnly != rosterOnly)
            {
                WorldModImportResult result = await Task.Run(() =>
                    WorldModImporter.Import(mod, rosterOnly, json => client.ImportWorldMod(json).GetAwaiter().GetResult()));
                choice.Notice = Summary(result);
                Debug.Log($"[WorkshopWorlds] import {(result.Ok ? "ok" : "failed")}: {CountsLine(result.Counts)}; read {result.ReadMs:0} ms, convert {result.ConvertMs:0} ms");
                if (!result.Ok)
                {
                    var failed = new WorldPreviewResult { Ok = false };
                    failed.Reasons.Add(new EngineReason { Code = "importFailed", Message = "The workshop world mod could not be imported. " + Kit.Capital(Kit.Str(result.Response, "stage") ?? "convert") + " step failed." });
                    return failed;
                }
                Imported[mod.PackId] = rosterOnly;
            }
            return await client.PreviewWorld(mod.PackId);
        }

        /// <summary>The import report in words: counts and how many warnings, no names.</summary>
        private static string Summary(WorldModImportResult result)
        {
            if (!result.Ok)
            {
                int errors = (result.Response?["errors"] as JArray)?.Count ?? 0;
                return $"Import failed ({errors} {(errors == 1 ? "problem" : "problems")}).";
            }
            JToken report = result.Response?["report"];
            int warnings = (report?["warnings"] as JArray)?.Count ?? (int?)report?["warningCount"] ?? 0;
            int notImported = (report?["notImported"] as JArray)?.Count ?? 0;
            int issues = (int?)result.Response?["issueCount"] ?? 0;
            return $"Imported: {CountsLine(result.Counts)}. {warnings} {(warnings == 1 ? "warning" : "warnings")}, {notImported} kinds of data not imported, {issues} loader {(issues == 1 ? "issue" : "issues")}.";
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
