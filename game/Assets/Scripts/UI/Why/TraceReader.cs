using System;
using System.Collections.Generic;

namespace RingsideBooker.UI.Why
{
    /// <summary>What a trace load came back with.</summary>
    public enum TraceLoadStatus
    {
        /// <summary>A full trace (<see cref="TraceLoadResult.Trace"/>).</summary>
        Trace,
        /// <summary>An older result's summary (<see cref="TraceLoadResult.Summary"/>).</summary>
        Summary,
        /// <summary>The engine keeps no breakdown for this result (<c>trace.get</c> answered null).</summary>
        None,
        /// <summary>The query failed (<see cref="TraceLoadResult.Error"/> says why).</summary>
        Error,
    }

    /// <summary>The answer a <see cref="TraceLoader"/> hands back to the Why? panel.</summary>
    public sealed class TraceLoadResult
    {
        private TraceLoadResult(TraceLoadStatus status, TraceNode trace, TraceEntry summary, string error)
        {
            Status = status;
            Trace = trace;
            Summary = summary;
            Error = error;
        }

        public TraceLoadStatus Status { get; }
        public TraceNode Trace { get; }
        public TraceEntry Summary { get; }
        public string Error { get; }

        public static TraceLoadResult FromTrace(TraceNode trace) =>
            new TraceLoadResult(TraceLoadStatus.Trace, trace ?? throw new ArgumentNullException(nameof(trace)), null, null);

        public static TraceLoadResult FromSummary(TraceEntry summary) =>
            new TraceLoadResult(TraceLoadStatus.Summary, null, summary ?? throw new ArgumentNullException(nameof(summary)), null);

        /// <summary>A stored entry: its trace when it still has one, else its summary.</summary>
        public static TraceLoadResult FromEntry(TraceEntry entry)
        {
            if (entry == null) return NoBreakdown;
            return entry.IsFullTrace ? FromTrace(entry.Trace) : FromSummary(entry);
        }

        public static readonly TraceLoadResult NoBreakdown = new TraceLoadResult(TraceLoadStatus.None, null, null, null);

        public static TraceLoadResult Failed(string message) =>
            new TraceLoadResult(TraceLoadStatus.Error, null, null, message ?? "Something went wrong.");
    }

    /// <summary>
    /// Reads traces from the engine's JSON: a bare trace node, a stored entry (<c>trace.get</c>'s
    /// data), and the host's whole <c>query(...)</c> answer (<c>{ revision, result }</c>, see
    /// <c>game/docs/engine-host.md</c>).
    /// </summary>
    public static class TraceReader
    {
        /// <summary>A trace node from its JSON text.</summary>
        public static TraceNode ParseNode(string json) => ReadNode(AsObject(WhyJson.Parse(json), "trace"));

        /// <summary>A stored entry (full trace or summary) from its JSON text.</summary>
        public static TraceEntry ParseEntry(string json) => ReadEntry(AsObject(WhyJson.Parse(json), "entry"));

        /// <summary>
        /// The host's answer to <c>query("trace.get", {"ref": …})</c>: the full trace, the summary,
        /// no breakdown (null data) or the error the query gave. Never throws.
        /// </summary>
        public static TraceLoadResult ReadTraceGetAnswer(string hostJson)
        {
            try
            {
                object data = ReadQueryData(hostJson, out string error);
                if (error != null) return TraceLoadResult.Failed(error);
                if (data == null) return TraceLoadResult.NoBreakdown;
                return TraceLoadResult.FromEntry(ReadEntry(AsObject(data, "data")));
            }
            catch (FormatException exception)
            {
                return TraceLoadResult.Failed(exception.Message);
            }
        }

        /// <summary>
        /// The host's answer to a query that builds a trace on demand and answers
        /// <c>{ value, trace }</c> (<c>workers.explain</c>, <c>roster.explain</c>…). A null answer
        /// means the number has no breakdown now. Never throws.
        /// </summary>
        public static TraceLoadResult ReadExplainAnswer(string hostJson)
        {
            try
            {
                object data = ReadQueryData(hostJson, out string error);
                if (error != null) return TraceLoadResult.Failed(error);
                if (data == null) return TraceLoadResult.NoBreakdown;
                Dictionary<string, object> answer = AsObject(data, "data");
                if (!answer.TryGetValue("trace", out object trace) || trace == null)
                {
                    return TraceLoadResult.Failed("The answer has no breakdown.");
                }
                return TraceLoadResult.FromTrace(ReadNode(AsObject(trace, "trace")));
            }
            catch (FormatException exception)
            {
                return TraceLoadResult.Failed(exception.Message);
            }
        }

        /// <summary>
        /// The <c>data</c> of a host query answer, or null with <paramref name="error"/> set when
        /// the query failed (the reasons' messages joined, as the web panel shows them).
        /// </summary>
        private static object ReadQueryData(string hostJson, out string error)
        {
            error = null;
            Dictionary<string, object> root = AsObject(WhyJson.Parse(hostJson), "answer");
            // The host wraps query answers in { revision, result }; accept a bare result too.
            Dictionary<string, object> result = root.TryGetValue("result", out object inner) && inner is Dictionary<string, object> wrapped
                ? wrapped
                : root;
            if (result.TryGetValue("ok", out object ok) && ok is bool okFlag && !okFlag)
            {
                error = ReasonsText(result);
                return null;
            }
            result.TryGetValue("data", out object data);
            return data;
        }

        private static string ReasonsText(Dictionary<string, object> result)
        {
            var messages = new List<string>();
            if (result.TryGetValue("reasons", out object reasons) && reasons is List<object> list)
            {
                foreach (object reason in list)
                {
                    if (reason is Dictionary<string, object> fields && fields.TryGetValue("message", out object message) && message is string text)
                    {
                        messages.Add(text);
                    }
                }
            }
            return messages.Count == 0 ? "Something went wrong." : string.Join(" ", messages);
        }

        /// <summary>A stored entry from parsed JSON.</summary>
        public static TraceEntry ReadEntry(Dictionary<string, object> fields)
        {
            var entry = new TraceEntry
            {
                Ref = ReadTraceRef(fields),
                Date = OptionalString(fields, "date"),
                Seq = OptionalNumber(fields, "seq") ?? 0,
            };
            if (fields.TryGetValue("trace", out object trace) && trace != null)
            {
                entry.Trace = ReadNode(AsObject(trace, "trace"));
                entry.Value = ReadValue(fields, "value");
                return entry;
            }
            entry.Label = RequiredString(fields, "label");
            entry.Value = ReadValue(fields, "value");
            entry.Unit = OptionalString(fields, "unit");
            entry.SummaryOnly = OptionalBool(fields, "summaryOnly") ?? false;
            var contributors = new List<TraceContributor>();
            if (fields.TryGetValue("topContributors", out object list) && list is List<object> items)
            {
                foreach (object item in items)
                {
                    Dictionary<string, object> contributor = AsObject(item, "topContributors");
                    contributors.Add(new TraceContributor
                    {
                        Label = RequiredString(contributor, "label"),
                        Effect = OptionalNumber(contributor, "effect") ?? 0,
                    });
                }
            }
            entry.TopContributors = contributors;
            return entry;
        }

        /// <summary>A trace node (and its children) from parsed JSON.</summary>
        public static TraceNode ReadNode(Dictionary<string, object> fields)
        {
            var node = new TraceNode
            {
                Kind = RequiredString(fields, "kind"),
                Label = OptionalString(fields, "label") ?? string.Empty,
                Unit = OptionalString(fields, "unit"),
                DocRef = OptionalString(fields, "docRef"),
                Value = ReadValue(fields, "value"),
                Reason = OptionalString(fields, "reason"),
                Key = OptionalString(fields, "key"),
                DefaultValue = ReadValue(fields, "defaultValue"),
                Overridden = OptionalBool(fields, "overridden") ?? false,
                Operand = OptionalNumber(fields, "operand") ?? 0,
                Before = OptionalNumber(fields, "before") ?? 0,
                After = OptionalNumber(fields, "after") ?? 0,
                BeforeUnit = OptionalString(fields, "beforeUnit"),
                OperandUnit = OptionalString(fields, "operandUnit"),
                Limit = OptionalNumber(fields, "limit") ?? 0,
                Min = OptionalNumber(fields, "min") ?? 0,
                Max = OptionalNumber(fields, "max") ?? 0,
                Applied = OptionalBool(fields, "applied") ?? false,
                Mode = OptionalString(fields, "mode"),
                Condition = OptionalString(fields, "condition"),
                Taken = OptionalBool(fields, "taken") ?? false,
                Chosen = ReadValue(fields, "chosen"),
            };
            double? hidden = OptionalNumber(fields, "hiddenSteps");
            if (hidden.HasValue) node.HiddenSteps = (int)hidden.Value;

            if (fields.TryGetValue("ref", out object reference) && reference is Dictionary<string, object> refFields)
            {
                node.Ref = new EntityRef(RequiredString(refFields, "kind"), RequiredString(refFields, "id"));
            }
            if (fields.TryGetValue("roll", out object roll) && roll is Dictionary<string, object> rollFields)
            {
                node.Roll = new RollRecord
                {
                    Stream = OptionalString(rollFields, "stream") ?? string.Empty,
                    Kind = OptionalString(rollFields, "kind") ?? string.Empty,
                    Label = OptionalString(rollFields, "label") ?? string.Empty,
                    Odds = OptionalNumber(rollFields, "odds"),
                    Min = OptionalNumber(rollFields, "min"),
                    Max = OptionalNumber(rollFields, "max"),
                    Options = OptionalNumber(rollFields, "options"),
                    Result = ReadValue(rollFields, "result"),
                };
            }
            if (fields.TryGetValue("considered", out object considered) && considered is List<object> options)
            {
                var list = new List<ConsideredOption>(options.Count);
                foreach (object item in options)
                {
                    Dictionary<string, object> option = AsObject(item, "considered");
                    list.Add(new ConsideredOption
                    {
                        Option = ReadValue(option, "option"),
                        Score = OptionalNumber(option, "score") ?? 0,
                        Reason = OptionalString(option, "reason"),
                    });
                }
                node.Considered = list;
            }
            else if (node.Kind == TraceKinds.Decision)
            {
                node.Considered = Array.Empty<ConsideredOption>();
            }
            if (fields.TryGetValue("children", out object children) && children is List<object> childList)
            {
                var list = new List<TraceNode>(childList.Count);
                foreach (object child in childList) list.Add(ReadNode(AsObject(child, "children")));
                node.Children = list;
            }
            return node;
        }

        private static TraceRef ReadTraceRef(Dictionary<string, object> fields)
        {
            if (fields.TryGetValue("ref", out object reference) && reference is Dictionary<string, object> refFields)
            {
                return new TraceRef(RequiredString(refFields, "kind"), RequiredString(refFields, "id"));
            }
            return null;
        }

        private static TraceValue ReadValue(Dictionary<string, object> fields, string name)
        {
            if (!fields.TryGetValue(name, out object value)) return TraceValue.Null;
            switch (value)
            {
                case double number: return TraceValue.Of(number);
                case bool flag: return TraceValue.Of(flag);
                case string text: return TraceValue.Of(text);
                default: return TraceValue.Null;
            }
        }

        private static Dictionary<string, object> AsObject(object value, string what)
        {
            if (value is Dictionary<string, object> fields) return fields;
            throw new FormatException($"Expected an object for {what}");
        }

        private static string RequiredString(Dictionary<string, object> fields, string name)
        {
            if (fields.TryGetValue(name, out object value) && value is string text) return text;
            throw new FormatException($"Missing text field '{name}'");
        }

        private static string OptionalString(Dictionary<string, object> fields, string name) =>
            fields.TryGetValue(name, out object value) ? value as string : null;

        private static double? OptionalNumber(Dictionary<string, object> fields, string name) =>
            fields.TryGetValue(name, out object value) && value is double number ? number : (double?)null;

        private static bool? OptionalBool(Dictionary<string, object> fields, string name) =>
            fields.TryGetValue(name, out object value) && value is bool flag ? flag : (bool?)null;
    }
}
