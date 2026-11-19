using System;
using System.Diagnostics;
using System.Linq;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.Import;
using RingsideBooker.Import.Pictures;
using UnityEditor;
using UnityEngine;
using Debug = UnityEngine.Debug;

namespace RingsideBooker.EditorTools
{
    /// <summary>
    /// The Unity-side smoke path for workshop world mod import (UNITY-06): reads a mod's database,
    /// imports it through the engine bundle (<see cref="JsEngineHost"/>), starts a new game in it
    /// with a founded promotion, plays 7 days and checks a few pictures load in place. It logs
    /// counts and timings only, never names from the mod.
    ///
    /// Batch: <c>game/tools/world-mod-import.sh [mod folder] [--roster-only]</c>, which runs
    /// <c>-executeMethod RingsideBooker.EditorTools.WorldModImportSmoke.RunBatch
    /// [-worldModFolder &lt;folder&gt;] [-rosterOnly]</c>. With no folder, the first installed mod found
    /// in the Steam libraries is used.
    /// </summary>
    public static class WorldModImportSmoke
    {
        public const string LogPrefix = "[WorldModImport]";
        private const int DaysToPlay = 7;

        public static void RunBatch()
        {
            var args = Environment.GetCommandLineArgs();
            string folder = null;
            var rosterOnly = false;
            for (var index = 0; index < args.Length; index++)
            {
                if (args[index] == "-worldModFolder" && index + 1 < args.Length)
                {
                    folder = args[index + 1];
                }
                else if (args[index] == "-rosterOnly")
                {
                    rosterOnly = true;
                }
            }

            var exitCode = 0;
            try
            {
                Run(folder, rosterOnly);
            }
            catch (Exception error)
            {
                Debug.LogError($"{LogPrefix} FAILED: {error}");
                exitCode = 1;
            }

            if (Application.isBatchMode)
            {
                EditorApplication.Exit(exitCode);
            }
        }

        [MenuItem("Ringside Booker/Import Workshop World Mod…")]
        private static void RunFromMenu()
        {
            var folder = EditorUtility.OpenFolderPanel("Workshop world mod folder", string.Empty, string.Empty);
            if (!string.IsNullOrEmpty(folder))
            {
                Run(folder, rosterOnly: false);
            }
        }

        [MenuItem("Ringside Booker/List Installed Workshop World Mods")]
        private static void ListFromMenu()
        {
            var mods = WorkshopModScanner.FindInstalled();
            Debug.Log($"{LogPrefix} {mods.Count} installed workshop world mod(s)");
            foreach (var mod in mods)
            {
                Debug.Log($"{LogPrefix} item {mod.ItemId}: {mod.WorldName} ({mod.StartDate}) in {mod.Folder}");
            }
        }

        public static void Run(string folder, bool rosterOnly)
        {
            var mod = string.IsNullOrEmpty(folder)
                ? WorkshopModScanner.FindInstalled().FirstOrDefault()
                : WorkshopModScanner.Describe(folder);
            if (mod == null)
            {
                throw new InvalidOperationException(string.IsNullOrEmpty(folder)
                    ? "No installed workshop world mod was found in the Steam libraries"
                    : $"No database at the top of {folder}");
            }

            Debug.Log($"{LogPrefix} mod item {mod.ItemId}, start {mod.StartDate}, rosterOnly {rosterOnly}, sqlite {Import.Sqlite.SqliteDatabase.LibraryVersion}");
            var clock = Stopwatch.StartNew();
            using (var host = JsEngineHost.LoadFromStreamingAssets())
            {
                Debug.Log($"{LogPrefix} engine loaded in {clock.ElapsedMilliseconds} ms");
                var result = WorldModImporter.Import(mod, rosterOnly, json => host.Call("importWorldMod", json));
                var report = result.Response["report"];
                Debug.Log($"{LogPrefix} read {result.ReadMs:F0} ms ({result.TablesJsonLength / 1024} KB of rows), convert+check {result.ConvertMs:F0} ms, ok {result.Ok}");
                Debug.Log($"{LogPrefix} source rows {report?["sourceCounts"]?.ToString(Newtonsoft.Json.Formatting.None)}");
                Debug.Log($"{LogPrefix} imported {result.Counts?.ToString(Newtonsoft.Json.Formatting.None)}");
                Debug.Log($"{LogPrefix} pictures {report?["pictures"]?.ToString(Newtonsoft.Json.Formatting.None)} skipped={report?["picturesSkipped"]}");
                var warnings = report?["warnings"] as JArray ?? new JArray();
                Debug.Log($"{LogPrefix} {warnings.Count} warning kind(s): {string.Join(", ", warnings.Select(warning => $"{warning["code"]}×{warning["count"]}"))}");
                Debug.Log($"{LogPrefix} loader issues {result.Response["issueCount"]}");
                if (!result.Ok)
                {
                    throw new InvalidOperationException($"Import failed: {result.ErrorSummary} {result.Response["issues"]?.ToString(Newtonsoft.Json.Formatting.None)}");
                }

                StartAndPlay(host, result.PackId);
                CheckPictures(host, mod, rosterOnly);
            }

            Debug.Log($"{LogPrefix} OK in {clock.ElapsedMilliseconds} ms");
        }

        private static void StartAndPlay(JsEngineHost host, string packId)
        {
            var preview = JObject.Parse(host.Call("previewWorld", packId));
            var promotions = preview["value"]?["promotions"] as JArray ?? new JArray();
            var homeRegion = promotions
                .OrderByDescending(promotion => promotion.Value<double?>("prestige") ?? 0)
                .Select(promotion => promotion.Value<string>("homeRegionKey"))
                .FirstOrDefault(region => region != null) ?? "us-northeast";
            var newGame = new JObject
            {
                ["rootPackId"] = packId,
                ["seed"] = "world-mod-smoke",
                ["playerName"] = "Smoke Test",
                ["saveName"] = "World mod smoke",
                ["seasonLength"] = new JObject { ["preset"] = "12m" },
                // A founded promotion with no starter show, so no card of the player's needs booking.
                ["player"] = new JObject
                {
                    ["mode"] = "found",
                    ["name"] = "Smoke Test Wrestling",
                    ["shortName"] = "STW",
                    ["homeRegionKey"] = homeRegion,
                    ["style"] = "traditional",
                    ["size"] = "small",
                    ["color"] = "#335577",
                    ["starterKit"] = false,
                    ["weeklyShowDay"] = 3,
                },
                ["settings"] = new JObject(),
            };
            var clock = Stopwatch.StartNew();
            var created = JObject.Parse(host.Call("newGame", newGame.ToString(Newtonsoft.Json.Formatting.None)));
            if (created.Value<bool?>("ok") != true)
            {
                throw new InvalidOperationException($"newGame failed: {created.ToString(Newtonsoft.Json.Formatting.None)}");
            }

            Debug.Log($"{LogPrefix} newGame {clock.ElapsedMilliseconds} ms ({promotions.Count} promotions to pick from)");
            clock.Restart();
            var days = 0;
            var date = string.Empty;
            for (var attempt = 0; attempt < 30 && days < DaysToPlay; attempt++)
            {
                host.Call("command", "news.ackAlerts", "{}");
                var advanced = JObject.Parse(host.CallAsync("advanceDays", $"{{\"maxDays\":{DaysToPlay - days}}}"));
                if (advanced.Value<bool?>("ok") != true)
                {
                    throw new InvalidOperationException($"advanceDays failed: {advanced.ToString(Newtonsoft.Json.Formatting.None)}");
                }

                if (advanced["failures"] is JArray failures && failures.Count > 0)
                {
                    throw new InvalidOperationException($"advanceDays had failures: {failures.ToString(Newtonsoft.Json.Formatting.None)}");
                }

                var step = advanced.Value<int?>("daysAdvanced") ?? 0;
                days += step;
                date = advanced.Value<string>("endDate") ?? date;
                if (step == 0 && advanced["stoppedBy"]?.Value<string>("kind") != "gate")
                {
                    break;
                }
            }

            if (days < DaysToPlay)
            {
                throw new InvalidOperationException($"Only {days} of {DaysToPlay} days were played");
            }

            Debug.Log($"{LogPrefix} advanced {days} days to {date} in {clock.ElapsedMilliseconds} ms");
        }

        private static void CheckPictures(JsEngineHost host, WorkshopMod mod, bool rosterOnly)
        {
            var list = JObject.Parse(host.Call("query", "workers.list", "{}"));
            var refs = list.SelectTokens("$..imageRef")
                .Select(token => token.Type == JTokenType.String ? token.Value<string>() : null)
                .Where(imageRef => imageRef != null)
                .ToList();
            using (var pictures = new PictureProvider(mod.PictureFolder, rosterOnly))
            {
                var onDisk = refs.Count(pictures.HasPicture);
                var loaded = refs.Take(3).Select(pictures.Get).ToList();
                Debug.Log($"{LogPrefix} workers.list: {refs.Count} picture refs, {onDisk} found on disk, " +
                          $"{loaded.Count(texture => texture != pictures.Placeholder)} of {loaded.Count} sampled decoded " +
                          $"({string.Join(", ", loaded.Select(texture => $"{texture.width}x{texture.height}"))}), files read {pictures.FilesRead}");
                if (rosterOnly && (refs.Count > 0 || pictures.FilesRead > 0))
                {
                    throw new InvalidOperationException("A roster-only import must not reference or read pictures");
                }
            }
        }
    }
}
