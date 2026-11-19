using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// Booking (the web's BookingView): pick one of your upcoming shows (<c>booking.shows</c>), see its
    /// card by slot (<c>booking.card</c>) with each segment's sides, type, time and planned result,
    /// add or edit segments in the editor sheet, plan results inline, Auto-fill
    /// (<c>aip.autoFillCard</c>), clear the card, read the checklist (<c>booking.validate</c>) and run
    /// the show: Go live (show night screen) or Run the show (<c>shows.runTonight</c>).
    /// </summary>
    public static class BookingScreen
    {
        public static VisualElement Build(ScreenContext context)
        {
            VisualElement screen = Kit.Screen("booking", "Booking");
            VisualElement host = Ui.El("rb-booking");
            screen.Add(host);
            Kit.Live(host, () => Render(host, context));
            return screen;
        }

        private static async Task Render(VisualElement host, ScreenContext context)
        {
            EngineClient client = Kit.Game.Client;
            QueryResult<JToken> shows = await client.Query("booking.shows", new JObject { ["limit"] = 12 });
            host.Clear();
            if (!shows.Ok)
            {
                host.Add(Kit.Error(Kit.Reasons(shows.Reasons)));
                return;
            }
            List<JToken> rows = Kit.Arr(shows.Data, "rows").ToList();
            if (rows.Count == 0)
            {
                host.Add(Kit.Note("You have no shows coming up to book. Shows are scheduled on the calendar."));
                return;
            }

            string eventId = context.Route.Param("event");
            JToken selected = rows.FirstOrDefault(row => Kit.Str(row, "eventInstanceId") == eventId)
                ?? rows.FirstOrDefault(row => Kit.Bool(row, "needsBooking")) ?? rows[0];
            eventId = Kit.Str(selected, "eventInstanceId");

            VisualElement picker = Ui.El("rb-show-picker").Named("booking-shows");
            foreach (JToken row in rows)
            {
                string id = Kit.Str(row, "eventInstanceId");
                Button chip = Ui.Button(string.Empty, () => context.Navigator.Go(ShellRoute.With("booking", "event", id)), "choice-chip", "rb-show-pick");
                chip.name = $"booking-show-{id}";
                VisualElement text = Ui.El("rb-show-pick__text");
                text.Add(Ui.Text(Kit.Str(row, "name"), "choice-chip__label"));
                text.Add(Ui.Text($"{Kit.Date(Kit.Str(row, "date"))} · {Kit.Num(row, "filledMain")}/{Kit.Num(row, "slots")}", "choice-chip__detail"));
                if (Kit.Bool(row, "needsBooking")) text.Add(Kit.Badge("Book", "badge--action"));
                chip.Add(text);
                PromotionLogos.PrependShow(chip, id, null, null, "rb-logo--sm");
                chip.EnableInClassList("choice-chip--selected", id == eventId);
                picker.Add(chip);
            }
            host.Add(picker);

            QueryResult<JToken> cardAnswer = await client.Query("booking.card", new JObject { ["eventInstanceId"] = eventId });
            QueryResult<JToken> validation = await client.Query("booking.validate", new JObject { ["eventInstanceId"] = eventId });
            if (!cardAnswer.Ok)
            {
                host.Add(Kit.Error(Kit.Reasons(cardAnswer.Reasons)));
                return;
            }
            JToken card = cardAnswer.Data;
            JToken live = null;
            if (Kit.Bool(card, "runsTonight"))
            {
                QueryResult<JToken> liveAnswer = await client.Query("shows.liveState", new JObject { ["eventInstanceId"] = eventId });
                if (liveAnswer.Ok) live = liveAnswer.Data;
            }
            JToken checks = validation.Ok ? validation.Data : null;

            Label feedback = Kit.Feedback();
            host.Add(ShowBar(card, checks, live, eventId, context, feedback));
            host.Add(feedback);

            VisualElement columns = Kit.Columns();
            VisualElement main = Ui.El("rb-column", "rb-column--wide");
            VisualElement side = Ui.El("rb-column");
            columns.With(main, side);
            host.Add(columns);

            bool canEdit = Kit.Bool(card, "canEdit");
            if (!canEdit && Kit.Str(card, "editBlock") is string block) main.Add(Kit.Note(block));
            foreach (JToken section in Kit.Arr(card, "sections"))
            {
                bool preShow = Kit.Bool(section, "preShow");
                Kit.Panel(main, preShow ? "Pre-show" : "Main card", out VisualElement body);
                foreach (JToken slot in Kit.Arr(section, "slots")) body.Add(Slot(slot, card, checks, canEdit, context, feedback));
            }
            Checklist(side, checks);
        }

        private static VisualElement ShowBar(JToken card, JToken checks, JToken live, string eventId, ScreenContext context, Label feedback)
        {
            JToken show = Kit.Obj(card, "show");
            VisualElement bar = Ui.El("card", "rb-showbar").Named("booking-showbar");
            PromotionLogos.PrependShow(bar, eventId, null, Kit.Str(show, "promotionId"), "rb-logo--lg");
            VisualElement info = Ui.El("rb-showbar__info");
            info.Add(Ui.Text(TextFormat.Upper(Kit.Str(show, "name")), "rb-title"));
            double days = Kit.Num(show, "daysUntil") ?? 0;
            string when = days <= 0 ? "Tonight" : days == 1 ? "Tomorrow" : $"In {days} days";
            info.Add(Kit.Note($"{when} · {Kit.Date(Kit.Str(show, "date"), true)} · {Kit.Str(show, "brandName") ?? "No brand"} · {Kit.Capital(Kit.Str(show, "importance"))}{(Kit.Bool(show, "televised") ? " · Televised" : string.Empty)}"));
            bar.Add(info);

            VisualElement actions = Ui.El("rb-row", "rb-showbar__actions");
            bool canEdit = Kit.Bool(card, "canEdit");
            if (canEdit)
            {
                Button fill = Ui.Btn("AUTO-FILL", async () =>
                {
                    CommandResult<JToken> result = await Kit.Run("aip.autoFillCard", new JObject { ["eventInstanceId"] = eventId, ["keepFilledSlots"] = true }, feedback);
                    if (result.Ok) await PlanAutoResults(eventId);
                }, null);
                fill.name = "booking-autofill";
                fill.tooltip = "Fill the empty slots the way the computer would book them; matches get an Auto result";
                actions.Add(fill);
                Button clear = Ui.Btn("CLEAR CARD", async () => await Kit.Run("booking.clearCard", new JObject { ["eventInstanceId"] = eventId }, feedback), "btn--ghost");
                clear.name = "booking-clear";
                actions.Add(clear);
            }

            bool tonight = Kit.Bool(card, "runsTonight");
            bool underWay = Kit.Str(live, "stage") == "live";
            bool goesLive = Kit.Str(live, "mode") == "live" || underWay;
            if (tonight || underWay)
            {
                bool runnable = checks != null && Kit.Bool(checks, "runnable");
                Button run = Ui.Btn(underWay ? "BACK TO THE SHOW" : goesLive ? "GO LIVE" : "RUN THE SHOW", async () =>
                {
                    if (goesLive)
                    {
                        context.Navigator.Go(ShellRoute.With(ScreenIds.ShowNight, "event", eventId));
                        return;
                    }
                    CommandResult<JToken> result = await Kit.Run("shows.runTonight", new JObject { ["eventInstanceId"] = eventId }, feedback);
                    if (result.Ok) context.Navigator.Go(ShellRoute.With(ScreenIds.ShowResults, "event", eventId));
                }, "btn--primary");
                run.name = "booking-run";
                run.SetEnabled(runnable || underWay || goesLive);
                if (!runnable && !underWay) run.tooltip = "Fix the problems in the checklist first";
                actions.Add(run);
            }
            bar.Add(actions);
            return bar;
        }

        /// <summary>Auto-fill leaves results open; plan Auto for every match without one so the card can run.</summary>
        public static async Task PlanAutoResults(string eventId)
        {
            EngineClient client = Kit.Game.Client;
            QueryResult<JToken> card = await client.Query("booking.card", new JObject { ["eventInstanceId"] = eventId });
            if (!card.Ok) return;
            foreach (JToken slot in Kit.Arr(card.Data, "sections").SelectMany(section => Kit.Arr(section, "slots")))
            {
                JToken segment = Kit.Obj(slot, "segment");
                if (segment == null || Kit.Str(segment, "kind") != "match") continue;
                if (PlannedResult(segment) != null) continue;
                await client.Command("booking.setResult", new JObject { ["segmentId"] = Kit.Str(segment, "segmentId"), ["result"] = "auto" });
            }
        }

        /// <summary>The Result-list choice a match holds: an outcome object, "auto"/"random", or null.</summary>
        public static JToken PlannedResult(JToken segment)
        {
            JToken draft = Kit.Obj(segment, "draft");
            JToken outcome = Kit.Obj(draft, "outcome");
            if (outcome != null) return outcome;
            string plan = Kit.Str(draft, "match.resultPlan");
            return plan == null ? null : new JValue(plan);
        }

        public static string ResultText(JToken result, JToken segment)
        {
            if (result == null) return "No result planned";
            if (result.Type == JTokenType.String) return (string)result == "auto" ? "Auto" : "Random";
            string kind = Kit.Str(result, "kind");
            if (kind == "draw") return "Draw";
            if (kind == "noContest") return "No contest";
            int side = (int)(Kit.Num(result, "winningSide") ?? 0);
            string name = Kit.Arr(segment, "sides").Where(entry => (int)(Kit.Num(entry, "side") ?? -1) == side).Select(entry => Kit.Str(entry, "name")).FirstOrDefault();
            return $"{name ?? $"Side {side + 1}"} wins";
        }

        private static VisualElement Slot(JToken slot, JToken card, JToken checks, bool canEdit, ScreenContext context, Label feedback)
        {
            bool preShow = Kit.Bool(slot, "preShow");
            int slotIndex = (int)(Kit.Num(slot, "slot") ?? 0);
            JToken segment = Kit.Obj(slot, "segment");
            VisualElement row = Ui.El("rb-slot").Named($"slot-{(preShow ? "pre" : "main")}-{slotIndex}");

            VisualElement head = Ui.El("rb-slot__head");
            head.Add(Ui.Text(Kit.Num(slot, "displayNumber")?.ToString() ?? string.Empty, "rb-slot__number"));
            head.Add(Ui.El("rb-cell-stack").With(
                Ui.Text(TextFormat.Upper(Kit.Str(slot, "roleLabel")), "section-label"),
                Ui.El("rb-row", "rb-row--tight").With(
                    Ui.Text(TimeText(slot), "t-xs", "t-muted"),
                    Kit.WhyTrace("Slot role", 0, Kit.Obj(slot, "roleTrace"), null, "Why this slot role"))));
            row.Add(head);

            VisualElement content = Ui.El("rb-slot__content");
            row.Add(content);
            string segmentId = Kit.Str(segment, "segmentId");

            if (segment == null)
            {
                content.Add(Ui.Text("Empty", "t-muted", "t-sm"));
                if (canEdit)
                {
                    VisualElement add = Ui.El("rb-row", "rb-row--tight", "rb-row--wrap");
                    add.Add(Ui.Btn("+ Match", () => SegmentEditor.Open(context, card, preShow, slotIndex, null, "match"), "btn--link").Named($"add-match-{slotIndex}"));
                    add.Add(Ui.Btn("+ Talking segment", () => SegmentEditor.Open(context, card, preShow, slotIndex, null, "angle"), "btn--link"));
                    content.Add(add);
                }
            }
            else
            {
                bool match = Kit.Str(segment, "kind") == "match";
                string sides = string.Join(match ? " vs " : " & ", Kit.Arr(segment, "sides").Select(side => Kit.Str(side, "name")));
                content.Add(Ui.Text(Kit.Str(segment, "label") ?? sides, "t-ui-semibold", "t-wrap"));
                var details = new List<string> { Kit.Str(segment, "typeName") };
                if (Kit.Str(segment, "talkLine") is string talk && !match) details.Add(talk);
                details.AddRange(Kit.Arr(segment, "titles").Select(title => Kit.Str(title, "name")));
                if (Kit.Arr(segment, "storylineIds").Any()) details.Add("Storyline");
                content.Add(Ui.Text(string.Join(" · ", details.Where(text => !string.IsNullOrEmpty(text))), "t-xs", "t-muted", "t-wrap"));

                foreach (JToken issue in IssuesFor(checks, segmentId))
                {
                    content.Add(Ui.Text(Kit.Str(issue, "message"), "t-xs", Kit.Str(issue, "severity") == "error" ? "t-negative" : "rb-warning", "t-wrap"));
                }

                VisualElement actions = Ui.El("rb-row", "rb-row--tight", "rb-row--wrap", "rb-slot__actions");
                if (match)
                {
                    JToken planned = PlannedResult(segment);
                    Label result = Ui.Text("Result: " + ResultText(planned, segment), "t-sm", planned == null ? "t-negative" : "t-data");
                    actions.Add(result);
                    if (canEdit)
                    {
                        actions.Add(Ui.Btn("Set Auto", async () => await Kit.Run("booking.setResult", new JObject { ["segmentId"] = segmentId, ["result"] = "auto" }, feedback), "btn--link"));
                        actions.Add(Ui.Btn("Set Random", async () => await Kit.Run("booking.setResult", new JObject { ["segmentId"] = segmentId, ["result"] = "random" }, feedback), "btn--link"));
                    }
                }
                if (canEdit)
                {
                    actions.Add(Ui.El("rb-spacer"));
                    actions.Add(Ui.Btn("Edit", () => SegmentEditor.Open(context, card, preShow, slotIndex, segment, Kit.Str(segment, "kind")), "btn--link").Named($"edit-{slotIndex}"));
                    actions.Add(Ui.Btn("Remove", async () => await Kit.Run("booking.removeSegment", new JObject { ["segmentId"] = segmentId }, feedback), "btn--link"));
                }
                content.Add(actions);
            }
            return row;
        }

        private static string TimeText(JToken slot)
        {
            string booked = Kit.Str(slot, "bookedTime");
            string usual = Kit.Str(slot, "durationLabel");
            return booked == null ? $"{usual} time" : $"{Kit.Capital(booked)} time (set)";
        }

        private static IEnumerable<JToken> IssuesFor(JToken checks, string segmentId)
        {
            if (checks == null || segmentId == null) return Enumerable.Empty<JToken>();
            return Kit.Arr(checks, "errors").Concat(Kit.Arr(checks, "warnings"))
                .Where(issue => Kit.Str(issue, "subject.id") == segmentId || Kit.Str(issue, "segmentId") == segmentId);
        }

        private static void Checklist(VisualElement parent, JToken checks)
        {
            Kit.Panel(parent, "Checklist", out VisualElement body).Named("booking-checklist");
            if (checks == null)
            {
                body.Add(Kit.Note("The checklist could not be read."));
                return;
            }
            body.Add(Ui.Text(Kit.Bool(checks, "runnable") ? "Ready to run." : "Not ready to run yet.", "t-sm", Kit.Bool(checks, "runnable") ? "t-positive" : "t-negative"));
            foreach (JToken item in Kit.Arr(checks, "checklist"))
            {
                bool passed = Kit.Bool(item, "passed");
                bool error = Kit.Str(item, "severity") == "error";
                VisualElement line = Ui.El("rb-check");
                line.Add(Ui.Text(passed ? "✓" : error ? "✕" : "!", "rb-check__mark", passed ? "t-positive" : error ? "t-negative" : "rb-warning"));
                VisualElement text = Ui.El("rb-cell-stack");
                text.Add(Ui.El("rb-row", "rb-row--tight").With(
                    Ui.Text(Kit.Str(item, "label"), "t-sm", "t-wrap"),
                    Kit.WhyTrace(Kit.Str(item, "label"), Kit.Num(item, "trace.value") ?? 0, Kit.Obj(item, "trace"))));
                if (!passed && Kit.Str(item, "detail") is string detail) text.Add(Ui.Text(detail, "t-xs", "t-muted", "t-wrap"));
                line.Add(text);
                body.Add(line);
            }
            List<JToken> warnings = Kit.Arr(checks, "warnings").ToList();
            if (warnings.Count > 0)
            {
                body.Add(Ui.Text(TextFormat.Upper("Warnings"), "section-label", "rb-gap-top"));
                foreach (JToken warning in warnings) body.Add(Ui.Text(Kit.Str(warning, "message"), "t-xs", "rb-warning", "t-wrap"));
            }
        }
    }
}
