using System;
using Newtonsoft.Json;

namespace RingsideBooker.Engine
{
    /// <summary>
    /// The engine stopped (UNITY-24): a call failed inside V8 or at the C#/JavaScript boundary, or
    /// the bundle would not start. The engine's own refusals are results, never faults; a fault means
    /// the world in memory can't be trusted any more, so the client stops and the game shows the
    /// engine-stopped screen. The last save on disk is untouched (no save can run after a fault).
    /// </summary>
    public sealed class EngineFault
    {
        public EngineFault(string call, Exception error, DateTimeOffset at, bool atStart = false)
        {
            Call = call;
            At = at;
            AtStart = atStart;
            Exception root = error?.GetBaseException() ?? error;
            Message = root?.Message ?? "Unknown error";
            Kind = root?.GetType().Name ?? "Exception";
            Detail = error?.ToString();
        }

        /// <summary>The call that failed, e.g. <c>query sim.status</c> or <c>advanceDays</c>.</summary>
        public string Call { get; }

        /// <summary>The error's message (one line).</summary>
        public string Message { get; }

        /// <summary>The exception's type name.</summary>
        public string Kind { get; }

        /// <summary>The full exception text with its stack.</summary>
        public string Detail { get; }

        /// <summary>When it happened (real-world time; never fed to the simulation).</summary>
        public DateTimeOffset At { get; }

        /// <summary>True when the engine never started (the bundle would not load).</summary>
        public bool AtStart { get; }

        /// <summary>
        /// Whether an exception from engine work means the engine stopped. Faults inside V8
        /// (ClearScript's exceptions), at the boundary (<see cref="JsEngineException"/>), an unsettled
        /// promise, a stack overflow guard or a host disposed underneath the client are fatal.
        /// Cancellation is not, and neither is a C# reader failing on a well-formed answer
        /// (<see cref="JsonException"/>): the engine itself is still fine then.
        /// </summary>
        public static bool IsFatal(Exception error)
        {
            if (error == null) return false;
            if (error is AggregateException aggregate && aggregate.InnerExceptions.Count == 1) error = aggregate.InnerExceptions[0];
            if (error is OperationCanceledException) return false;
            if (error is JsonException) return false;
            if (error is JsEngineException) return true;
            if (error is InsufficientExecutionStackException || error is OutOfMemoryException) return true;
            if (error is ObjectDisposedException disposed && disposed.ObjectName == nameof(JsEngineHost)) return true;
            if (error is InvalidOperationException && error.Message.Contains("did not settle")) return true;
            string space = error.GetType().Namespace ?? string.Empty;
            return space.StartsWith("Microsoft.ClearScript", StringComparison.Ordinal);
        }
    }

    /// <summary>A call refused because the engine had already stopped (see <see cref="EngineClient.Fault"/>).</summary>
    public sealed class EngineStoppedException : Exception
    {
        public EngineStoppedException(EngineFault fault)
            : base("The engine has stopped: " + (fault?.Message ?? "unknown error"))
        {
            Fault = fault;
        }

        public EngineFault Fault { get; }
    }
}
