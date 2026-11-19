using System;
using System.Collections.Generic;

namespace RingsideBooker.UI.Why
{
    /// <summary>
    /// The engine's calculation traces in C#: the same shape as
    /// <c>packages/engine/src/core/trace/types.ts</c>, read from the JSON the engine host returns
    /// (see <see cref="TraceReader"/>). One <see cref="TraceNode"/> class carries the fields of
    /// every node kind; <see cref="TraceNode.Kind"/> says which ones are set.
    /// </summary>
    public static class TraceKinds
    {
        public const string Formula = "formula";
        public const string Input = "input";
        public const string Constant = "constant";
        public const string Tunable = "tunable";
        public const string Add = "add";
        public const string Subtract = "subtract";
        public const string Multiply = "multiply";
        public const string Divide = "divide";
        public const string Power = "power";
        public const string Min = "min";
        public const string Max = "max";
        public const string Clamp = "clamp";
        public const string Round = "round";
        public const string Roll = "roll";
        public const string Branch = "branch";
        public const string Decision = "decision";
        public const string Note = "note";

        /// <summary>Every node kind, in the order the calculation traces doc lists them.</summary>
        public static readonly IReadOnlyList<string> All = new[]
        {
            Formula, Input, Constant, Tunable, Add, Subtract, Multiply, Divide, Power,
            Min, Max, Clamp, Round, Roll, Branch, Decision, Note,
        };

        public static bool IsArithmetic(string kind) =>
            kind == Add || kind == Subtract || kind == Multiply || kind == Divide || kind == Power;

        public static bool IsLimit(string kind) => kind == Min || kind == Max || kind == Clamp;
    }

    /// <summary>The units a traced number can be in (the engine's tunable units), plus <c>people</c>.</summary>
    public static class TraceUnits
    {
        public const string Points = "points";
        public const string PointsPerDay = "points/day";
        public const string Percent = "percent";
        public const string Ratio = "ratio";
        public const string Multiplier = "multiplier";
        public const string Days = "days";
        public const string Months = "months";
        public const string Years = "years";
        public const string Money = "money";
        public const string MoneyPerMonth = "money/month";
        public const string Count = "count";
        public const string Kilograms = "kilograms";
        public const string Attribute = "attribute";
        public const string Stars = "stars";
        public const string Probability = "probability";
        public const string Flag = "flag";
        public const string Choice = "choice";
        /// <summary>Display only: a headcount such as attendance (`12,400 people`).</summary>
        public const string People = "people";
    }

    /// <summary>What a trace value holds.</summary>
    public enum TraceValueType
    {
        Null,
        Number,
        Bool,
        Text,
    }

    /// <summary>A trace value: a number, a yes/no, text, or nothing (JSON null).</summary>
    public readonly struct TraceValue : IEquatable<TraceValue>
    {
        public TraceValueType Type { get; }
        public double Number { get; }
        public bool Bool { get; }
        public string Text { get; }

        private TraceValue(TraceValueType type, double number, bool flag, string text)
        {
            Type = type;
            Number = number;
            Bool = flag;
            Text = text;
        }

        public static readonly TraceValue Null = new TraceValue(TraceValueType.Null, 0, false, null);

        public static TraceValue Of(double number) => new TraceValue(TraceValueType.Number, number, false, null);

        public static TraceValue Of(bool flag) => new TraceValue(TraceValueType.Bool, 0, flag, null);

        public static TraceValue Of(string text) =>
            text == null ? Null : new TraceValue(TraceValueType.Text, 0, false, text);

        public bool IsNull => Type == TraceValueType.Null;
        public bool IsNumber => Type == TraceValueType.Number;
        public bool IsBool => Type == TraceValueType.Bool;
        public bool IsText => Type == TraceValueType.Text;

        /// <summary>Strict equality, like JavaScript's <c>===</c> on these values.</summary>
        public bool Equals(TraceValue other)
        {
            if (Type != other.Type) return false;
            switch (Type)
            {
                case TraceValueType.Number: return Number == other.Number;
                case TraceValueType.Bool: return Bool == other.Bool;
                case TraceValueType.Text: return string.Equals(Text, other.Text, StringComparison.Ordinal);
                default: return true;
            }
        }

        public override bool Equals(object obj) => obj is TraceValue other && Equals(other);

        public override int GetHashCode()
        {
            switch (Type)
            {
                case TraceValueType.Number: return Number.GetHashCode();
                case TraceValueType.Bool: return Bool ? 1 : 2;
                case TraceValueType.Text: return Text.GetHashCode();
                default: return 0;
            }
        }

        public static bool operator ==(TraceValue left, TraceValue right) => left.Equals(right);

        public static bool operator !=(TraceValue left, TraceValue right) => !left.Equals(right);

        public override string ToString() => TraceFormat.Value(this);
    }

    /// <summary>
    /// A link to an entity (a worker, promotion, title, show…): <c>kind</c> is the engine's entity
    /// kind (<c>person</c>, <c>promotion</c>, <c>title</c>, <c>eventInstance</c>, …).
    /// </summary>
    public sealed class EntityRef
    {
        public EntityRef(string kind, string id)
        {
            Kind = kind;
            Id = id;
        }

        public string Kind { get; }
        public string Id { get; }

        public override string ToString() => $"{Kind}:{Id}";
    }

    /// <summary>What a stored trace explains: <c>{ kind: "segment.rating", id: "seg_…" }</c>.</summary>
    public sealed class TraceRef
    {
        public TraceRef(string kind, string id)
        {
            Kind = kind;
            Id = id;
        }

        public string Kind { get; }
        public string Id { get; }

        /// <summary>The JSON the engine's <c>trace.get</c> query takes: <c>{"ref":{...}}</c>.</summary>
        public string ToTraceGetArgs() =>
            "{\"ref\":{\"kind\":" + JsonString(Kind) + ",\"id\":" + JsonString(Id) + "}}";

        public override string ToString() => $"{Kind}:{Id}";

        private static string JsonString(string text)
        {
            var builder = new System.Text.StringBuilder("\"");
            foreach (char c in text)
            {
                switch (c)
                {
                    case '"': builder.Append("\\\""); break;
                    case '\\': builder.Append("\\\\"); break;
                    default:
                        if (c < ' ') builder.Append("\\u").Append(((int)c).ToString("x4"));
                        else builder.Append(c);
                        break;
                }
            }
            return builder.Append('"').ToString();
        }
    }

    /// <summary>A recorded random roll (the engine's <c>RollRecord</c>).</summary>
    public sealed class RollRecord
    {
        public string Stream { get; set; }
        /// <summary><c>chance</c>, <c>oneIn</c>, <c>int</c>, <c>float</c>, <c>pick</c>, <c>weighted</c> or <c>normal</c>.</summary>
        public string Kind { get; set; }
        public string Label { get; set; }
        public double? Odds { get; set; }
        public double? Min { get; set; }
        public double? Max { get; set; }
        public double? Options { get; set; }
        public TraceValue Result { get; set; }
    }

    /// <summary>One option a decision weighed, with its score.</summary>
    public sealed class ConsideredOption
    {
        /// <summary>Text or a yes/no.</summary>
        public TraceValue Option { get; set; }
        public double Score { get; set; }
        public string Reason { get; set; }
    }

    /// <summary>
    /// One node of a calculation trace. Fields that do not belong to <see cref="Kind"/> keep their
    /// defaults. Treat nodes as read-only: <see cref="TraceStepUnits.WithStepUnits"/> copies
    /// nodes rather than changing them.
    /// </summary>
    public sealed class TraceNode
    {
        private static readonly IReadOnlyList<TraceNode> NoChildren = Array.Empty<TraceNode>();

        public string Kind { get; set; }
        /// <summary>Plain English, written for the player.</summary>
        public string Label { get; set; }
        /// <summary>What the value measures (a <see cref="TraceUnits"/> name), or null.</summary>
        public string Unit { get; set; }
        public string DocRef { get; set; }
        /// <summary>Sub-steps, or null when the node has none listed.</summary>
        public IReadOnlyList<TraceNode> Children { get; set; }
        public TraceValue Value { get; set; }

        // input
        public EntityRef Ref { get; set; }

        // constant, arithmetic (optional), decision
        public string Reason { get; set; }

        // tunable
        public string Key { get; set; }
        public TraceValue DefaultValue { get; set; }
        public bool Overridden { get; set; }

        // arithmetic, limits, round
        public double Operand { get; set; }
        public double Before { get; set; }
        public double After { get; set; }
        /// <summary>Read time only: the unit <see cref="Before"/> is in on a step that changes the unit.</summary>
        public string BeforeUnit { get; set; }
        /// <summary>Read time only: the unit of <see cref="Operand"/> on such a step.</summary>
        public string OperandUnit { get; set; }

        // min / max / clamp
        public double Limit { get; set; }
        public double Min { get; set; }
        public double Max { get; set; }
        public bool Applied { get; set; }

        // round: "round", "floor" or "ceil"
        public string Mode { get; set; }

        // roll
        public RollRecord Roll { get; set; }

        // branch
        public string Condition { get; set; }
        public bool Taken { get; set; }

        // decision
        public TraceValue Chosen { get; set; }
        public IReadOnlyList<ConsideredOption> Considered { get; set; }

        // note
        public int? HiddenSteps { get; set; }

        /// <summary>The children, or an empty list.</summary>
        public IReadOnlyList<TraceNode> ChildList => Children ?? NoChildren;

        public bool HasChildren => Children != null && Children.Count > 0;

        /// <summary>A shallow copy (children are shared).</summary>
        public TraceNode Clone() => (TraceNode)MemberwiseClone();
    }

    /// <summary>One of the steps that moved a summarised result the most.</summary>
    public sealed class TraceContributor
    {
        public string Label { get; set; }
        /// <summary><c>after - before</c> of the step.</summary>
        public double Effect { get; set; }
    }

    /// <summary>
    /// What <c>trace.get</c> answers: a recent result's full trace, or an older result's summary.
    /// </summary>
    public sealed class TraceEntry
    {
        public TraceRef Ref { get; set; }
        /// <summary>Game date, <c>YYYY-MM-DD</c>.</summary>
        public string Date { get; set; }
        public double Seq { get; set; }

        /// <summary>The full trace, or null for a summary.</summary>
        public TraceNode Trace { get; set; }

        // Summary fields (Trace == null).
        public string Label { get; set; }
        public TraceValue Value { get; set; }
        public string Unit { get; set; }
        public IReadOnlyList<TraceContributor> TopContributors { get; set; }
        /// <summary>True when only a summary was ever kept (a rival promotion's result).</summary>
        public bool SummaryOnly { get; set; }

        public bool IsFullTrace => Trace != null;
    }
}
