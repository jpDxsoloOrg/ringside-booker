using System;
using System.Collections.Generic;
using System.Linq;
using RingsideBooker.Import.Pictures;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using RingsideBooker.UI.Why;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Contracts
{
    /// <summary>
    /// Small design-system pieces the Contracts screen and its sheets share (UNITY-17): portraits
    /// from the workshop world's pictures, name cells, choice chips, switches, money fields, a
    /// search box and a modal whose buttons decide themselves when it closes. All on the UNITY-11
    /// <c>ds-</c> classes plus <c>ct-</c> layout classes in <c>Contracts.uss</c>.
    /// </summary>
    public static class ContractUi
    {
        private static StyleSheet sheet;

        /// <summary>Adds the screen's stylesheet (Resources/Contracts/Contracts.uss) to <paramref name="element"/>.</summary>
        public static void Style(VisualElement element)
        {
            if (sheet == null) sheet = Resources.Load<StyleSheet>("Contracts/Contracts");
            if (sheet != null && !element.styleSheets.Contains(sheet)) element.styleSheets.Add(sheet);
        }

        // ---- Pictures -------------------------------------------------------------------------------

        /// <summary>The worker's picture from the workshop world, or null (a painted silhouette then).</summary>
        public static Texture2D Picture(string imageRef)
        {
            if (string.IsNullOrEmpty(imageRef)) return null;
            PictureProvider pictures = WorkshopWorlds.CurrentPictures;
            if (pictures == null || !pictures.HasPicture(imageRef)) return null;
            return pictures.Get(imageRef);
        }

        public static VisualElement Portrait(string imageRef, string sizeClass = "ds-portrait--xs", bool gold = false) =>
            DsCards.PortraitBox(Picture(imageRef), Alignment.Tweener, sizeClass, gold);

        /// <summary>A table's name cell: a small portrait and the name (ellipsized), a crown for a champion.</summary>
        public static VisualElement NameCell(string ringName, string imageRef, bool champion = false)
        {
            VisualElement cell = Ds.Row("ct-name-cell");
            cell.Add(Portrait(imageRef, "ds-portrait--xs", champion));
            cell.Add(Ds.Text(ringName ?? ContractText.NoValue, "ds-cell__text", "ds-cell__text--strong", "ct-name-cell__name"));
            if (champion) cell.Add(new Icon("crown", "ds-icon--xs", "ct-name-cell__crown"));
            return cell;
        }

        public static Label Cell(string text, params string[] extra)
        {
            Label label = Ds.Text(text ?? ContractText.NoValue, "ds-cell__text");
            foreach (string className in extra) label.AddToClassList(className);
            return label;
        }

        public static Label NumCell(string text) => Cell(text, "ds-cell__text--num");

        public static Label Muted(string text) => Cell(text, "ds-cell__text--muted");

        /// <summary>The status chips in a row (the first two; the rest in the tooltip).</summary>
        public static VisualElement Chips(IReadOnlyList<ContractText.StatusChip> chips, int max = 2)
        {
            VisualElement row = Ds.Row("ct-chips");
            foreach (ContractText.StatusChip chip in chips.Take(max)) row.Add(Ds.Pill(chip.State, chip.Text, chip.Icon));
            if (chips.Count > max)
            {
                Label more = Ds.Text($"+{chips.Count - max}", "ct-chips__more");
                DsTooltip.Attach(more, string.Join("\n", chips.Skip(max).Select(chip => chip.Text)));
                row.Add(more);
            }
            return row;
        }

        // ---- Controls -------------------------------------------------------------------------------

        /// <summary>A labelled group of choice chips; disabled options show their reason on hover.</summary>
        public sealed class ChoiceGroup<T> : VisualElement
        {
            private readonly List<(Button chip, T value, bool enabled)> chips = new List<(Button, T, bool)>();
            private readonly Action<T> onPick;

            public ChoiceGroup(string label, IEnumerable<(T value, string text, bool enabled, string reason)> options, T selected, Action<T> onPick, string name = null)
            {
                this.onPick = onPick;
                AddToClassList("ct-field");
                if (name != null) this.name = name;
                if (label != null) Add(Ds.Text(TextFormat.Upper(label), "ct-field__label"));
                VisualElement row = Ds.Row("ds-row--wrap", "ct-choices");
                foreach ((T value, string text, bool enabled, string reason) in options)
                {
                    T captured = value;
                    Button chip = Ds.Chip(text, Equals(value, selected), () => Pick(captured));
                    chip.SetEnabled(enabled);
                    if (!enabled && !string.IsNullOrEmpty(reason))
                    {
                        // A disabled button gets no pointer events: the reason sits on a wrapper.
                        VisualElement wrap = Ds.El("ct-choice-wrap");
                        wrap.Add(chip);
                        DsTooltip.Attach(wrap, reason, text);
                        row.Add(wrap);
                    }
                    else
                    {
                        row.Add(chip);
                    }
                    chips.Add((chip, value, enabled));
                }
                Add(row);
            }

            public T Value { get; private set; }

            public void Pick(T value, bool notify = true)
            {
                Value = value;
                foreach ((Button chip, T chipValue, bool _) in chips) chip.EnableInClassList("ds-chip--selected", Equals(chipValue, value));
                if (notify) onPick?.Invoke(value);
            }
        }

        /// <summary>A switch row: a box, a label and a quiet description under it.</summary>
        public static Button Switch(string label, bool on, Action<bool> changed, string description = null, bool enabled = true, string name = null)
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
            row.AddToClassList("ct-switch");
            row.Add(box);
            VisualElement words = Ds.Column("ct-switch__words");
            words.Add(Ds.Text(label, "ds-check__label", "ct-switch__label"));
            if (description != null) words.Add(Ds.Text(description, "ct-switch__hint"));
            row.Add(words);
            row.SetEnabled(enabled);
            Draw();
            return row;

            void Draw()
            {
                box.Clear();
                if (state) box.Add(new Icon("check", "ds-icon--xs", "ds-check__tick"));
                row.EnableInClassList("ds-check--on", state);
            }
        }

        /// <summary>A labelled text input with a hint and an error line under it.</summary>
        public sealed class Field : VisualElement
        {
            private readonly Label error;

            public Field(string label, string value, Action<string> changed, string hint = null, string placeholder = null, string name = null, string prefix = null)
            {
                AddToClassList("ct-field");
                Add(Ds.Text(TextFormat.Upper(label), "ct-field__label"));
                VisualElement box = Ds.Row("ct-input");
                if (prefix != null) box.Add(Ds.Text(prefix, "ct-input__prefix"));
                Input = new TextField { value = value ?? string.Empty };
                if (name != null) Input.name = name;
                Input.AddToClassList("ct-input__field");
                if (placeholder != null) Input.textEdition.placeholder = placeholder;
                Input.RegisterValueChangedCallback(evt => changed?.Invoke(evt.newValue));
                box.Add(Input);
                Add(box);
                if (hint != null) Add(Ds.Text(hint, "ct-field__hint"));
                error = Ds.Text(string.Empty, "ct-field__error");
                error.SetShown(false);
                Add(error);
            }

            public TextField Input { get; }

            public void SetError(string text)
            {
                error.text = text ?? string.Empty;
                error.SetShown(!string.IsNullOrEmpty(text));
            }
        }

        /// <summary>The search box above a table.</summary>
        public static VisualElement Search(string placeholder, string value, Action<string> changed, string name)
        {
            VisualElement box = Ds.Row("ct-search");
            box.Add(new Icon("search", "ds-icon--sm", "ct-search__icon"));
            var field = new TextField { name = name, value = value ?? string.Empty };
            field.AddToClassList("ct-search__field");
            field.textEdition.placeholder = placeholder;
            field.RegisterValueChangedCallback(evt => changed(evt.newValue ?? string.Empty));
            box.Add(field);
            return box;
        }

        /// <summary>A plain line in a state colour with its icon (notices, errors, warnings).</summary>
        public static VisualElement Notice(DsState state, string text, string icon = null)
        {
            VisualElement row = Ds.Row("ct-notice", Ds.StateClass(state));
            row.Add(new Icon(icon ?? Ds.StateIcon(state), "ds-icon--sm", "ct-notice__icon"));
            row.Add(Ds.Text(text, "ct-notice__text"));
            return row;
        }

        /// <summary>A Why? next to a value, or the value alone when there's no source.</summary>
        public static VisualElement Value(string text, WhyButton why, params string[] classes)
        {
            VisualElement row = Ds.Row("ct-value");
            Label label = Ds.Text(text, "ct-value__text");
            foreach (string className in classes) label.AddToClassList(className);
            row.Add(label);
            if (why != null) row.Add(why);
            return row;
        }

        /// <summary>Key-value rows whose values are elements (a number with its Why?).</summary>
        public static VisualElement Facts(params (string key, VisualElement value)[] rows)
        {
            VisualElement list = Ds.El("ds-kv", "ct-facts");
            foreach ((string key, VisualElement value) in rows)
            {
                if (value == null) continue;
                VisualElement row = Ds.El("ds-kv__row", "ct-facts__row");
                row.Add(Ds.Text(key, "ds-kv__key"));
                row.Add(value);
                list.Add(row);
            }
            return list;
        }

        public static VisualElement FactText(string text) => Ds.Text(text ?? ContractText.NoValue, "ds-kv__value");

        // ---- Modal ----------------------------------------------------------------------------------

        /// <summary>A modal in the design system's look whose footer the caller fills (buttons close it themselves).</summary>
        public static OverlayHandle Modal(VisualElement anyElement, string title, VisualElement body, VisualElement footer, string name = null)
        {
            OverlayLayer layer = OverlayLayer.Of(anyElement);
            if (layer == null) return null;
            VisualElement modal = Ds.El("ds-modal", "ct-modal");
            Style(modal);
            if (name != null) modal.name = name;
            modal.pickingMode = PickingMode.Position;
            OverlayHandle handle = null;
            VisualElement header = Ds.El("ds-overlay-header");
            VisualElement words = Ds.El("ds-overlay-header__words");
            words.Add(Ds.Text(TextFormat.Upper(title), "ds-overlay-header__title"));
            header.Add(words);
            Button close = Ds.IconButton("close", "Close (Esc)", () => handle?.Close());
            close.AddToClassList(DsTooltip.NoFocusTipClass);
            header.Add(close);
            modal.Add(header);
            body.AddToClassList("ds-modal__body");
            modal.Add(body);
            footer.AddToClassList("ds-modal__footer");
            modal.Add(footer);
            handle = layer.Open(modal, new OverlayOptions { Modal = true, Dismissable = true, Centered = true });
            handle.Entry.AddToClassList("ds-overlay--modal");
            return handle;
        }
    }
}
