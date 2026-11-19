using System;
using System.Threading.Tasks;
using UnityEngine;

namespace RingsideBooker.Saves
{
    /// <summary>
    /// When to save after the player changes the game (the web's SAVE-01 <c>SaveAfterChanges</c>):
    /// a change starts a short timer, so a burst of edits writes once; the save waits while the
    /// engine is busy (an advance) and runs one at a time. Timing only: the caller supplies the
    /// save. Use from the main thread (timers resume on Unity's synchronization context).
    /// </summary>
    public sealed class AutosaveScheduler : IDisposable
    {
        /// <summary>How long after the last change the save starts (web: 750 ms).</summary>
        public const int DefaultDelayMs = 750;

        private readonly Func<Task> save;
        private readonly Func<bool> canSave;
        private readonly Action<bool> onPendingChange;
        private readonly int delayMs;

        private int timerGeneration;
        private bool dirty;
        private bool pending;
        private bool disposed;
        private Task inFlight;

        /// <param name="save">Writes the save; failures should be reported by it (a throw is logged).</param>
        /// <param name="canSave">False while the save must wait (an advance runs); it retries after the delay.</param>
        /// <param name="onPendingChange">Told when unsaved changes appear (true) and once they are saved (false).</param>
        public AutosaveScheduler(Func<Task> save, Func<bool> canSave, Action<bool> onPendingChange = null, int delayMs = DefaultDelayMs)
        {
            this.save = save ?? throw new ArgumentNullException(nameof(save));
            this.canSave = canSave ?? (() => true);
            this.onPendingChange = onPendingChange;
            this.delayMs = Math.Max(0, delayMs);
        }

        /// <summary>True from a change until a save that started after it has finished.</summary>
        public bool Pending => pending;

        /// <summary>True while a save runs.</summary>
        public bool Saving => inFlight != null;

        /// <summary>The game changed: save after the delay, restarting the delay if one was waiting.</summary>
        public void NoteChange()
        {
            if (disposed) return;
            dirty = true;
            SetPending(true);
            Schedule();
        }

        /// <summary>Saves now if anything is unsaved and the engine is free; otherwise waits for the save already running.</summary>
        public async Task Flush()
        {
            if (disposed) return;
            if (inFlight != null)
            {
                await inFlight;
                return;
            }

            if (!dirty || !canSave()) return;
            timerGeneration++;
            await Start();
        }

        /// <summary>Waits for a running save, if any (no new save starts).</summary>
        public Task WhenIdle() => inFlight ?? Task.CompletedTask;

        /// <summary>Forgets unsaved changes (another game was loaded). A running save finishes.</summary>
        public void Cancel()
        {
            timerGeneration++;
            dirty = false;
            if (inFlight == null) SetPending(false);
        }

        /// <summary>Stops for good: no timer fires after this.</summary>
        public void Dispose()
        {
            Cancel();
            disposed = true;
        }

        private async void Schedule()
        {
            int generation = ++timerGeneration;
            await Task.Delay(delayMs);
            if (generation != timerGeneration) return;
            Fire();
        }

        private void Fire()
        {
            if (disposed || !dirty) return;
            // One save at a time; a change during a save is picked up when it ends. A busy engine waits.
            if (inFlight != null || !canSave())
            {
                Schedule();
                return;
            }

            _ = Start();
        }

        private async Task Start()
        {
            dirty = false;
            var done = new TaskCompletionSource<bool>();
            inFlight = done.Task;
            try
            {
                await save();
            }
            catch (Exception error)
            {
                Debug.LogException(error);
            }
            finally
            {
                inFlight = null;
                done.TrySetResult(true);
            }

            if (disposed) return;
            if (dirty)
            {
                Schedule();
            }
            else
            {
                SetPending(false);
            }
        }

        private void SetPending(bool value)
        {
            if (pending == value) return;
            pending = value;
            onPendingChange?.Invoke(value);
        }
    }
}
