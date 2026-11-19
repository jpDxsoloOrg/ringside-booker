using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Widgets;
using RingsideBooker.UI.Why;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// Shared pieces for the engine-backed screens: JSON readers, panels, stat rows, tables, Why?
    /// buttons and the "draw again when the world changes" binding. Screens are plain functions that
    /// return a <see cref="VisualElement"/> (see <see cref="UI.Navigation.ScreenRegistry"/>).
    /// </summary>
    public static class Kit
    {
        public const string NoValue = "—";

        public static EngineGame Game => EngineGame.Current;

        // ---- JSON ---------------------------------------------------------------------------------

        public static string Str(JToken token, string path) =>
            token == null || token.Type == JTokenType.Null ? null : token.SelectToken(path) is JValue value && value.Type != JTokenType.Null ? value.ToString(CultureInfo.InvariantCulture) : null;

        public static double? Num(JToken token, string path)
        {
            JToken value = token?.SelectToken(path);
            if (value == null || value.Type == JTokenType.Null) return null;
            return value.Type == JTokenType.Integer || value.Type == JTokenType.Float ? (double?)value.Value<double>() : null;
        }

        public static bool Bool(JToken token, string path) => token?.SelectToken(path) is JValue value && value.Type == JTokenType.Boolean && (bool)value;

        public static IEnumerable<JToken> Arr(JToken token, string path = null)
        {
            JToken array = path == null ? token : token?.SelectToken(path);
            return array is JArray items ? items : Enumerable.Empty<JToken>();
        }

        public static JToken Obj(JToken token, string path)
        {
            JToken value = token?.SelectToken(path);
            return value == null || value.Type == JTokenType.Null ? null : value;
        }

        // ---- Words --------------------------------------------------------------------------------

        public static readonly string[] CardPushes = { "mainEvent", "upperCard", "midCard", "lowerCard", "enhancement" };

        public static string PushLabel(string push)
        {
            switch (push)
            {
                case "mainEvent": return "Main event";
                case "upperCard": return "Upper card";
                case "midCard": return "Mid card";
                case "lowerCard": return "Lower card";
                case "enhancement": return "Enhancement";
                default: return NoValue;
            }
        }

        public static string Capital(string text) =>
            string.IsNullOrEmpty(text) ? text : char.ToUpperInvariant(text[0]) + text.Substring(1);

        public static string Date(string iso, bool withWeekday = false)
        {
            if (!GameDate.TryParse(iso, out GameDate date)) return iso ?? NoValue;
            return withWeekday ? date.DayMonthYear : date.Short;
        }

        /// <summary>"3.75★" style: quarter stars as text.</summary>
        public static string Stars(double? stars) =>
            stars.HasValue ? stars.Value.ToString("0.##", CultureInfo.InvariantCulture) + "★" : NoValue;

        public static string Decimal1(double? value) =>
            value.HasValue ? value.Value.ToString("0.0", CultureInfo.InvariantCulture) : NoValue;

        public static string Whole(double? value) =>
            value.HasValue ? TextFormat.Number((long)Math.Round(value.Value)) : NoValue;

        public static string Reasons(IEnumerable<EngineReason> reasons) =>
            string.Join(" ", (reasons ?? Enumerable.Empty<EngineReason>()).Select(reason => TextFormat.Sentence(reason.Message)));

        // ---- Elements -----------------------------------------------------------------------------

        /// <summary>A screen root with its heading.</summary>
        public static VisualElement Screen(string id, string title, string subtitle = null)
        {
            VisualElement screen = Ui.El("rb-screen").Named($"screen-{id}");
            screen.Add(Ui.Text(TextFormat.Upper(title), "screen-heading"));
            if (!string.IsNullOrEmpty(subtitle)) screen.Add(Ui.Text(subtitle, "rb-subtitle", "t-muted"));
            return screen;
        }

        /// <summary>A card with a section label; add content to the returned body.</summary>
        public static VisualElement Panel(VisualElement parent, string title, out VisualElement body, string extraClass = null)
        {
            VisualElement panel = Ui.El("card", "rb-panel");
            if (extraClass != null) panel.AddToClassList(extraClass);
            if (!string.IsNullOrEmpty(title)) panel.Add(Ui.Text(TextFormat.Upper(title), "section-label", "rb-panel__title"));
            body = Ui.El("rb-panel__body");
            panel.Add(body);
            parent?.Add(panel);
            return panel;
        }

        public static VisualElement Row(params VisualElement[] children) => Ui.El("rb-row").With(children);

        public static VisualElement Columns(params VisualElement[] children) => Ui.El("rb-columns").With(children);

        public static Label Note(string text, params string[] classes)
        {
            Label label = Ui.Text(text, "rb-note", "t-wrap");
            foreach (string className in classes) label.AddToClassList(className);
            return label;
        }

        public static Label Error(string text) => Ui.Text(text, "rb-error", "t-wrap");

        /// <summary>A label above a big number, with an optional Why? after the number.</summary>
        public static VisualElement Stat(string label, string value, VisualElement why = null, string tone = null)
        {
            VisualElement stat = Ui.El("rb-stat");
            stat.Add(Ui.Text(TextFormat.Upper(label), "rb-stat__label"));
            Label number = Ui.Text(value, "rb-stat__value");
            if (tone != null) number.AddToClassList(tone);
            stat.Add(Ui.El("rb-stat__line").With(number, why));
            return stat;
        }

        /// <summary>"Label: value [?]" on one line.</summary>
        public static VisualElement Line(string label, string value, VisualElement why = null)
        {
            return Ui.El("rb-line").With(
                Ui.Text(label, "rb-line__label"),
                Ui.Text(value, "rb-line__value"),
                why);
        }

        public static Label Badge(string text, string modifier = null)
        {
            Label badge = Ui.Text(TextFormat.Upper(text), "badge", "rb-badge");
            if (modifier != null) badge.AddToClassList(modifier);
            return badge;
        }

        /// <summary>A row of choice chips; <paramref name="onPick"/> gets the picked value.</summary>
        public static VisualElement Chips<T>(IEnumerable<(T value, string label)> options, T selected, Action<T> onPick, string name = null)
        {
            VisualElement row = Ui.El("chip-row", "rb-chips");
            if (name != null) row.name = name;
            var buttons = new List<(Button button, T value)>();
            foreach ((T value, string label) in options)
            {
                T captured = value;
                Button chip = Ui.Button(string.Empty, null, "choice-chip", "rb-chip");
                chip.Add(Ui.Text(label, "choice-chip__label"));
                chip.clicked += () =>
                {
                    foreach ((Button other, T otherValue) in buttons) other.EnableInClassList("choice-chip--selected", Equals(otherValue, captured));
                    onPick(captured);
                };
                chip.EnableInClassList("choice-chip--selected", Equals(value, selected));
                buttons.Add((chip, value));
                row.Add(chip);
            }
            return row;
        }

        // ---- Tables -------------------------------------------------------------------------------

        /// <summary>A simple table: a header row and data rows with fixed relative column widths.</summary>
        public sealed class Table
        {
            private readonly float[] widths;

            public Table(VisualElement parent, IReadOnlyList<string> headers, IReadOnlyList<float> widths)
            {
                this.widths = widths.ToArray();
                Root = Ui.El("rb-table");
                VisualElement head = Ui.El("rb-table__row", "rb-table__head");
                for (int index = 0; index < headers.Count; index++)
                {
                    head.Add(Cell(Ui.Text(TextFormat.Upper(headers[index]), "rb-table__heading"), index));
                }
                Root.Add(head);
                parent?.Add(Root);
            }

            public VisualElement Root { get; }

            public VisualElement AddRow(params object[] cells)
            {
                VisualElement row = Ui.El("rb-table__row");
                for (int index = 0; index < cells.Length; index++)
                {
                    VisualElement content = cells[index] as VisualElement ?? Ui.Text(cells[index]?.ToString() ?? NoValue, "rb-table__text");
                    row.Add(Cell(content, index));
                }
                Root.Add(row);
                return row;
            }

            private VisualElement Cell(VisualElement content, int index)
            {
                VisualElement cell = Ui.El("rb-table__cell");
                cell.style.flexGrow = index < widths.Length ? widths[index] : 1;
                cell.style.flexBasis = 0;
                cell.Add(content);
                return cell;
            }
        }

        // ---- Why? ---------------------------------------------------------------------------------

        /// <summary>A Why? button over a stored trace ref, or null when there is none.</summary>
        public static WhyButton WhyRef(string label, double value, JToken traceRef, string unit = null, string title = null)
        {
            WhySource source = Game?.TraceRefSource(traceRef);
            if (source == null) return null;
            return new WhyButton(label, TraceValue.Of(value), source, unit) { PanelTitle = title ?? label };
        }

        /// <summary>A Why? button over a trace the screen already has, or null when there is none.</summary>
        public static WhyButton WhyTrace(string label, double value, JToken trace, string unit = null, string title = null)
        {
            if (trace == null || trace.Type != JTokenType.Object) return null;
            try
            {
                TraceNode node = TraceReader.ParseNode(trace.ToString(Newtonsoft.Json.Formatting.None));
                return new WhyButton(label, TraceValue.Of(value), WhySource.FromTrace(node), unit) { PanelTitle = title ?? label };
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[Screens] trace for {label}: {exception.Message}");
                return null;
            }
        }

        /// <summary>A Why? button whose breakdown an explain query builds when opened (<c>{ value, trace }</c>).</summary>
        public static WhyButton WhyExplain(string label, double value, string query, JObject args, string unit = null)
        {
            EngineGame game = Game;
            if (game == null) return null;
            WhySource source = WhySource.FromLoader(done => game.Client.QueryRaw(query, args).Then(
                json => done(TraceReader.ReadExplainAnswer(json)),
                error => done(TraceLoadResult.Failed(error.Message))));
            return new WhyButton(label, TraceValue.Of(value), source, unit) { PanelTitle = label };
        }

        // ---- Live binding -------------------------------------------------------------------------

        /// <summary>
        /// Draws <paramref name="host"/> with <paramref name="render"/> when it is attached, and again
        /// whenever the engine's world changes (after a command or an advance) while it stays on
        /// screen. Calls never overlap: a change during a draw draws once more afterwards.
        /// </summary>
        public static void Live(VisualElement host, Func<Task> render)
        {
            EngineGame game = Game;
            if (game == null)
            {
                host.Add(Note("This screen needs a game. Start a new game from the title screen; the demo game has no engine behind it."));
                return;
            }

            bool drawing = false;
            bool again = false;

            async void Draw()
            {
                if (drawing)
                {
                    again = true;
                    return;
                }
                drawing = true;
                try
                {
                    do
                    {
                        again = false;
                        await render();
                    }
                    while (again && host.panel != null);
                }
                catch (Exception exception)
                {
                    Debug.LogException(exception);
                    host.Clear();
                    host.Add(Error($"Something went wrong drawing this screen: {exception.Message}"));
                }
                finally
                {
                    drawing = false;
                }
            }

            void Changed(long revision)
            {
                if (host.panel != null && !game.Client.IsAdvancing) Draw();
            }

            host.RegisterCallback<AttachToPanelEvent>(_ =>
            {
                game.Client.OnStateChanged += Changed;
                Draw();
            });
            host.RegisterCallback<DetachFromPanelEvent>(_ => game.Client.OnStateChanged -= Changed);
        }

        /// <summary>Runs an engine command and shows its refusal in <paramref name="feedback"/> (cleared on success).</summary>
        public static async Task<CommandResult<JToken>> Run(string command, object args, Label feedback = null)
        {
            CommandResult<JToken> result = await Game.Client.Command(command, args);
            if (feedback != null)
            {
                feedback.text = result.Ok ? string.Empty : Reasons(result.Reasons);
                feedback.SetShown(!result.Ok);
            }
            if (!result.Ok) Debug.Log($"[Screens] {command} refused: {result.ReasonText}");
            return result;
        }

        /// <summary>An error line, hidden until a refusal fills it.</summary>
        public static Label Feedback()
        {
            Label label = Error(string.Empty);
            label.SetShown(false);
            return label;
        }
    }
}
