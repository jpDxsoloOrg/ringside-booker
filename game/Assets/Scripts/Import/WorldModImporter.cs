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

        /// <summary>Bytes of table JSON handed to the engine.</summary>
        public int TablesJsonLength { get; internal set; }

        /// <summary>Counts per pack record kind (people, promotions, titles…), from the report.</summary>
        public JObject Counts => Response?["report"]?["counts"] as JObject;

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
        public static WorldModImportResult Import(WorkshopMod mod, bool rosterOnly, Func<string, string> importWorldMod)
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
            string tablesJson;
            using (var database = WorldModDatabase.OpenCopy(mod.DatabasePath))
            {
                tablesJson = database.ReadTablesJson();
            }

            var readMs = clock.Elapsed.TotalMilliseconds;
            clock.Restart();
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
