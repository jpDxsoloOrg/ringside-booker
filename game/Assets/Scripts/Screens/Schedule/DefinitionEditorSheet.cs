using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Schedule
{
    /// <summary>
    /// The recurring show editor (EVT8-03), a side sheet for a new show or one of yours: name, how
    /// often (with the next dates from the engine), size, where, and the brand when the promotion
    /// has brands; slot counts, TV, a preferred venue and the first date are one step away under
    /// "More options". For an edit, "What changes" lists the dates Save adds and removes and the
    /// shows it keeps because they are booked, carded, run or taped. Every refusal is the engine's
    /// own words (<c>calendar.previewDefinition</c> runs the command's checks). No minutes (D-10).
    /// </summary>
    public sealed class DefinitionEditorSheet
    {
        /// <summary>The open editor (for tours and tests), or null.</summary>
        public static DefinitionEditorSheet Current { get; private set; }

        private readonly ScreenContext context;
        private readonly string promotionId;
        private readonly JToken stored;
        private readonly RecurringDraft original;
        private readonly VisualElement body = Ds.Column("sc-editor");
        private readonly VisualElement footer = Ds.Row("sc-footer");
        private JToken options;
        private JToken places;
        private JToken venues;
        private List<ImportanceChoice> importances = new List<ImportanceChoice>();
        private GameDate effectiveFrom;
        private GameDate maxDate;
        private OverlayHandle handle;

        private DsTextField nameField;
        private UpcomingDates upcoming;
        private VisualElement sizeSlot;
        private VisualElement placeSlot;
        private VisualElement venueSlot;
        private NumberStepper slots;
        private NumberStepper preShow;
        private DateField firstDate;
        private VisualElement more;
        private Button moreToggle;
        private VisualElement changes;
        private VisualElement problems;
        private Button save;
        private bool moreOpen;
        private bool nameTouched;
        private bool saving;
        private int version;

        private DefinitionEditorSheet(ScreenContext context, string promotionId, JToken stored)
        {
            this.context = context;
            this.promotionId = promotionId;
            this.stored = stored;
            original = stored == null ? null : RecurringDraft.FromRow(stored);
            Draft = original == null ? new RecurringDraft() : RecurringDraft.FromRow(stored);
        }

        /// <summary>What the sheet will save.</summary>
        public RecurringDraft Draft { get; }

        /// <summary>The last preview from the engine (reasons, next dates, plan).</summary>
        public JToken Preview { get; private set; }

        /// <summary>True while a preview or save is on its way.</summary>
        public bool Busy { get; private set; }

        /// <summary>The saved result, once Save worked.</summary>
        public JToken Saved { get; private set; }

        public bool IsEdit => stored != null;

        /// <summary>Opens the editor: a new show when <paramref name="definitionRow"/> is null, else that show.</summary>
        public static async void Open(ScreenContext context, string promotionId, JToken definitionRow)
        {
            var editor = new DefinitionEditorSheet(context, promotionId, definitionRow);
            Current = editor;
            await editor.Build();
        }

        private async Task Build()
        {
            ScheduleEditor.Style(body);
            body.Add(Ds.Loading("Loading your schedule…"));
            string title = IsEdit ? $"Edit {Kit.Str(stored, "name")}" : "New recurring show";
            handle = ScheduleEditor.Sheet(context, title, body, footer, IsEdit ? "Recurring show" : "Your schedule", 600f, "schedule-editor");
            if (handle == null) return;
            handle.Closed += () =>
            {
                if (Current == this) Current = null;
            };

            Busy = true;
            options = await ScheduleEditor.Options(promotionId);
            places = await ScheduleEditor.Places(promotionId);
            Busy = false;
            body.Clear();
            if (options == null || places == null)
            {
                body.Add(Kit.Error("Couldn't load the schedule options."));
                return;
            }
            importances = ImportanceChoice.From(options);
            GameDate.TryParse(Kit.Str(options, "effectiveFrom"), out effectiveFrom);
            GameDate.TryParse(Kit.Str(options, "maxDate"), out maxDate);
            if (!IsEdit)
            {
                Draft.Recurrence = new RecurrenceValue { Kind = RecurrenceValue.Weekly, Weekdays = new List<int> { 4 }, Weekday = 4 };
                Draft.SetImportance("regular", importances);
                Draft.RegionId = null;
            }
            BuildForm();
            RequestPreview();
        }

        private void BuildForm()
        {
            body.Clear();
            if (!IsEdit)
                body.Add(Ds.Text("Pick a name and how often it runs. Size and place have sensible defaults; you can change them any time.", "sc-lead"));

            nameField = new DsTextField("Name", Draft.Name, value =>
            {
                Draft.Name = value;
                nameTouched = true;
                RequestPreview();
            }, null, "show-name", 60, "e.g. Friday Night Fights");
            body.Add(nameField);

            body.Add(new RecurrenceBuilder(Draft.Recurrence, value =>
            {
                Draft.Recurrence = value.Clone();
                RequestPreview();
            }, effectiveFrom, maxDate, "show-recurrence"));
            upcoming = new UpcomingDates("show-upcoming");
            upcoming.SetLoading(true);
            body.Add(upcoming);

            sizeSlot = Ds.Column("sc-slot");
            body.Add(sizeSlot);
            DrawSize();

            placeSlot = Ds.Column("sc-slot");
            body.Add(placeSlot);
            DrawPlace();

            List<JToken> brands = Kit.Arr(options, "brands").Where(brand => Kit.Bool(brand, "active") || Kit.Str(brand, "brandId") == Draft.BrandId).ToList();
            if (brands.Count > 0)
            {
                var choices = new List<(string, string)> { (string.Empty, "Whole promotion") };
                choices.AddRange(brands.Select(brand => (Kit.Str(brand, "brandId"), Kit.Str(brand, "name"))));
                body.Add(ScheduleEditor.ChoiceField("Brand", choices, Draft.BrandId ?? string.Empty, picked =>
                {
                    Draft.BrandId = string.IsNullOrEmpty(picked) ? null : picked;
                    RequestPreview();
                    RedrawChips("show-brand", Draft.BrandId ?? string.Empty);
                }, "show-brand"));
            }

            moreToggle = Ds.Button("More options", ToggleMore, DsButtonKind.Ghost, "chevron-down");
            moreToggle.name = "show-more-toggle";
            moreToggle.AddToClassList("sc-more-toggle");
            body.Add(moreToggle);
            more = Ds.Column("sc-more");
            more.name = "show-more";
            more.SetShown(false);
            body.Add(more);
            BuildMore();

            changes = Ds.Column("sc-changes");
            changes.name = "show-changes";
            changes.SetShown(false);
            body.Add(changes);
            problems = Ds.Column("sc-problems");
            body.Add(problems);

            footer.Clear();
            footer.Add(Ds.Spacer());
            Button cancel = Ds.Button("Cancel", () => handle?.Close(), DsButtonKind.Ghost);
            cancel.name = "show-cancel";
            footer.Add(cancel);
            save = Ds.Button(IsEdit ? "Save changes" : "Add to calendar", () => _ = SaveAsync(), DsButtonKind.Primary, "check");
            save.name = "show-save";
            save.SetEnabled(false);
            footer.Add(save);
        }

        private void DrawSize()
        {
            sizeSlot.Clear();
            var choices = importances.Select(choice => (choice.Importance, choice.Label));
            sizeSlot.Add(ScheduleEditor.ChoiceField("Size", choices, Draft.Importance, picked =>
            {
                Draft.SetImportance(picked, importances);
                slots?.SetWithoutNotify(Draft.Slots);
                preShow?.SetWithoutNotify(Draft.PreShowSlots);
                DrawSize();
                RequestPreview();
            }, "show-size", $"{ScheduleEditor.SizeWords(Draft.Slots, Draft.PreShowSlots)} on the card. Bigger shows draw bigger crowds and cost more to put on."));
        }

        private void DrawPlace()
        {
            placeSlot.Clear();
            string home = Kit.Str(options, "homeRegionName");
            var regionOptions = new List<(string value, string label, string detail)> { (string.Empty, $"Home region ({home})", "Where your fans are") };
            regionOptions.AddRange(ScheduleEditor.RegionOptions(places).Where(option => option.value != Kit.Str(options, "homeRegionId")));
            string current = Draft.RegionId == null ? $"Home region ({home})"
                : regionOptions.FirstOrDefault(option => option.value == Draft.RegionId).label ?? Draft.RegionId;
            placeSlot.Add(ScheduleEditor.PickerField("Where", current, regionOptions, picked =>
            {
                Draft.RegionId = string.IsNullOrEmpty(picked) ? null : picked;
                Draft.VenueId = null;
                DrawPlace();
                _ = LoadVenues();
                RequestPreview();
            }, "show-region", "The venue is picked for each show when its card is set, unless you choose one under More options."));
        }

        private void BuildMore()
        {
            more.Clear();
            VisualElement pair = Ds.Row("sc-pair");
            slots = new NumberStepper("Main-card slots", Draft.Slots, 3, 12, value =>
            {
                Draft.Slots = value;
                Draft.FormatTouched = true;
                DrawSize();
                RequestPreview();
            }, "A show needs at least 3 slots", "A show can have at most 12 slots", "show-slots");
            preShow = new NumberStepper("Pre-show slots", Draft.PreShowSlots, 0, 3, value =>
            {
                Draft.PreShowSlots = value;
                Draft.FormatTouched = true;
                DrawSize();
                RequestPreview();
            }, "No pre-show", "At most 3 pre-show slots", "show-preshow");
            pair.Add(slots);
            pair.Add(preShow);
            more.Add(pair);
            more.Add(Ds.Text("The last main-card slot is the main event. Slots fill a card; there are no minutes.", "dsf-hint"));
            more.Add(ScheduleEditor.Switch("Televised", Draft.Televised, on =>
            {
                Draft.Televised = on;
                RequestPreview();
            }, "Shown on TV when you have a network deal that covers it.", "show-televised"));
            venueSlot = Ds.Column("sc-slot");
            more.Add(venueSlot);
            _ = LoadVenues();
            if (!IsEdit)
            {
                firstDate = new DateField("First show from", GameDate.TryParse(Draft.ActiveFrom, out GameDate from) ? from : effectiveFrom, effectiveFrom, maxDate, date =>
                {
                    Draft.ActiveFrom = date == effectiveFrom ? null : date.Iso;
                    RequestPreview();
                }, "show-first-date");
                more.Add(firstDate);
            }
        }

        private async Task LoadVenues()
        {
            if (venueSlot == null) return;
            string region = Draft.RegionId ?? Kit.Str(options, "homeRegionId");
            JToken answer = await ScheduleEditor.Places(promotionId, region);
            venues = answer;
            venueSlot.Clear();
            var venueOptions = new List<(string value, string label, string detail)> { (string.Empty, "Picked for each show", "The usual choice") };
            foreach (JToken venue in Kit.Arr(venues, "venues"))
            {
                string seats = $"{TextFormat.Number((long)(Kit.Num(venue, "capacity") ?? 0))} seats";
                venueOptions.Add((Kit.Str(venue, "venueId"), Kit.Str(venue, "name"),
                    Kit.Bool(venue, "available") ? seats : $"{seats} · {Kit.Str(venue, "unavailableReason")}"));
            }
            string current = Draft.VenueId == null ? "Picked for each show" : venueOptions.FirstOrDefault(option => option.value == Draft.VenueId).label ?? "Picked for each show";
            venueSlot.Add(ScheduleEditor.PickerField("Preferred venue", current, venueOptions, picked =>
            {
                Draft.VenueId = string.IsNullOrEmpty(picked) ? null : picked;
                _ = LoadVenues();
                RequestPreview();
            }, "show-venue"));
        }

        private void ToggleMore()
        {
            bool open = !moreOpen;
            moreOpen = open;
            more.SetShown(open);
            BusinessText(moreToggle, open ? "Fewer options" : "More options");
        }

        /// <summary>Opens or closes "More options" (tours).</summary>
        public void SetMore(bool open)
        {
            if (moreOpen != open) ToggleMore();
        }

        private static void BusinessText(Button button, string text)
        {
            Label label = button?.Q<Label>(className: "ds-btn__label");
            if (label != null) label.text = TextFormat.Upper(text);
        }

        private void RedrawChips(string name, string selected)
        {
            body.Query<Button>().ForEach(chip =>
            {
                if (chip.name != null && chip.name.StartsWith(name + "-", System.StringComparison.Ordinal))
                    chip.EnableInClassList("ds-chip--selected", chip.name == $"{name}-{selected}");
            });
        }

        // ---- Preview -------------------------------------------------------------------------------

        private void RequestPreview()
        {
            int ticket = ++version;
            upcoming?.SetLoading(true);
            save?.SetEnabled(false);
            Busy = true;
            body.schedule.Execute(() => _ = RunPreview(ticket)).StartingIn(150);
        }

        private async Task RunPreview(int ticket)
        {
            if (ticket != version) return;
            var args = new JObject
            {
                ["promotionId"] = promotionId,
                ["eventDefinitionId"] = IsEdit ? Kit.Str(stored, "eventDefinitionId") : null,
                ["draft"] = Draft.ToJson(),
                ["count"] = 5,
            };
            QueryResult<JToken> answer = await Kit.Game.Client.Query("calendar.previewDefinition", args);
            if (ticket != version) return;
            Busy = false;
            if (!answer.Ok)
            {
                ShowProblems(new[] { Kit.Reasons(answer.Reasons) });
                return;
            }
            Preview = answer.Data;
            FieldReasons reasons = FieldReasons.FromJson(Kit.Obj(Preview, "reasons"));
            List<GameDate> dates = Kit.Arr(Preview, "nextDates")
                .Select(date => GameDate.TryParse((string)date, out GameDate parsed) ? parsed : (GameDate?)null)
                .Where(date => date.HasValue).Select(date => date.Value).ToList();
            upcoming.SetDates(Kit.Str(Preview, "recurrenceText"), dates);

            nameField.SetError(nameTouched || IsEdit ? reasons.For("name") : null);
            slots?.SetError(reasons.For("format.slots"));
            preShow?.SetError(reasons.For("format.preShowSlots"));
            firstDate?.SetError(reasons.For("activeFrom"));
            string placeProblem = reasons.For("preferredRegionId") ?? reasons.For("preferredVenueId");
            if (placeProblem != null && !moreOpen && reasons.For("preferredVenueId") != null) SetMore(true);
            ShowProblems(reasons.Others(new[] { "name", "format.slots", "format.preShowSlots", "activeFrom" })
                .Where(message => !(message == reasons.For("name") && !nameTouched && !IsEdit)));
            if ((reasons.For("format.slots") != null || reasons.For("format.preShowSlots") != null) && !moreOpen) SetMore(true);

            bool differs = Draft.DiffersFrom(original);
            DrawChanges(differs ? Kit.Obj(Preview, "plan") : null);
            save.SetEnabled(reasons.Count == 0 && (!IsEdit || differs) && !saving);
        }

        private void ShowProblems(IEnumerable<string> messages)
        {
            problems.Clear();
            foreach (string message in messages.Where(text => !string.IsNullOrEmpty(text)).Distinct())
                problems.Add(ScheduleEditor.Notice(DsState.Bad, message));
        }

        private void DrawChanges(JToken plan)
        {
            changes.Clear();
            if (!IsEdit || plan == null || plan.Type == JTokenType.Null)
            {
                changes.SetShown(false);
                return;
            }
            changes.SetShown(true);
            changes.Add(Ds.SectionHeader("What changes"));
            List<string> added = Kit.Arr(plan, "add").Select(date => (string)date).ToList();
            List<JToken> removed = Kit.Arr(plan, "remove").ToList();
            List<JToken> refreshed = Kit.Arr(plan, "refresh").ToList();
            List<JToken> kept = Kit.Arr(plan, "kept").ToList();
            if (added.Count == 0 && removed.Count == 0 && refreshed.Count == 0 && kept.Count == 0)
            {
                changes.Add(Ds.Text("No upcoming show changes. Only the show's details are updated.", "dsf-hint"));
                return;
            }
            if (added.Count > 0)
                changes.Add(ChangeLine(DsState.Good, "add", $"+{added.Count} new {Plural(added.Count, "date")}", ScheduleEditor.DateList(added, 6), "changes-added"));
            if (removed.Count > 0)
                changes.Add(ChangeLine(DsState.Bad, "decrease", $"−{removed.Count} {Plural(removed.Count, "date")} removed",
                    ScheduleEditor.DateList(removed.Select(row => Kit.Str(row, "date")), 6), "changes-removed"));
            if (refreshed.Count > 0)
                changes.Add(ChangeLine(DsState.Info, "edit", $"{refreshed.Count} upcoming {Plural(refreshed.Count, "show")} updated",
                    "They take the new name, size or place.", "changes-updated"));
            if (kept.Count > 0)
            {
                changes.Add(ChangeLine(DsState.Gold, "lock", $"{kept.Count} {Plural(kept.Count, "show")} kept as they are",
                    "Already booked, carded, run or taped: Save never changes them.", "changes-kept"));
                VisualElement list = Ds.Column("sc-kept");
                foreach (JToken row in kept.Take(8))
                {
                    VisualElement line = Ds.Row("sc-kept__row");
                    string date = Kit.Str(row, "date");
                    line.Add(Ds.Text(GameDate.TryParse(date, out GameDate day) ? UpcomingDates.ShortDay(day) : date, "sc-kept__date"));
                    line.Add(Ds.Text(Kit.Str(row, "name"), "sc-kept__name"));
                    line.Add(Ds.Pill(DsState.Gold, Kit.Str(row, "reasonText"), "lock"));
                    string id = Kit.Str(row, "eventInstanceId");
                    Button open = Ds.Button("Open", () => ShowSheet.Open(context, id), DsButtonKind.Ghost);
                    open.AddToClassList("ds-btn--link");
                    line.Add(open);
                    list.Add(line);
                }
                changes.Add(list);
            }
        }

        private static VisualElement ChangeLine(DsState state, string icon, string title, string detail, string name)
        {
            VisualElement line = Ds.Row("sc-change", Ds.StateClass(state)).Named(name);
            line.Add(new Icon(icon, "ds-icon--sm", "sc-change__icon"));
            VisualElement words = Ds.Column("sc-change__words");
            words.Add(Ds.Text(title, "sc-change__title"));
            if (!string.IsNullOrEmpty(detail)) words.Add(Ds.Text(detail, "sc-change__detail"));
            line.Add(words);
            return line;
        }

        private static string Plural(int count, string word) => count == 1 ? word : word + "s";

        // ---- Save ----------------------------------------------------------------------------------

        /// <summary>Saves the draft (tours call it); null when it worked, else the engine's words.</summary>
        public async Task<string> SaveAsync()
        {
            if (saving) return "Already saving";
            nameTouched = true;
            saving = true;
            save.SetEnabled(false);
            Busy = true;
            (JToken data, string problem) = IsEdit
                ? await ScheduleEditor.Run("calendar.updateDefinition", new JObject { ["eventDefinitionId"] = Kit.Str(stored, "eventDefinitionId"), ["draft"] = Draft.ToJson() })
                : await ScheduleEditor.Run("calendar.createDefinition", new JObject { ["promotionId"] = promotionId, ["draft"] = Draft.ToJson() });
            saving = false;
            Busy = false;
            if (problem != null)
            {
                ShowProblems(new[] { problem });
                RequestPreview();
                return problem;
            }
            Saved = data;
            Debug.Log($"[Schedule] saved {(IsEdit ? "changes to" : "new show")} {Draft.Name.Trim()}");
            ShowSaved(data);
            return null;
        }

        private void ShowSaved(JToken data)
        {
            body.Clear();
            List<string> added = Kit.Arr(data, "added").Select(date => (string)date).ToList();
            VisualElement hero = Ds.Row("sc-saved");
            hero.Add(new Icon("check-circle", "ds-icon--lg", "sc-saved__icon"));
            VisualElement words = Ds.Column("sc-saved__words");
            words.Add(Ds.Text(IsEdit ? "Changes saved" : $"{Draft.Name.Trim()} is on the calendar", "sc-saved__title"));
            string upcomingText = Kit.Str(Preview, "recurrenceText");
            words.Add(Ds.Text(IsEdit ? upcomingText : $"{upcomingText}. New dates keep being added as the year goes on.", "dsf-hint"));
            hero.Add(words);
            body.Add(hero);
            if (added.Count > 0) body.Add(ChangeLine(DsState.Good, "add", $"+{added.Count} {Plural(added.Count, "date")} added", ScheduleEditor.DateList(added, 6), "saved-added"));
            if (IsEdit)
            {
                List<string> removed = Kit.Arr(data, "removed").Select(date => (string)date).ToList();
                if (removed.Count > 0) body.Add(ChangeLine(DsState.Bad, "decrease", $"−{removed.Count} {Plural(removed.Count, "date")} removed", ScheduleEditor.DateList(removed, 6), "saved-removed"));
                int kept = Kit.Arr(data, "kept").Count();
                if (kept > 0) body.Add(ChangeLine(DsState.Gold, "lock", $"{kept} {Plural(kept, "show")} kept as they were", null, "saved-kept"));
            }
            footer.Clear();
            footer.Add(Ds.Spacer());
            string first = added.FirstOrDefault() ?? (string)Kit.Arr(Preview, "nextDates").FirstOrDefault();
            Button calendar = Ds.Button("Show on calendar", () =>
            {
                handle?.Close();
                ScheduleEditor.ShowOnCalendar(context, first);
            }, DsButtonKind.Ghost, "calendar");
            calendar.name = "show-saved-calendar";
            footer.Add(calendar);
            Button done = Ds.Button("Done", () => handle?.Close(), DsButtonKind.Primary);
            done.name = "show-saved-done";
            footer.Add(done);
        }

        /// <summary>Closes the sheet.</summary>
        public void Close() => handle?.Close();
    }
}
