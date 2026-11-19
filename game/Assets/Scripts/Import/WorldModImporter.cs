using System;
using System.Diagnostics;
using Newtonsoft.Json.Linq;

namespace RingsideBooker.Import
{
    /// <summary>The outcome of importing a workshop world mod into the engine.</summary>
    public sealed class WorldModImportResult
    {
        public bool Ok { get; internal set; }

        /// <summary>The imported world's pack id (pass it as <c>rootPackId</c> to <c>newGame</c>).</summary>
        public string PackId { get; internal set; }

        /// <summary>The engine's full answer: <c>{ok, manifest, report, issues, issueCount}</c> or the refusal.</summary>
        public JObject Response { get; internal set; }

        public double ReadMs { get; internal set; }

        public double ConvertMs { get; internal set; }

        /// <summary>The exception that stopped the import before the engine answered (an unreadable database), or null.</summary>
        public Exception Exception { get; internal set; }

        /// <summary>A failed result for an import that threw before the engine answered.</summary>
        public static WorldModImportResult Failed(string packId, Exception exception) => new WorldModImportResult
        {
            Ok = false,
            PackId = packId,
            Exception = exception,
        };

        /// <summary>Bytes of table JSON handed to the engine.</summary>
        public int TablesJsonLength { get; internal set; }

        /// <summary>Counts per pack record kind (people, promotions, titles…), from the report.</summary>
        public JObject Counts => Response?["report"]?["counts"] as JObject;

        /// <summary>
        /// Why a failed import failed, as codes and counts only (no names from the mod), for the
        /// log: the stage, the engine rules the pack check refused with how often
        /// (<c>ruleCounts</c>), or the converter's fixed error sentences, or the refusal codes.
        /// Null for a successful import.
        /// </summary>
        public string ReasonCodes
        {
            get
            {
                if (Ok)
                {
                    return null;
                }

                if (Exception != null)
                {
                    return "stage=read; exception=" + Exception.GetType().Name;
                }

                if (Response == null)
                {
                    return "no-response";
                }

                var parts = new System.Collections.Generic.List<string> { "stage=" + (Response.Value<string>("stage") ?? "host") };
                if (Response["ruleCounts"] is JObject rules)
                {
                    foreach (var rule in rules.Properties())
                    {
                        parts.Add(rule.Name + "x" + rule.Value);
                    }
                }
                else if (Response.Value<string>("stage") == "convert" && Response["errors"] is JArray errors)
                {
                    // The converter's errors are fixed sentences about missing tables and empty worlds.
                    foreach (var error in errors)
                    {
                        parts.Add(error.ToString());
                    }
                }

                if (Response["reasons"] is JArray reasons)
                {
                    foreach (var reason in reasons)
                    {
                        parts.Add("reason=" + (reason.Value<string>("code") ?? "unknown"));
                    }
                }

                return string.Join("; ", parts);
            }
        }

        /// <summary>A one-line summary of the problems, for a failed import.</summary>
        public string ErrorSummary
        {
            get
            {
                if (Ok || Response == null)
                {
                    return null;
                }

                var errors = Response["errors"] as JArray;
                var reasons = Response["reasons"] as JArray;
                return errors != null ? string.Join("; ", errors) : reasons?.ToString(Newtonsoft.Json.Formatting.None) ?? "unknown error";
            }
        }
    }

    /// <summary>
    /// Imports a workshop world mod: reads its database (a temp copy) into JSON rows and hands them
    /// to the engine bundle's <c>importWorldMod</c>, which converts them into a world pack, checks
    /// it with the pack loader and keeps it for <c>newGame</c> for the rest of the session.
    ///
    /// The engine call is a delegate so this assembly does not depend on a particular host:
    /// pass <c>json =&gt; host.Call("importWorldMod", json)</c> for a <c>JsEngineHost</c>.
    /// Run it on the engine's thread; reading a large mod takes about a second.
    /// </summary>
    public static class WorldModImporter
    {
        /// <summary>The stage names <see cref="Import(WorkshopMod, bool, Func{string, string}, Action{string})"/> reports.</summary>
        public const string StageReading = "reading";
        public const string StageConverting = "converting";

        public static WorldModImportResult Import(WorkshopMod mod, bool rosterOnly, Func<string, string> importWorldMod) =>
            Import(mod, rosterOnly, importWorldMod, null);

        /// <summary>
        /// As above; <paramref name="onStage"/> (called on the importing thread) hears
        /// <see cref="StageReading"/> and then <see cref="StageConverting"/>.
        /// </summary>
        public static WorldModImportResult Import(WorkshopMod mod, bool rosterOnly, Func<string, string> importWorldMod, Action<string> onStage)
        {
            if (mod == null)
            {
                throw new ArgumentNullException(nameof(mod));
            }

            if (importWorldMod == null)
            {
                throw new ArgumentNullException(nameof(importWorldMod));
            }

            var clock = Stopwatch.StartNew();
            onStage?.Invoke(StageReading);
            string tablesJson;
            using (var database = WorldModDatabase.OpenCopy(mod.DatabasePath))
            {
                tablesJson = database.ReadTablesJson();
            }

            var readMs = clock.Elapsed.TotalMilliseconds;
            clock.Restart();
            onStage?.Invoke(StageConverting);
            var input = "{\"rosterOnly\":" + (rosterOnly ? "true" : "false") +
                        ",\"packId\":\"" + mod.PackId + "\",\"tables\":" + tablesJson + "}";
            var response = JObject.Parse(importWorldMod(input));
            return new WorldModImportResult
            {
                Ok = response.Value<bool?>("ok") == true,
                PackId = mod.PackId,
                Response = response,
                ReadMs = readMs,
                ConvertMs = clock.Elapsed.TotalMilliseconds,
                TablesJsonLength = tablesJson.Length,
            };
        }
    }
}
