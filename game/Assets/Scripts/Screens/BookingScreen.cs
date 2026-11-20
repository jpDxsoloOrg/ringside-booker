using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// Booking as the approved fight card (UNITY-11 mockups 08/09, UNITY-20): the upcoming shows as
    /// chips (<c>booking.shows</c>), the show up top with its venue (<c>boxOffice.showVenue</c>; Change
    /// opens the venue picker) and the Time used bar (<c>booking.card</c>'s time: Short / Standard /
    /// Long per slot, never minutes), a quiet checklist pill (<c>booking.validate</c>) that opens the
    /// card check, Auto-fill (<c>aip.autoFillCard</c>), Clear and Go live. Below: one matchup card per
    /// slot in running order (drag the handle to reorder, <c>booking.moveSegment</c>) and the selected
    /// slot's details on the right (<see cref="BookingDetails"/>).
    /// </summary>
    public static class BookingScreen
    {
        /// <summary>What survives a redraw: the selected slot, the open "More options", the previews.</summary>
        internal sealed class State
        {
            public string EventId;
            public string Selected;
            public bool MoreOpen;
            public CardPeople People;
            public readonly Dictionary<string, (string key, float stars, JToken preview)> Previews = new Dictionary<string, (string, float, JToken)>();
        }

        public static VisualElement Build(ScreenContext context)
        {
            VisualElement screen = FightCardStyles.Apply(Ui.El("rb-screen", "fc-screen").Named("screen-booking"));
            VisualElement host = Ds.Column("fc-page").Named("booking-host");
            screen.Add(host);
            var state = new State();
            Kit.Live(host, () => Render(host, context, state));
            return screen;
        }

        internal static string SlotKey(bool preShow, int slot) => $"{(preShow ? "pre" : "main")}-{slot}";

        internal static string SlotKey(JToken slot) => SlotKey(Kit.Bool(slot, "preShow"), (int)(Kit.Num(slot, "slot") ?? 0));

        private static async Task Render(VisualElement host, ScreenContext context, State state)
        {
            EngineClient client = Kit.Game.Client;
            QueryResult<JToken> shows = await client.Query("booking.shows", new JObject { ["limit"] = 30 });
            if (!shows.Ok)
            {
                host.Clear();
                host.Add(Kit.Error(Kit.Reasons(shows.Reasons)));
                return;
            }
            List<JToken> rows = Kit.Arr(shows.Data, "rows").ToList();
            if (rows.Count == 0)
            {
                host.Clear();
                host.Add(Ds.Empty("calendar", "No shows to book", Kit.Str(shows.Data, "unavailableReason") ?? "You have no shows coming up. Shows are scheduled on the calendar.",
                    "Open the calendar", () => context.Navigator.Go(ShellRoute.To("calendar")), "calendar"));
                return;
            }

            string eventId = context.Route.Param("event") ?? state.EventId;
            JToken selectedShow = rows.FirstOrDefault(row => Kit.Str(row, "eventInstanceId") == eventId)
                ?? rows.FirstOrDefault(row => Kit.Str(row, "eventInstanceId") == Kit.Str(shows.Data, "nextToBookId"))
                ?? rows.FirstOrDefault(row => Kit.Bool(row, "needsBooking")) ?? rows[0];
            eventId = Kit.Str(selectedShow, "eventInstanceId");
            if (state.EventId != eventId)
            {
                state.EventId = eventId;
                state.Selected = null;
                state.MoreOpen = false;
                state.Previews.Clear();
            }

            var args = new JObject { ["eventInstanceId"] = eventId };
            (QueryResult<JToken> cardAnswer, QueryResult<JToken> validation, QueryResult<JToken> venue, QueryResult<JToken> liveRead, QueryResult<JToken> roster) = await client.Read("booking.card",
                reader => (reader.Query("booking.card", args), reader.Query("booking.validate", args), reader.Query("boxOffice.showVenue", args),
                    reader.Query("shows.liveState", args), reader.Query("roster.summary")));
            state.People ??= await CardPeople.LoadAsync();
            if (!cardAnswer.Ok)
            {
                host.Clear();
                host.Add(ShowStrip(rows, eventId, context));
                host.Add(Kit.Error(Kit.Reasons(cardAnswer.Reasons)));
                return;
            }
            JToken card = cardAnswer.Data;
            JToken live = null;
            if (Kit.Bool(card, "runsTonight") && liveRead.Ok) live = liveRead.Data;
            JToken checks = validation.Ok ? validation.Data : null;
            List<JToken> slots = Kit.Arr(card, "sections").SelectMany(section => Kit.Arr(section, "slots")).ToList();
            if (state.Selected == null || slots.All(slot => SlotKey(slot) != state.Selected))
            {
                JToken main = slots.LastOrDefault(slot => !Kit.Bool(slot, "preShow") && Kit.Obj(slot, "segment") != null)
                    ?? slots.FirstOrDefault(slot => Kit.Obj(slot, "segment") == null) ?? slots.FirstOrDefault();
                state.Selected = main == null ? null : SlotKey(main);
            }

            Label feedback = Kit.Feedback();
            feedback.name = "booking-feedback";
            var page = new BookingPage(context, state, card, checks, feedback, eventId, host);
            if (roster.Ok && Kit.Num(roster.Data, "byGroup.wrestlers") is double wrestlerCount) page.Wrestlers = (int)wrestlerCount;

            host.Clear();
            host.Add(ShowStrip(rows, eventId, context));
            host.Add(Header(page, Kit.Obj(venue.Ok ? venue.Data : null, "venue"), live));
            host.Add(feedback);
            if (page.MustSign && Kit.Bool(card, "canEdit")) host.Add(SigningNote(page));

            bool canEdit = Kit.Bool(card, "canEdit");
            if (!canEdit && Kit.Obj(card, "editBlock") is JToken block)
            {
                VisualElement note = Ds.Row("fc-note");
                note.Add(Ds.Pill(DsState.Info, Kit.Str(block, "message") ?? "This card can no longer change.", "info"));
                host.Add(note);
            }

            VisualElement columns = Ds.Row("ds-row--top", "fc-columns");
            VisualElement fight = Ds.Column("fc-fight").Named("booking-fight-card");
            VisualElement details = Ds.Column("fc-details").Named("booking-details");
            columns.Add(fight);
            columns.Add(details);
            host.Add(columns);

            var drag = new SlotDrag(page);
            foreach (JToken slot in slots) fight.Add(SlotRow(page, slot, drag));

            JToken chosen = slots.FirstOrDefault(slot => SlotKey(slot) == state.Selected);
            if (chosen != null) details.Add(BookingDetails.Build(page, chosen));
            FillPreviews(page, fight, slots);
        }

        // ---- The show strip and header ------------------------------------------------------------

        private static VisualElement ShowStrip(List<JToken> rows, string eventId, ScreenContext context)
        {
            VisualElement strip = Ds.Row("fc-show-strip").Named("booking-shows");
            strip.Add(Ds.Text("BOOKING FOR", "fc-label"));
            // The next few shows, plus the chosen one when it is further out (don't overwhelm).
            foreach (JToken row in rows.Take(6).Concat(rows.Skip(6).Where(row => Kit.Str(row, "eventInstanceId") == eventId)))
            {
                string id = Kit.Str(row, "eventInstanceId");
                int filled = (int)((Kit.Num(row, "filledMain") ?? 0) + (Kit.Num(row, "filledPreShow") ?? 0));
                string importance = Kit.Str(row, "importance");
                bool big = importance == "major" || importance == "flagship";
                Button chip = Ds.Chip($"{Kit.Str(row, "name")} · {ShortDate(Kit.Str(row, "date"))}", id == eventId,
                    () => context.Navigator.Go(ShellRoute.With("booking", "event", id)), filled, big ? "star" : "tv");
                chip.name = $"booking-show-{id}";
                chip.AddToClassList("fc-show-chip");
                if (Kit.Bool(row, "needsBooking")) chip.AddToClassList("fc-show-chip--needs");
                strip.Add(chip);
            }
            strip.Add(Ds.Spacer());
            strip.Add(Ds.Button("Calendar", () => context.Navigator.Go(ShellRoute.To("calendar")), DsButtonKind.Ghost, "calendar"));
            return strip;
        }

        internal static string ShortDate(string iso)
        {
            if (iso == null || !DateTime.TryParse(iso, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out DateTime date)) return iso ?? string.Empty;
            return date.ToString("ddd d MMM", System.Globalization.CultureInfo.InvariantCulture);
        }

        private static VisualElement Header(BookingPage page, JToken venue, JToken live)
        {
            JToken card = page.Card;
            JToken show = Kit.Obj(card, "show");
            VisualElement head = Ds.Row("fc-head");

            VisualElement panel = Ds.Row("ds-show", "ds-show--wide", "fc-show").Named("booking-showbar");
            PromotionLogos.PrependShow(panel, page.EventId, null, Kit.Str(show, "promotionId"), "rb-logo--xl");
            VisualElement words = Ds.Column("ds-show__words", "fc-show__words");
            VisualElement kicker = Ds.Row("ds-show__kicker");
            string importance = Kit.Str(show, "importance");
            DsState importanceState = CardWords.ImportanceState(importance);
            kicker.Add(Ds.Pill(importanceState, CardWords.Importance(importance), importanceState == DsState.Gold ? "star" : "tv"));
            kicker.Add(Ds.Text(TextFormat.Upper(CardWords.Countdown(Kit.Num(show, "daysUntil") ?? 0)), "ds-show__countdown", "fc-countdown"));
            if (Kit.Bool(show, "televised")) kicker.Add(Ds.Text("TELEVISED", "fc-quiet-tag"));
            words.Add(kicker);
            words.Add(Ds.Text(TextFormat.Upper(Kit.Str(show, "name")), "ds-show__name", "fc-show__name"));
            VisualElement meta = Ds.Row("ds-show__meta");
            meta.Add(new Icon("calendar", "ds-icon--xs"));
            meta.Add(Ds.Text(Kit.Date(Kit.Str(show, "date"), true), "ds-show__meta-text"));
            meta.Add(new Icon("venue", "ds-icon--xs"));
            string venueText = venue == null ? "Venue not chosen yet" : $"{Kit.Str(venue, "name")}, {Kit.Str(venue, "regionName")}";
            meta.Add(Ds.Text(venueText, "ds-show__meta-text", "fc-venue-text"));
            if (Kit.Bool(card, "canEdit"))
            {
                Button change = Ds.Button(venue == null ? "Choose venue" : "Change", () => VenuePicker.Open(page.Feedback, page.EventId), DsButtonKind.Ghost, null);
                change.AddToClassList("ds-btn--link");
                change.AddToClassList("fc-venue-change");
                change.name = "booking-venue";
                meta.Add(change);
            }
            words.Add(meta);
            words.Add(TimeUsed(Kit.Obj(card, "time")));
            panel.Add(words);

            List<JToken> slots = page.Slots.ToList();
            VisualElement progress = Ds.Column("ds-show__progress");
            progress.Add(Ds.Text($"{slots.Count(slot => Kit.Obj(slot, "segment") != null)}/{slots.Count}", "ds-show__booked"));
            progress.Add(Ds.Text("BOOKED", "ds-show__booked-label"));
            panel.Add(progress);
            head.Add(panel);

            VisualElement status = Ds.Column("fc-status");
            status.Add(ChecklistPill(page));
            VisualElement buttons = Ds.Row("fc-status__buttons");
            if (Kit.Bool(card, "canEdit"))
            {
                Button fill = Ds.Button("Auto-fill", async () =>
                {
                    if (page.Wrestlers is int few && few < 2)
                    {
                        // Nobody to book: say what to do instead of a refusal (UNITY-22).
                        DsOverlay.Toast(page.Feedback, $"{Signing.Title}: Auto-fill needs people under contract", DsState.Warn);
                        return;
                    }
                    CommandResult<JToken> result = await Kit.Run("aip.autoFillCard", new JObject { ["eventInstanceId"] = page.EventId, ["keepFilledSlots"] = true }, page.Feedback);
                    if (result.Ok) await PlanAutoResults(page.EventId);
                    if (page.MustSign) DsOverlay.Toast(page.Feedback, $"{Signing.Title}: there aren't enough to fill the card", DsState.Warn);
                }, DsButtonKind.Ghost, "sparkles");
                fill.name = "booking-autofill";
                DsTooltip.Attach(fill, page.MustSign
                    ? $"{Signing.Title}. Auto-fill can only book the people you have under contract."
                    : "Fill the empty slots the way the computer would book them. Matches get an Auto result.");
                buttons.Add(fill);
                Button clear = Ds.Button("Clear", () => ConfirmClear(page), DsButtonKind.Ghost, "trash");
                clear.name = "booking-clear";
                buttons.Add(clear);
            }
            buttons.Add(RunButton(page, live));
            status.Add(buttons);
            head.Add(status);
            return head;
        }

        /// <summary>EVT4-08's Time used: the card's time against the show's, in the show's own units (never minutes).</summary>
        private static VisualElement TimeUsed(JToken time)
        {
            VisualElement block = Ds.Column("fc-time").Named("booking-time-used");
            if (time == null) return block;
            double used = Kit.Num(time, "used") ?? 0;
            double budget = Math.Max(1, Kit.Num(time, "budget") ?? 1);
            double over = Kit.Num(time, "over") ?? 0;
            VisualElement row = Ds.Row("fc-time__row");
            VisualElement meter = Ds.Meter((float)(used / budget), over > 0 ? DsState.Bad : DsState.Info, "Time used");
            meter.AddToClassList("fc-time__meter");
            row.Add(meter);
            row.Add(Ds.Text($"{used:0} of {budget:0}", "fc-time__value"));
            row.AddOpt(Kit.WhyTrace("Time used", used, Kit.Obj(time, "usedTrace"), "count", "Why the card uses this much time"));
            block.Add(row);
            double spare = budget - used;
            string note = over > 0 ? $"Over the show's time by {over:0}: shorten a match or drop a segment."
                : spare <= 0 ? "The show is full. Shorten a match to make another one longer."
                : $"Room for {spare:0} more. A longer match raises its star limit and what the crowd expects.";
            Label noteLabel = Ds.Text(note, "fc-time__note");
            if (over > 0) noteLabel.AddToClassList(Kit.Bool(time, "extended") ? "fc-time__note--bad" : "fc-time__note--warn");
            block.Add(noteLabel);
            return block;
        }

        private static VisualElement RunButton(BookingPage page, JToken live)
        {
            JToken card = page.Card;
            bool tonight = Kit.Bool(card, "runsTonight");
            bool underWay = Kit.Str(live, "stage") == "live";
            bool goesLive = Kit.Str(live, "mode") == "live" || underWay;
            if (!tonight && !underWay)
            {
                return Ds.Text($"On air {CardWords.Countdown(Kit.Num(card, "show.daysUntil") ?? 0).ToLowerInvariant()}", "fc-runs-later");
            }
            if (goesLive)
            {
                // A live show goes on air from the day button in the top bar ("Go live" / "Back to the
                // show"), so the header doesn't offer a second one (UNITY-22: don't overwhelm).
                Label hint = Ds.Text(underWay ? "On air now: Back to the show, top right" : "Go live with the day button, top right", "fc-runs-later");
                hint.name = "booking-live-hint";
                return hint;
            }
            bool runnable = page.Checks != null && Kit.Bool(page.Checks, "runnable");
            SkewButton run =Ds.Cta(underWay ? "Back to the show" : goesLive ? "Go live" : "Run the show", async () =>
            {
                if (!runnable && !underWay)
                {
                    DsOverlay.Toast(page.Feedback, "Fix the problems in the card check first", DsState.Warn);
                    return;
                }
                if (goesLive)
                {
                    page.Context.Navigator.Go(ShellRoute.With(ScreenIds.ShowNight, "event", page.EventId));
                    return;
                }
                CommandResult<JToken> result = await Kit.Run("shows.runTonight", new JObject { ["eventInstanceId"] = page.EventId }, page.Feedback);
                if (result.Ok) page.Context.Navigator.Go(ShellRoute.With(ScreenIds.ShowResults, "event", page.EventId));
            }, goesLive ? "live" : "play");
            run.name = "booking-run";
            run.AddToClassList("ds-cta--lg");
            run.EnableInClassList("fc-cta--blocked", !runnable && !underWay);
            if (!runnable && !underWay) DsTooltip.Attach(run, "Fix the problems in the card check first");
            return run;
        }

        /// <summary>Too few wrestlers to fill a card (a founded promotion starts with nobody): one plain line and one way to sign people.</summary>
        private static VisualElement SigningNote(BookingPage page)
        {
            VisualElement note = Ds.Row("fc-note", "fc-signing").Named("booking-signing");
            note.Add(Ds.Pill(DsState.Warn, Signing.Title, "contracts"));
            note.Add(Ds.Text(Signing.Detail(page.Wrestlers ?? 0), "fc-runs-later", "fc-signing__words"));
            Button go = Ds.Button(Signing.Action, () => page.Context.Navigator.Go(Signing.Route), DsButtonKind.Secondary, "contracts");
            go.name = "booking-sign-wrestlers";
            note.Add(go);
            // DRF-03: after a draft with "Negotiate contracts after the draft" (or a new promotion) the
            // first show can come before anyone has signed; calling it off lets the days move on.
            Button off = Ds.Button("Call off this show", () => ConfirmCallOff(page), DsButtonKind.Ghost);
            off.name = "booking-call-off";
            DsTooltip.Attach(off, "Cancel tonight's show. The next one stays on the calendar.");
            note.Add(off);
            return note;
        }

        private static void ConfirmCallOff(BookingPage page)
        {
            VisualElement body = Ds.Column();
            body.Add(Ds.Text("The show is cancelled and the day can move on. Your next show stays on the calendar.", "ds-type-body", "fc-wrap"));
            DsOverlay.Modal(page.Feedback, "Call off this show?", body,
                ("Keep it", DsButtonKind.Ghost, null),
                ("Call it off", DsButtonKind.Danger, async () => await Kit.Run("calendar.cancelShow", new JObject { ["eventInstanceId"] = page.EventId }, page.Feedback)));
        }

        private static void ConfirmClear(BookingPage page)
        {
            VisualElement body = Ds.Column();
            body.Add(Ds.Text("Every segment on this card is removed, and their storyline links with them.", "ds-type-body", "fc-wrap"));
            DsOverlay.Modal(page.Feedback, "Clear the card?", body,
                ("Keep it", DsButtonKind.Ghost, null),
                ("Clear the card", DsButtonKind.Danger, async () => await Kit.Run("booking.clearCard", new JObject { ["eventInstanceId"] = page.EventId }, page.Feedback)));
        }

        // ---- The quiet checklist ------------------------------------------------------------------

        private static VisualElement ChecklistPill(BookingPage page)
        {
            JToken checks = page.Checks;
            int errors = Kit.Arr(checks, "errors").Count();
            int warnings = Kit.Arr(checks, "warnings").Count();
            DsState state = checks == null ? DsState.Neutral : errors > 0 ? DsState.Bad : warnings > 0 ? DsState.Warn : DsState.Good;
            string text = checks == null ? "The card check could not be read"
                : errors > 0 && page.MustSign ? $"Not ready: {Signing.Title.ToLowerInvariant()}"
                : errors > 0 ? $"Not ready: {errors} {(errors == 1 ? "problem" : "problems")}"
                : warnings > 0 ? $"Ready, but {warnings} {(warnings == 1 ? "thing" : "things")} to check"
                : Kit.Bool(page.Card, "runsTonight") ? "Ready to go live" : "The card looks good";
            Button button = null;
            button = new Button(() => OpenChecklist(page, button)) { text = string.Empty, name = "booking-checklist" };
            button.AddToClassList("fc-checklist");
            button.AddToClassList(Ds.StateClass(state));
            button.Add(new Icon(state == DsState.Good ? "check-circle" : state == DsState.Bad ? "problem" : "warning", "ds-icon--md", "fc-checklist__icon"));
            button.Add(Ds.Text(text, "fc-checklist__text"));
            button.Add(new Icon("chevron-down", "ds-icon--sm", "fc-checklist__chevron"));
            return button;
        }

        /// <summary>The card check: each check with a tick or a warning, the detail and a Fix that jumps to the slot.</summary>
        public static void OpenChecklist(BookingPage page, VisualElement anchor)
        {
            JToken checks = page.Checks;
            VisualElement list = FightCardStyles.Apply(Ds.Column("fc-checklist-pop")).Named("booking-checklist-pop");
            list.Add(Ds.Text("CARD CHECK", "fc-label"));
            UI.Shell.OverlayHandle handle = null;
            if (page.MustSign)
            {
                // The founded promotion's first problem: nobody (or too few) to book.
                VisualElement sign = Ds.Row("ds-row--top", "fc-check", Ds.StateClass(DsState.Bad)).Named("check-signing");
                sign.Add(new Icon("problem", "ds-icon--sm", "fc-check__icon"));
                VisualElement signWords = Ds.Column("fc-check__words");
                signWords.Add(Ds.Text(Signing.Title, "fc-check__text"));
                signWords.Add(Ds.Text(Signing.Detail(page.Wrestlers ?? 0), "fc-check__detail"));
                sign.Add(signWords);
                Button go = Ds.Button(Signing.Action, () =>
                {
                    handle?.Close();
                    page.Context.Navigator.Go(Signing.Route);
                }, DsButtonKind.Secondary);
                go.name = "check-fix-signing";
                sign.Add(go);
                list.Add(sign);
            }
            foreach (JToken item in Kit.Arr(checks, "checklist"))
            {
                bool passed = Kit.Bool(item, "passed");
                DsState state = passed ? DsState.Good : Kit.Str(item, "severity") == "error" ? DsState.Bad : DsState.Warn;
                VisualElement row = Ds.Row("ds-row--top", "fc-check", Ds.StateClass(state));
                row.Add(new Icon(passed ? "check" : state == DsState.Bad ? "problem" : "warning", "ds-icon--sm", "fc-check__icon"));
                VisualElement words = Ds.Column("fc-check__words");
                words.Add(Ds.Text(Kit.Str(item, "label"), "fc-check__text"));
                row.Add(words);
                if (!passed)
                {
                    string checkId = Kit.Str(item, "id");
                    List<JToken> issues = Kit.Arr(checks, "errors").Concat(Kit.Arr(checks, "warnings")).Where(issue => Kit.Str(issue, "checkId") == checkId).ToList();
                    string detail = Kit.Str(item, "detail") ?? Kit.Str(issues.FirstOrDefault(), "message");
                    if (detail != null) words.Add(Ds.Text(detail, "fc-check__detail"));
                    string slotKey = SlotOfIssue(page, issues.FirstOrDefault());
                    if (slotKey != null)
                    {
                        Button fix = Ds.Button("Fix", () =>
                        {
                            handle?.Close();
                            page.Select(slotKey);
                        }, DsButtonKind.Secondary);
                        fix.name = $"check-fix-{checkId}";
                        row.Add(fix);
                    }
                }
                list.Add(row);
            }
            if (checks == null) list.Add(Ds.Text("The card check could not be read.", "fc-check__detail"));
            handle = DsOverlay.Popover(anchor, list);
        }

        private static string SlotOfIssue(BookingPage page, JToken issue)
        {
            if (issue == null) return null;
            if (Kit.Obj(issue, "slot") is JToken slot) return SlotKey(Kit.Bool(slot, "preShow"), (int)(Kit.Num(slot, "slot") ?? 0));
            string segmentId = Kit.Str(issue, "segmentId");
            if (segmentId == null) return null;
            JToken found = page.Slots.FirstOrDefault(entry => Kit.Str(entry, "segment.segmentId") == segmentId);
            return found == null ? null : SlotKey(found);
        }

        internal static IEnumerable<JToken> IssuesFor(JToken checks, JToken slot)
        {
            if (checks == null) return Enumerable.Empty<JToken>();
            string segmentId = Kit.Str(slot, "segment.segmentId");
            bool preShow = Kit.Bool(slot, "preShow");
            int index = (int)(Kit.Num(slot, "slot") ?? 0);
            return Kit.Arr(checks, "errors").Concat(Kit.Arr(checks, "warnings")).Where(issue =>
                (segmentId != null && Kit.Str(issue, "segmentId") == segmentId) ||
                (Kit.Obj(issue, "slot") is JToken at && Kit.Bool(at, "preShow") == preShow && (int)(Kit.Num(at, "slot") ?? -1) == index));
        }

        // ---- The fight card -----------------------------------------------------------------------

        private static VisualElement SlotRow(BookingPage page, JToken slot, SlotDrag drag)
        {
            bool preShow = Kit.Bool(slot, "preShow");
            string key = SlotKey(slot);
            JToken segment = Kit.Obj(slot, "segment");
            VisualElement row = Ds.Row("ds-row--top", "fc-slot").Named($"slot-{key}");
            row.userData = slot;
            row.Add(Ds.Text(preShow ? "PRE" : Kit.Num(slot, "displayNumber")?.ToString() ?? string.Empty, "fc-slot__number"));
            bool canEdit = Kit.Bool(page.Card, "canEdit");

            VisualElement body;
            if (segment == null) body = EmptySlot(page, slot, canEdit);
            else
            {
                Matchup matchup = Matchups.FromBooking(slot, segment, page.State.People);
                foreach (JToken issue in IssuesFor(page.Checks, slot))
                {
                    matchup.Flags.Add((Kit.Str(issue, "severity") == "error" ? DsState.Bad : DsState.Warn, Kit.Str(issue, "message")));
                }
                body = DsCards.MatchupCard(matchup, false, () => page.Select(key));
                body.RegisterCallback<NavigationSubmitEvent>(_ => page.Select(key));
                if (page.State.Previews.TryGetValue(key, out var cached) && cached.key == PreviewKey(slot)) Matchups.AddStars(body, cached.stars);
            }
            body.AddToClassList("fc-slot__card");
            body.name = $"slot-card-{key}";
            body.EnableInClassList("ds-match--selected", page.State.Selected == key);
            row.Add(body);

            VisualElement handle = Ds.Column("fc-slot__handle").Named($"slot-handle-{key}");
            handle.Add(new Icon("drag-handle", "ds-icon--md"));
            if (canEdit && segment != null)
            {
                DsTooltip.Attach(handle, "Drag to move this segment to another slot");
                drag.Attach(handle, row);
            }
            else handle.AddToClassList("fc-slot__handle--idle");
            row.Add(handle);
            return row;
        }

        private static VisualElement EmptySlot(BookingPage page, JToken slot, bool canEdit)
        {
            bool preShow = Kit.Bool(slot, "preShow");
            int index = (int)(Kit.Num(slot, "slot") ?? 0);
            string key = SlotKey(slot);
            VisualElement empty = Ds.Column("ds-match", "fc-empty");
            empty.focusable = true;
            empty.AddManipulator(new Clickable(() => page.Select(key)));
            empty.RegisterCallback<NavigationSubmitEvent>(_ => page.Select(key));
            VisualElement top = Ds.Row("ds-match__top");
            top.Add(Ds.Text(TextFormat.Upper(Kit.Str(slot, "roleLabel")), "ds-match__slot"));
            top.Add(Ds.Text("Open slot", "ds-match__type"));
            top.Add(Ds.Spacer());
            top.Add(new Icon("clock", "ds-icon--xs", "ds-match__meta-icon"));
            top.Add(Ds.Text(CardWords.Length(Kit.Str(slot, "durationClass")), "ds-match__meta"));
            empty.Add(top);
            VisualElement add = Ds.Row("fc-empty__add");
            foreach (JToken issue in IssuesFor(page.Checks, slot)) add.Add(Ds.Pill(Kit.Str(issue, "severity") == "error" ? DsState.Bad : DsState.Warn, Kit.Str(issue, "message")));
            add.Add(Ds.Spacer());
            if (canEdit)
            {
                string suffix = preShow ? $"pre-{index}" : index.ToString();
                Button match = Ds.Button("Add a match", () => SegmentEditor.Open(page, slot, null, "match"), DsButtonKind.Ghost, "add");
                match.name = $"add-match-{suffix}";
                Button angle = Ds.Button("Add a talking segment", () => SegmentEditor.Open(page, slot, null, "angle"), DsButtonKind.Ghost, "promo");
                angle.name = $"add-angle-{suffix}";
                add.Add(match);
                add.Add(angle);
            }
            empty.Add(add);
            return empty;
        }

        // ---- Previews (expected stars) -----------------------------------------------------------

        internal static string PreviewKey(JToken slot) =>
            Kit.Obj(slot, "segment.draft")?.ToString(Newtonsoft.Json.Formatting.None) + "|" + Kit.Str(slot, "bookedTime") + "|" + Kit.Str(slot, "role");

        /// <summary>
        /// The expected stars of each booked segment (<c>match.preview</c>, one typical night), drawn
        /// on the cards when they arrive and cached until the segment changes.
        /// </summary>
        private static async void FillPreviews(BookingPage page, VisualElement fight, List<JToken> slots)
        {
            try
            {
                foreach (JToken slot in slots)
                {
                    if (Kit.Obj(slot, "segment") == null) continue;
                    string key = SlotKey(slot);
                    string previewKey = PreviewKey(slot);
                    if (page.State.Previews.TryGetValue(key, out var cached) && cached.key == previewKey) continue;
                    JToken preview = await Preview(page.Card, slot);
                    if (fight.panel == null) return;
                    if (preview == null) continue;
                    float stars = (float)(Kit.Num(preview, "stars.value") ?? 0);
                    page.State.Previews[key] = (previewKey, stars, preview);
                    VisualElement card = fight.Q<VisualElement>($"slot-card-{key}");
                    if (card != null) Matchups.AddStars(card, stars);
                    if (page.State.Selected == key) page.RefreshDetails();
                }
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[Booking] previews: {exception.Message}");
            }
        }

        internal static async Task<JToken> Preview(JToken card, JToken slot)
        {
            JToken segment = Kit.Obj(slot, "segment");
            JToken show = Kit.Obj(card, "show");
            if (segment == null || show == null || Kit.Game == null) return null;
            var sides = new JArray();
            foreach (IGrouping<int, JToken> side in Kit.Arr(segment, "draft.participants").GroupBy(person => (int)(Kit.Num(person, "side") ?? 0)).OrderBy(group => group.Key))
            {
                while (sides.Count < side.Key) sides.Add(new JArray());
                sides.Add(new JArray(side.Select(person => Kit.Str(person, "personId"))));
            }
            if (sides.Count == 0 || Kit.Str(segment, "kind") != "match") return null;
            var args = new JObject
            {
                ["kind"] = Kit.Str(segment, "kind"),
                ["typeKey"] = Kit.Str(segment, "typeKey"),
                ["sides"] = sides,
                ["slotRole"] = Kit.Str(slot, "role"),
                ["importance"] = Kit.Str(show, "importance"),
                ["regionId"] = Kit.Str(show, "regionId"),
                ["televised"] = Kit.Bool(show, "televised"),
                ["promotionId"] = Kit.Str(show, "promotionId"),
                ["previewSeed"] = 1,
            };
            if (Kit.Str(slot, "bookedTime") is string booked) args["bookedTime"] = booked;
            QueryResult<JToken> answer = await Kit.Game.Client.Query("match.preview", args);
            return answer.Ok ? answer.Data : null;
        }

        // ---- Shared ----------------------------------------------------------------------------------

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

        /// <summary>The planned result in words: "Calder Voss by pinfall", "Auto (decided on the night)", "Draw".</summary>
        public static string ResultText(JToken segment)
        {
            JToken result = Kit.Obj(segment, "result");
            if (result == null) return "Not planned yet";
            switch (Kit.Str(result, "kind"))
            {
                case "auto": return "Auto (decided on the night)";
                case "random": return "Random";
                case "draw": return "Draw";
                case "noContest": return "No contest";
            }
            int side = (int)(Kit.Num(result, "winningSide") ?? 0);
            string name = Kit.Arr(segment, "sides").Where(entry => (int)(Kit.Num(entry, "side") ?? -1) == side).Select(entry => Kit.Str(entry, "name")).FirstOrDefault();
            string method = Kit.Str(result, "methodName");
            return $"{name ?? $"Side {side + 1}"}{(method == null ? string.Empty : $" by {method.ToLowerInvariant()}")}";
        }
    }

    /// <summary>One draw of the booking screen: what the details panel, the drag and the editor need.</summary>
    public sealed class BookingPage
    {
        private readonly VisualElement host;

        internal BookingPage(ScreenContext context, BookingScreen.State state, JToken card, JToken checks, Label feedback, string eventId, VisualElement host)
        {
            Context = context;
            State = state;
            Card = card;
            Checks = checks;
            Feedback = feedback;
            EventId = eventId;
            this.host = host;
            Slots = Kit.Arr(card, "sections").SelectMany(section => Kit.Arr(section, "slots")).ToList();
        }

        public ScreenContext Context { get; }
        internal BookingScreen.State State { get; }
        public JToken Card { get; }
        public JToken Checks { get; }
        public Label Feedback { get; }
        public string EventId { get; }
        /// <summary>Wrestlers under contract (<c>roster.summary</c>), or null when it couldn't be read.</summary>
        public int? Wrestlers { get; internal set; }
        /// <summary>Too few wrestlers to fill a card: Booking says "Sign some wrestlers first".</summary>
        public bool MustSign => Wrestlers is int count && Signing.Needed(count);
        public IReadOnlyList<JToken> Slots { get; }
        public bool CanEdit => Kit.Bool(Card, "canEdit");
        public bool MoreOpen => State.MoreOpen;

        /// <summary>Selects a slot: highlights its card and redraws the details panel (no engine call).</summary>
        public void Select(string slotKey)
        {
            if (State.Selected != slotKey) State.MoreOpen = false;
            State.Selected = slotKey;
            host.Query<VisualElement>(className: "fc-slot__card").ForEach(card =>
                card.EnableInClassList("ds-match--selected", card.name == $"slot-card-{slotKey}"));
            RefreshDetails();
        }

        public void RefreshDetails()
        {
            VisualElement details = host.Q<VisualElement>("booking-details");
            if (details == null) return;
            details.Clear();
            JToken slot = Slots.FirstOrDefault(entry => BookingScreen.SlotKey(entry) == State.Selected);
            if (slot != null) details.Add(BookingDetails.Build(this, slot));
        }

        /// <summary>Opens or closes the More options part of the details panel.</summary>
        public void SetMore(bool open)
        {
            State.MoreOpen = open;
            RefreshDetails();
        }

        public bool Previewed(string slotKey, out float stars, out JToken preview)
        {
            if (State.Previews.TryGetValue(slotKey, out var cached))
            {
                stars = cached.stars;
                preview = cached.preview;
                return true;
            }
            stars = 0;
            preview = null;
            return false;
        }

        /// <summary>The selected slot moves with its segment after a move.</summary>
        internal void FollowTo(JToken slot) => State.Selected = BookingScreen.SlotKey(slot);
    }

    /// <summary>
    /// Drag to reorder: press a slot's handle, move over another slot and let go. The target slot
    /// shows a line while dragging; dropping sends <c>booking.moveSegment</c> (a filled target swaps).
    /// The details panel's Move up / Move down do the same from the keyboard.
    /// </summary>
    internal sealed class SlotDrag
    {
        private readonly BookingPage page;
        private VisualElement source;
        private VisualElement target;

        public SlotDrag(BookingPage page) => this.page = page;

        public void Attach(VisualElement handle, VisualElement row)
        {
            handle.RegisterCallback<PointerDownEvent>(evt =>
            {
                if (evt.button != 0) return;
                source = row;
                row.AddToClassList("fc-slot--dragging");
                handle.CapturePointer(evt.pointerId);
                evt.StopPropagation();
            });
            handle.RegisterCallback<PointerMoveEvent>(evt =>
            {
                if (source != row || !handle.HasPointerCapture(evt.pointerId)) return;
                VisualElement over = RowAt(row.parent, evt.position);
                if (over == target) return;
                target?.RemoveFromClassList("fc-slot--target");
                target = over == row ? null : over;
                target?.AddToClassList("fc-slot--target");
            });
            handle.RegisterCallback<PointerUpEvent>(async evt =>
            {
                if (source != row) return;
                handle.ReleasePointer(evt.pointerId);
                VisualElement dropped = target;
                Reset(row);
                if (dropped != null) await Move(row, dropped);
            });
            handle.RegisterCallback<PointerCaptureOutEvent>(_ => Reset(row));
        }

        private void Reset(VisualElement row)
        {
            target?.RemoveFromClassList("fc-slot--target");
            row.RemoveFromClassList("fc-slot--dragging");
            source = null;
            target = null;
        }

        private static VisualElement RowAt(VisualElement list, Vector2 position)
        {
            if (list == null) return null;
            foreach (VisualElement child in list.Children())
            {
                if (!child.ClassListContains("fc-slot")) continue;
                Rect bounds = child.worldBound;
                if (position.y >= bounds.yMin && position.y <= bounds.yMax) return child;
            }
            return null;
        }

        private async Task Move(VisualElement from, VisualElement to)
        {
            string segmentId = Kit.Str(from.userData as JToken, "segment.segmentId");
            if (segmentId == null || !(to.userData is JToken target)) return;
            await MoveTo(page, segmentId, target);
        }

        public static async Task MoveTo(BookingPage page, string segmentId, JToken target)
        {
            page.FollowTo(target);
            CommandResult<JToken> result = await Kit.Run("booking.moveSegment", new JObject
            {
                ["segmentId"] = segmentId,
                ["toPreShow"] = Kit.Bool(target, "preShow"),
                ["toSlot"] = (int)(Kit.Num(target, "slot") ?? 0),
            }, page.Feedback);
            if (result.Ok) DsOverlay.Toast(page.Feedback, $"Moved to {Kit.Str(target, "roleLabel")} ({BookingSlotName(target)})", DsState.Good, null, 3f);
        }

        private static string BookingSlotName(JToken slot) =>
            Kit.Bool(slot, "preShow") ? $"pre-show slot {(Kit.Num(slot, "slot") ?? 0) + 1}" : $"slot {Kit.Num(slot, "displayNumber")}";
    }
}
