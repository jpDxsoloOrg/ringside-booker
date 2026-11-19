using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.Import.Pictures;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using RingsideBooker.UI.Why;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Creative
{
    /// <summary>
    /// Small design-system pieces the Titles and Storylines screens share (UNITY-16): pictures from
    /// the workshop world, the belt plate, quiet Why?s, choice chips, switches, text fields, a search
    /// box, notices, a popover menu and a modal whose buttons decide when it closes. The look is the
    /// UNITY-11 <c>ds-</c> components; <c>cr-</c> classes in <c>Creative.uss</c> only place things.
    /// </summary>
    public static class CreativeUi
    {
        public const string NoValue = "—";

        private static StyleSheet sheet;

        /// <summary>Adds the screens' stylesheet (Resources/Creative/Creative.uss) to <paramref name="element"/>.</summary>
        public static void Style(VisualElement element)
        {
            if (sheet == null) sheet = Resources.Load<StyleSheet>("Creative/Creative");
            if (sheet != null && !element.styleSheets.Contains(sheet)) element.styleSheets.Add(sheet);
        }

        /// <summary>
        /// Several queries for one draw, read in one engine-thread trip with <c>EngineClient.Read</c>
        /// (UNITY-23), so a redraw costs one main-thread hop. Results come back in order.
        /// </summary>
        public static Task<QueryResult<JToken>[]> Queries(EngineClient client, params (string name, object args)[] queries) =>
            client.Read("creative " + string.Join("+", queries.Select(query => query.name)),
                reader => queries.Select(query => reader.Query(query.name, query.args)).ToArray());

        // ---- Pictures -------------------------------------------------------------------------------

        /// <summary>A picture from the workshop world (portrait, belt), or null (painted art then).</summary>
        public static Texture2D Picture(string imageRef)
        {
            if (string.IsNullOrEmpty(imageRef)) return null;
            PictureProvider pictures = WorkshopWorlds.CurrentPictures;
            if (pictures == null || !pictures.HasPicture(imageRef)) return null;
            Texture2D texture = pictures.Get(imageRef);
            return texture == pictures.Placeholder ? null : texture;
        }

        public static VisualElement Portrait(string imageRef, string sizeClass = "ds-portrait--xs", bool gold = false, Alignment tone = Alignment.Tweener) =>
            DsCards.PortraitBox(Picture(imageRef), tone, sizeClass, gold);

        /// <summary>A brand or promotion logo from the workshop world, else its monogram.</summary>
        public static VisualElement Logo(string logoRef, string name, string sizeClass = "rb-logo--sm") =>
            PromotionLogos.Badge(WorkshopWorlds.CurrentPictures, logoRef, name ?? "?", sizeClass);

        /// <summary>
        /// A title's belt: its picture from the world when it has one, else a plate in the metal its
        /// prestige earns (gold, silver, bronze, plain) with the belt icon. Sizes: <c>cr-belt--sm|md|lg</c>.
        /// </summary>
        public static VisualElement Belt(string imageRef, double prestige, string sizeClass = "cr-belt--md")
        {
            VisualElement plate = Ds.El("cr-belt", sizeClass, "cr-belt--" + TitleText.BeltTier(prestige));
            Texture2D picture = Picture(imageRef);
            if (picture != null)
            {
                plate.AddToClassList("cr-belt--picture");
                var image = new Image { image = picture, scaleMode = ScaleMode.ScaleToFit };
                image.AddToClassList("cr-belt__image");
                plate.Add(image);
                return plate;
            }
            plate.Add(new Icon("titles", sizeClass == "cr-belt--lg" ? "ds-icon--2xl" : sizeClass == "cr-belt--sm" ? "ds-icon--sm" : "ds-icon--lg", "cr-belt__icon"));
            return plate;
        }

        /// <summary>
        /// Makes a card clickable (mouse, Enter or Space) while buttons inside it (a menu, Award, a
        /// Why?) keep their own clicks. Hover and focus come from <c>cr-clickable</c>.
        /// </summary>
        public static VisualElement Clickable(VisualElement element, Action onClick)
        {
            element.AddToClassList("cr-clickable");
            element.focusable = true;
            element.tabIndex = 0;
            element.RegisterCallback<ClickEvent>(evt =>
            {
                if (evt.target is VisualElement target && target != element && target.GetFirstOfType<Button>() != null) return;
                onClick();
            });
            element.RegisterCallback<NavigationSubmitEvent>(evt =>
            {
                if (evt.target == element) onClick();
            });
            return element;
        }

        // ---- Text -----------------------------------------------------------------------------------

        public static Label Line(string text, params string[] classes)
        {
            Label label = Ds.Text(text ?? NoValue, "cr-line");
            foreach (string className in classes) label.AddToClassList(className);
            return label;
        }

        /// <summary>A one-line label that ellipsizes (letter-spacing 0, as Unity measures without it).</summary>
        public static Label Clip(string text, params string[] classes)
        {
            Label label = Ds.Text(text ?? NoValue, "cr-clip");
            foreach (string className in classes) label.AddToClassList(className);
            label.tooltip = text;
            return label;
        }

        /// <summary>A worker's name that opens their profile (<c>worker?id=</c>, UNITY-15).</summary>
        public static Label Person(string name, string personId, params string[] classes) =>
            LinkTo(Clip(name, classes), personId == null ? null : ShellRoute.With(ScreenIds.Worker, "id", personId));

        /// <summary>A promotion's name that opens its profile (<c>promotion?id=</c>, UNITY-15).</summary>
        public static Label Promotion(string name, string promotionId, params string[] classes) =>
            LinkTo(Clip(name, classes), promotionId == null ? null : ShellRoute.With(ScreenIds.Promotion, "id", promotionId));

        /// <summary>Makes a label a link to <paramref name="route"/> when that screen exists; the click stops there (a card under it does not open).</summary>
        public static Label LinkTo(Label label, ShellRoute route)
        {
            if (route == null || !ScreenRegistry.IsLive(route.ScreenId)) return label;
            label.AddToClassList("cr-link");
            label.RegisterCallback<ClickEvent>(evt =>
            {
                evt.StopPropagation();
                ShellController.Current?.Navigator.Go(route);
            });
            return label;
        }

        public static Label Cell(string text, params string[] extra)
        {
            Label label = Ds.Text(text ?? NoValue, "ds-cell__text");
            foreach (string className in extra) label.AddToClassList(className);
            return label;
        }

        public static Label Micro(string text) => Ds.Text(TextFormat.Upper(text), "cr-micro");

        // ---- Why? -----------------------------------------------------------------------------------

        /// <summary>
        /// Makes a Why? quiet: a small "?" that stays faint until its host is hovered or it has focus.
        /// Returns the host for chaining. Nothing happens when <paramref name="why"/> is null.
        /// </summary>
        public static VisualElement Quiet(VisualElement host, WhyButton why)
        {
            if (why == null) return host;
            host.AddToClassList("cr-why-host");
            why.AddToClassList("cr-quiet-why");
            host.Add(why);
            return host;
        }

        /// <summary>A value with its quiet Why? after it (the value alone when there is no source).</summary>
        public static VisualElement Value(string text, WhyButton why, params string[] classes)
        {
            VisualElement row = Ds.Row("cr-value");
            Label label = Ds.Text(text, "cr-value__text");
            foreach (string className in classes) label.AddToClassList(className);
            row.Add(label);
            return Quiet(row, why);
        }

        /// <summary>A Why? over a stored trace ref, or null.</summary>
        public static WhyButton WhyRef(string label, double value, JToken traceRef, string unit = null, string title = null) =>
            traceRef == null || traceRef.Type == JTokenType.Null ? null : Kit.WhyRef(label, value, traceRef, unit, title);

        /// <summary>A Why? over a trace node the screen already has, or null.</summary>
        public static WhyButton WhyTrace(string label, double value, JToken trace, string unit = null, string title = null) =>
            trace == null || trace.Type == JTokenType.Null ? null : Kit.WhyTrace(label, value, trace, unit, title);

        /// <summary>The stored ref when there is one, else the inline trace (the engine sets exactly one).</summary>
        public static WhyButton WhyEither(string label, double value, JToken traceRef, JToken trace, string unit = null, string title = null) =>
            WhyRef(label, value, traceRef, unit, title) ?? WhyTrace(label, value, trace, unit, title);

        // ---- Layout ---------------------------------------------------------------------------------

        /// <summary>Key-value rows whose values are elements (a number with its Why?).</summary>
        public static VisualElement Facts(params (string key, VisualElement value)[] rows)
        {
            VisualElement list = Ds.El("ds-kv", "cr-facts");
            foreach ((string key, VisualElement value) in rows)
            {
                if (value == null) continue;
                VisualElement row = Ds.El("ds-kv__row", "cr-facts__row");
                row.Add(Ds.Text(key, "ds-kv__key"));
                row.Add(value);
                list.Add(row);
            }
            return list;
        }

        public static VisualElement FactText(string text) => Ds.Text(text ?? NoValue, "ds-kv__value");

        /// <summary>A plain line in a state colour with its icon (notices, refusals, warnings).</summary>
        public static VisualElement Notice(DsState state, string text, string icon = null)
        {
            VisualElement row = Ds.Row("cr-notice", Ds.StateClass(state));
            row.Add(new Icon(icon ?? Ds.StateIcon(state), "ds-icon--sm", "cr-notice__icon"));
            row.Add(Ds.Text(text, "cr-notice__text"));
            return row;
        }

        /// <summary>A notice that stays hidden until <see cref="SetProblem"/> fills it.</summary>
        public static VisualElement Problem(string name = null)
        {
            VisualElement notice = Notice(DsState.Bad, string.Empty);
            if (name != null) notice.name = name;
            notice.SetShown(false);
            return notice;
        }

        public static void SetProblem(VisualElement notice, string text)
        {
            if (notice == null) return;
            notice.Q<Label>(className: "cr-notice__text").text = text ?? string.Empty;
            notice.SetShown(!string.IsNullOrEmpty(text));
        }

        /// <summary>The "Back to …" link at the top of a detail page.</summary>
        public static Button BackLink(string text, Action onClick, string name)
        {
            Button link = Ds.Button(text, onClick, DsButtonKind.Ghost, "back");
            link.AddToClassList("ds-btn--link");
            link.AddToClassList("cr-back");
            link.name = name;
            return link;
        }

        // ---- Controls -------------------------------------------------------------------------------

        /// <summary>A labelled group of choice chips; disabled options show their reason on hover.</summary>
        public sealed class ChoiceGroup<T> : VisualElement
        {
            private readonly List<(Button chip, T value)> chips = new List<(Button, T)>();
            private readonly Action<T> onPick;
            private readonly Label hint;
            private readonly Label error;

            public ChoiceGroup(string label, IEnumerable<(T value, string text)> options, T selected, Action<T> onPick, string name = null, string hintText = null)
            {
                this.onPick = onPick;
                Value = selected;
                AddToClassList("cr-field");
                if (name != null) this.name = name;
                if (label != null) Add(Ds.Text(TextFormat.Upper(label), "cr-field__label"));
                VisualElement row = Ds.Row("ds-row--wrap", "cr-choices");
                foreach ((T value, string text) in options)
                {
                    T captured = value;
                    Button chip = Ds.Chip(text, Equals(value, selected), () => Pick(captured));
                    chip.name = name == null ? null : $"{name}-{value}";
                    row.Add(chip);
                    chips.Add((chip, value));
                }
                Add(row);
                hint = Ds.Text(hintText ?? string.Empty, "cr-field__hint");
                hint.SetShown(!string.IsNullOrEmpty(hintText));
                Add(hint);
                error = Ds.Text(string.Empty, "cr-field__error");
                error.SetShown(false);
                Add(error);
            }

            public T Value { get; private set; }

            public IEnumerable<Button> Chips => chips.Select(entry => entry.chip);

            public void Pick(T value, bool notify = true)
            {
                Value = value;
                foreach ((Button chip, T chipValue) in chips) chip.EnableInClassList("ds-chip--selected", Equals(chipValue, value));
                if (notify) onPick?.Invoke(value);
            }

            public void SetLocked(bool locked)
            {
                foreach ((Button chip, T _) in chips) chip.SetEnabled(!locked);
            }

            public void SetHint(string text)
            {
                hint.text = text ?? string.Empty;
                hint.SetShown(!string.IsNullOrEmpty(text));
            }

            public void SetError(string text)
            {
                error.text = text ?? string.Empty;
                error.SetShown(!string.IsNullOrEmpty(text));
            }
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
            row.AddToClassList("cr-switch");
            row.Add(box);
            VisualElement words = Ds.Column("cr-switch__words");
            words.Add(Ds.Text(label, "ds-check__label", "cr-switch__label"));
            if (description != null) words.Add(Ds.Text(description, "cr-switch__hint"));
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

        /// <summary>A labelled text input with a hint and an error line under it.</summary>
        public sealed class Field : VisualElement
        {
            private readonly Label error;
            private readonly Label hint;

            public Field(string label, string value, Action<string> changed, string hintText = null, string name = null, int maxLength = 0, bool multiline = false)
            {
                AddToClassList("cr-field");
                Add(Ds.Text(TextFormat.Upper(label), "cr-field__label"));
                VisualElement box = Ds.Row("cr-input");
                if (multiline) box.AddToClassList("cr-input--multiline");
                Input = new TextField { value = value ?? string.Empty, multiline = multiline };
                if (maxLength > 0) Input.maxLength = maxLength;
                if (name != null) Input.name = name;
                Input.AddToClassList("cr-input__field");
                if (multiline) Input.verticalScrollerVisibility = ScrollerVisibility.Auto;
                Input.RegisterValueChangedCallback(evt => changed?.Invoke(evt.newValue));
                box.Add(Input);
                Add(box);
                hint = Ds.Text(hintText ?? string.Empty, "cr-field__hint");
                hint.SetShown(!string.IsNullOrEmpty(hintText));
                Add(hint);
                error = Ds.Text(string.Empty, "cr-field__error");
                error.SetShown(false);
                Add(error);
            }

            public TextField Input { get; }

            public void SetHint(string text)
            {
                hint.text = text ?? string.Empty;
                hint.SetShown(!string.IsNullOrEmpty(text));
            }

            public void SetError(string text)
            {
                error.text = text ?? string.Empty;
                error.SetShown(!string.IsNullOrEmpty(text));
            }
        }

        /// <summary>The search box above a list.</summary>
        public static VisualElement Search(string placeholder, string value, Action<string> changed, string name)
        {
            VisualElement box = Ds.Row("cr-search");
            box.Add(new Icon("search", "ds-icon--sm", "cr-search__icon"));
            var field = new TextField { name = name, value = value ?? string.Empty };
            field.AddToClassList("cr-search__field");
            field.textEdition.placeholder = placeholder;
            field.RegisterValueChangedCallback(evt => changed(evt.newValue ?? string.Empty));
            box.Add(field);
            return box;
        }

        /// <summary>A menu (a popover of buttons) under <paramref name="anchor"/>; danger items in red.</summary>
        public static OverlayHandle Menu(VisualElement anchor, IEnumerable<(string text, string icon, bool danger, Action onClick)> items, string name = null)
        {
            VisualElement menu = Ds.Column("cr-menu");
            Style(menu);
            if (name != null) menu.name = name;
            OverlayHandle handle = null;
            foreach ((string text, string icon, bool danger, Action onClick) in items)
            {
                Action click = onClick;
                Button item = Ds.Button(text, () =>
                {
                    handle?.Close();
                    click?.Invoke();
                }, danger ? DsButtonKind.Danger : DsButtonKind.Ghost, icon);
                item.AddToClassList("cr-menu__item");
                item.name = name == null ? null : $"{name}-{text.ToLowerInvariant().Replace(' ', '-')}";
                menu.Add(item);
            }
            handle = DsOverlay.Popover(anchor, menu);
            return handle;
        }

        // ---- Overlays -------------------------------------------------------------------------------

        /// <summary>A side sheet on the screens' stylesheet, with a footer of buttons the caller fills.</summary>
        public static OverlayHandle Sheet(VisualElement anyElement, string title, VisualElement body, VisualElement footer, string eyebrow = null, float width = 560f, string name = null)
        {
            Style(body);
            if (footer != null) Style(footer);
            OverlayHandle handle = DsOverlay.SideSheet(anyElement, title, body, eyebrow, footer, width);
            if (handle != null)
            {
                Style(handle.Entry);
                if (name != null) handle.Entry.name = name;
            }
            return handle;
        }

        /// <summary>A modal in the design system's look whose footer the caller fills (its buttons close it themselves).</summary>
        public static OverlayHandle Modal(VisualElement anyElement, string title, VisualElement body, VisualElement footer, string name = null)
        {
            OverlayLayer layer = OverlayLayer.Of(anyElement);
            if (layer == null) return null;
            VisualElement modal = Ds.El("ds-modal", "cr-modal");
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

        /// <summary>
        /// A confirm: words, then Cancel and a confirm button that runs <paramref name="run"/>. The
        /// modal closes when it returns null and stays open with the engine's words when it returns a
        /// refusal.
        /// </summary>
        public static OverlayHandle Confirm(VisualElement anyElement, string title, string body, string confirmText, bool danger,
            Func<Task<string>> run, string name = null)
        {
            VisualElement content = Ds.Column("cr-confirm");
            content.Add(Ds.Text(body, "cr-confirm__text"));
            VisualElement problem = Problem();
            content.Add(problem);
            VisualElement footer = Ds.Row("cr-footer");
            OverlayHandle handle = null;
            footer.Add(Ds.Button("Cancel", () => handle?.Close(), DsButtonKind.Ghost));
            Button confirm = null;
            confirm = Ds.Button(confirmText, async () =>
            {
                confirm.SetEnabled(false);
                string refused;
                try
                {
                    refused = await run();
                }
                catch (Exception exception)
                {
                    Debug.LogException(exception);
                    refused = EngineUnreachable;
                }
                confirm.SetEnabled(true);
                if (refused == null) handle?.Close();
                else SetProblem(problem, refused);
            }, danger ? DsButtonKind.Danger : DsButtonKind.Primary);
            confirm.name = name == null ? null : name + "-confirm";
            footer.Add(confirm);
            handle = Modal(anyElement, title, content, footer, name);
            return handle;
        }

        /// <summary>What the player reads when a command never reached the engine.</summary>
        public const string EngineUnreachable = "Couldn't reach the game engine. Try again.";

        /// <summary>Runs a command: null when it worked, else the engine's words.</summary>
        public static async Task<string> Run(string command, JObject args)
        {
            EngineGame game = Kit.Game;
            if (game == null) return "No game is running.";
            CommandResult<JToken> result = await game.Client.Command(command, args);
            if (result.Ok) return null;
            Debug.Log($"[Creative] {command} refused: {result.ReasonText}");
            return Kit.Reasons(result.Reasons);
        }

        /// <summary>The engine's refusal reasons of a failed query, in words.</summary>
        public static string QueryProblem(QueryResult<JToken> result) =>
            result == null ? "Something went wrong." : Kit.Reasons(result.Reasons);

        /// <summary>True when the query failed because no game is loaded.</summary>
        public static bool NoWorld(QueryResult<JToken> result) =>
            result != null && !result.Ok && result.HasReason(EngineReasonCodes.NoWorld);

        public static IReadOnlyList<(string code, string field, string message)> ReasonList(IEnumerable<EngineReason> reasons) =>
            (reasons ?? Enumerable.Empty<EngineReason>()).Select(reason => (reason.Code, reason.Field, reason.Message)).ToList();

        public static IReadOnlyList<(string code, string field, string message)> ReasonList(JToken reasons) =>
            Kit.Arr(reasons).Select(reason => (Kit.Str(reason, "code"), Kit.Str(reason, "field"), Kit.Str(reason, "message"))).ToList();
    }
}
