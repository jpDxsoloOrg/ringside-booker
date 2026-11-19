using System;
using System.Collections.Generic;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Design
{
    /// <summary>
    /// State colours: every state pill and icon pairs one of these with an icon and a word, so the
    /// player scans by colour but never needs colour alone.
    /// </summary>
    public enum DsState
    {
        Neutral,
        Good,
        Warn,
        Bad,
        Info,
        Live,
        Gold,
    }

    public enum DsButtonKind
    {
        Primary,
        Secondary,
        Ghost,
        Danger,
    }

    /// <summary>
    /// The design system's builders (UNITY-11). Every class they use starts with <c>ds-</c> and lives
    /// in <c>Assets/UI/Design/*.uss</c>; the tokens are in DsTokens.uss and documented in
    /// <c>game/docs/design-system.md</c>.
    /// </summary>
    public static class Ds
    {
        public static VisualElement El(params string[] classes) => Ui.El(classes);

        public static Label Text(string text, params string[] classes) => Ui.Text(text, classes);

        /// <summary>Display text (Barlow Condensed, capitals): the broadcast voice for headings and numbers.</summary>
        public static Label Display(string text, params string[] classes)
        {
            Label label = Ui.Text(TextFormat.Upper(text), classes);
            label.AddToClassList("ds-display");
            return label;
        }

        public static string StateClass(DsState state) => "ds-state--" + state.ToString().ToLowerInvariant();

        /// <summary>The icon a state shows when nothing more specific fits.</summary>
        public static string StateIcon(DsState state) => state switch
        {
            DsState.Good => "check-circle",
            DsState.Warn => "warning",
            DsState.Bad => "problem",
            DsState.Info => "info",
            DsState.Live => "live",
            DsState.Gold => "crown",
            _ => "flat",
        };

        // ---- Buttons -----------------------------------------------------------------------------

        /// <summary>A button: icon (optional) then label. Primary is the one main action of a view.</summary>
        public static Button Button(string text, Action onClick, DsButtonKind kind = DsButtonKind.Secondary, string icon = null)
        {
            var button = new Button(onClick) { text = string.Empty };
            button.AddToClassList("ds-btn");
            button.AddToClassList("ds-btn--" + kind.ToString().ToLowerInvariant());
            if (icon != null) button.Add(new Icon(icon, "ds-icon--sm", "ds-btn__icon"));
            if (!string.IsNullOrEmpty(text)) button.Add(Ui.Text(TextFormat.Upper(text), "ds-btn__label"));
            return button;
        }

        /// <summary>A square icon-only button; the tooltip names it.</summary>
        public static Button IconButton(string icon, string tooltip, Action onClick, bool quiet = true)
        {
            var button = new Button(onClick) { text = string.Empty };
            button.AddToClassList("ds-icon-btn");
            if (quiet) button.AddToClassList("ds-icon-btn--quiet");
            button.Add(new Icon(icon, "ds-icon--md"));
            DsTooltip.Attach(button, tooltip);
            return button;
        }

        /// <summary>The skewed red-orange call to action (Next day, Go live, Book the card). One per screen.</summary>
        public static SkewButton Cta(string text, Action onClick, string icon = "chevron-right") =>
            new SkewButton(text, icon, onClick);

        // ---- Chips, badges, pills, tags ------------------------------------------------------------

        /// <summary>A filter or choice chip. <paramref name="count"/> shows a quiet number after the label.</summary>
        public static Button Chip(string text, bool selected = false, Action onClick = null, int? count = null, string icon = null)
        {
            var chip = new Button(onClick) { text = string.Empty };
            chip.AddToClassList("ds-chip");
            chip.EnableInClassList("ds-chip--selected", selected);
            if (icon != null) chip.Add(new Icon(icon, "ds-icon--xs", "ds-chip__icon"));
            chip.Add(Ui.Text(text, "ds-chip__label"));
            if (count.HasValue) chip.Add(Ui.Text(count.Value.ToString(), "ds-chip__count"));
            return chip;
        }

        /// <summary>A count badge (sidebar unread, tab counts).</summary>
        public static Label Badge(string text, DsState state = DsState.Live)
        {
            Label badge = Ui.Text(text, "ds-badge", StateClass(state));
            return badge;
        }

        /// <summary>A state pill: icon and a plain word ("Tired", "Ready", "Title change").</summary>
        public static VisualElement Pill(DsState state, string text, string icon = null, bool solid = false)
        {
            VisualElement pill = Ui.El("ds-pill", StateClass(state));
            if (solid) pill.AddToClassList("ds-pill--solid");
            pill.Add(new Icon(icon ?? StateIcon(state), "ds-icon--xs", "ds-pill__icon"));
            pill.Add(Ui.Text(text, "ds-pill__label"));
            return pill;
        }

        /// <summary>A coloured dot and a word: the quietest state marker (table cells).</summary>
        public static VisualElement Dot(DsState state, string text)
        {
            VisualElement row = Ui.El("ds-dot-label", StateClass(state));
            row.Add(Ui.El("ds-dot"));
            row.Add(Ui.Text(text, "ds-dot-label__text"));
            return row;
        }

        /// <summary>A small capitals tag (FACE, HEEL, CHAMPION, MAIN EVENT).</summary>
        public static Label Tag(string text, string modifier = null)
        {
            Label tag = Ui.Text(TextFormat.Upper(text), "ds-tag");
            if (modifier != null) tag.AddToClassList("ds-tag--" + modifier);
            return tag;
        }

        // ---- Headings and layout -------------------------------------------------------------------

        /// <summary>A section header: a red tick, capitals title, a rule, and an optional quiet link.</summary>
        public static VisualElement SectionHeader(string title, string linkText = null, Action onLink = null)
        {
            VisualElement header = Ui.El("ds-section-header");
            header.Add(Ui.El("ds-section-header__tick"));
            header.Add(Ui.Text(TextFormat.Upper(title), "ds-section-header__title"));
            header.Add(Ui.El("ds-section-header__rule"));
            if (linkText != null)
            {
                Button link = Button(linkText, onLink, DsButtonKind.Ghost, null);
                link.AddToClassList("ds-btn--link");
                link.Add(new Icon("chevron-right", "ds-icon--xs", "ds-btn__icon-end"));
                header.Add(link);
            }
            return header;
        }

        /// <summary>A panel: the surface every block of content sits on.</summary>
        public static VisualElement Panel(string title = null, string linkText = null, Action onLink = null, params string[] classes)
        {
            VisualElement panel = Ui.El("ds-panel");
            foreach (string className in classes) panel.AddToClassList(className);
            if (title != null) panel.Add(SectionHeader(title, linkText, onLink));
            return panel;
        }

        public static VisualElement Row(params string[] classes)
        {
            VisualElement row = Ui.El("ds-row");
            foreach (string className in classes) row.AddToClassList(className);
            return row;
        }

        public static VisualElement Column(params string[] classes)
        {
            VisualElement column = Ui.El("ds-col");
            foreach (string className in classes) column.AddToClassList(className);
            return column;
        }

        public static VisualElement Spacer() => Ui.El("ds-spacer");

        // ---- Numbers ---------------------------------------------------------------------------------

        /// <summary>
        /// A stat tile: label, big number, a plain-words line and an optional trend. Pass a
        /// <paramref name="why"/> to add the quiet Why? that appears on hover or focus.
        /// </summary>
        public static VisualElement StatTile(string label, string value, string words = null, DsState state = DsState.Neutral,
            string trend = null, DsState trendState = DsState.Neutral, WhyBreakdown why = null)
        {
            VisualElement tile = Ui.El("ds-stat", StateClass(state));
            VisualElement top = Ui.El("ds-stat__top");
            top.Add(Ui.Text(TextFormat.Upper(label), "ds-stat__label"));
            tile.Add(top);
            VisualElement valueRow = Ui.El("ds-stat__value-row");
            valueRow.Add(Ui.Text(value, "ds-stat__value"));
            if (trend != null)
            {
                VisualElement trendEl = Ui.El("ds-trend", StateClass(trendState));
                trendEl.Add(new Icon(trendState == DsState.Bad ? "trend-down" : trendState == DsState.Good ? "trend-up" : "flat", "ds-icon--xs"));
                trendEl.Add(Ui.Text(trend, "ds-trend__text"));
                valueRow.Add(trendEl);
            }
            tile.Add(valueRow);
            if (words != null) tile.Add(Ui.Text(words, "ds-stat__words"));
            if (why != null) Why(tile, why, top);
            return tile;
        }

        /// <summary>A thin meter (0–1) in a state colour, with an optional word on its left.</summary>
        public static VisualElement Meter(float fraction, DsState state = DsState.Info, string word = null)
        {
            VisualElement meter = Ui.El("ds-meter", StateClass(state));
            if (word != null) meter.Add(Ui.Text(word, "ds-meter__word"));
            VisualElement track = Ui.El("ds-meter__track");
            VisualElement fill = Ui.El("ds-meter__fill");
            fill.style.width = Length.Percent(UnityEngine.Mathf.Clamp01(fraction) * 100f);
            track.Add(fill);
            meter.Add(track);
            return meter;
        }

        // ---- Why? ----------------------------------------------------------------------------------

        /// <summary>
        /// Adds the quiet Why? to <paramref name="host"/>: a small "?" that is invisible until the host
        /// is hovered or the "?" has focus. Hovering it previews the first line; clicking opens the
        /// breakdown in a side sheet. Returns the button (screens can call <see cref="WhyButtonOpen"/>).
        /// </summary>
        public static Button Why(VisualElement host, WhyBreakdown breakdown, VisualElement into = null)
        {
            host.AddToClassList("ds-why-host");
            Button button = null;
            button = new Button(() => DsOverlay.OpenWhy(button, breakdown)) { text = string.Empty };
            button.AddToClassList("ds-why");
            button.Add(new Icon("why", "ds-icon--xs"));
            DsTooltip.Attach(button, breakdown.Preview, $"Why {breakdown.ValueText}?");
            (into ?? host).Add(button);
            return button;
        }

        public static void WhyButtonOpen(Button whyButton) =>
            whyButton?.SendEvent(NavigationSubmitEventFor(whyButton));

        private static EventBase NavigationSubmitEventFor(VisualElement target)
        {
            NavigationSubmitEvent submit = NavigationSubmitEvent.GetPooled();
            submit.target = target;
            return submit;
        }

        // ---- Empty and loading -------------------------------------------------------------------

        /// <summary>An empty state: icon, one line of what's missing, a hint, and the action that fixes it.</summary>
        public static VisualElement Empty(string icon, string title, string hint, string actionText = null, Action onAction = null, string actionIcon = null)
        {
            VisualElement empty = Ui.El("ds-empty");
            empty.Add(new Icon(icon, "ds-icon--2xl", "ds-empty__icon"));
            empty.Add(Ui.Text(title, "ds-empty__title"));
            if (hint != null) empty.Add(Ui.Text(hint, "ds-empty__hint"));
            if (actionText != null) empty.Add(Button(actionText, onAction, DsButtonKind.Secondary, actionIcon));
            return empty;
        }

        /// <summary>A loading state: a spinning ring and what is happening.</summary>
        public static VisualElement Loading(string text)
        {
            VisualElement loading = Ui.El("ds-loading");
            VisualElement ring = new Icon("reset", "ds-icon--lg", "ds-loading__spinner");
            float angle = 0;
            ring.schedule.Execute(() =>
            {
                angle = (angle + 12f) % 360f;
                ring.style.rotate = new Rotate(angle);
            }).Every(33);
            loading.Add(ring);
            loading.Add(Ui.Text(text, "ds-loading__text"));
            return loading;
        }

        /// <summary>A skeleton line (loading placeholder) of the given width in percent.</summary>
        public static VisualElement Skeleton(float widthPercent, string modifier = null)
        {
            VisualElement line = Ui.El("ds-skeleton");
            if (modifier != null) line.AddToClassList("ds-skeleton--" + modifier);
            line.style.width = Length.Percent(widthPercent);
            return line;
        }

        /// <summary>Key-value rows for details panels ("Contract  ends Mar 2027").</summary>
        public static VisualElement KeyValues(params (string key, string value)[] pairs)
        {
            VisualElement list = Ui.El("ds-kv");
            foreach ((string key, string value) in pairs)
            {
                list.Add(Ui.El("ds-kv__row").With(Ui.Text(key, "ds-kv__key"), Ui.Text(value, "ds-kv__value")));
            }
            return list;
        }

        public static IEnumerable<T> Each<T>(params T[] items) => items;
    }

    /// <summary>
    /// What a Why? explains: the value, one plain-words summary (the hover preview), and the lines that
    /// made it. The game will feed this from the engine's traces (UNITY-08's WhySource); the mockups
    /// fill it by hand.
    /// </summary>
    public sealed class WhyBreakdown
    {
        public WhyBreakdown(string title, string valueText, string summary, params WhyLine[] lines)
        {
            Title = title;
            ValueText = valueText;
            Summary = summary;
            Lines = lines;
        }

        public string Title { get; }
        public string ValueText { get; }
        public string Summary { get; }
        public IReadOnlyList<WhyLine> Lines { get; }

        public string Preview => Summary + "\nClick for the full breakdown.";
    }

    public readonly struct WhyLine
    {
        public WhyLine(string label, string effect, DsState state = DsState.Neutral, string detail = null)
        {
            Label = label;
            Effect = effect;
            State = state;
            Detail = detail;
        }

        public string Label { get; }
        public string Effect { get; }
        public DsState State { get; }
        public string Detail { get; }
    }

    /// <summary>The skewed CTA: a <see cref="SkewShape"/> that is focusable and presses on click, Enter or Space.</summary>
    public sealed class SkewButton : SkewShape
    {
        private readonly Label label;

        public SkewButton(string text, string icon, Action onClick)
        {
            AddToClassList("ds-cta");
            focusable = true;
            tabIndex = 0;
            label = Ui.Text(TextFormat.Upper(text), "ds-cta__label");
            Add(label);
            if (icon != null) Add(new Icon(icon, "ds-icon--sm", "ds-cta__icon"));
            if (onClick != null) Clicked += onClick;
            this.AddManipulator(new Clickable(() => Clicked?.Invoke()));
            RegisterCallback<NavigationSubmitEvent>(_ => Clicked?.Invoke());
        }

        public event Action Clicked;

        public string Text
        {
            get => label.text;
            set => label.text = TextFormat.Upper(value);
        }
    }
}
