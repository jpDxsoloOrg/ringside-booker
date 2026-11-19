using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// The selected slot's details beside the fight card (mockup 08): the slot, the matchup, the
    /// expected stars (<c>match.preview</c>) with their Why?, the basics in words (winner, finish,
    /// length, titles), the length as Short / Standard / Long (saved with <c>booking.updateSegment</c>),
    /// and "More options" one step away: the planned result (<c>booking.setResult</c>), the storyline
    /// links (<see cref="StorylineLinks"/>) and moving the segment up or down. Edit opens the full
    /// segment editor; the bin removes it.
    /// </summary>
    public static class BookingDetails
    {
        public static VisualElement Build(BookingPage page, JToken slot)
        {
            JToken segment = Kit.Obj(slot, "segment");
            VisualElement panel = Ds.Panel(segment == null ? "Open slot" : Kit.Str(segment, "kind") == "match" ? "Match details" : "Segment details", null, null, "fc-details-panel");
            panel.name = "booking-details-panel";
            VisualElement head = Ds.Row("fc-details-head");
            head.Add(Ds.Text(TextFormat.Upper(Kit.Str(slot, "roleLabel")), "fc-details-head__slot"));
            head.AddOpt(Kit.WhyTrace("Slot role", 0, Kit.Obj(slot, "roleTrace"), null, "Why this slot has this role"));
            head.Add(Ds.Spacer());
            if (segment != null && Kit.Arr(segment, "titles").Any()) head.Add(Ds.Pill(DsState.Gold, "Title match", "trophy"));
            if (segment != null && Kit.Arr(segment, "storylineIds").Any()) head.Add(Ds.Pill(DsState.Info, "Storyline", "storylines"));
            panel.Add(head);

            if (segment == null)
            {
                OpenSlot(page, slot, panel);
                return panel;
            }
            if (Kit.Str(segment, "kind") == "match") Match(page, slot, segment, panel);
            else Angle(page, slot, segment, panel);
            return panel;
        }

        private static void OpenSlot(BookingPage page, JToken slot, VisualElement panel)
        {
            panel.Add(Ds.Text("Nothing booked here yet", "fc-details-title"));
            panel.Add(Ds.Text($"Usual length: {CardWords.Length(Kit.Str(slot, "durationClass"))}", "ds-type-caption"));
            if (!page.CanEdit) return;
            VisualElement actions = Ds.Row("fc-details-actions");
            Button match = Ds.Button("Add a match", () => SegmentEditor.Open(page, slot, null, "match"), DsButtonKind.Primary, "add");
            match.name = "details-add-match";
            actions.Add(match);
            Button angle = Ds.Button("Add a talking segment", () => SegmentEditor.Open(page, slot, null, "angle"), DsButtonKind.Secondary, "promo");
            angle.name = "details-add-angle";
            actions.Add(angle);
            panel.Add(actions);
        }

        private static void Match(BookingPage page, JToken slot, JToken segment, VisualElement panel)
        {
            List<JToken> sides = Kit.Arr(segment, "sides").ToList();
            panel.Add(Ds.Text(Kit.Str(segment, "label") ?? string.Join(" vs ", sides.Select(side => Kit.Str(side, "name"))), "fc-details-title"));
            string length = CardWords.Length(Kit.Str(slot, "bookedTime") ?? Kit.Str(slot, "durationClass"));
            panel.Add(Ds.Text(string.Join(" · ", new[] { Kit.Str(segment, "typeName"), length }.Where(text => text != null)), "ds-type-caption"));
            if (Kit.Str(segment, "durationShiftNote") is string shift) panel.Add(Ds.Text(shift, "fc-hint"));

            string key = BookingScreen.SlotKey(slot);
            VisualElement expect = Ds.Row("fc-expect").Named("booking-expected");
            expect.Add(Ds.Text("EXPECTED", "fc-label"));
            if (page.Previewed(key, out float stars, out JToken preview))
            {
                expect.Add(new Stars(stars, "ds-icon--md"));
                expect.Add(Ds.Text(stars >= 4 ? "Should steal the show" : stars >= 3 ? "A good match" : stars >= 2 ? "Solid filler" : "Filler", "fc-expect__word"));
                expect.Add(Ds.Spacer());
                expect.AddOpt(Kit.WhyTrace("Expected stars", stars, Kit.Obj(preview, "stars.trace"), "stars", "Why we expect this rating"));
            }
            else expect.Add(Ds.Text("Working it out…", "fc-hint"));
            panel.Add(expect);

            panel.Add(Ds.SectionHeader("The basics"));
            var basics = new List<(string, string)>
            {
                ("Winner", BookingScreen.ResultText(segment)),
                ("Length", length + (Kit.Bool(slot, "timeLocked") ? " (the main event always runs long)" : string.Empty)),
            };
            List<string> titles = Kit.Arr(segment, "titles").Select(title => Kit.Str(title, "name")).ToList();
            basics.Add(("On the line", titles.Count == 0 ? "No title" : string.Join(", ", titles)));
            if (Kit.Arr(segment, "storylineIds").Any()) basics.Add(("Storylines", $"{Kit.Arr(segment, "storylineIds").Count()} linked"));
            panel.Add(Ds.KeyValues(basics.ToArray()));
            if (preview != null)
            {
                VisualElement read = Ds.Column("fc-read");
                AddMeter(read, "Crowd", Kit.Num(preview, "crowd.value"), DsState.Live);
                AddMeter(read, "Work rate", Kit.Num(preview, "workRate.value"), DsState.Good);
                AddMeter(read, "Star power", Kit.Num(preview, "starPower.value"), DsState.Info);
                panel.Add(read);
            }

            Length(page, slot, segment, panel);
            More(page, slot, segment, panel, match: true);
            Actions(page, slot, segment, panel, match: true);
        }

        private static void AddMeter(VisualElement parent, string word, double? value, DsState state)
        {
            if (value == null) return;
            VisualElement meter = Ds.Meter((float)(value.Value / 100.0), state, word);
            parent.Add(meter);
        }

        private static void Angle(BookingPage page, JToken slot, JToken segment, VisualElement panel)
        {
            List<string> speakers = Kit.Arr(segment, "sides").SelectMany(side => Kit.Arr(side, "people")).Select(person => Kit.Str(person, "ringName")).ToList();
            panel.Add(Ds.Text(Kit.Str(segment, "label") ?? Kit.Str(segment, "talkLine") ?? string.Join(" & ", speakers), "fc-details-title"));
            string length = CardWords.Length(Kit.Str(slot, "bookedTime") ?? Kit.Str(slot, "durationClass"));
            panel.Add(Ds.Text(string.Join(" · ", new[] { Kit.Str(segment, "typeName"), SettingWord(Kit.Str(segment, "setting")), length }.Where(text => text != null)), "ds-type-caption"));

            panel.Add(Ds.SectionHeader("Beats"));
            List<JToken> beats = Kit.Arr(segment, "draft.angle.beats").ToList();
            var names = Kit.Arr(segment, "sides").SelectMany(side => Kit.Arr(side, "people"))
                .GroupBy(person => Kit.Str(person, "personId")).ToDictionary(group => group.Key, group => Kit.Str(group.First(), "ringName"));
            if (beats.Count == 0) panel.Add(Ds.Text("One beat of the type's usual kind, with everyone in it.", "fc-hint"));
            int number = 1;
            foreach (JToken beat in beats)
            {
                VisualElement row = Ds.Row("fc-beat-line");
                row.Add(Ds.Text($"{number++}", "fc-beat-line__number"));
                row.Add(Ds.Text(SegmentEditor.BeatName(Kit.Str(beat, "beatKey")), "fc-beat-line__name"));
                row.Add(Ds.Text(string.Join(", ", Kit.Arr(beat, "personIds").Select(id => names.TryGetValue((string)id, out string name) ? name : "Someone")), "fc-beat-line__people"));
                panel.Add(row);
            }
            panel.Add(Ds.KeyValues(("Speakers", speakers.Count == 0 ? "Nobody yet" : string.Join(", ", speakers)), ("Length", length)));
            Length(page, slot, segment, panel);
            More(page, slot, segment, panel, match: false);
            Actions(page, slot, segment, panel, match: false);
        }

        public static string SettingWord(string setting) => setting switch
        {
            "ring" => "In the ring",
            "backstage" => "Backstage",
            "video" => "Pre-taped",
            _ => null,
        };

        /// <summary>Short / Standard / Long for this slot (the usual one marked); never minutes (D-10).</summary>
        private static void Length(BookingPage page, JToken slot, JToken segment, VisualElement panel)
        {
            if (!page.CanEdit) return;
            if (Kit.Bool(slot, "timeLocked"))
            {
                panel.Add(Ds.Text("Length: Long. The main event always runs long.", "fc-hint"));
                return;
            }
            VisualElement row = Ds.Row("fc-length").Named("booking-length");
            row.Add(Ds.Text("LENGTH", "fc-label"));
            var tabs = new DsTabs(segmented: true);
            string usual = Kit.Str(slot, "usualTime");
            foreach (string length in CardWords.Lengths) tabs.Add(length, CardWords.Length(length) + (length == usual ? " (usual)" : string.Empty));
            tabs.Select(Kit.Str(slot, "bookedTime") ?? Kit.Str(slot, "durationClass") ?? usual, notify: false);
            tabs.Selected += async picked =>
            {
                var draft = (JObject)Kit.Obj(segment, "draft").DeepClone();
                if (picked == usual) draft.Remove("bookedTime");
                else draft["bookedTime"] = picked;
                await Kit.Run("booking.updateSegment", new JObject { ["segmentId"] = Kit.Str(segment, "segmentId"), ["draft"] = draft }, page.Feedback);
            };
            row.Add(tabs);
            panel.Add(row);
        }

        /// <summary>The advanced part, one step away: result, storylines and running order.</summary>
        private static void More(BookingPage page, JToken slot, JToken segment, VisualElement panel, bool match)
        {
            Button toggle = Ds.Button(page.MoreOpen ? "Fewer options" : match ? "More options: result, storylines, order" : "More options: storylines, order",
                () => page.SetMore(!page.MoreOpen), DsButtonKind.Ghost, page.MoreOpen ? "chevron-down" : "chevron-right");
            toggle.AddToClassList("fc-more");
            toggle.name = "booking-more";
            panel.Add(toggle);
            if (!page.MoreOpen) return;
            VisualElement more = Ds.Column("fc-more-body").Named("booking-more-body");
            string segmentId = Kit.Str(segment, "segmentId");
            if (match && page.CanEdit)
            {
                more.Add(Ds.Text("PLANNED RESULT", "fc-label", "fc-label--block"));
                if (Kit.Bool(page.Card, "randomWinners")) more.Add(Ds.Text("Random winners are on for this game: winners are decided on the night.", "fc-hint"));
                VisualElement chips = Ds.Row("fc-chip-row").Named("booking-result");
                string current = ResultKey(Kit.Obj(segment, "result"));
                void Chip(string key, string text, JToken value)
                {
                    Button chip = Ds.Chip(text, current == key, async () =>
                        await Kit.Run("booking.setResult", new JObject { ["segmentId"] = segmentId, ["result"] = value }, page.Feedback));
                    chip.name = $"result-{key}";
                    chips.Add(chip);
                }
                Chip("auto", "Auto", "auto");
                Chip("random", "Random", "random");
                foreach (JToken side in Kit.Arr(segment, "sides"))
                {
                    int number = (int)(Kit.Num(side, "side") ?? 0);
                    Chip($"win-{number}", $"{Kit.Str(side, "name")} wins", new JObject { ["kind"] = "win", ["winningSide"] = number, ["methodKey"] = Kit.Str(segment, "result.methodKey") ?? "method.pinfall" });
                }
                Chip("draw", "Draw", new JObject { ["kind"] = "draw" });
                Chip("noContest", "No contest", new JObject { ["kind"] = "noContest" });
                more.Add(chips);
                more.Add(Ds.Text("Auto lets the night pick the most sensible winner. The way they win is set in the editor.", "fc-hint"));
            }

            more.Add(Ds.Text("STORYLINES", "fc-label", "fc-label--block"));
            more.Add(StorylineLinks.Build(segmentId, page.Feedback, null));

            if (page.CanEdit)
            {
                more.Add(Ds.Text("RUNNING ORDER", "fc-label", "fc-label--block"));
                VisualElement order = Ds.Row("fc-chip-row");
                int index = page.Slots.ToList().FindIndex(entry => BookingScreen.SlotKey(entry) == BookingScreen.SlotKey(slot));
                JToken up = index > 0 ? page.Slots[index - 1] : null;
                JToken down = index >= 0 && index < page.Slots.Count - 1 ? page.Slots[index + 1] : null;
                Button upButton = Ds.Button("Move up", async () => await SlotDrag.MoveTo(page, segmentId, up), DsButtonKind.Secondary, "up");
                upButton.name = "booking-move-up";
                upButton.SetEnabled(up != null);
                Button downButton = Ds.Button("Move down", async () => await SlotDrag.MoveTo(page, segmentId, down), DsButtonKind.Secondary, "down");
                downButton.name = "booking-move-down";
                downButton.SetEnabled(down != null);
                order.Add(upButton);
                order.Add(downButton);
                more.Add(order);
                more.Add(Ds.Text("Or drag the handle beside a card. Moving onto a booked slot swaps the two.", "fc-hint"));
            }
            panel.Add(more);
        }

        private static string ResultKey(JToken result)
        {
            string kind = Kit.Str(result, "kind");
            return kind == "win" ? $"win-{Kit.Num(result, "winningSide") ?? 0}" : kind;
        }

        private static void Actions(BookingPage page, JToken slot, JToken segment, VisualElement panel, bool match)
        {
            if (!page.CanEdit) return;
            VisualElement actions = Ds.Row("fc-details-actions");
            Button edit = Ds.Button(match ? "Edit match" : "Edit segment", () => SegmentEditor.Open(page, slot, segment, Kit.Str(segment, "kind")), DsButtonKind.Secondary, "edit");
            edit.name = "booking-edit";
            actions.Add(edit);
            if (match)
            {
                Button winner = Ds.Button("Change winner", () => page.SetMore(true), DsButtonKind.Secondary, "trophy");
                winner.name = "booking-change-winner";
                actions.Add(winner);
            }
            actions.Add(Ds.Spacer());
            Button remove = Ds.IconButton("trash", "Remove from the card", async () =>
                await Kit.Run("booking.removeSegment", new JObject { ["segmentId"] = Kit.Str(segment, "segmentId") }, page.Feedback));
            remove.name = "booking-remove";
            actions.Add(remove);
            panel.Add(actions);
        }
    }
}
