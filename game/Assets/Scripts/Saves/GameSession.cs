using System;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using UnityEngine;

namespace RingsideBooker.Saves
{
    /// <summary>The outcome of one save.</summary>
    public sealed class SaveOutcome
    {
        public bool Ok { get; private set; }
        public SaveSlotInfo Slot { get; private set; }
        public string Problem { get; private set; }

        public static SaveOutcome Saved(SaveSlotInfo slot) => new SaveOutcome { Ok = true, Slot = slot };

        public static SaveOutcome Failed(string problem) => new SaveOutcome { Problem = problem };
    }

    /// <summary>How a session's slot was last written or opened (the "Last saved" chip says it).</summary>
    public enum SaveKind
    {
        Loaded,
        LoadedBackup,
        Created,
        Autosave,
        Manual,
        Final,
    }

    public enum OpenStatus
    {
        Opened,
        /// <summary>The save would not load and the build it came from explains why (offer export or delete).</summary>
        OlderBuild,
        /// <summary>The save would not load for another reason (a real problem: show the details).</summary>
        Failed,
    }

    /// <summary>What opening a slot did.</summary>
    public sealed class OpenResult
    {
        public OpenStatus Status { get; internal set; }
        public GameSession Session { get; internal set; }
        public SaveSlotInfo Slot { get; internal set; }

        /// <summary>The engine's load result (stage and issues on failure).</summary>
        public LoadResult Load { get; internal set; }

        /// <summary>"Copy details" text when the load failed.</summary>
        public string Report { get; internal set; }

        /// <summary>One line for the player when the load failed.</summary>
        public string Problem { get; internal set; }

        public bool Ok => Status == OpenStatus.Opened;
    }

    /// <summary>
    /// The game being played and its slot: saves it after changes (debounced, never during an
    /// advance, off the main thread), after each advance, on Main menu and on quit. One at a time
    /// (<see cref="Current"/>). The session does not own the <see cref="EngineClient"/>: it never
    /// disposes or unloads it.
    /// </summary>
    public sealed class GameSession
    {
        private static Task ending = Task.CompletedTask;

        private readonly AutosaveScheduler autosave;
        private readonly long baselineRevision;
        private Task writeChain = Task.CompletedTask;
        private Task endTask;

        private GameSession(EngineClient engine, SaveStore store, string slotId, string label, LocalSeat seat, long revision)
        {
            Engine = engine;
            Store = store;
            SlotId = slotId;
            Label = label;
            Seat = seat;
            baselineRevision = revision;
            // The autosave waits until the engine has nothing queued, and waits longer after changes
            // the slower a save is (a big imported world saves in 1-2 s), so it lands in a pause
            // instead of in front of the player's next step (UNITY-23).
            autosave = new AutosaveScheduler(AutosaveAsync, () => !Engine.IsBusy, PendingChanged);
            Engine.OnStateChanged += OnStateChanged;
            Engine.OnAdvanceFinished += OnAdvanceFinished;
        }

        private static GameSession current;

        /// <summary>The running game, or null on the title screen.</summary>
        public static GameSession Current
        {
            get => current;
            private set
            {
                if (ReferenceEquals(current, value)) return;
                current = value;
                CurrentChanged?.Invoke(value);
            }
        }

        /// <summary>Raised on the main thread when <see cref="Current"/> changes (the "Last saved" chip follows it).</summary>
        public static event Action<GameSession> CurrentChanged;

        /// <summary>The last session's final save while it is still writing (the title waits on it).</summary>
        public static Task Ending => ending;

        /// <summary>Raised on the main thread after each save (ok or not).</summary>
        public event Action<SaveOutcome> Saved;

        /// <summary>Raised when unsaved changes appear (true) and once they are saved (false).</summary>
        public event Action<bool> UnsavedChanged;

        public EngineClient Engine { get; }
        public SaveStore Store { get; }
        public string SlotId { get; }

        /// <summary>The slot's name; also the save header's label.</summary>
        public string Label { get; }

        /// <summary>Who this machine plays as (from the new game or the load).</summary>
        public LocalSeat Seat { get; }

        public SaveSlotInfo LastSaved { get; private set; }

        /// <summary>Why the last save failed, or null when it worked (the chip shows a warning).</summary>
        public string LastProblem { get; private set; }

        /// <summary>How the slot was last written or opened.</summary>
        public SaveKind LastSaveKind { get; private set; }

        public bool HasUnsavedChanges => autosave.Pending;

        public bool IsEnded => endTask != null;

        /// <summary>
        /// Starts a session for a game just made with <c>NewGame</c>: a new slot named
        /// <paramref name="label"/> and its first save. Ends any running session without saving it
        /// (its world was replaced by the new game).
        /// </summary>
        public static async Task<GameSession> BeginNewAsync(EngineClient engine, string label, long revision, LocalSeat seat = null, SaveStore store = null)
        {
            if (engine == null) throw new ArgumentNullException(nameof(engine));
            store = store ?? new SaveStore();
            Current?.Detach();
            string name = string.IsNullOrWhiteSpace(label) ? "New career" : label.Trim();
            var session = new GameSession(engine, store, store.NewSlotId(name), name, seat, revision);
            Current = session;
            SaveOutcome first = await session.TimedSaveAsync(SaveKind.Created);
            if (!first.Ok) Debug.LogWarning("GameSession: the first save failed: " + first.Problem);
            return session;
        }

        /// <summary>
        /// Ends the running session (with its final save), loads the slot (or its backup) and makes
        /// it the running game. A failed load leaves no session; the result says why and whether it
        /// is the older-build case.
        /// </summary>
        public static Task<OpenResult> OpenSlotAsync(EngineClient engine, SaveSlotInfo slot, SaveStore store = null, bool backup = false)
        {
            if (slot == null) throw new ArgumentNullException(nameof(slot));
            store = store ?? new SaveStore();
            SaveStore reader = store;
            return OpenAsync(engine, slot, store, () => reader.Read(slot.SlotId, backup), backup);
        }

        /// <summary>
        /// Loads one of the slot's backups (<see cref="SaveStore.ListBackups"/>) and makes it the
        /// running game in that slot. The slot's latest save stays as it is until the game saves over
        /// it, and then it becomes a backup itself. Same outcomes as <see cref="OpenSlotAsync"/>.
        /// </summary>
        public static Task<OpenResult> OpenBackupAsync(EngineClient engine, SaveSlotInfo slot, string backupId, SaveStore store = null)
        {
            if (slot == null) throw new ArgumentNullException(nameof(slot));
            if (string.IsNullOrEmpty(backupId)) throw new ArgumentNullException(nameof(backupId));
            store = store ?? new SaveStore();
            SaveStore reader = store;
            return OpenAsync(engine, slot, store, () => reader.LoadBackup(slot.SlotId, backupId), true);
        }

        private static async Task<OpenResult> OpenAsync(EngineClient engine, SaveSlotInfo slot, SaveStore store, Func<byte[]> read, bool backup)
        {
            if (engine == null) throw new ArgumentNullException(nameof(engine));
            await EndCurrentAsync();

            byte[] bytes;
            try
            {
                bytes = await Task.Run(read);
            }
            catch (Exception error) when (error is System.IO.IOException || error is UnauthorizedAccessException)
            {
                return new OpenResult { Status = OpenStatus.Failed, Slot = slot, Problem = "Could not read the save file: " + error.Message, Report = error.ToString() };
            }

            LoadResult loaded = await engine.Load(bytes);
            if (loaded.Ok)
            {
                var session = new GameSession(engine, store, slot.SlotId, slot.Label ?? loaded.Summary?.Label, loaded.Summary?.Seat, loaded.Revision)
                {
                    LastSaved = slot,
                    LastSaveKind = backup ? SaveKind.LoadedBackup : SaveKind.Loaded,
                };
                Current = session;
                return new OpenResult { Status = OpenStatus.Opened, Session = session, Slot = slot, Load = loaded };
            }

            string saved = null;
            string current = null;
            bool olderBuild = false;
            if (Array.IndexOf(SaveCompat.GuardedStages, loaded.Stage) >= 0)
            {
                LoadResult inspected = await engine.InspectSave(bytes);
                EngineInfo info = await engine.Info();
                current = info.SchemaFingerprint;
                if (inspected.Ok)
                {
                    saved = inspected.Header?.Value<string>("schemaFingerprint");
                    olderBuild = SaveCompat.IsOlderBuild(loaded.Stage, saved, current);
                }
            }

            return new OpenResult
            {
                Status = olderBuild ? OpenStatus.OlderBuild : OpenStatus.Failed,
                Slot = slot,
                Load = loaded,
                Problem = olderBuild ? SaveCompat.OlderBuildBody : loaded.ProblemText,
                Report = SaveCompat.Report(slot.Label, loaded, saved, current, olderBuild),
            };
        }

        /// <summary>Ends the running session, if any (final save always). Safe to call from Main menu.</summary>
        public static void EndCurrent()
        {
            _ = EndCurrentAsync();
        }

        /// <summary><see cref="EndCurrent"/>, awaitable; also waits for a previous session still writing.</summary>
        public static Task EndCurrentAsync(bool alwaysSave = true)
        {
            GameSession session = Current;
            return session == null ? ending : session.EndAsync(alwaysSave);
        }

        /// <summary>
        /// Saves now. The engine call is queued at once (so it runs before anything queued after
        /// this call, such as an unload); the file is written off the main thread, in call order.
        /// </summary>
        /// <summary>The autosave's delay: <see cref="AutosaveDelayPerSaveTime"/> × the last save's time, from 750 ms to <see cref="MaxAutosaveDelayMs"/>.</summary>
        public const int AutosaveDelayPerSaveTime = 3;

        /// <summary>The longest the autosave waits after the last change.</summary>
        public const int MaxAutosaveDelayMs = 10000;

        private Task AutosaveAsync() => TimedSaveAsync(SaveKind.Autosave);

        // Saves now and sets the autosave's delay from how long the save took.
        private async Task<SaveOutcome> TimedSaveAsync(SaveKind kind)
        {
            var clock = System.Diagnostics.Stopwatch.StartNew();
            SaveOutcome outcome = await SaveNowAsync(kind);
            if (outcome.Ok)
            {
                long delay = clock.ElapsedMilliseconds * AutosaveDelayPerSaveTime;
                autosave.DelayMs = (int)Math.Max(AutosaveScheduler.DefaultDelayMs, Math.Min(MaxAutosaveDelayMs, delay));
            }

            return outcome;
        }

        public Task<SaveOutcome> SaveNowAsync() => SaveNowAsync(SaveKind.Manual);

        private Task<SaveOutcome> SaveNowAsync(SaveKind kind)
        {
            DateTimeOffset savedAt = DateTimeOffset.UtcNow;
            Task<SaveResult> engineSave;
            try
            {
                engineSave = Engine.Save(Label, savedAt);
            }
            catch (ObjectDisposedException error)
            {
                return Task.FromResult(SaveOutcome.Failed(error.Message));
            }

            Task previousWrite = writeChain;
            var written = new TaskCompletionSource<bool>();
            writeChain = written.Task;
            return FinishSave(engineSave, previousWrite, written, savedAt, kind);
        }

        /// <summary>
        /// Stops autosaving and writes the final save (when <paramref name="alwaysSave"/>, or when
        /// changes are unsaved). Detaches from the engine; <see cref="Current"/> becomes null.
        /// </summary>
        public Task EndAsync(bool alwaysSave = true)
        {
            if (endTask != null) return endTask;
            bool save = alwaysSave || autosave.Pending;
            if (Engine.IsAdvancing) Engine.CancelAdvance();
            Task<SaveOutcome> finalSave = save ? SaveNowAsync(SaveKind.Final) : null;
            Task running = autosave.WhenIdle();
            Detach();
            endTask = FinishEnd(finalSave, running);
            ending = endTask;
            return endTask;
        }

        private async Task FinishEnd(Task<SaveOutcome> finalSave, Task running)
        {
            await running;
            if (finalSave != null)
            {
                SaveOutcome outcome = await finalSave;
                if (!outcome.Ok) Debug.LogWarning("GameSession: the final save failed: " + outcome.Problem);
            }

            await writeChain;
        }

        private void Detach()
        {
            Engine.OnStateChanged -= OnStateChanged;
            Engine.OnAdvanceFinished -= OnAdvanceFinished;
            autosave.Dispose();
            if (endTask == null) endTask = Task.CompletedTask;
            if (Current == this) Current = null;
        }

        private async Task<SaveOutcome> FinishSave(Task<SaveResult> engineSave, Task previousWrite, TaskCompletionSource<bool> written, DateTimeOffset savedAt, SaveKind kind)
        {
            SaveOutcome outcome;
            try
            {
                SaveResult result = await engineSave;
                await previousWrite;
                if (!result.Ok || result.Bytes == null)
                {
                    outcome = SaveOutcome.Failed(result.ReasonText);
                }
                else
                {
                    var info = new SaveSlotInfo
                    {
                        SlotId = SlotId,
                        Label = Label,
                        SavedAt = savedAt,
                    };
                    info.ApplyHeader(result.Header);
                    info.Label = Label;
                    EngineInfo engineInfo = Engine.Ready.IsCompleted && !Engine.Ready.IsFaulted ? Engine.Ready.Result : null;
                    info.EngineVersion = engineInfo?.EngineVersion;
                    info.FormatVersion = engineInfo?.SaveFormatVersion ?? 0;
                    info.BuildVersion = SaveBuild.Version;
                    info.BuildChannel = SaveBuild.Channel;
                    byte[] bytes = result.Bytes;
                    JToken header = result.Header;
                    string fingerprint = engineInfo?.SchemaFingerprint;
                    // Verify before rotating (POL1-04): bytes that do not check out never replace the save.
                    string problem = await Task.Run(() => SaveVerifier.Check(bytes, header, fingerprint));
                    if (problem != null)
                    {
                        Debug.LogWarning("GameSession: the save did not check out: " + problem);
                        outcome = SaveOutcome.Failed(SaveVerifier.NotReplacedMessage);
                    }
                    else
                    {
                        LastSaved = await Task.Run(() => Store.Write(info, bytes));
                        outcome = SaveOutcome.Saved(LastSaved);
                    }
                }
            }
            catch (SaveVerifyException error)
            {
                // Verify after writing: the disk kept something else, so nothing was replaced.
                Debug.LogWarning("GameSession: the written save did not read back: " + error.Message);
                outcome = SaveOutcome.Failed(SaveVerifier.NotReplacedMessage);
            }
            catch (Exception error)
            {
                outcome = SaveOutcome.Failed(error.GetBaseException().Message);
                Debug.LogException(error);
            }
            finally
            {
                written.TrySetResult(true);
            }

            LastProblem = outcome.Ok ? null : outcome.Problem;
            if (outcome.Ok) LastSaveKind = kind;
            Saved?.Invoke(outcome);
            return outcome;
        }

        private void OnStateChanged(long revision)
        {
            if (revision <= baselineRevision || Engine.IsAdvancing) return;
            autosave.NoteChange();
        }

        private void OnAdvanceFinished(AdvanceReport report)
        {
            if (report != null && report.Ok && report.DaysAdvanced > 0) autosave.NoteChange();
        }

        private void PendingChanged(bool pending) => UnsavedChanged?.Invoke(pending);
    }
}
