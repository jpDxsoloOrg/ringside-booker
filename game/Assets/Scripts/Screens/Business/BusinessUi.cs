using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using RingsideBooker.UI.Why;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Business
{
    /// <summary>
    /// Small design-system pieces the Finances, Production and Networks screens share (UNITY-18):
    /// the page head, the money verdict banner, stat tiles with a real (engine) quiet Why?, notices,
    /// key-value facts, choice chips, a switch and a modal whose footer the caller fills. All on the
    /// UNITY-11 <c>ds-</c> classes plus <c>biz-</c> layout classes in <c>Business.uss</c>.
    /// </summary>
    public static class BusinessUi
    {
        private static StyleSheet sheet;

        /// <summary>Adds the screens' stylesheet (Resources/Business/Business.uss) to <paramref name="element"/>.</summary>
        public static void Style(VisualElement element)
        {
            if (sheet == null) sheet = Resources.Load<StyleSheet>("Business/Business");
            if (sheet != null && !element.styleSheets.Contains(sheet)) element.styleSheets.Add(sheet);
        }

        /// <summary>A screen root: the headline and a quiet line under it.</summary>
        public static VisualElement Page(string screenName, string title, string lead, out VisualElement headRight)
        {
            VisualElement root = Ds.Column("biz-page").Named(screenName);
            Style(root);
            VisualElement head = Ds.Row("biz-head");
            VisualElement titles = Ds.Column("biz-head__titles");
            titles.Add(Ds.Text(TextFormat.Upper(title), "ds-type-headline", "biz-head__title"));
            if (lead != null) titles.Add(Ds.Text(lead, "biz-head__lead"));
            head.Add(titles);
            head.Add(Ds.Spacer());
            headRight = Ds.Row("biz-head__right");
            head.Add(headRight);
            root.Add(head);
            return root;
        }

        // ---- Why? -----------------------------------------------------------------------------------

        /// <summary>Makes an engine Why? quiet: a small "?" that shows on hover of <paramref name="host"/> or on focus.</summary>
        public static WhyButton Quiet(WhyButton why, VisualElement host)
        {
            if (why == null) return null;
            why.AddToClassList("ds-why");
            why.AddToClassList("biz-why");
            host?.AddToClassList("ds-why-host");
            return why;
        }

        /// <summary>A Why? over an inline <c>{ value, trace }</c> answer.</summary>
        public static WhyButton WhyTraced(string label, JToken traced, string unit = null) =>
            traced == null || traced.Type != JTokenType.Object ? null : Kit.WhyTrace(label, Kit.Num(traced, "value") ?? 0, Kit.Obj(traced, "trace"), unit, label);

        /// <summary>A Why? over an inline trace whose value is words ("Safe", "Would accept").</summary>
        public static WhyButton WhyWords(string label, string words, JToken trace)
        {
            if (trace == null || trace.Type != JTokenType.Object) return null;
            try
            {
                TraceNode node = TraceReader.ParseNode(trace.ToString(Newtonsoft.Json.Formatting.None));
                return new WhyButton(label, TraceValue.Of(words), WhySource.FromTrace(node)) { PanelTitle = label };
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[Business] trace for {label}: {exception.Message}");
                return null;
            }
        }

        /// <summary>A Why? over a stored trace whose value is words.</summary>
        public static WhyButton WhyRefWords(string label, string words, JToken traceRef)
        {
            WhySource source = Kit.Game?.TraceRefSource(traceRef);
            return source == null ? null : new WhyButton(label, TraceValue.Of(words), source) { PanelTitle = label };
        }

        /// <summary>A Why? over a stored trace, or null.</summary>
        public static WhyButton WhyRef(string label, double value, JToken traceRef, string unit = null) =>
            traceRef == null || traceRef.Type == JTokenType.Null ? null : Kit.WhyRef(label, value, traceRef, unit, label);

        /// <summary>A value with its quiet Why? beside it (the web's <c>Explained</c>).</summary>
        public static VisualElement Value(string text, WhyButton why, params string[] classes)
        {
            VisualElement row = Ds.Row("biz-value");
            Label label = Ds.Text(text, "biz-value__text");
            foreach (string className in classes) label.AddToClassList(className);
            row.Add(label);
            if (why != null) row.Add(Quiet(why, row));
            return row;
        }

        // ---- Tiles and banners ----------------------------------------------------------------------

        /// <summary>
        /// A stat tile (label, big value with an optional unit, a plain-words line) whose quiet Why? is
        /// an engine trace. Words come before numbers, so <paramref name="words"/> says what the number means.
        /// </summary>
        public static VisualElement Tile(string label, string value, string words, DsState state, WhyButton why = null, string unit = null, string name = null, string icon = null)
        {
            VisualElement tile = Ds.El("ds-stat", Ds.StateClass(state), "biz-tile");
            if (name != null) tile.name = name;
            VisualElement top = Ds.El("ds-stat__top");
            if (icon != null) top.Add(new Icon(icon, "ds-icon--xs", "biz-tile__icon"));
            top.Add(Ds.Text(TextFormat.Upper(label), "ds-stat__label", "biz-tile__label"));
            tile.Add(top);
            VisualElement valueRow = Ds.El("ds-stat__value-row");
            valueRow.Add(Ds.Text(value, "ds-stat__value", "biz-tile__value"));
            if (unit != null) valueRow.Add(Ds.Text(unit, "biz-tile__unit"));
            tile.Add(valueRow);
            if (words != null) tile.Add(Ds.Text(words, "ds-stat__words", "biz-tile__words"));
            if (why != null) top.Add(Quiet(why, tile));
            return tile;
        }

        /// <summary>A plain line in a state colour with its icon (notices, warnings, refusals).</summary>
        public static VisualElement Notice(DsState state, string text, string icon = null, string name = null)
        {
            VisualElement row = Ds.Row("biz-notice", Ds.StateClass(state));
            if (name != null) row.name = name;
            row.Add(new Icon(icon ?? Ds.StateIcon(state), "ds-icon--sm", "biz-notice__icon"));
            row.Add(Ds.Text(text, "biz-notice__text"));
            return row;
        }

        /// <summary>
        /// The money verdict that leads the Finances and Production screens: the answer in plain words
        /// ("You're losing money"), the sentence behind it, and the runway's Why?. Coloured by state, so a
        /// warning is seen before it is read.
        /// </summary>
        public static VisualElement Verdict(JToken runway, string name = "money-verdict")
        {
            string status = Kit.Str(runway, "status");
            DsState state = BusinessText.RunwayState(status);
            VisualElement banner = Ds.Row("biz-verdict", Ds.StateClass(state)).Named(name);
            VisualElement edge = Ds.El("biz-verdict__edge");
            banner.Add(edge);
            VisualElement iconBox = Ds.El("biz-verdict__icon-box");
            iconBox.Add(new Icon(status == BusinessText.StatusMaking ? "trend-up" : BusinessText.RunwayWarns(status) ? "warning" : "finance", "ds-icon--xl", "biz-verdict__icon"));
            banner.Add(iconBox);
            VisualElement words = Ds.Column("biz-verdict__words");
            VisualElement top = Ds.Row("biz-verdict__top");
            top.Add(Ds.Text(TextFormat.Upper(BusinessText.RunwayVerdict(status)), "biz-verdict__title"));
            (string text, DsState state)? badge = BusinessText.RunwayBadge(status);
            if (badge.HasValue && badge.Value.text != BusinessText.RunwayVerdict(status)) top.Add(Ds.Pill(badge.Value.state, badge.Value.text, "warning", true));
            words.Add(top);
            double monthlyNet = Kit.Num(runway, "monthlyNet") ?? 0;
            string headline = BusinessText.RunwayHeadline(status, monthlyNet, Kit.Num(runway, "monthsLeft"), (int)(Kit.Num(runway, "daysUntilForecast") ?? 0));
            if (BusinessText.RunwayWarns(status) && status != BusinessText.StatusOut)
            {
                headline += $" You lose about {BusinessText.Money(Math.Abs(monthlyNet))} a month.";
            }
            words.Add(Ds.Text(headline, "biz-verdict__text"));
            banner.Add(words);
            WhyButton why = RunwayWhy(runway);
            if (why != null)
            {
                banner.Add(Ds.Spacer());
                banner.Add(Quiet(why, banner));
            }
            return banner;
        }

        /// <summary>The runway's Why?: the months left when there are some, else the month's net.</summary>
        public static WhyButton RunwayWhy(JToken runway)
        {
            if (Kit.Num(runway, "monthsLeft") is double months && Kit.Obj(runway, "monthsLeftTrace") is JToken monthsTrace && monthsTrace.Type == JTokenType.Object)
            {
                return Kit.WhyTrace("Months of cash left", months, monthsTrace, "months", "Months of cash left");
            }
            return Kit.WhyTrace("Money a month at this rate", Kit.Num(runway, "monthlyNet") ?? 0, Kit.Obj(runway, "monthlyNetTrace"), "money", "Money a month at this rate");
        }

        /// <summary>The "Cash runway" tile: months left (or Growing / Out of cash / After a week) with its Why?.</summary>
        public static VisualElement RunwayTile(JToken runway)
        {
            string status = Kit.Str(runway, "status");
            (string value, string unit) = BusinessText.RunwayValue(status, Kit.Num(runway, "monthsLeft"));
            double monthlyNet = Kit.Num(runway, "monthlyNet") ?? 0;
            string words = status == BusinessText.StatusTooEarly
                ? $"Fixed costs {BusinessText.Compact(Math.Abs(monthlyNet))} a month"
                : $"{BusinessText.SignedCompact(monthlyNet, true)} a month at this rate";
            DsState state = status == BusinessText.StatusRunningOut || status == BusinessText.StatusOut ? DsState.Bad
                : status == BusinessText.StatusLosing ? DsState.Warn
                : status == BusinessText.StatusMaking ? DsState.Good : DsState.Neutral;
            return Tile("Cash runway", value, words, state, RunwayWhy(runway), unit, "tile-runway", "gauge");
        }

        /// <summary>Sets a <see cref="Ds.Button"/>'s words (its label child; the button's own text stays empty).</summary>
        public static void SetButtonText(Button button, string text)
        {
            Label label = button?.Q<Label>(className: "ds-btn__label");
            if (label != null) label.text = TextFormat.Upper(text);
        }

        /// <summary>Marks the last child of a row (USS has no <c>:last-child</c>), so it drops its right margin.</summary>
        public static T MarkLast<T>(T row) where T : VisualElement
        {
            for (int i = 0; i < row.childCount; i++) row[i].EnableInClassList("biz-last", i == row.childCount - 1);
            return row;
        }

        // ---- Facts ----------------------------------------------------------------------------------

        /// <summary>Key-value rows whose values are elements (a number with its Why?).</summary>
        public static VisualElement Facts(params (string key, VisualElement value)[] rows)
        {
            VisualElement list = Ds.El("ds-kv", "biz-facts");
            foreach ((string key, VisualElement value) in rows)
            {
                if (value == null) continue;
                VisualElement row = Ds.El("ds-kv__row", "biz-facts__row");
                row.Add(Ds.Text(key, "ds-kv__key", "biz-facts__key"));
                row.Add(value);
                list.Add(row);
            }
            return list;
        }

        public static Label FactText(string text) => Ds.Text(text ?? BusinessText.NoValue, "ds-kv__value", "biz-facts__value");

        /// <summary>A sub-heading inside a sheet or panel.</summary>
        public static Label SubHeading(string text) => Ds.Text(TextFormat.Upper(text), "biz-subheading");

        public static Label Quiet(string text) => Ds.Text(text, "biz-quiet");

        // ---- Table cells ----------------------------------------------------------------------------

        public static Label Cell(string text, params string[] extra)
        {
            Label label = Ds.Text(text ?? BusinessText.NoValue, "ds-cell__text");
            foreach (string className in extra)
            {
                if (!string.IsNullOrEmpty(className)) label.AddToClassList(className);
            }
            return label;
        }

        public static Label NumCell(string text, params string[] extra) => Cell(text, extra.Concat(new[] { "ds-cell__text--num" }).ToArray());

        public static Label Muted(string text) => Cell(text, "ds-cell__text--muted");

        /// <summary>A number cell with its quiet Why?.</summary>
        public static VisualElement NumWhy(string text, WhyButton why, string extra = null)
        {
            VisualElement row = Ds.Row("biz-cell-why");
            Label label = NumCell(text);
            if (extra != null) label.AddToClassList(extra);
            row.Add(label);
            if (why != null) row.Add(Quiet(why, row));
            return row;
        }

        /// <summary>A logo (network or promotion) through <see cref="PromotionLogos"/>: the picture, else a monogram.</summary>
        public static VisualElement Logo(string logoRef, string name, string sizeClass = "rb-logo--sm") =>
            PromotionLogos.Badge(WorkshopWorlds.CurrentPictures, logoRef, name, sizeClass);

        // ---- Controls -------------------------------------------------------------------------------

        /// <summary>A labelled group of choice chips; disabled options say why on hover.</summary>
        public static VisualElement Choices<T>(string label, IEnumerable<(T value, string text)> options, T selected, Action<T> onPick, string name = null)
        {
            VisualElement field = Ds.Column("biz-field");
            if (name != null) field.name = name;
            if (label != null) field.Add(Ds.Text(TextFormat.Upper(label), "biz-field__label"));
            VisualElement row = Ds.Row("ds-row--wrap", "biz-choices");
            foreach ((T value, string text) in options)
            {
                T captured = value;
                Button chip = Ds.Chip(text, Equals(value, selected), () => onPick(captured));
                if (name != null) chip.name = $"{name}-{value}";
                row.Add(chip);
            }
            field.Add(row);
            return field;
        }

        /// <summary>A switch row: a box, a label and a quiet description under it.</summary>
        public static Button Switch(string label, bool on, Action<bool> changed, string description = null, string name = null)
        {
            bool state = on;
            VisualElement box = Ds.El("ds-check__box");
            Button row = null;
            row = new Button(() =>
            {
                state = !state;
                Draw();
                changed?.Invoke(state);
            }) { text = string.Empty };
            if (name != null) row.name = name;
            row.AddToClassList("ds-check");
            row.AddToClassList("biz-switch");
            row.Add(box);
            VisualElement words = Ds.Column("biz-switch__words");
            words.Add(Ds.Text(label, "ds-check__label", "biz-switch__label"));
            if (description != null) words.Add(Ds.Text(description, "biz-switch__hint"));
            row.Add(words);
            Draw();
            return row;

            void Draw()
            {
                box.Clear();
                if (state) box.Add(new Icon("check", "ds-icon--xs", "ds-check__tick"));
                row.EnableInClassList("ds-check--on", state);
            }
        }

        /// <summary>The refusals the engine gave, in words.</summary>
        public static VisualElement Refusals(IEnumerable<string> messages, string name = null)
        {
            var list = messages.Where(text => !string.IsNullOrEmpty(text)).ToList();
            VisualElement box = Ds.Column("biz-refusals");
            if (name != null) box.name = name;
            foreach (string message in list) box.Add(Notice(DsState.Bad, TextFormat.Sentence(message)));
            box.SetShown(list.Count > 0);
            return box;
        }

        // ---- Modal ----------------------------------------------------------------------------------

        /// <summary>A modal in the design system's look whose footer the caller fills (its buttons close it themselves).</summary>
        public static OverlayHandle Modal(VisualElement anyElement, string title, VisualElement body, VisualElement footer, string name = null, float width = 560f)
        {
            OverlayLayer layer = OverlayLayer.Of(anyElement);
            if (layer == null) return null;
            VisualElement modal = Ds.El("ds-modal", "biz-modal");
            Style(modal);
            modal.style.width = width;
            if (name != null) modal.name = name;
            modal.pickingMode = PickingMode.Position;
            OverlayHandle handle = null;
            VisualElement header = Ds.El("ds-overlay-header");
            VisualElement words = Ds.El("ds-overlay-header__words");
            words.Add(Ds.Text(TextFormat.Upper(title), "ds-overlay-header__title", "biz-modal__title"));
            header.Add(words);
            Button close = Ds.IconButton("close", "Close (Esc)", () => handle?.Close());
            close.AddToClassList(DsTooltip.NoFocusTipClass);
            header.Add(close);
            modal.Add(header);
            var scroll = new ScrollView(ScrollViewMode.Vertical) { horizontalScrollerVisibility = ScrollerVisibility.Hidden };
            scroll.AddToClassList("biz-modal__scroll");
            body.AddToClassList("ds-modal__body");
            scroll.Add(body);
            modal.Add(scroll);
            footer.AddToClassList("ds-modal__footer");
            modal.Add(footer);
            handle = layer.Open(modal, new OverlayOptions { Modal = true, Dismissable = true, Centered = true });
            handle.Entry.AddToClassList("ds-overlay--modal");
            return handle;
        }

        /// <summary>A side sheet with the screens' stylesheet on it.</summary>
        public static OverlayHandle Sheet(VisualElement anyElement, string title, VisualElement body, string eyebrow, VisualElement footer, float width = 620f)
        {
            Style(body);
            if (footer != null) Style(footer);
            OverlayHandle handle = DsOverlay.SideSheet(anyElement, title, body, eyebrow, footer, width);
            if (handle != null) Style(handle.Entry);
            return handle;
        }
    }
}
