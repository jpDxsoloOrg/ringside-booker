using System.Collections.Generic;
using System.Linq;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Mockups
{
    /// <summary>
    /// Booking as a fight card: the show up top, its matches as matchup cards in running order, and the
    /// selected match's details on the right. The checklist stays a single quiet line ("Ready to go live")
    /// until something needs a look; then that line turns amber and the match carries the pill.
    /// </summary>
    public static class BookingMockup
    {
        /// <summary>The checklist button (the tour opens it).</summary>
        public static Button LastChecklist { get; private set; }

        public static VisualElement Build(MockupController mock)
        {
            VisualElement page = Ds.Column("mk-page");
            List<Matchup> card = MockupData.ShowcaseCard();

            // Which show: the upcoming ones as chips, the chosen one big.
            VisualElement shows = Ds.Row("mk-show-strip");
            shows.Add(Ds.Text("BOOKING FOR", "mk-label"));
            shows.Add(Ds.Chip("Mainstage · Tonight", false, null, 4, "tv"));
            shows.Add(Ds.Chip("Overclock · Wed 27", false, null, 0, "tv"));
            shows.Add(Ds.Chip("Showcase · Sun 31", true, null, 8, "star"));
            shows.Add(Ds.Chip("Cold Front · Sun 14 Feb", false, null, 0, "star"));
            shows.Add(Ds.Spacer());
            shows.Add(Ds.Button("Calendar", null, DsButtonKind.Ghost, "calendar"));
            page.Add(shows);

            VisualElement header = Ds.Row("mk-booking-head");
            VisualElement show = DsCards.ShowCard(MockupData.Showcase(), wide: true);
            show.AddToClassList("mk-grow");
            header.Add(show);
            VisualElement status = Ds.Column("mk-booking-status");
            LastChecklist = Checklist(mock, card);
            status.Add(LastChecklist);
            VisualElement buttons = Ds.Row("mk-booking-buttons");
            buttons.Add(Ds.Button("Auto-fill", null, DsButtonKind.Ghost, "sparkles"));
            buttons.Add(Ds.Button("Clear", null, DsButtonKind.Ghost, "trash"));
            SkewButton live = Ds.Cta("Go live", () => mock.Show(MockupScreens.ShowNight), "live");
            live.AddToClassList("ds-cta--lg");
            buttons.Add(live);
            status.Add(buttons);
            // Time used (EVT4-08): slot lengths against the show's budget, never minutes.
            VisualElement time = Ds.Row("mk-time-used");
            time.Add(Ds.Meter(MockupData.ShowcaseTimeUsed / (float)MockupData.ShowcaseTimeTotal, DsState.Info, "Time used"));
            time.Add(Ds.Text($"{MockupData.ShowcaseTimeUsed} of {MockupData.ShowcaseTimeTotal}", "mk-time-used__value"));
            show.Q<VisualElement>(className: "ds-show__words").Add(time);
            header.Add(status);
            page.Add(header);

            VisualElement columns = Ds.Row("ds-row--top", "mk-columns");
            VisualElement fight = Ds.Column("mk-fight-card");
            VisualElement details = Ds.Column("mk-match-details");
            Matchup selected = card.Last();
            var cards = new Dictionary<Matchup, VisualElement>();
            int index = 0;
            foreach (Matchup match in card)
            {
                Matchup target = match;
                VisualElement row = Ds.Row("ds-row--top", "mk-slot");
                row.Add(Ds.Text(index == 0 ? "PRE" : index.ToString(), "mk-slot__number"));
                VisualElement element = DsCards.MatchupCard(match, false, () =>
                {
                    foreach (KeyValuePair<Matchup, VisualElement> pair in cards) pair.Value.EnableInClassList("ds-match--selected", pair.Key == target);
                    details.Clear();
                    details.Add(Details(target));
                });
                element.AddToClassList("mk-grow");
                cards[match] = element;
                row.Add(element);
                row.Add(Ds.Column("mk-slot__handle").With(new Icon("drag-handle", "ds-icon--md")));
                fight.Add(row);
                index++;
            }
            cards[selected].AddToClassList("ds-match--selected");
            VisualElement add = Ds.Row("mk-add-slot");
            add.Add(Ds.Button("Add a match", null, DsButtonKind.Ghost, "add"));
            add.Add(Ds.Button("Add a promo", null, DsButtonKind.Ghost, "promo"));
            fight.Add(add);
            details.Add(Details(selected));
            columns.Add(fight);
            columns.Add(details);
            page.Add(columns);
            return page;
        }

        /// <summary>The quiet checklist: one line when all's well, amber with a count when not; click for the list.</summary>
        private static Button Checklist(MockupController mock, List<Matchup> card)
        {
            int problems = card.Sum(match => match.Flags.Count);
            Button button = null;
            button = new Button(() => OpenChecklist(button, card)) { text = string.Empty, name = "booking-checklist" };
            button.AddToClassList("mk-checklist");
            DsState state = problems == 0 ? DsState.Good : DsState.Warn;
            button.AddToClassList(Ds.StateClass(state));
            button.Add(new Icon(problems == 0 ? "check-circle" : "warning", "ds-icon--md", "mk-checklist__icon"));
            button.Add(Ds.Text(problems == 0 ? "Ready to go live" : $"Ready, but {problems} thing to check", "mk-checklist__text"));
            button.Add(new Icon("chevron-down", "ds-icon--sm", "mk-checklist__chevron"));
            return button;
        }

        public static void OpenChecklist(VisualElement anchor, List<Matchup> card)
        {
            VisualElement list = Ds.Column("mk-checklist-pop");
            list.Add(Ds.Text("CARD CHECK", "mk-label"));
            (DsState state, string text, string detail)[] checks =
            {
                (DsState.Good, "Every slot is filled", "8 matches and a pre-show bout"),
                (DsState.Good, "Main event booked", "Voss vs Thackeray for the World title"),
                (DsState.Good, "Every match has a planned winner", null),
                (DsState.Warn, "The Cheetah is banged up", "He can work, but a long match risks an injury. Shorten it or swap him out."),
                (DsState.Good, "Nobody is booked twice", null),
                (DsState.Good, "Title matches are set up correctly", "4 titles on the line"),
            };
            foreach ((DsState state, string text, string detail) in checks)
            {
                VisualElement row = Ds.Row("ds-row--top", "mk-check-line", Ds.StateClass(state));
                row.Add(new Icon(state == DsState.Good ? "check" : "warning", "ds-icon--sm", "mk-check-line__icon"));
                VisualElement words = Ds.Column("mk-check-line__words");
                words.Add(Ds.Text(text, "mk-check-line__text"));
                if (detail != null && state != DsState.Good) words.Add(Ds.Text(detail, "mk-check-line__detail"));
                row.Add(words);
                if (state != DsState.Good) row.Add(Ds.Button("Fix", null, DsButtonKind.Secondary));
                list.Add(row);
            }
            DsOverlay.Popover(anchor, list);
        }

        private static VisualElement Details(Matchup match)
        {
            VisualElement panel = Ds.Panel("Match details", null, null, "mk-details-panel");
            VisualElement head = Ds.Row("mk-details-head");
            head.Add(Ds.Text(match.Slot.ToUpperInvariant(), "mk-details-head__slot"));
            head.Add(Ds.Spacer());
            if (match.Title != null) head.Add(Ds.Pill(DsState.Gold, "Title match", "trophy"));
            panel.Add(head);
            panel.Add(Ds.Text($"{match.A.Name} vs {match.B?.Name}", "mk-details-title"));
            panel.Add(Ds.Text($"{match.MatchType} · {match.Length}", "ds-type-caption"));

            VisualElement expect = Ds.Row("mk-expect");
            expect.Add(Ds.Text("EXPECTED", "mk-label"));
            expect.Add(new Stars(match.Stars ?? 0, "ds-icon--md"));
            expect.Add(Ds.Text(match.Stars >= 4 ? "Should steal the show" : match.Stars >= 3 ? "Good match" : "Filler", "mk-expect__word"));
            if (match.Slot == "Main event") Ds.Why(expect, MockupWhy.MatchRating);
            panel.Add(expect);

            panel.Add(Ds.SectionHeader("The basics"));
            panel.Add(Ds.KeyValues(
                ("Winner", match.Slot == "Main event" ? "Ewan Thackeray (planned)" : $"{match.A.Name} (planned)"),
                ("Finish", "Clean pinfall"),
                ("Length", match.Length),
                ("Crowd interest", match.Slot == "Main event" ? "Red hot" : "Warm")));
            VisualElement read = Ds.Column("mk-read");
            read.Add(Ds.Meter(0.92f, DsState.Live, "Crowd"));
            read.Add(Ds.Meter(0.78f, DsState.Good, "Chemistry"));
            read.Add(Ds.Meter(0.55f, DsState.Info, "Risk"));
            panel.Add(read);

            // Advanced: one step away, collapsed by default.
            Button more = Ds.Button("More options: spots, interference, road agent", null, DsButtonKind.Ghost, "chevron-right");
            more.AddToClassList("mk-more");
            panel.Add(more);
            VisualElement actions = Ds.Row("mk-details-actions");
            actions.Add(Ds.Button("Change winner", null, DsButtonKind.Secondary, "edit"));
            actions.Add(Ds.Button("Swap wrestler", null, DsButtonKind.Secondary, "users"));
            actions.Add(Ds.Spacer());
            actions.Add(Ds.IconButton("trash", "Remove from the card", null));
            panel.Add(actions);
            return panel;
        }
    }
}
