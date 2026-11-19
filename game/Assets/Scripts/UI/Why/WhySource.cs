using System;

namespace RingsideBooker.UI.Why
{
    /// <summary>
    /// Fetches a stored trace by reference, usually by asking the engine
    /// <c>query("trace.get", traceRef.ToTraceGetArgs())</c> and reading the answer with
    /// <see cref="TraceReader.ReadTraceGetAnswer"/>. Call <paramref name="done"/> once, on the
    /// main thread, now or later.
    /// </summary>
    public delegate void TraceRefLoader(TraceRef traceRef, Action<TraceLoadResult> done);

    /// <summary>
    /// Builds a breakdown on demand (an engine query that answers <c>{ value, trace }</c>, read
    /// with <see cref="TraceReader.ReadExplainAnswer"/>). Call <paramref name="done"/> once, on
    /// the main thread, now or later.
    /// </summary>
    public delegate void TraceLoader(Action<TraceLoadResult> done);

    /// <summary>
    /// Where a Why? panel gets its trace (the web's <c>TraceSource</c>): handed over inline,
    /// fetched by reference when the panel opens, or built by a loader when the panel opens.
    /// Nothing is loaded while the panel is closed, so a list can put a Why? button on every row.
    /// The first answer is kept; <see cref="Invalidate"/> forgets it (say, after a new day).
    /// </summary>
    public sealed class WhySource
    {
        private readonly TraceLoadResult inline;
        private readonly TraceRef traceRef;
        private readonly TraceRefLoader refLoader;
        private readonly TraceLoader loader;
        private TraceLoadResult cached;

        private WhySource(TraceLoadResult inline, TraceRef traceRef, TraceRefLoader refLoader, TraceLoader loader)
        {
            this.inline = inline;
            this.traceRef = traceRef;
            this.refLoader = refLoader;
            this.loader = loader;
        }

        /// <summary>A trace the screen already has.</summary>
        public static WhySource FromTrace(TraceNode trace) =>
            new WhySource(TraceLoadResult.FromTrace(trace), null, null, null);

        /// <summary>A stored entry the screen already has (a full trace or a summary).</summary>
        public static WhySource FromEntry(TraceEntry entry) =>
            new WhySource(TraceLoadResult.FromEntry(entry), null, null, null);

        /// <summary>A stored trace fetched by reference when the panel opens.</summary>
        public static WhySource FromRef(TraceRef traceRef, TraceRefLoader loader) =>
            new WhySource(null, traceRef ?? throw new ArgumentNullException(nameof(traceRef)),
                loader ?? throw new ArgumentNullException(nameof(loader)), null);

        /// <summary>A breakdown built by <paramref name="loader"/> when the panel opens.</summary>
        public static WhySource FromLoader(TraceLoader loader) =>
            new WhySource(null, null, null, loader ?? throw new ArgumentNullException(nameof(loader)));

        /// <summary>The source for an optional trace or reference, or null when there is neither.</summary>
        public static WhySource Of(TraceNode trace, TraceRef traceRef = null, TraceRefLoader loader = null)
        {
            if (trace != null) return FromTrace(trace);
            if (traceRef != null && loader != null) return FromRef(traceRef, loader);
            return null;
        }

        /// <summary>True when the trace is already here (no load needed).</summary>
        public bool IsInline => inline != null;

        /// <summary>What the panel says when the answer is "no breakdown".</summary>
        internal string NoBreakdownText => traceRef != null ? TraceText.NoStoredBreakdownText : TraceText.NoBreakdownText;

        /// <summary>Forgets a loaded answer, so the next open asks again.</summary>
        public void Invalidate() => cached = null;

        /// <summary>Gets the trace: at once when inline or cached, else through the loader.</summary>
        internal void Load(Action<TraceLoadResult> done)
        {
            if (inline != null)
            {
                done(inline);
                return;
            }
            if (cached != null)
            {
                done(cached);
                return;
            }
            Action<TraceLoadResult> keep = result =>
            {
                result = result ?? TraceLoadResult.Failed(null);
                if (result.Status != TraceLoadStatus.Error) cached = result;
                done(result);
            };
            try
            {
                if (refLoader != null) refLoader(traceRef, keep);
                else loader(keep);
            }
            catch (Exception exception)
            {
                done(TraceLoadResult.Failed(exception.Message));
            }
        }
    }

    /// <summary>
    /// Links from a breakdown to the things it names (an input's worker, promotion, title, show…).
    /// Screens provide these; the panel draws a linked name only when <see cref="CanOpen"/> says
    /// yes, and plain text otherwise.
    /// </summary>
    public sealed class WhyLinks
    {
        public WhyLinks(Action<EntityRef> open, Func<EntityRef, bool> canOpen = null)
        {
            Open = open ?? throw new ArgumentNullException(nameof(open));
            CanOpen = canOpen ?? (_ => true);
        }

        /// <summary>Opens the entity's screen (a worker's profile, say).</summary>
        public Action<EntityRef> Open { get; }

        /// <summary>Whether this entity has a screen to open.</summary>
        public Func<EntityRef, bool> CanOpen { get; }

        /// <summary>Whether to close the Why? panel when a link is followed. True by default.</summary>
        public bool CloseOnOpen { get; set; } = true;
    }
}
