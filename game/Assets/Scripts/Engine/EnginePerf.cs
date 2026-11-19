using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using System.Text;

namespace RingsideBooker.Engine
{
    /// <summary>
    /// Dev timing for the engine bridge and the UI around it (UNITY-23). Off unless a dev flag turns
    /// it on (<c>-rbProfileSkip</c>, <c>-rbProfile</c>); when off every hook is one bool check.
    ///
    /// <para><see cref="EngineClient"/> records each call under its label: time waiting in the queue,
    /// time inside V8 (<see cref="JsEngineHost"/>), time marshalling JSON in C#, and the JSON sizes in
    /// and out. An advance also records its day pipeline (V8 time minus the progress callbacks) and
    /// the callbacks (progress parsing plus the reads run between days). UI code records refreshes
    /// and redraws with <see cref="Measure"/> and <see cref="Count"/>; <see cref="Summary"/> prints
    /// the table for the log.</para>
    /// </summary>
    public static class EnginePerf
    {
        private static readonly object Gate = new object();
        private static readonly Dictionary<string, Stat> Stats = new Dictionary<string, Stat>();

        // The current engine call's V8 time and JSON sizes (engine thread); nested calls (reads run
        // between the days of an advance) save and restore them.
        [ThreadStatic] private static long v8Ticks;
        [ThreadStatic] private static long bytesIn;
        [ThreadStatic] private static long bytesOut;

        /// <summary>True while timing is collected.</summary>
        public static volatile bool Enabled;

        /// <summary>Milliseconds per <see cref="Stopwatch"/> tick.</summary>
        public static readonly double MsPerTick = 1000.0 / Stopwatch.Frequency;

        /// <summary>Clears every number collected so far.</summary>
        public static void Reset()
        {
            lock (Gate)
            {
                Stats.Clear();
            }
        }

        /// <summary>Adds one sample of <paramref name="ms"/> to <paramref name="key"/>.</summary>
        public static void Record(string key, double ms)
        {
            if (!Enabled) return;
            lock (Gate)
            {
                Get(key).Add(ms);
            }
        }

        /// <summary>Counts <paramref name="times"/> occurrences of <paramref name="key"/> (no time).</summary>
        public static void Count(string key, int times = 1)
        {
            if (!Enabled) return;
            lock (Gate)
            {
                Get(key).Count += times;
            }
        }

        /// <summary>Times a block: <c>using (EnginePerf.Measure("ui.topBar")) { … }</c>.</summary>
        public static Scope Measure(string key) => Enabled ? new Scope(key, Stopwatch.GetTimestamp()) : default;

        /// <summary>One sample's numbers so far, or null.</summary>
        public static Stat Find(string key)
        {
            lock (Gate)
            {
                return Stats.TryGetValue(key, out Stat stat) ? stat.Clone() : null;
            }
        }

        /// <summary>The sum of <see cref="Stat.TotalMs"/> over keys starting with <paramref name="prefix"/>.</summary>
        public static double TotalMs(string prefix)
        {
            lock (Gate)
            {
                return Stats.Where(pair => pair.Key.StartsWith(prefix, StringComparison.Ordinal)).Sum(pair => pair.Value.TotalMs);
            }
        }

        /// <summary>The sum of <see cref="Stat.V8Ms"/> over keys starting with <paramref name="prefix"/>.</summary>
        public static double V8Ms(string prefix)
        {
            lock (Gate)
            {
                return Stats.Where(pair => pair.Key.StartsWith(prefix, StringComparison.Ordinal)).Sum(pair => pair.Value.V8Ms);
            }
        }

        /// <summary>The table for the log: one line per key, slowest first.</summary>
        public static string Summary(int top = 60)
        {
            List<KeyValuePair<string, Stat>> rows;
            lock (Gate)
            {
                rows = Stats.Select(pair => new KeyValuePair<string, Stat>(pair.Key, pair.Value.Clone())).ToList();
            }

            var text = new StringBuilder();
            text.AppendLine(string.Format(CultureInfo.InvariantCulture,
                "{0,-44} {1,7} {2,10} {3,9} {4,10} {5,10} {6,10} {7,9} {8,9}",
                "key", "count", "total ms", "max ms", "v8 ms", "json ms", "wait ms", "in KB", "out KB"));
            foreach (KeyValuePair<string, Stat> row in rows.OrderByDescending(pair => pair.Value.TotalMs + pair.Value.WaitMs).Take(top))
            {
                Stat stat = row.Value;
                bool call = stat.V8Ms > 0 || stat.BytesOut > 0;
                text.AppendLine(string.Format(CultureInfo.InvariantCulture,
                    "{0,-44} {1,7} {2,10:0.0} {3,9:0.0} {4,10} {5,10} {6,10} {7,9} {8,9}",
                    row.Key.Length > 44 ? row.Key.Substring(0, 44) : row.Key,
                    stat.Count,
                    stat.TotalMs,
                    stat.MaxMs,
                    call ? stat.V8Ms.ToString("0.0", CultureInfo.InvariantCulture) : "",
                    call ? (stat.TotalMs - stat.V8Ms).ToString("0.0", CultureInfo.InvariantCulture) : "",
                    stat.WaitMs > 0 ? stat.WaitMs.ToString("0.0", CultureInfo.InvariantCulture) : "",
                    call ? (stat.BytesIn / 1024.0).ToString("0", CultureInfo.InvariantCulture) : "",
                    call ? (stat.BytesOut / 1024.0).ToString("0", CultureInfo.InvariantCulture) : ""));
            }

            return text.ToString();
        }

        // --- Engine-thread hooks (EngineClient / JsEngineHost) -----------------------------------

        internal struct CallCounters
        {
            public long V8Ticks;
            public long BytesIn;
            public long BytesOut;
        }

        /// <summary>Starts counting a call on this thread; returns the outer call's counters.</summary>
        internal static CallCounters BeginCall()
        {
            var outer = new CallCounters { V8Ticks = v8Ticks, BytesIn = bytesIn, BytesOut = bytesOut };
            v8Ticks = 0;
            bytesIn = 0;
            bytesOut = 0;
            return outer;
        }

        /// <summary>Ends a call: records it and puts the outer call's counters back.</summary>
        internal static void EndCall(string label, CallCounters outer, double totalMs, double waitMs)
        {
            lock (Gate)
            {
                Stat stat = Get("call " + label);
                stat.Add(totalMs);
                stat.WaitMs += waitMs;
                stat.V8Ms += v8Ticks * MsPerTick;
                stat.BytesIn += bytesIn;
                stat.BytesOut += bytesOut;
            }

            v8Ticks = outer.V8Ticks;
            bytesIn = outer.BytesIn;
            bytesOut = outer.BytesOut;
        }

        /// <summary>One trip into V8 (JsEngineHost): its time and the JSON text it carried.</summary>
        internal static void NoteV8(long ticks, string[] arguments, string result)
        {
            v8Ticks += ticks;
            if (arguments != null)
            {
                foreach (string argument in arguments) bytesIn += argument?.Length ?? 0;
            }

            bytesOut += result?.Length ?? 0;
        }

        private static Stat Get(string key)
        {
            if (!Stats.TryGetValue(key, out Stat stat))
            {
                stat = new Stat();
                Stats.Add(key, stat);
            }

            return stat;
        }

        /// <summary>A timed block (see <see cref="Measure"/>).</summary>
        public readonly struct Scope : IDisposable
        {
            private readonly string key;
            private readonly long started;

            internal Scope(string key, long started)
            {
                this.key = key;
                this.started = started;
            }

            public void Dispose()
            {
                if (key == null) return;
                Record(key, (Stopwatch.GetTimestamp() - started) * MsPerTick);
            }
        }

        /// <summary>The numbers under one key.</summary>
        public sealed class Stat
        {
            public int Count;
            public double TotalMs;
            public double MaxMs;
            public double WaitMs;
            public double V8Ms;
            public long BytesIn;
            public long BytesOut;

            internal void Add(double ms)
            {
                Count++;
                TotalMs += ms;
                if (ms > MaxMs) MaxMs = ms;
            }

            internal Stat Clone() => (Stat)MemberwiseClone();
        }
    }
}
