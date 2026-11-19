using System;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace RingsideBooker.UI.Bridge
{
    /// <summary>
    /// One way to deal with a stop straight from the day control's "Needs attention" sheet, for stops
    /// whose screen the game does not have yet ("Mark as seen", "Let them go", "Refuse").
    /// </summary>
    public sealed class GateAction
    {
        public GateAction(string label, Func<Task<string>> run, string hint = null, bool primary = false)
        {
            Label = label;
            Run = run ?? throw new ArgumentNullException(nameof(run));
            Hint = hint;
            Primary = primary;
        }

        /// <summary>The button's words.</summary>
        public string Label { get; }
        /// <summary>What pressing it does, in a line (the button's tooltip), or null.</summary>
        public string Hint { get; }
        /// <summary>The usual answer (drawn as the main button; the skip check presses it).</summary>
        public bool Primary { get; }
        /// <summary>Runs the action on the main thread: null when it worked, else why it did not.</summary>
        public Func<Task<string>> Run { get; }
    }

    /// <summary>
    /// Optional on an <see cref="IDayControl"/>: the actions that clear a stop without its screen.
    /// The day control lists them in "Needs attention" so a day can never be stuck on a stop the
    /// game has no screen for.
    /// </summary>
    public interface IGateActions
    {
        /// <summary>The ways to clear <paramref name="hit"/> here, primary first; empty when it needs its screen.</summary>
        IReadOnlyList<GateAction> ActionsFor(GateHit hit);
    }
}
