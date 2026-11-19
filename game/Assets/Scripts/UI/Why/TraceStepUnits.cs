using System.Collections.Generic;

namespace RingsideBooker.UI.Why
{
    /// <summary>
    /// Port of the engine's <c>withStepUnits</c> (<c>packages/engine/src/core/trace/units.ts</c>):
    /// a calculation records its unit once, on the formula, and this hands every step the unit it
    /// is read in, so a money step reads as dollars rather than raw cents. Rules:
    /// <list type="bullet">
    /// <item>the steps of a formula are in the formula's unit;</item>
    /// <item>except while the running value is still in its starting value's own unit: steps until
    /// the first multiply or divide stay in that unit, and that step gets <c>beforeUnit</c> (and
    /// <c>operandUnit</c> when its factor names a unit of its own);</item>
    /// <item>an amount added, subtracted or used as a floor or ceiling is in the unit of the value
    /// it changes;</item>
    /// <item>factors and the insides of inputs, decisions, rolls and branches get nothing;</item>
    /// <item>a node that names its own unit keeps it and passes it on.</item>
    /// </list>
    /// The given trace is never changed; changed nodes are copies.
    /// </summary>
    public static class TraceStepUnits
    {
        private static readonly HashSet<string> SameUnitParents = new HashSet<string>
        {
            TraceKinds.Add, TraceKinds.Subtract, TraceKinds.Min, TraceKinds.Max,
        };

        private static readonly HashSet<string> UnitTakers = new HashSet<string>
        {
            TraceKinds.Formula, TraceKinds.Input, TraceKinds.Constant, TraceKinds.Add, TraceKinds.Subtract,
            TraceKinds.Multiply, TraceKinds.Divide, TraceKinds.Power, TraceKinds.Min, TraceKinds.Max,
            TraceKinds.Clamp, TraceKinds.Round, TraceKinds.Note,
        };

        private static readonly HashSet<string> FactorUnits = new HashSet<string> { TraceUnits.Ratio, TraceUnits.Multiplier };

        /// <summary>
        /// A copy of <paramref name="node"/> in which every step that leaves its unit out carries
        /// the unit it is read in. <paramref name="inheritedUnit"/> is the unit the node sits in;
        /// leave it null for a root.
        /// </summary>
        public static TraceNode WithStepUnits(TraceNode node, string inheritedUnit = null)
        {
            TraceNode own = WithOwnUnit(node, inheritedUnit);
            if (own.Kind == TraceKinds.Formula)
            {
                IReadOnlyList<TraceNode> steps = FormulaSteps(own, own.Unit);
                if (ReferenceEquals(steps, own.Children)) return own;
                TraceNode copy = ReferenceEquals(own, node) ? own.Clone() : own;
                copy.Children = steps;
                return copy;
            }
            return WithChildUnits(own, node, SameUnitParents.Contains(own.Kind) ? own.Unit : null);
        }

        private static bool IsScalingStep(TraceNode node) =>
            node.Kind == TraceKinds.Multiply || node.Kind == TraceKinds.Divide;

        private static string OperandUnitOf(TraceNode step)
        {
            // The traced amount is recorded last, after any setting reads attached to the step.
            IReadOnlyList<TraceNode> children = step.ChildList;
            if (children.Count == 0) return null;
            string unit = children[children.Count - 1].Unit;
            return unit == null || FactorUnits.Contains(unit) ? null : unit;
        }

        private static TraceNode WithOwnUnit(TraceNode node, string unit)
        {
            if (node.Unit != null || unit == null || !UnitTakers.Contains(node.Kind)) return node;
            TraceNode copy = node.Clone();
            copy.Unit = unit;
            return copy;
        }

        private static TraceNode WithChildUnits(TraceNode own, TraceNode original, string childUnit)
        {
            if (own.Children == null || childUnit == null) return own;
            var children = new List<TraceNode>(own.Children.Count);
            bool changed = false;
            foreach (TraceNode child in own.Children)
            {
                TraceNode read = WithStepUnits(child, childUnit);
                changed |= !ReferenceEquals(read, child);
                children.Add(read);
            }
            if (!changed) return own;
            TraceNode copy = ReferenceEquals(own, original) ? own.Clone() : own;
            copy.Children = children;
            return copy;
        }

        private static IReadOnlyList<TraceNode> FormulaSteps(TraceNode formula, string unit)
        {
            IReadOnlyList<TraceNode> original = formula.Children;
            if (original == null || original.Count == 0) return original;
            TraceNode readStart = WithStepUnits(original[0], unit);
            string running = readStart.Unit ?? unit;
            var children = new List<TraceNode>(original.Count) { readStart };
            bool changed = !ReferenceEquals(readStart, original[0]);
            for (int index = 1; index < original.Count; index++)
            {
                TraceNode step = original[index];
                TraceNode read;
                if (unit != null && running != null && running != unit && IsScalingStep(step))
                {
                    string operandUnit = OperandUnitOf(step);
                    // A factor's own trace is not in the calculation's unit, so its children stay.
                    read = step.Clone();
                    read.Unit = step.Unit ?? unit;
                    read.BeforeUnit = running;
                    if (operandUnit != null) read.OperandUnit = operandUnit;
                    running = unit;
                }
                else
                {
                    read = WithStepUnits(step, running);
                }
                changed |= !ReferenceEquals(read, step);
                children.Add(read);
            }
            return changed ? children : original;
        }
    }
}
