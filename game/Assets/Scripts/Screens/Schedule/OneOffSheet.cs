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
    /// The one-off special sheet (EVT8-04): a single big night (a PPV) on a date the player picks.
    /// Name, date, size (Major event by default, with its card size), where and, one step away, the
    /// slot counts, a venue and the brand. Live checks from <c>calendar.checkNewShow</c> put the
    /// engine's refusals under their field and its warnings ("you already have a show that night")
    /// in a quiet row; Create runs <c>calendar.addOneOff</c> and opens the new show.
    /// </summary>
    public sealed class OneOffSheet
    {
        public static OneOffSheet Current { get; private set; }

        private readonly ScreenContext context;
        private readonly string promotionId;
        private readonly VisualElement body = Ds.Column("sc-editor");
        private readonly VisualElement footer = Ds.Row("sc-footer");
        private JToken options;
        private JToken places;
        private List<ImportanceChoice> importances = new List<ImportanceChoice>();
        private GameDate effectiveFrom;
        private GameDate maxDate;
        private OverlayHandle handle;

        private DsTextField nameField;
        private DateField dateField;
        private VisualElement sizeSlot;
        private VisualElement placeSlot;
        private VisualElement venueSlot;
        private NumberStepper slots;
        private NumberStepper preShow;
        private VisualElement more;
        private Button moreToggle;
        private bool moreOpen;
        private VisualElement warnings;
        private VisualElement problems;
        private Button create;
        private bool nameTouched;
        private bool saving;
        private int version;

        private OneOffSheet(ScreenContext context, string promotionId)
        {
            this.context = context;
            this.promotionId = promotionId;
        }

        public SpecialDraft Draft { get; } = new SpecialDraft();

        public JToken Check { get; private set; }

        public bool Busy { get; private set; }

        /// <summary>The new show's id once Create worked.</summary>
        public string CreatedId { get; private set; }

        public static async void Open(ScreenContext context, string promotionId)
        {
            var sheet = new OneOffSheet(context, promotionId);
            Current = sheet;
            await sheet.Build();
        }

        private async Task Build()
        {
            ScheduleEditor.Style(body);
            body.Add(Ds.Loading("Loading your schedule…"));
            handle = ScheduleEditor.Sheet(context, "New one-off special", body, footer, "Your schedule", 600f, "schedule-special");
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
            Draft.Date = SpecialDraft.DefaultDate(effectiveFrom).Iso;
            Draft.SetImportance("major", importances);
            BuildForm();
            RequestCheck();
        }

        private void BuildForm()
        {
            body.Clear();
            body.Add(Ds.Text("One big night on a date you pick. It goes on the calendar like any other show, and you book its card the same way.", "sc-lead"));
            nameField = new DsTextField("Name", Draft.Name, value =>
            {
                Draft.Name = value;
                nameTouched = true;
                RequestCheck();
            }, null, "special-name", 60, "e.g. New Year Bash");
            body.Add(nameField);

            GameDate.TryParse(Draft.Date, out GameDate date);
            dateField = new DateField("Date", date, effectiveFrom, maxDate, picked =>
            {
                Draft.Date = picked.Iso;
                _ = LoadVenues();
                RequestCheck();
            }, "special-date");
            body.Add(dateField);

            sizeSlot = Ds.Column("sc-slot");
            body.Add(sizeSlot);
            DrawSize();
            placeSlot = Ds.Column("sc-slot");
            body.Add(placeSlot);
            DrawPlace();

            warnings = Ds.Column("sc-warnings").Named("special-warnings");
            body.Add(warnings);

            moreToggle = Ds.Button("More options", ToggleMore, DsButtonKind.Ghost, "chevron-down");
            moreToggle.name = "special-more-toggle";
            moreToggle.AddToClassList("sc-more-toggle");
            body.Add(moreToggle);
            more = Ds.Column("sc-more").Named("special-more");
            more.SetShown(false);
            body.Add(more);
            BuildMore();

            problems = Ds.Column("sc-problems");
            body.Add(problems);

            footer.Clear();
            footer.Add(Ds.Spacer());
            Button cancel = Ds.Button("Cancel", () => handle?.Close(), DsButtonKind.Ghost);
            cancel.name = "special-cancel";
            footer.Add(cancel);
            create = Ds.Button("Add to calendar", () => _ = CreateAsync(), DsButtonKind.Primary, "check");
            create.name = "special-create";
            create.SetEnabled(false);
            footer.Add(create);
        }

        private void DrawSize()
        {
            sizeSlot.Clear();
            sizeSlot.Add(ScheduleEditor.ChoiceField("Size", importances.Select(choice => (choice.Importance, choice.Label)), Draft.Importance, picked =>
            {
                Draft.SetImportance(picked, importances);
                slots?.SetWithoutNotify(Draft.Slots);
                preShow?.SetWithoutNotify(Draft.PreShowSlots);
                DrawSize();
                RequestCheck();
            }, "special-size", $"{ScheduleEditor.SizeWords(Draft.Slots, Draft.PreShowSlots)} on the card."));
        }

        private void DrawPlace()
        {
            placeSlot.Clear();
            string home = Kit.Str(options, "homeRegionName");
            var regionOptions = new List<(string value, string label, string detail)> { (string.Empty, $"Home region ({home})", "Where your fans are") };
            regionOptions.AddRange(ScheduleEditor.RegionOptions(places).Where(option => option.value != Kit.Str(options, "homeRegionId")));
            string current = Draft.RegionId == null ? $"Home region ({home})" : regionOptions.FirstOrDefault(option => option.value == Draft.RegionId).label ?? Draft.RegionId;
            placeSlot.Add(ScheduleEditor.PickerField("Where", current, regionOptions, picked =>
            {
                Draft.RegionId = string.IsNullOrEmpty(picked) ? null : picked;
                Draft.VenueId = null;
                DrawPlace();
                _ = LoadVenues();
                RequestCheck();
            }, "special-region"));
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
                RequestCheck();
            }, "A show needs at least 3 slots", "A show can have at most 12 slots", "special-slots");
            preShow = new NumberStepper("Pre-show slots", Draft.PreShowSlots, 0, 3, value =>
            {
                Draft.PreShowSlots = value;
                Draft.FormatTouched = true;
                DrawSize();
                RequestCheck();
            }, "No pre-show", "At most 3 pre-show slots", "special-preshow");
            pair.Add(slots);
            pair.Add(preShow);
            more.Add(pair);
            venueSlot = Ds.Column("sc-slot");
            more.Add(venueSlot);
            _ = LoadVenues();
            List<JToken> brands = Kit.Arr(options, "brands").Where(brand => Kit.Bool(brand, "active")).ToList();
            if (brands.Count > 0)
            {
                var choices = new List<(string, string)> { (string.Empty, "Whole promotion") };
                choices.AddRange(brands.Select(brand => (Kit.Str(brand, "brandId"), Kit.Str(brand, "name"))));
                more.Add(ScheduleEditor.ChoiceField("Brand", choices, Draft.BrandId ?? string.Empty, picked =>
                {
                    Draft.BrandId = string.IsNullOrEmpty(picked) ? null : picked;
                    body.Query<Button>().ForEach(chip =>
                    {
                        if (chip.name != null && chip.name.StartsWith("special-brand-", System.StringComparison.Ordinal))
                            chip.EnableInClassList("ds-chip--selected", chip.name == "special-brand-" + (Draft.BrandId ?? string.Empty));
                    });
                    RequestCheck();
                }, "special-brand"));
            }
        }

        private async Task LoadVenues()
        {
            if (venueSlot == null) return;
            string region = Draft.RegionId ?? Kit.Str(options, "homeRegionId");
            JToken answer = await ScheduleEditor.Places(promotionId, region, Draft.Date);
            venueSlot.Clear();
            var venueOptions = new List<(string value, string label, string detail)> { (string.Empty, "No venue yet", "Picked when the card is set") };
            foreach (JToken venue in Kit.Arr(answer, "venues"))
            {
                string seats = $"{TextFormat.Number((long)(Kit.Num(venue, "capacity") ?? 0))} seats";
                venueOptions.Add((Kit.Str(venue, "venueId"), Kit.Str(venue, "name"), Kit.Bool(venue, "available") ? seats : $"{seats} · {Kit.Str(venue, "unavailableReason")}"));
            }
            string current = Draft.VenueId == null ? "No venue yet" : venueOptions.FirstOrDefault(option => option.value == Draft.VenueId).label ?? "No venue yet";
            venueSlot.Add(ScheduleEditor.PickerField("Venue", current, venueOptions, picked =>
            {
                Draft.VenueId = string.IsNullOrEmpty(picked) ? null : picked;
                _ = LoadVenues();
                RequestCheck();
            }, "special-venue"));
        }

        private void ToggleMore()
        {
            moreOpen = !moreOpen;
            more.SetShown(moreOpen);
            Label label = moreToggle.Q<Label>(className: "ds-btn__label");
            if (label != null) label.text = TextFormat.Upper(moreOpen ? "Fewer options" : "More options");
        }

        public void SetMore(bool open)
        {
            if (moreOpen != open) ToggleMore();
        }

        /// <summary>Sets the name and date as if typed (tours).</summary>
        public void Fill(string name, GameDate date)
        {
            nameField.Input.value = name;
            dateField.Set(date);
        }

        // ---- Checks --------------------------------------------------------------------------------

        private void RequestCheck()
        {
            int ticket = ++version;
            create?.SetEnabled(false);
            Busy = true;
            body.schedule.Execute(() => _ = RunCheck(ticket)).StartingIn(150);
        }

        private async Task RunCheck(int ticket)
        {
            if (ticket != version) return;
            if (Draft.Date == null)
            {
                Busy = false;
                return;
            }
            QueryResult<JToken> answer = await Kit.Game.Client.Query("calendar.checkNewShow", new JObject { ["show"] = Draft.ToJson(promotionId) });
            if (ticket != version) return;
            Busy = false;
            problems.Clear();
            if (!answer.Ok)
            {
                problems.Add(ScheduleEditor.Notice(DsState.Bad, Kit.Reasons(answer.Reasons)));
                return;
            }
            Check = answer.Data;
            FieldReasons reasons = FieldReasons.FromJson(Kit.Obj(Check, "reasons"));
            nameField.SetError(nameTouched ? reasons.For("name") : null);
            dateField.SetError(reasons.For("date"));
            slots.SetError(reasons.For("format.slots"));
            preShow.SetError(reasons.For("format.preShowSlots"));
            if ((reasons.For("format.slots") ?? reasons.For("format.preShowSlots") ?? reasons.For("venueId") ?? reasons.For("brandId")) != null) SetMore(true);
            foreach (string message in reasons.Others(new[] { "name", "date", "format.slots", "format.preShowSlots" }).Distinct())
                problems.Add(ScheduleEditor.Notice(DsState.Bad, message));
            warnings.Clear();
            foreach (JToken warning in Kit.Arr(Check, "warnings"))
                warnings.Add(ScheduleEditor.Notice(DsState.Warn, Kit.Str(warning, "message"), "warning"));
            create.SetEnabled(reasons.Count == 0 && !saving);
        }

        // ---- Create --------------------------------------------------------------------------------

        /// <summary>Adds the special (tours call it); null when it worked, else the engine's words.</summary>
        public async Task<string> CreateAsync()
        {
            if (saving) return "Already saving";
            nameTouched = true;
            saving = true;
            create.SetEnabled(false);
            Busy = true;
            (JToken data, string problem) = await ScheduleEditor.Run("calendar.addOneOff", Draft.ToJson(promotionId));
            saving = false;
            Busy = false;
            if (problem != null)
            {
                problems.Clear();
                problems.Add(ScheduleEditor.Notice(DsState.Bad, problem));
                RequestCheck();
                return problem;
            }
            CreatedId = Kit.Str(data, "eventInstanceId");
            Debug.Log($"[Schedule] added special {Draft.Name.Trim()} on {Draft.Date}");
            handle?.Close();
            ScheduleEditor.ShowOnCalendar(context, Draft.Date);
            if (CreatedId != null) ShowSheet.Open(context ?? new ScreenContext(ShellRoute.To("calendar"), ShellController.Current.Navigator, ShellController.Current.Overlay), CreatedId);
            return null;
        }
    }
}
