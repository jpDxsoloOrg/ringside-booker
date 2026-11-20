using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Schedule
{
    /// <summary>
    /// The schedule editor's entry points (EVT8-03/04): the "New show" button and its menu (Weekly
    /// or recurring show…, One-off special…, Manage shows…), the Edit and Retire actions on one of
    /// your shows, and the shared helpers the sheets use. Placed on the Calendar's month bar, the
    /// show sheet and your promotion's Shows tab. Only shown when the player runs a promotion.
    /// </summary>
    public static class ScheduleEditor
    {
        /// <summary>The promotion the player runs, or null (unemployed: no button).</summary>
        public static string OwnPromotionId => Kit.Game?.PromotionId;

        /// <summary>The "New show" menu button, or null when the player runs no promotion.</summary>
        public static Button NewShowButton(ScreenContext context, string name = "schedule-new-show")
        {
            string promotionId = OwnPromotionId;
            if (promotionId == null) return null;
            Button button = null;
            button = Ds.Button("New show", () => OpenMenu(button, context, promotionId), DsButtonKind.Primary, "add");
            button.name = name;
            DsTooltip.Attach(button, "Add a weekly show or a one-off special, or manage your shows");
            return button;
        }

        /// <summary>A quiet "Manage shows" button, or null when the player runs no promotion.</summary>
        public static Button ManageButton(ScreenContext context, string name = "schedule-manage")
        {
            string promotionId = OwnPromotionId;
            if (promotionId == null) return null;
            Button button = Ds.Button("Manage shows", () => ManageShowsSheet.Open(context, promotionId), DsButtonKind.Ghost, "calendar");
            button.name = name;
            return button;
        }

        public static void OpenMenu(VisualElement anchor, ScreenContext context, string promotionId)
        {
            VisualElement menu = Ds.Column("sc-menu");
            Style(menu);
            menu.name = "schedule-menu";
            OverlayHandle handle = null;
            void Item(string text, string detail, string icon, string id, Action run)
            {
                var item = new Button(() =>
                {
                    handle?.Close();
                    run();
                }) { text = string.Empty, name = id };
                item.AddToClassList("sc-menu__item");
                item.Add(new Icon(icon, "ds-icon--md", "sc-menu__icon"));
                VisualElement words = Ds.Column("sc-menu__words");
                words.Add(Ds.Text(text, "sc-menu__title"));
                words.Add(Ds.Text(detail, "sc-menu__detail"));
                item.Add(words);
                menu.Add(item);
            }
            Item("Weekly or recurring show…", "TV every week, a monthly special, a yearly event", "calendar", "schedule-new-recurring",
                () => DefinitionEditorSheet.Open(context, promotionId, null));
            Item("One-off special…", "A single big night (a PPV) on a date you pick", "star", "schedule-new-special",
                () => OneOffSheet.Open(context, promotionId));
            Item("Manage shows…", "Edit or retire your recurring shows", "edit", "schedule-manage-shows",
                () => ManageShowsSheet.Open(context, promotionId));
            handle = DsOverlay.Popover(anchor, menu);
        }

        /// <summary>
        /// Adds "Edit show" and "Retire show…" to a show sheet's footer for one of your shows that
        /// comes from a recurring show (one-offs and rival shows get nothing).
        /// </summary>
        public static void AddShowActions(VisualElement footer, JToken show, ScreenContext context, Action closeSheet)
        {
            string definitionId = Kit.Str(show, "definitionId");
            if (!Kit.Bool(show, "isOwn") || definitionId == null || OwnPromotionId == null) return;
            Button edit = Ds.Button("Edit show", async () =>
            {
                JToken row = await DefinitionRow(definitionId);
                if (row == null) return;
                closeSheet?.Invoke();
                DefinitionEditorSheet.Open(context, Kit.Str(row, "promotionId"), row);
            }, DsButtonKind.Ghost, "edit");
            edit.name = "show-sheet-edit-show";
            Button retire = Ds.Button("Retire show…", async () =>
            {
                JToken row = await DefinitionRow(definitionId);
                if (row == null) return;
                closeSheet?.Invoke();
                RetireShowDialog.Open(context, row);
            }, DsButtonKind.Ghost, "trash");
            retire.name = "show-sheet-retire-show";
            footer.Insert(0, retire);
            footer.Insert(0, edit);
        }

        /// <summary>One of your recurring shows as <c>calendar.definitions</c> lists it, or null.</summary>
        public static async Task<JToken> DefinitionRow(string definitionId)
        {
            QueryResult<JToken> rows = await Kit.Game.Client.Query("calendar.definitions", new JObject());
            return rows.Ok ? Kit.Arr(rows.Data).FirstOrDefault(row => Kit.Str(row, "eventDefinitionId") == definitionId) : null;
        }

        /// <summary><c>calendar.editorOptions</c> for the promotion, or null.</summary>
        public static async Task<JToken> Options(string promotionId)
        {
            QueryResult<JToken> answer = await Kit.Game.Client.Query("calendar.editorOptions", new JObject { ["promotionId"] = promotionId });
            return answer.Ok && answer.Data != null && answer.Data.Type != JTokenType.Null ? answer.Data : null;
        }

        /// <summary><c>calendar.placeChoices</c>: regions, and a region's venues when one is given.</summary>
        public static async Task<JToken> Places(string promotionId, string regionId = null, string date = null)
        {
            var args = new JObject { ["promotionId"] = promotionId };
            if (regionId != null) args["regionId"] = regionId;
            if (date != null) args["date"] = date;
            QueryResult<JToken> answer = await Kit.Game.Client.Query("calendar.placeChoices", args);
            return answer.Ok ? answer.Data : null;
        }

        /// <summary>The region picker's options: home first, then its neighbours, then the rest.</summary>
        public static List<(string value, string label, string detail)> RegionOptions(JToken places, string homeLabel = "Home")
        {
            var options = new List<(string, string, string)>();
            foreach (JToken region in Kit.Arr(places, "regions"))
            {
                string detail = Kit.Bool(region, "isHome") ? $"{homeLabel} · {Kit.Str(region, "countryName")}"
                    : Kit.Bool(region, "isNeighbourOfHome") ? $"Next to home · {Kit.Str(region, "countryName")}"
                    : Kit.Str(region, "countryName");
                options.Add((Kit.Str(region, "regionId"), Kit.Str(region, "name"), detail));
            }
            return options;
        }

        /// <summary>"6 main slots + 1 pre-show" (never minutes).</summary>
        public static string SizeWords(double? slots, double? preShow)
        {
            string main = $"{(int)(slots ?? 0)} slots";
            int pre = (int)(preShow ?? 0);
            return pre > 0 ? $"{main} + {pre} pre-show" : main;
        }

        /// <summary>The first <paramref name="count"/> dates as "Fri 8 Jan", then "and N more".</summary>
        public static string DateList(IEnumerable<string> isoDates, int count)
        {
            List<string> all = isoDates.ToList();
            IEnumerable<string> shown = all.Take(count).Select(iso => GameDate.TryParse(iso, out GameDate date) ? UpcomingDates.ShortDay(date) : iso);
            string text = string.Join(", ", shown);
            return all.Count > count ? $"{text} and {all.Count - count} more" : text;
        }

        // ---- Shared sheet pieces -------------------------------------------------------------------

        private static StyleSheet sheet;

        public static void Style(VisualElement element)
        {
            if (sheet == null) sheet = Resources.Load<StyleSheet>("Schedule/Schedule");
            if (sheet != null && !element.styleSheets.Contains(sheet)) element.styleSheets.Add(sheet);
            DsForm.Style(element);
        }

        /// <summary>A side sheet on the schedule stylesheet with a footer the caller fills.</summary>
        public static OverlayHandle Sheet(ScreenContext context, string title, VisualElement body, VisualElement footer, string eyebrow, float width, string name)
        {
            Style(body);
            if (footer != null) Style(footer);
            VisualElement anchor = context?.Overlay?.Layer ?? ShellController.Current?.Overlay?.Layer;
            OverlayHandle handle = DsOverlay.SideSheet(anchor, title, body, eyebrow, footer, width);
            if (handle != null)
            {
                Style(handle.Entry);
                handle.Entry.name = name;
            }
            return handle;
        }

        /// <summary>A switch row: a box, a label and a quiet line under it.</summary>
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
            row.AddToClassList("sc-switch");
            row.Add(box);
            VisualElement words = Ds.Column("sc-switch__words");
            words.Add(Ds.Text(label, "ds-check__label", "sc-switch__label"));
            if (description != null) words.Add(Ds.Text(description, "sc-switch__hint"));
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

        /// <summary>A notice line (warning, problem, info) in the sheet.</summary>
        public static VisualElement Notice(DsState state, string text, string icon = null)
        {
            VisualElement notice = Ds.Row("sc-notice", Ds.StateClass(state));
            notice.Add(new Icon(icon ?? Ds.StateIcon(state), "ds-icon--sm", "sc-notice__icon"));
            notice.Add(Ds.Text(text, "sc-notice__text"));
            return notice;
        }

        /// <summary>A labelled picker (a button that opens a filterable list).</summary>
        public static VisualElement PickerField(string label, string current, IReadOnlyList<(string value, string label, string detail)> options,
            Action<string> pick, string name, string hint = null)
        {
            VisualElement field = Ds.Column("dsf-field");
            field.Add(DsForm.Label(label));
            Button picker = ScreenDs.Picker(current, options, pick, options.Count > 8, name);
            picker.AddToClassList("sc-picker");
            field.Add(picker);
            if (hint != null) field.Add(Ds.Text(hint, "dsf-hint"));
            return field;
        }

        /// <summary>A labelled row of choice chips.</summary>
        public static VisualElement ChoiceField<T>(string label, IEnumerable<(T value, string label)> options, T selected, Action<T> pick, string name, string hint = null)
        {
            VisualElement field = Ds.Column("dsf-field");
            field.Add(DsForm.Label(label));
            VisualElement chips = ScreenDs.Choices(options, selected, pick, name);
            chips.AddToClassList("dsf-chips");
            field.Add(chips);
            if (hint != null) field.Add(Ds.Text(hint, "dsf-hint").Named(name + "-hint"));
            return field;
        }

        /// <summary>Runs a command: the result when it worked, else null with the engine's words in <paramref name="problem"/>.</summary>
        public static async Task<(JToken data, string problem)> Run(string command, JObject args)
        {
            EngineGame game = Kit.Game;
            if (game == null) return (null, "No game is running.");
            CommandResult<JToken> result = await game.Client.Command(command, args);
            if (result.Ok) return (result.Data, null);
            Debug.Log($"[Schedule] {command} refused: {result.ReasonText}");
            return (null, Kit.Reasons(result.Reasons));
        }

        /// <summary>Goes to the calendar month of <paramref name="isoDate"/> on your shows.</summary>
        public static void ShowOnCalendar(ScreenContext context, string isoDate)
        {
            string month = isoDate != null && isoDate.Length >= 7 ? isoDate.Substring(0, 7) : null;
            ShellNavigator navigator = context?.Navigator ?? ShellController.Current?.Navigator;
            navigator?.Go(month == null ? ShellRoute.To("calendar") : ShellRoute.With("calendar", "month", month, "scope", "mine"));
        }
    }
}
