using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;
using UnityEngine;

namespace RingsideBooker.Engine
{
    /// <summary>
    /// The game's typed client for the embedded engine (game/docs/engine-host.md). It owns one
    /// <see cref="JsEngineHost"/> on a dedicated engine thread with a work queue, so the UI never
    /// waits on the simulation.
    ///
    /// <para><b>Threading.</b> Create it on Unity's main thread (<see cref="StartAsync"/>). Every call
    /// returns a <see cref="Task{T}"/> and is queued; calls run one at a time, in the order they were
    /// made. Awaiting a call from a MonoBehaviour resumes on the main thread (Unity's
    /// SynchronizationContext); for callbacks use <see cref="EngineTaskExtensions.Then{T}"/>. Events
    /// are raised on the main thread. While an advance runs, queued queries (and <c>WorldHash</c>,
    /// <c>Info</c>) at the head of the queue run between days, so screens can still read; commands,
    /// saves and loads wait for the advance to finish.</para>
    ///
    /// <para><b>Refusals</b> are results, not exceptions: check <see cref="EngineResult.Ok"/> and show
    /// <see cref="EngineResult.Reasons"/>, as the web client does. A faulted task means a fault at the
    /// C#/JavaScript boundary (<see cref="JsEngineException"/>) or a disposed client.</para>
    /// </summary>
    public sealed class EngineClient : IDisposable
    {
        /// <summary>The engine thread's stack (the engine recurses deeply in a few places).</summary>
        public const int EngineThreadStackBytes = 16 * 1024 * 1024;

        /// <summary>How long <see cref="Dispose"/> waits for the engine thread to finish its current call.</summary>
        public static readonly TimeSpan DisposeTimeout = TimeSpan.FromSeconds(10);

        /// <summary>Settings for every JSON the client writes and reads (camelCase, dates kept as text).</summary>
        public static readonly JsonSerializerSettings JsonSettings = new JsonSerializerSettings
        {
            ContractResolver = new CamelCasePropertyNamesContractResolver(),
            NullValueHandling = NullValueHandling.Ignore,
            MissingMemberHandling = MissingMemberHandling.Ignore,
            DateParseHandling = DateParseHandling.None,
            FloatParseHandling = FloatParseHandling.Double,
        };

        private static readonly JsonSerializer Serializer = JsonSerializer.Create(JsonSettings);

        private readonly SynchronizationContext mainContext;
        private readonly object queueLock = new object();
        private readonly LinkedList<WorkItem> queue = new LinkedList<WorkItem>();
        private readonly Thread engineThread;
        private readonly TaskCompletionSource<EngineInfo> ready =
            new TaskCompletionSource<EngineInfo>(TaskCreationOptions.RunContinuationsAsynchronously);

        private JsEngineHost host; // engine thread only
        private bool closing; // under queueLock
        private int pendingCount; // under queueLock: queued plus running calls
        private volatile bool advancing;
        private volatile bool cancelRequested;
        private long revision = -1; // last revision seen (Interlocked)
        private long notifiedRevision = -1; // engine thread only

        /// <summary>
        /// Starts the engine thread and loads the bundle on it. Call on Unity's main thread: the main
        /// thread's SynchronizationContext receives events, and the native V8 search path is set
        /// here. <see cref="Ready"/> completes when the bundle has loaded.
        /// </summary>
        /// <param name="bundlePath">engine.js; null for StreamingAssets/engine/engine.js.</param>
        /// <param name="mainThreadContext">Where events are raised; null for the current context.
        /// With no context at all, events are raised on the engine thread.</param>
        public EngineClient(string bundlePath = null, SynchronizationContext mainThreadContext = null)
        {
            mainContext = mainThreadContext ?? SynchronizationContext.Current;
            JsEngineHost.ConfigureNativeSearchPath(Application.dataPath);
            string path = bundlePath ?? JsEngineHost.DefaultBundlePath;

            engineThread = new Thread(() => EngineThreadMain(path), EngineThreadStackBytes)
            {
                Name = "Ringside engine",
                IsBackground = true,
            };
            engineThread.Start();
            Application.quitting += Dispose;
        }

        /// <summary>Raised on the main thread after every simulated day of an advance.</summary>
        public event Action<AdvanceProgress> OnAdvanceProgress;

        /// <summary>Raised on the main thread when an advance ends (completed, at a gate, cancelled or refused).</summary>
        public event Action<AdvanceReport> OnAdvanceFinished;

        /// <summary>
        /// Raised on the main thread when a call returns a new world revision (a command applied, a
        /// game made or loaded, an advance finished): screens refresh their queries. Not raised per
        /// day during an advance; use <see cref="OnAdvanceProgress"/> for that.
        /// </summary>
        public event Action<long> OnStateChanged;

        /// <summary>Raised on the main thread when <see cref="IsBusy"/> changes.</summary>
        public event Action<bool> OnBusyChanged;

        /// <summary>Completes with <c>info()</c> once the bundle has loaded; faults if it could not.</summary>
        public Task<EngineInfo> Ready => ready.Task;

        /// <summary>True while any call is queued or running.</summary>
        public bool IsBusy
        {
            get
            {
                lock (queueLock)
                {
                    return pendingCount > 0;
                }
            }
        }

        /// <summary>True while an advance runs (the "simulating" state: disable commands, show Stop).</summary>
        public bool IsAdvancing => advancing;

        /// <summary>The last world revision any call returned (-1 before the first).</summary>
        public long Revision => Interlocked.Read(ref revision);

        /// <summary>Starts a client and waits for the bundle to load. Call on Unity's main thread.</summary>
        public static async Task<EngineClient> StartAsync(string bundlePath = null)
        {
            var client = new EngineClient(bundlePath);
            try
            {
                await client.Ready;
            }
            catch
            {
                client.Dispose();
                throw;
            }

            return client;
        }

        /// <summary>The bundle's versions and whether a game is loaded.</summary>
        public Task<EngineInfo> Info()
        {
            return Enqueue("info", true, engine => ParseToken(engine.Call("info")).ToObject<EngineInfo>(Serializer));
        }

        /// <summary><c>configure</c>, e.g. <c>new { debugChecks = true }</c>; applies from the next new game or load.</summary>
        public Task<EngineResult> Configure(object options)
        {
            string json = ToJsonArgument(options);
            return Enqueue("configure", false, engine => ParseResult<EngineResult>(engine.Call("configure", json)));
        }

        /// <summary>The bundled world packs, for the new-game wizard.</summary>
        public Task<WorldListResult> ListWorlds()
        {
            return Enqueue("listWorlds", true, engine => ParseResult<WorldListResult>(engine.Call("listWorlds")));
        }

        /// <summary>The wizard's preview of one world pack (promotions, regions, settings, start date).</summary>
        public Task<WorldPreviewResult> PreviewWorld(string rootPackId)
        {
            return Enqueue("previewWorld", true, engine => ParseResult<WorldPreviewResult>(engine.Call("previewWorld", rootPackId)));
        }

        /// <summary>
        /// Builds a new world and makes it the running game. <paramref name="options"/> is the engine's
        /// new-game input (engine-host.md, "newGame"): a JObject, an object serialised in camelCase,
        /// or JSON text. A refusal leaves the running game as it was.
        /// </summary>
        public Task<NewGameResult> NewGame(object options)
        {
            string json = ToJsonArgument(options);
            return Enqueue("newGame", false, engine => ParseResult<NewGameResult>(engine.Call("newGame", json)));
        }

        /// <summary>Loads a save file's bytes (the web app's save format). A failed load leaves the running game as it was.</summary>
        public Task<LoadResult> Load(byte[] saveBytes)
        {
            if (saveBytes == null)
            {
                throw new ArgumentNullException(nameof(saveBytes));
            }

            return Enqueue("load", false, engine =>
                ParseResult<LoadResult>(engine.CallAsync("load", Convert.ToBase64String(saveBytes))));
        }

        /// <summary>Reads a save's header without loading it (load screen).</summary>
        public Task<LoadResult> InspectSave(byte[] saveBytes)
        {
            if (saveBytes == null)
            {
                throw new ArgumentNullException(nameof(saveBytes));
            }

            return Enqueue("inspectSave", false, engine =>
                ParseResult<LoadResult>(engine.CallAsync("inspectSave", Convert.ToBase64String(saveBytes))));
        }

        /// <summary>
        /// Saves the running game. <see cref="SaveResult.Bytes"/> is the file to write as it is.
        /// </summary>
        /// <param name="label">The header's label; null for the world's name.</param>
        /// <param name="savedAt">The header's time; null for now.</param>
        public Task<SaveResult> Save(string label = null, DateTimeOffset? savedAt = null)
        {
            var options = new JObject();
            if (label != null)
            {
                options["label"] = label;
            }

            if (savedAt.HasValue)
            {
                options["savedAt"] = savedAt.Value.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture);
            }

            string json = options.ToString(Formatting.None);
            return Enqueue("save", false, engine =>
            {
                JToken token = ParseToken(engine.CallAsync("save", json));
                var result = token.ToObject<SaveResult>(Serializer);
                string base64 = token.Value<string>("base64");
                result.Bytes = base64 == null ? null : Convert.FromBase64String(base64);
                if (token["revision"] != null)
                {
                    ObserveRevision(result.Revision, true);
                }

                return result;
            });
        }

        /// <summary>
        /// Runs an engine query for the local seat (or <paramref name="viewer"/>, e.g.
        /// <see cref="EngineViewers.Omniscient"/>). <typeparamref name="T"/> may be a C# type from
        /// EngineTypes.cs or <see cref="JToken"/> for any shape. Args are a JObject, an object or JSON
        /// text; null means <c>{}</c>.
        /// </summary>
        public Task<QueryResult<T>> Query<T>(string name, object args = null, object viewer = null)
        {
            string argsJson = ToJsonArgument(args);
            string viewerJson = viewer == null ? null : ToJsonArgument(viewer);
            return Enqueue("query " + name, true, engine =>
            {
                string json = RunQuery(engine, name, argsJson, viewerJson);
                JToken result = Envelope(json, out long resultRevision);
                var query = new QueryResult<T>();
                FillEnvelope(query, result, resultRevision);
                if (query.Ok)
                {
                    query.Data = ToData<T>(result["data"]);
                }

                return query;
            });
        }

        /// <summary>A query whose data stays raw JSON (any shape).</summary>
        public Task<QueryResult<JToken>> Query(string name, object args = null, object viewer = null)
        {
            return Query<JToken>(name, args, viewer);
        }

        /// <summary>A query's whole JSON result, untouched (<c>{ revision, result }</c>), e.g. for Why? traces.</summary>
        public Task<string> QueryRaw(string name, object args = null, object viewer = null)
        {
            string argsJson = ToJsonArgument(args);
            string viewerJson = viewer == null ? null : ToJsonArgument(viewer);
            return Enqueue("query " + name, true, engine => RunQuery(engine, name, argsJson, viewerJson));
        }

        /// <summary>
        /// Runs an engine command as the local seat, all or nothing. Refused while an advance runs
        /// (it waits in the queue until the advance ends).
        /// </summary>
        public Task<CommandResult<T>> Command<T>(string name, object args = null)
        {
            string argsJson = ToJsonArgument(args);
            return Enqueue("command " + name, false, engine =>
            {
                JToken result = Envelope(engine.Call("command", name, argsJson), out long resultRevision);
                var command = new CommandResult<T>();
                FillEnvelope(command, result, resultRevision);
                if (command.Ok)
                {
                    command.Data = ToData<T>(result["data"]);
                    if (result["events"] is JArray events)
                    {
                        command.Events = events.ToObject<List<EngineEventRef>>(Serializer);
                    }
                }

                ObserveRevision(resultRevision, true);
                return command;
            });
        }

        /// <summary>A command whose data stays raw JSON.</summary>
        public Task<CommandResult<JToken>> Command(string name, object args = null)
        {
            return Command<JToken>(name, args);
        }

        /// <summary>
        /// Simulates up to <see cref="AdvanceOptions.MaxDays"/> days, stopping early at a gate, at
        /// <see cref="AdvanceOptions.StopAtDate"/> or when cancelled. Progress goes to
        /// <paramref name="progress"/> and <see cref="OnAdvanceProgress"/> on the main thread, once a day.
        /// Cancelling <paramref name="cancellationToken"/> (or <see cref="CancelAdvance"/>) stops after
        /// the current day and returns a report with <c>stoppedBy.kind = "cancelled"</c>; a token
        /// cancelled before the advance starts cancels the task instead.
        /// </summary>
        public Task<AdvanceReport> AdvanceDays(
            AdvanceOptions options,
            IProgress<AdvanceProgress> progress = null,
            CancellationToken cancellationToken = default)
        {
            if (options == null)
            {
                throw new ArgumentNullException(nameof(options));
            }

            string json = JsonConvert.SerializeObject(options, JsonSettings);
            return Enqueue(
                "advanceDays",
                false,
                engine => RunAdvance(engine, json, options.MaxDays, progress, cancellationToken),
                cancellationToken);
        }

        /// <summary>Asks the running advance (if any) to stop after its current day. Any thread.</summary>
        public void CancelAdvance()
        {
            if (advancing)
            {
                cancelRequested = true;
            }
        }

        /// <summary>The whole game as the host's JSON text (<c>{ ok, state, revision }</c>, several MB): tools and debugging.</summary>
        public Task<string> ExportState()
        {
            return Enqueue("exportState", true, engine => engine.Call("exportState"));
        }

        /// <summary>The world hash, the same value the web app and the headless runner print for the same game.</summary>
        public Task<WorldHashResult> WorldHash()
        {
            return Enqueue("worldHash", true, engine => ParseResult<WorldHashResult>(engine.Call("worldHash")));
        }

        /// <summary>
        /// Host API v2 (UNITY-06): converts a workshop world mod's tables into a world pack the
        /// engine keeps for the session (<c>{tables, rosterOnly?, packId?}</c> JSON in, the host's raw
        /// JSON answer out). Pass it as <c>WorldModImporter.Import</c>'s delegate from a worker thread
        /// with <c>json =&gt; client.ImportWorldMod(json).Result</c>, never from the main thread.
        /// </summary>
        public Task<string> ImportWorldMod(string inputJson)
        {
            return Enqueue("importWorldMod", false, engine => engine.Call("importWorldMod", inputJson));
        }

        /// <summary>Host API v2: forgets an imported world pack (raw JSON answer).</summary>
        public Task<string> RemoveImportedWorld(string packId)
        {
            return Enqueue("removeImportedWorld", false, engine => engine.Call("removeImportedWorld", packId));
        }

        /// <summary>
        /// Host API v3 (UNITY-14): an imported world pack as JSON text (<c>{"ok":true,"pack":{manifest,files}}</c>,
        /// several MB for a big world), to store it. Pass this answer back to
        /// <see cref="RegisterImportedWorld"/> after a restart.
        /// </summary>
        public Task<string> ExportImportedWorld(string packId)
        {
            return Enqueue("exportImportedWorld", true, engine => engine.Call("exportImportedWorld", packId));
        }

        /// <summary>
        /// Host API v3: makes a stored world pack (<c>{pack}</c> JSON, e.g. an
        /// <see cref="ExportImportedWorld"/> answer) an imported world again without converting
        /// anything (raw JSON answer, <c>{ok, manifest}</c>). The full checks run at preview and new game.
        /// </summary>
        public Task<string> RegisterImportedWorld(string inputJson)
        {
            return Enqueue("registerImportedWorld", false, engine => engine.Call("registerImportedWorld", inputJson));
        }

        /// <summary>Any host function by name, with JSON-text arguments; the raw JSON answer (tools, new host calls).</summary>
        public Task<string> CallRaw(string function, params string[] jsonArgs)
        {
            return Enqueue("call " + function, false, engine => engine.Call(function, jsonArgs));
        }

        /// <summary>Stops the running game (every world call then gets <c>noWorld</c>).</summary>
        public Task<EngineResult> Unload()
        {
            return Enqueue("unload", false, engine => ParseResult<EngineResult>(engine.Call("unload")));
        }

        /// <summary>
        /// Stops the engine: queued calls are cancelled, a running advance stops after its day, and
        /// the V8 runtime is freed on the engine thread. Waits up to <see cref="DisposeTimeout"/>.
        /// </summary>
        public void Dispose()
        {
            List<WorkItem> dropped;
            lock (queueLock)
            {
                if (closing)
                {
                    return;
                }

                closing = true;
                dropped = new List<WorkItem>(queue);
                queue.Clear();
                pendingCount -= dropped.Count;
                Monitor.PulseAll(queueLock);
            }

            cancelRequested = true;
            Application.quitting -= Dispose;
            foreach (WorkItem item in dropped)
            {
                item.Cancel();
            }

            if (Thread.CurrentThread != engineThread && !engineThread.Join(DisposeTimeout))
            {
                Debug.LogWarning("EngineClient: the engine thread did not stop in time");
            }
        }

        private static string RunQuery(JsEngineHost engine, string name, string argsJson, string viewerJson)
        {
            return viewerJson == null
                ? engine.Call("query", name, argsJson)
                : engine.Call("query", name, argsJson, viewerJson);
        }

        private AdvanceReport RunAdvance(
            JsEngineHost engine,
            string optionsJson,
            int daysRequested,
            IProgress<AdvanceProgress> progress,
            CancellationToken cancellationToken)
        {
            cancelRequested = false;
            advancing = true;
            AdvanceReport report;
            bool timing = EnginePerf.Enabled;
            long callbackTicks = 0;
            int days = 0;
            long advanceStarted = timing ? System.Diagnostics.Stopwatch.GetTimestamp() : 0;
            try
            {
                string json = engine.CallAsync("advanceDays", optionsJson, progressJson =>
                {
                    long callbackStarted = timing ? System.Diagnostics.Stopwatch.GetTimestamp() : 0;
                    days++;
                    try
                    {
                        var day = ParseToken(progressJson).ToObject<AdvanceProgress>(Serializer);
                        ObserveRevision(day.Revision, false);
                        Post("main.OnAdvanceProgress", () =>
                        {
                            progress?.Report(day);
                            OnAdvanceProgress?.Invoke(day);
                        });
                    }
                    catch (Exception error)
                    {
                        Debug.LogException(error);
                    }

                    if (cancelRequested || cancellationToken.IsCancellationRequested)
                    {
                        engine.Call("cancelAdvance");
                    }

                    RunQueuedReads(engine);
                    if (timing) callbackTicks += System.Diagnostics.Stopwatch.GetTimestamp() - callbackStarted;
                });
                if (timing)
                {
                    double callMs = (System.Diagnostics.Stopwatch.GetTimestamp() - advanceStarted) * EnginePerf.MsPerTick;
                    double callbackMs = callbackTicks * EnginePerf.MsPerTick;
                    EnginePerf.Record("advance.dayPipeline (V8)", callMs - callbackMs);
                    EnginePerf.Record("advance.progressCallbacks", callbackMs);
                    EnginePerf.Count("advance.days", days);
                }

                report = ParseResult<AdvanceReport>(json);
                report.DaysRequested = daysRequested;
            }
            finally
            {
                advancing = false;
                cancelRequested = false;
            }

            Post("main.OnAdvanceFinished", () => OnAdvanceFinished?.Invoke(report));
            return report;
        }

        private Task<T> Enqueue<T>(
            string label,
            bool readOnly,
            Func<JsEngineHost, T> work,
            CancellationToken cancellationToken = default)
        {
            var completion = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
            var item = new WorkItem(
                label,
                readOnly,
                cancellationToken,
                engine => completion.TrySetResult(work(engine)),
                error => completion.TrySetException(error),
                () => completion.TrySetCanceled());

            bool becameBusy;
            lock (queueLock)
            {
                if (closing)
                {
                    completion.TrySetException(new ObjectDisposedException(nameof(EngineClient)));
                    return completion.Task;
                }

                queue.AddLast(item);
                pendingCount++;
                becameBusy = pendingCount == 1;
                Monitor.Pulse(queueLock);
            }

            if (becameBusy)
            {
                Post("main.OnBusyChanged", () => OnBusyChanged?.Invoke(true));
            }

            return completion.Task;
        }

        private void EngineThreadMain(string bundlePath)
        {
            try
            {
                host = JsEngineHost.LoadFromFile(bundlePath);
                ready.TrySetResult(ParseToken(host.Call("info")).ToObject<EngineInfo>(Serializer));
            }
            catch (Exception error)
            {
                ready.TrySetException(error);
                host?.Dispose();
                host = null;
                FailRemaining(error);
                return;
            }

            try
            {
                while (true)
                {
                    WorkItem item;
                    lock (queueLock)
                    {
                        while (queue.Count == 0 && !closing)
                        {
                            Monitor.Wait(queueLock);
                        }

                        if (closing)
                        {
                            break;
                        }

                        item = queue.First.Value;
                        queue.RemoveFirst();
                    }

                    Execute(item);
                }
            }
            finally
            {
                host.Dispose();
                host = null;
            }
        }

        // Between days of an advance: run the reads at the head of the queue. A read queued after a
        // command stays behind it, so every call still sees the calls made before it.
        private void RunQueuedReads(JsEngineHost engine)
        {
            while (true)
            {
                WorkItem item;
                lock (queueLock)
                {
                    if (closing || queue.Count == 0 || !queue.First.Value.ReadOnly)
                    {
                        return;
                    }

                    item = queue.First.Value;
                    queue.RemoveFirst();
                }

                Execute(item);
            }
        }

        private void Execute(WorkItem item)
        {
            try
            {
                if (item.CancellationToken.IsCancellationRequested)
                {
                    item.Cancel();
                }
                else if (EnginePerf.Enabled)
                {
                    RunMeasured(item);
                }
                else
                {
                    item.Run(host);
                }
            }
            catch (Exception error)
            {
                item.Fail(error);
            }
            finally
            {
                bool becameIdle;
                lock (queueLock)
                {
                    pendingCount--;
                    becameIdle = pendingCount == 0 && !closing;
                }

                if (becameIdle)
                {
                    Post("main.OnBusyChanged", () => OnBusyChanged?.Invoke(false));
                }
            }
        }

        // Dev timing (EnginePerf): queue wait, then the call's time, its V8 share and JSON sizes.
        private void RunMeasured(WorkItem item)
        {
            long started = System.Diagnostics.Stopwatch.GetTimestamp();
            double waitMs = (started - item.EnqueuedAt) * EnginePerf.MsPerTick;
            EnginePerf.CallCounters outer = EnginePerf.BeginCall();
            try
            {
                item.Run(host);
            }
            finally
            {
                double totalMs = (System.Diagnostics.Stopwatch.GetTimestamp() - started) * EnginePerf.MsPerTick;
                EnginePerf.EndCall(item.Label, outer, totalMs, waitMs);
            }
        }

        private void FailRemaining(Exception error)
        {
            List<WorkItem> failed;
            lock (queueLock)
            {
                closing = true;
                failed = new List<WorkItem>(queue);
                queue.Clear();
                pendingCount = 0;
            }

            foreach (WorkItem item in failed)
            {
                item.Fail(error);
            }
        }

        private TResult ParseResult<TResult>(string json) where TResult : EngineResult
        {
            JToken token = ParseToken(json);
            var result = token.ToObject<TResult>(Serializer);
            if (token["revision"] != null)
            {
                ObserveRevision(result.Revision, true);
            }

            return result;
        }

        // Records a revision; raises OnStateChanged when it differs from the last one announced.
        private void ObserveRevision(long newRevision, bool announce)
        {
            Interlocked.Exchange(ref revision, newRevision);
            if (!announce || newRevision == notifiedRevision)
            {
                return;
            }

            notifiedRevision = newRevision;
            Post("main.OnStateChanged", () => OnStateChanged?.Invoke(newRevision));
        }

        // A query/command result is { revision, result: { ok, data | reasons } }; a host refusal
        // (noWorld, busy, invalidArgs) is { ok: false, reasons, revision } with no "result".
        private static JToken Envelope(string json, out long resultRevision)
        {
            JToken root = ParseToken(json);
            resultRevision = root.Value<long?>("revision") ?? 0;
            return root["result"] is JObject result ? result : root;
        }

        private void FillEnvelope(EngineResult target, JToken result, long resultRevision)
        {
            target.Ok = result.Value<bool?>("ok") ?? false;
            target.Revision = resultRevision;
            if (result["reasons"] is JArray reasons)
            {
                target.Reasons = reasons.ToObject<List<EngineReason>>(Serializer);
            }

            Interlocked.Exchange(ref revision, resultRevision);
        }

        private static T ToData<T>(JToken data)
        {
            if (data == null || data.Type == JTokenType.Null)
            {
                return default;
            }

            if (typeof(JToken).IsAssignableFrom(typeof(T)) && data is T token)
            {
                return token;
            }

            return data.ToObject<T>(Serializer);
        }

        /// <summary>Parses engine JSON the way the client does (dates stay text, numbers as double/long).</summary>
        public static JToken ParseToken(string json)
        {
            using (var reader = new JsonTextReader(new StringReader(json)))
            {
                reader.DateParseHandling = DateParseHandling.None;
                reader.FloatParseHandling = FloatParseHandling.Double;
                return JToken.ReadFrom(reader);
            }
        }

        /// <summary>
        /// An argument as JSON text: null is <c>{}</c>, a string is taken as JSON text already, a
        /// JToken is written as it is, anything else is serialised in camelCase.
        /// </summary>
        public static string ToJsonArgument(object value)
        {
            switch (value)
            {
                case null:
                    return "{}";
                case string json:
                    return json;
                case JToken token:
                    return token.ToString(Formatting.None);
                default:
                    return JsonConvert.SerializeObject(value, JsonSettings);
            }
        }

        // Raises an event on the main thread; with timing on, the handlers' time is recorded under label.
        private void Post(string label, Action action)
        {
            if (mainContext == null)
            {
                Invoke(label, action);
                return;
            }

            mainContext.Post(state => Invoke(label, (Action)state), action);
        }

        private static void Invoke(string label, Action action)
        {
            try
            {
                if (EnginePerf.Enabled)
                {
                    using (EnginePerf.Measure(label))
                    {
                        action();
                    }
                }
                else
                {
                    action();
                }
            }
            catch (Exception error)
            {
                Debug.LogException(error);
            }
        }

        private sealed class WorkItem
        {
            private readonly Action<JsEngineHost> run;
            private readonly Action<Exception> fail;
            private readonly Action cancel;

            public WorkItem(
                string label,
                bool readOnly,
                CancellationToken cancellationToken,
                Action<JsEngineHost> run,
                Action<Exception> fail,
                Action cancel)
            {
                Label = label;
                ReadOnly = readOnly;
                CancellationToken = cancellationToken;
                this.run = run;
                this.fail = fail;
                this.cancel = cancel;
                EnqueuedAt = EnginePerf.Enabled ? System.Diagnostics.Stopwatch.GetTimestamp() : 0;
            }

            public string Label { get; }

            /// <summary>When it was queued (Stopwatch ticks; 0 when timing is off).</summary>
            public long EnqueuedAt { get; }

            /// <summary>A read that may run between days of an advance.</summary>
            public bool ReadOnly { get; }

            public CancellationToken CancellationToken { get; }

            public void Run(JsEngineHost engine) => run(engine);

            public void Fail(Exception error) => fail(error);

            public void Cancel() => cancel();

            public override string ToString() => Label;
        }
    }

    /// <summary>Callback form of the client's calls, for MonoBehaviours that do not use async/await.</summary>
    public static class EngineTaskExtensions
    {
        /// <summary>
        /// Calls <paramref name="onResult"/> (or <paramref name="onError"/>, default: log it) on the
        /// thread that called <c>Then</c>, which must be Unity's main thread.
        /// <c>client.Query&lt;ClockView&gt;("clock.get").Then(r =&gt; label.text = r.Data.Date);</c>
        /// </summary>
        public static void Then<T>(this Task<T> task, Action<T> onResult, Action<Exception> onError = null)
        {
            TaskScheduler scheduler = SynchronizationContext.Current != null
                ? TaskScheduler.FromCurrentSynchronizationContext()
                : TaskScheduler.Default;
            task.ContinueWith(
                finished =>
                {
                    if (finished.IsCompletedSuccessfully)
                    {
                        onResult?.Invoke(finished.Result);
                        return;
                    }

                    Exception error = finished.IsCanceled
                        ? new OperationCanceledException("The engine call was cancelled")
                        : (Exception)finished.Exception?.GetBaseException();
                    if (onError != null)
                    {
                        onError(error);
                    }
                    else
                    {
                        Debug.LogException(error);
                    }
                },
                CancellationToken.None,
                TaskContinuationOptions.None,
                scheduler);
        }
    }
}
