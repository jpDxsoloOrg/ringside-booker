using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Newtonsoft.Json.Linq;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using RingsideBooker.UI.Why;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// Small pieces the redesigned screens (UNITY-21: Office, Match lab) share on top of the UNITY-11
    /// components: the quiet Why? over a real engine trace, labelled choice rows, a popover list for
    /// long choices, portraits from the workshop world and compact money.
    /// </summary>
    public static class ScreenDs
    {
        public const string QuietWhyClass = "rb-why-quiet";

        /// <summary>
        /// Makes a UNITY-08 Why? button quiet in the UNITY-11 way: invisible until <paramref name="host"/>
        /// is hovered or the button has focus. Adds it to <paramref name="into"/> (or the host). Null-safe.
        /// </summary>
        public static WhyButton Quiet(VisualElement host, WhyButton why, VisualElement into = null)
        {
            if (why == null) return null;
            host.AddToClassList("ds-why-host");
            why.AddToClassList(QuietWhyClass);
            (into ?? host).Add(why);
            return why;
        }

        /// <summary>A quiet Why? over a trace the screen already has.</summary>
        public static WhyButton WhyTrace(VisualElement host, string label, double value, JToken trace, string unit = null, VisualElement into = null) =>
            Quiet(host, Kit.WhyTrace(label, value, trace, unit), into);

        /// <summary>A quiet Why? over a trace whose value is words (a decision: "Side 1 wins").</summary>
        public static WhyButton WhyDecision(VisualElement host, string label, string valueText, JToken trace, VisualElement into = null)
        {
            if (trace == null || trace.Type != JTokenType.Object) return null;
            try
            {
                TraceNode node = TraceReader.ParseNode(trace.ToString(Newtonsoft.Json.Formatting.None));
                return Quiet(host, new WhyButton(label, TraceValue.Of(valueText), WhySource.FromTrace(node)) { PanelTitle = label }, into);
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[Screens] trace for {label}: {exception.Message}");
                return null;
            }
        }

        /// <summary>A quiet Why? over a stored trace ref.</summary>
        public static WhyButton WhyRef(VisualElement host, string label, double value, JToken traceRef, string unit = null, VisualElement into = null) =>
            Quiet(host, Kit.WhyRef(label, value, traceRef, unit), into);

        /// <summary>A labelled field: a micro label over its control.</summary>
        public static VisualElement Field(string label, VisualElement control, string hint = null)
        {
            VisualElement field = Ds.Column("rb-ds-field");
            field.Add(Ds.Text(TextFormat.Upper(label), "rb-ds-field__label"));
            field.Add(control);
            if (hint != null) field.Add(Ds.Text(hint, "rb-ds-field__hint"));
            return field;
        }

        /// <summary>A wrapping row of choice chips; the selected one is lit.</summary>
        public static VisualElement Choices<T>(IEnumerable<(T value, string label)> options, T selected, Action<T> onPick, string name = null)
        {
            VisualElement row = Ds.Row("ds-row--wrap", "rb-ds-choices");
            if (name != null) row.name = name;
            foreach ((T value, string label) in options)
            {
                T target = value;
                Button chip = Ds.Chip(label, EqualityComparer<T>.Default.Equals(value, selected), () => onPick(target));
                if (name != null) chip.name = $"{name}-{value}";
                row.Add(chip);
            }
            return row;
        }

        /// <summary>
        /// A button showing the current choice that opens a popover list of the rest (for long lists:
        /// regions, promotions, finishes). <paramref name="searchable"/> adds a filter box.
        /// </summary>
        public static Button Picker(string current, IReadOnlyList<(string value, string label, string detail)> options, Action<string> onPick, bool searchable = false, string name = null)
        {
            Button button = null;
            button = Ds.Button(current, () => OpenPicker(button, options, onPick, searchable), DsButtonKind.Secondary, null);
            button.AddToClassList("rb-ds-picker");
            button.Add(new Icon("chevron-down", "ds-icon--xs", "ds-btn__icon-end"));
            if (name != null) button.name = name;
            return button;
        }

        private static void OpenPicker(VisualElement anchor, IReadOnlyList<(string value, string label, string detail)> options, Action<string> onPick, bool searchable)
        {
            VisualElement content = Ds.Column("rb-ds-picker-list");
            OverlayHandle handle = null;
            var scroll = new ScrollView(ScrollViewMode.Vertical) { horizontalScrollerVisibility = ScrollerVisibility.Hidden };
            scroll.AddToClassList("rb-ds-picker-list__scroll");
            void Fill(string filter)
            {
                scroll.Clear();
                foreach ((string value, string label, string detail) in options)
                {
                    if (!string.IsNullOrEmpty(filter)
                        && label.IndexOf(filter, StringComparison.OrdinalIgnoreCase) < 0
                        && (detail ?? string.Empty).IndexOf(filter, StringComparison.OrdinalIgnoreCase) < 0) continue;
                    string target = value;
                    var row = new Button(() =>
                    {
                        handle?.Close();
                        onPick(target);
                    }) { text = string.Empty };
                    row.AddToClassList("rb-ds-picker-list__row");
                    row.Add(Ds.Text(label, "rb-ds-picker-list__label"));
                    if (detail != null) row.Add(Ds.Text(detail, "rb-ds-picker-list__detail"));
                    scroll.Add(row);
                }
            }
            if (searchable)
            {
                content.Add(SearchBox("Filter…", Fill, "picker-filter"));
            }
            content.Add(scroll);
            Fill(null);
            handle = DsOverlay.Popover(anchor, content, alignRight: false);
        }

        /// <summary>A search box: an icon and a text field that calls <paramref name="changed"/> as the player types.</summary>
        public static VisualElement SearchBox(string placeholder, Action<string> changed, string name)
        {
            VisualElement box = Ds.Row("rb-ds-search");
            box.Add(new Icon("search", "ds-icon--sm", "rb-ds-search__icon"));
            var field = new TextField { name = name };
            field.AddToClassList("rb-ds-search__field");
            field.textEdition.placeholder = placeholder;
            field.RegisterValueChangedCallback(change => changed(change.newValue));
            box.Add(field);
            return box;
        }

        /// <summary>The workshop world's picture for a person or logo, or null (a painted silhouette or monogram then).</summary>
        public static Texture2D Picture(string imageRef) =>
            string.IsNullOrEmpty(imageRef) ? null : PromotionLogos.Texture(WorkshopWorlds.CurrentPictures, imageRef);

        /// <summary>The alignment a portrait is painted in.</summary>
        public static Alignment AlignmentOf(string alignment) => alignment switch
        {
            "heel" => Alignment.Heel,
            "face" => Alignment.Face,
            _ => Alignment.Tweener,
        };

        /// <summary>Cents in a headline size: "$40.62M", "$950K", "−$1.20M".</summary>
        public static string ShortMoney(double cents)
        {
            double dollars = Math.Abs(cents) / 100.0;
            string body;
            if (dollars >= 1_000_000_000) body = "$" + (dollars / 1_000_000_000).ToString("0.00", CultureInfo.InvariantCulture) + "B";
            else if (dollars >= 1_000_000) body = "$" + (dollars / 1_000_000).ToString("0.00", CultureInfo.InvariantCulture) + "M";
            else if (dollars >= 10_000) body = "$" + Math.Round(dollars / 1_000).ToString("0", CultureInfo.InvariantCulture) + "K";
            else body = "$" + Math.Round(dollars).ToString("N0", CultureInfo.InvariantCulture);
            return cents < 0 && Math.Round(dollars) > 0 ? TextFormat.Minus + body : body;
        }

        /// <summary>A signed short money: "+$1.10M", "−$0.95M", "$0".</summary>
        public static string SignedMoney(double cents) =>
            cents > 0 ? "+" + ShortMoney(cents) : ShortMoney(cents);

        /// <summary>Popularity 0–100 as the web's word.</summary>
        public static string PopularityWord(double value) =>
            value >= 80 ? "Megastar" : value >= 65 ? "Huge" : value >= 50 ? "Big" : value >= 35 ? "Solid" : value >= 20 ? "Small" : "Tiny";

        public static DsState PopularityState(double value) =>
            value >= 65 ? DsState.Gold : value >= 45 ? DsState.Info : DsState.Neutral;

        /// <summary>"Calder Voss & Ewan Thackeray", "A, B & C".</summary>
        public static string JoinNames(IEnumerable<string> names)
        {
            List<string> list = names.Where(name => !string.IsNullOrEmpty(name)).ToList();
            if (list.Count <= 1) return list.FirstOrDefault() ?? string.Empty;
            return string.Join(", ", list.Take(list.Count - 1)) + " & " + list[list.Count - 1];
        }

        /// <summary>Adds a stylesheet from Resources once per element (screens own their layout styles).</summary>
        public static void Style(VisualElement element, string resource)
        {
            var shared = Resources.Load<StyleSheet>("Screens/ScreenDs");
            if (shared != null) element.styleSheets.Add(shared);
            var sheet = Resources.Load<StyleSheet>(resource);
            if (sheet != null) element.styleSheets.Add(sheet);
            else Debug.LogWarning($"[Screens] stylesheet {resource} is missing");
        }
    }
}
