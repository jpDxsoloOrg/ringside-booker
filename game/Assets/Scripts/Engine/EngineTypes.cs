using System;
using System.Collections.Generic;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RingsideBooker.Engine
{
    // C# shapes for the engine host's common envelopes (game/docs/engine-host.md). Anything the
    // screens read that is not here stays a JToken, so a screen can read any query without a C#
    // type for every engine shape. Traces (Why?) are never parsed here: they arrive as raw JToken
    // and UNITY-08 deserializes them.

    /// <summary>The entity a reason, gate hit or trace node is about, so the UI can link to it.</summary>
    public sealed class EntityRef
    {
        public string Kind { get; set; }
        public string Id { get; set; }

        public override string ToString() => $"{Kind}:{Id}";
    }

    /// <summary>
    /// Why a call was refused: <c>{ code, message, field?, subject? }</c>. Host codes are
    /// <c>noWorld</c>, <c>busy</c>, <c>invalidArgs</c> and <c>internal</c>; queries and commands add
    /// their own. <see cref="Message"/> is written for the player and is shown as it is.
    /// </summary>
    public sealed class EngineReason
    {
        public string Code { get; set; }
        public string Message { get; set; }

        /// <summary>The argument the reason is about, such as <c>value</c> or <c>types[2]</c>.</summary>
        public string Field { get; set; }

        public EntityRef Subject { get; set; }

        /// <summary>Any other fields the engine sent with the reason.</summary>
        [JsonExtensionData]
        public IDictionary<string, JToken> Extra { get; set; }

        public override string ToString() => Field == null ? $"{Code}: {Message}" : $"{Code} ({Field}): {Message}";
    }

    /// <summary>Well-known reason codes from the host.</summary>
    public static class EngineReasonCodes
    {
        public const string NoWorld = "noWorld";
        public const string Busy = "busy";
        public const string InvalidArgs = "invalidArgs";
        public const string Internal = "internal";
    }

    /// <summary>Fields every host result has: <c>ok</c>, refusal <c>reasons</c> and the world <c>revision</c>.</summary>
    public class EngineResult
    {
        public bool Ok { get; set; }
        public List<EngineReason> Reasons { get; set; } = new List<EngineReason>();

        /// <summary>Goes up whenever the world changes; cache query results by it.</summary>
        public long Revision { get; set; }

        /// <summary>The reasons joined into one line (empty when ok).</summary>
        public string ReasonText => Reasons == null ? string.Empty : string.Join("; ", Reasons);

        public bool HasReason(string code) => Reasons != null && Reasons.Exists(reason => reason.Code == code);
    }

    /// <summary>A query's answer: <c>Data</c> when ok, <c>Reasons</c> when refused.</summary>
    public sealed class QueryResult<T> : EngineResult
    {
        public T Data { get; set; }
    }

    /// <summary>An event a command published: <c>{ type, seq }</c>.</summary>
    public sealed class EngineEventRef
    {
        public string Type { get; set; }
        public long Seq { get; set; }
    }

    /// <summary>A command's outcome (all or nothing): <c>Data</c> and <c>Events</c> when applied, <c>Reasons</c> when refused.</summary>
    public sealed class CommandResult<T> : EngineResult
    {
        public T Data { get; set; }
        public List<EngineEventRef> Events { get; set; } = new List<EngineEventRef>();
    }

    /// <summary><c>info()</c>: the bundle's versions and state.</summary>
    public sealed class EngineInfo
    {
        public string EngineVersion { get; set; }
        public int HostApiVersion { get; set; }
        public int SaveFormatVersion { get; set; }
        public string SchemaFingerprint { get; set; }
        public List<string> Shims { get; set; } = new List<string>();
        public bool DebugChecks { get; set; }
        public bool WorldLoaded { get; set; }
        public long Revision { get; set; }
    }

    /// <summary><c>listWorlds()</c>: the bundled world packs' manifests (raw), and packs that would not read.</summary>
    public sealed class WorldListResult : EngineResult
    {
        public JArray Packs { get; set; } = new JArray();
        public JArray Issues { get; set; } = new JArray();
    }

    /// <summary><c>previewWorld(id)</c>: the new-game wizard's preview (raw <c>WorldPreview</c>).</summary>
    public sealed class WorldPreviewResult : EngineResult
    {
        public JToken Value { get; set; }
        public JArray Issues { get; set; } = new JArray();
    }

    /// <summary>Who this machine plays as. Viewer and controller are passed back to the engine as they are.</summary>
    public sealed class LocalSeat
    {
        public JToken Viewer { get; set; }
        public JToken Controller { get; set; }
        public string PromotionId { get; set; }
    }

    /// <summary><c>newGame(options)</c>.</summary>
    public sealed class NewGameResult : EngineResult
    {
        public JToken Summary { get; set; }
        public LocalSeat Seat { get; set; }
        public List<string> Warnings { get; set; } = new List<string>();
    }

    /// <summary>A problem found reading a save: <c>{ path, message }</c>.</summary>
    public sealed class SaveIssue
    {
        public string Path { get; set; }
        public string Message { get; set; }

        public override string ToString() => string.IsNullOrEmpty(Path) ? Message : $"{Path}: {Message}";
    }

    /// <summary>What a loaded save turned out to be.</summary>
    public sealed class LoadSummary
    {
        public string Label { get; set; }
        public LocalSeat Seat { get; set; }
        public string PromotionName { get; set; }
        public string GameDate { get; set; }
        /// <summary>The save-format upgrades that ran on load, oldest first (empty for a current save).</summary>
        public List<AppliedMigration> MigrationsApplied { get; set; } = new List<AppliedMigration>();
    }

    /// <summary>One save-format upgrade that ran on load (the engine's <c>AppliedMigration</c>).</summary>
    public sealed class AppliedMigration
    {
        public int From { get; set; }
        public int To { get; set; }

        /// <summary>What it changed, in words ("Adds venue capacity").</summary>
        public string Title { get; set; }
    }

    /// <summary>
    /// <c>load(save)</c> / <c>inspectSave(save)</c>. On failure <see cref="Stage"/> says where the save
    /// broke (<c>decode</c>, <c>parse</c>, <c>format</c>, <c>version</c>, <c>migrate</c>, <c>validate</c>,
    /// <c>build</c>, <c>integrity</c>) and <see cref="Issues"/> what was wrong; a host refusal (busy)
    /// comes in <see cref="EngineResult.Reasons"/> instead.
    /// </summary>
    public sealed class LoadResult : EngineResult
    {
        public LoadSummary Summary { get; set; }
        public List<SaveIssue> Warnings { get; set; } = new List<SaveIssue>();
        public string Stage { get; set; }
        public List<SaveIssue> Issues { get; set; } = new List<SaveIssue>();
        public int Truncated { get; set; }

        /// <summary>For <c>inspectSave</c>: the save's header (raw <c>SaveHeader</c>).</summary>
        public JToken Header { get; set; }

        /// <summary>For <c>inspectSave</c>: the engine build that wrote the save.</summary>
        public string EngineVersion { get; set; }

        /// <summary>For <c>inspectSave</c>: the save's format version.</summary>
        public int FormatVersion { get; set; }

        /// <summary>Everything that went wrong, as one line.</summary>
        public string ProblemText
        {
            get
            {
                var parts = new List<string>();
                if (Reasons != null && Reasons.Count > 0)
                {
                    parts.Add(ReasonText);
                }

                if (Issues != null && Issues.Count > 0)
                {
                    parts.Add((Stage == null ? string.Empty : Stage + ": ") + string.Join("; ", Issues));
                }

                return string.Join("; ", parts);
            }
        }
    }

    /// <summary><c>save(options)</c>: the save file's bytes, decoded from the host's base64.</summary>
    public sealed class SaveResult : EngineResult
    {
        /// <summary>The file's bytes: write them to disk as they are.</summary>
        [JsonIgnore]
        public byte[] Bytes { get; set; }

        public int ByteLength { get; set; }
        public JToken Header { get; set; }
    }

    /// <summary><c>worldHash()</c>: the engine's world hash (16 hex digits), the same the web app prints.</summary>
    public sealed class WorldHashResult : EngineResult
    {
        public string Hash { get; set; }
    }

    /// <summary>Options for <c>advanceDays</c>.</summary>
    public sealed class AdvanceOptions
    {
        public const int MaxAllowedDays = 3650;

        /// <summary>1 to 3650.</summary>
        public int MaxDays { get; set; } = 1;

        /// <summary>A game date, <c>YYYY-MM-DD</c>, to stop at (optional).</summary>
        public string StopAtDate { get; set; }

        public static AdvanceOptions Days(int days) => new AdvanceOptions { MaxDays = days };
    }

    /// <summary>Sent after every simulated day of an advance.</summary>
    public sealed class AdvanceProgress
    {
        public int DaysDone { get; set; }
        public int DaysRequested { get; set; }

        /// <summary>The day just simulated.</summary>
        public string Date { get; set; }

        /// <summary>The world's date now (the next day to simulate).</summary>
        public string CurrentDate { get; set; }

        public long Revision { get; set; }
    }

    /// <summary>A gate that stopped an advance: a decision the player must make first.</summary>
    public sealed class GateHit
    {
        /// <summary><c>system.camelName</c>, such as <c>shows.tonight</c> or <c>news.alert</c>.</summary>
        public string GateId { get; set; }

        /// <summary>Written for the player, naming the thing that needs them.</summary>
        public string Reason { get; set; }

        public EntityRef Subject { get; set; }

        /// <summary>The screen route key the UI can link to, such as <c>booking</c> or <c>news</c>.</summary>
        public string ActionHint { get; set; }
    }

    /// <summary>Well-known gate ids.</summary>
    public static class GateIds
    {
        public const string ShowTonight = "shows.tonight";
        public const string NewsAlert = "news.alert";
        public const string StopDate = "sim.stopDate";
        public const string RepeatedFailure = "sim.repeatedFailure";
    }

    /// <summary>Why an advance stopped: <c>completed</c>, <c>gate</c> (with hits) or <c>cancelled</c>.</summary>
    public sealed class AdvanceStop
    {
        public const string Completed = "completed";
        public const string Gate = "gate";
        public const string Cancelled = "cancelled";

        public string Kind { get; set; }
        public List<GateHit> Hits { get; set; } = new List<GateHit>();
    }

    /// <summary>A step that failed during an advance (the day still ran).</summary>
    public sealed class AdvanceFailure
    {
        public string Date { get; set; }
        public string StepId { get; set; }
        public string Message { get; set; }
    }

    /// <summary>The outcome of <c>advanceDays</c>: the engine's advance report plus ok and revision.</summary>
    public sealed class AdvanceReport : EngineResult
    {
        public string StartDate { get; set; }
        public string EndDate { get; set; }
        public int DaysAdvanced { get; set; }
        public AdvanceStop StoppedBy { get; set; }
        public List<AdvanceFailure> Failures { get; set; } = new List<AdvanceFailure>();
        public int EventsPublished { get; set; }

        /// <summary>The days asked for (the request's <c>maxDays</c>; filled in by the client, not the engine).</summary>
        [JsonIgnore]
        public int DaysRequested { get; set; }

        /// <summary>Wall-clock time (not deterministic).</summary>
        public JToken Timing { get; set; }

        public bool Completed => Ok && StoppedBy?.Kind == AdvanceStop.Completed;
        public bool StoppedAtGate => Ok && StoppedBy?.Kind == AdvanceStop.Gate;
        public bool WasCancelled => Ok && StoppedBy?.Kind == AdvanceStop.Cancelled;

        /// <summary>The gates that stopped the advance (empty unless <see cref="StoppedAtGate"/>).</summary>
        public IReadOnlyList<GateHit> GateHits => StoppedBy?.Hits ?? (IReadOnlyList<GateHit>)Array.Empty<GateHit>();
    }

    /// <summary><c>clock.get</c>.</summary>
    public sealed class ClockView
    {
        /// <summary><c>YYYY-MM-DD</c>.</summary>
        public string Date { get; set; }

        /// <summary>0 = Monday … 6 = Sunday.</summary>
        public int Weekday { get; set; }

        /// <summary>Day 1 is the world's start date.</summary>
        public int DayNumber { get; set; }
    }

    /// <summary>The active season in <c>sim.status</c>.</summary>
    public sealed class SeasonStatus
    {
        public int Number { get; set; }
        public string EndDate { get; set; }
    }

    /// <summary>
    /// The viewer's promotion in <c>sim.status</c>. Cash is in cents. Popularity (with its Why?
    /// traces) stays raw.
    /// </summary>
    public sealed class PromotionStatus
    {
        public string PromotionId { get; set; }
        public string Name { get; set; }
        public string ShortName { get; set; }
        public long Cash { get; set; }

        /// <summary>The stored cash Why? ref (raw <c>TraceRef</c>), or null.</summary>
        public JToken CashTraceRef { get; set; }

        /// <summary>Raw: homeRegionId, homeRegion, prestige, headline, headlineLabel, traceRef, trace.</summary>
        public JToken Popularity { get; set; }
    }

    /// <summary><c>sim.status</c>: what the top bar shows.</summary>
    public sealed class SimStatus
    {
        public string Date { get; set; }
        public SeasonStatus Season { get; set; }
        public PromotionStatus Promotion { get; set; }
        public bool Sandbox { get; set; }
    }

    /// <summary><c>sim.pendingGates</c>: why Next Day would stop today, if it would.</summary>
    public sealed class PendingGates
    {
        public string Date { get; set; }
        public List<GateHit> Hits { get; set; } = new List<GateHit>();
    }

    /// <summary>Common query and command names.</summary>
    public static class EngineQueries
    {
        public const string Clock = "clock.get";
        public const string SimStatus = "sim.status";
        public const string PendingGates = "sim.pendingGates";
        public const string LastDayReport = "sim.lastDayReport";
        public const string Trace = "trace.get";
    }

    public static class EngineCommands
    {
        public const string AckNewsAlerts = "news.ackAlerts";
    }

    /// <summary>Viewers to pass to <see cref="EngineClient.Query{T}"/> instead of the local seat.</summary>
    public static class EngineViewers
    {
        /// <summary>Sees everything (debugging tools only).</summary>
        public static JObject Omniscient => new JObject { ["kind"] = "omniscient" };
    }
}
