using System.Collections.Generic;
using System.Linq;
using RingsideBooker.UI.Design;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Mockups
{
    /// <summary>
    /// Show night with a broadcast feel: a LIVE bar and the show-so-far scoreboard, the current segment
    /// big in the middle with a few lines of play-by-play, the running order on the right, and one
    /// clear control (Run the next segment) with Sim the rest beside it.
    /// </summary>
    public static class ShowNightMockup
    {
        public static VisualElement Build(MockupController mock)
        {
            VisualElement page = Ds.Column("mk-page", "mk-broadcast");
            List<Matchup> card = MockupData.ShowcaseCard();
            const int current = 7;

            VisualElement bar = Ds.Row("mk-live-bar");
            VisualElement live = Ds.Pill(DsState.Live, "LIVE", "live", solid: true);
            live.AddToClassList("mk-live-pill");
            bar.Add(live);
            bar.Add(DsCards.Logo("AW", MockupData.PromotionColor, "ds-logo--sm"));
            VisualElement title = Ds.Column("mk-live-bar__title");
            title.Add(Ds.Text("ALTURA SHOWCASE", "mk-live-bar__name"));
            title.Add(Ds.Text("Brackwater Arena · Sun 31 Jan 2027 · Turnstile Pay-Per-View", "ds-type-caption"));
            bar.Add(title);
            bar.Add(Ds.Spacer());
            bar.Add(DsCards.Scoreboard(new[]
            {
                ("Segment", $"{current + 1} / {card.Count}", "Co-main event", DsState.Neutral),
                ("Crowd", "14,212", "95% full", DsState.Good),
                ("Show so far", "3½ ★", "Great so far", DsState.Gold),
                ("Heat", "Hot", "Rising all night", DsState.Live),
            }, "live"));
            page.Add(bar);

            VisualElement columns = Ds.Row("ds-row--top", "mk-columns");
            VisualElement stage = Ds.Column("mk-stage");
            VisualElement now = Ds.Row("mk-now");
            VisualElement nowTag = new SkewShape { SkewLeft = false };
            nowTag.AddToClassList("mk-now__tag");
            nowTag.Add(Ds.Text("NOW", "mk-now__tag-text"));
            now.Add(nowTag);
            now.Add(Ds.Text("Co-main event · in progress · Long match, into the closing stretch", "mk-now__text"));
            stage.Add(now);
            card[current].Stars = null; // no rating until it's over
            stage.Add(DsCards.MatchupCard(card[current], big: true));

            VisualElement momentum = Ds.Panel(null, null, null, "mk-momentum");
            VisualElement sides = Ds.Row("mk-momentum__sides");
            sides.Add(Ds.Text("HALVORSEN", "mk-momentum__name"));
            sides.Add(Ds.Spacer());
            sides.Add(Ds.Text("WHO'S ON TOP", "mk-label"));
            sides.Add(Ds.Spacer());
            sides.Add(Ds.Text("TAKAMORI", "mk-momentum__name"));
            momentum.Add(sides);
            VisualElement track = Ds.Row("mk-momentum__track");
            VisualElement left = Ds.El("mk-momentum__left");
            left.style.width = Length.Percent(44);
            track.Add(left);
            track.Add(Ds.El("mk-momentum__right"));
            momentum.Add(track);
            stage.Add(momentum);

            VisualElement feed = Ds.Panel("Play by play", null, null, "mk-feed");
            (string time, string text, bool big)[] lines =
            {
                ("NOW", "Takamori hits the spinning heel kick, Halvorsen kicks out at two!", true),
                ("", "Halvorsen works the arm, the crowd behind Takamori now.", false),
                ("", "Big dive to the floor from Takamori. Brackwater is on its feet.", false),
                ("", "Halvorsen cheats to take over: a thumb to the eye behind the referee's back.", false),
            };
            foreach ((string time, string text, bool big) in lines)
            {
                VisualElement row = Ds.Row("mk-feed__line");
                if (big) row.AddToClassList("mk-feed__line--big");
                row.Add(Ds.Text(time, "mk-feed__time"));
                row.Add(Ds.Text(text, "mk-feed__text"));
                feed.Add(row);
            }
            stage.Add(feed);

            VisualElement controls = Ds.Row("mk-controls");
            SkewButton run = Ds.Cta("Run to the finish", null, "play");
            run.AddToClassList("ds-cta--lg");
            controls.Add(run);
            controls.Add(Ds.Button("Sim the rest", () => mock.Show(MockupScreens.Results), DsButtonKind.Secondary, "fast-forward"));
            controls.Add(Ds.Button("Pause", null, DsButtonKind.Ghost, "pause"));
            controls.Add(Ds.Spacer());
            controls.Add(Ds.Text("Space: run · S: sim the rest", "ds-type-caption"));
            stage.Add(controls);
            columns.Add(stage);

            VisualElement order = Ds.Panel("Running order", null, null, "mk-order");
            for (int index = 0; index < card.Count; index++)
            {
                Matchup match = card[index];
                VisualElement row = Ds.Row("mk-order__row");
                if (index < current) row.AddToClassList("mk-order__row--done");
                if (index == current) row.AddToClassList("mk-order__row--now");
                row.Add(Ds.Text(index == 0 ? "PRE" : index.ToString(), "mk-order__number"));
                VisualElement words = Ds.Column("mk-order__words");
                words.Add(Ds.Text($"{Short(match.A.Name)} vs {Short(match.B?.Name)}", "mk-order__name"));
                words.Add(Ds.Text(match.Title != null ? match.Title.Replace(" Championship", " title") : match.Slot, match.Title != null ? "mk-order__title" : "mk-order__slot"));
                row.Add(words);
                row.Add(Ds.Spacer());
                if (index < current) row.Add(new Stars(Results[index], "ds-icon--xs"));
                else if (index == current) row.Add(Ds.Pill(DsState.Live, "Live", "live"));
                else row.Add(Ds.Text(match.Length, "ds-type-caption"));
                order.Add(row);
            }
            columns.Add(order);
            page.Add(columns);
            return page;
        }

        /// <summary>The ratings the earlier matches got (the results screen uses the same).</summary>
        public static readonly float[] Results = { 2f, 3f, 2.5f, 3.5f, 3f, 2.5f, 4f, 4f, 4.5f };

        private static string Short(string name)
        {
            if (name == null) return string.Empty;
            string[] parts = name.Split(' ');
            return parts.Length > 1 && parts[0] != "The" ? parts.Last() : name;
        }
    }

    /// <summary>
    /// Results: the show's grade first (stars and a word), the scoreboard, then one reveal card per match
    /// (winner on the left, finish and stars), and the key changes on the right, each with a quiet Why?.
    /// Cards reveal one after another.
    /// </summary>
    public static class ResultsMockup
    {
        public static VisualElement GradeWhyHost { get; private set; }

        public static VisualElement Build(MockupController mock)
        {
            VisualElement page = Ds.Column("mk-page");
            List<Matchup> card = MockupData.ShowcaseCard();
            string[] finishes =
            {
                "Pinfall", "Pinfall", "Submission", "Pinfall", "Pinfall",
                "Count-out", "Submission", "Pinfall", "Pinfall",
            };
            int[] winners = { 0, 0, 1, 0, 0, 1, 0, 0, 1 };
            for (int index = 0; index < card.Count; index++)
            {
                card[index].Stars = ShowNightMockup.Results[index];
                card[index].Winner = winners[index];
                card[index].Finish = finishes[index];
                card[index].Flags.Clear();
            }
            card[5].Flags.Add((DsState.Bad, "The Cheetah hurt his knee"));
            // The title changes hands: the crown moves to the winner.
            card[8].A = new MatchupSide("Calder Voss", Alignment.Face, "Reign ends at 300 days");
            card[8].B = new MatchupSide("Ewan Thackeray", Alignment.Heel, "New champion", "Altura World Champion");

            VisualElement hero = Ds.Row("mk-results-hero");
            VisualElement grade = Ds.Column("mk-grade");
            grade.Add(Ds.Text("TONIGHT'S RESULTS", "mk-label"));
            grade.Add(Ds.Text("ALTURA SHOWCASE", "ds-type-display"));
            VisualElement stars = Ds.Row("mk-grade__stars");
            stars.Add(new Stars(4f, "ds-icon--xl"));
            stars.Add(Ds.Text("Great show", "mk-grade__word"));
            Ds.Why(stars, MockupWhy.ShowGrade);
            GradeWhyHost = stars;
            grade.Add(stars);
            grade.Add(Ds.Text("Your best show of the year so far, and a new World Champion.", "ds-type-body"));
            hero.Add(grade);
            hero.Add(Ds.Spacer());
            VisualElement board = DsCards.Scoreboard(new[]
            {
                ("Attendance", "14,212", "95% full", DsState.Good),
                ("Gate", "$1.21M", "+$0.18M merch", DsState.Good),
                ("Viewers", "2.4M", "Pay-per-view buys 61K", DsState.Neutral),
                ("Popularity", "+2", "Northeast now 77", DsState.Good),
            }, "broadcast");
            board.AddToClassList("mk-results-board");
            Ds.Why(board.Children().First(), MockupWhy.Attendance);
            hero.Add(board);
            page.Add(hero);

            VisualElement columns = Ds.Row("ds-row--top", "mk-columns");
            VisualElement reveals = Ds.Column("mk-reveals");

            // The main event leads, big, with the title change.
            Matchup main = card.Last();
            VisualElement banner = Ds.Row("mk-new-champ");
            VisualElement bannerShape = new SkewShape { SkewLeft = false };
            bannerShape.AddToClassList("mk-new-champ__tag");
            bannerShape.Add(new Icon("crown", "ds-icon--sm", "mk-new-champ__icon"));
            bannerShape.Add(Ds.Text("AND NEW", "mk-new-champ__tag-text"));
            banner.Add(bannerShape);
            banner.Add(Ds.Text("Ewan Thackeray is the new Altura World Champion", "mk-new-champ__text"));
            reveals.Add(banner);
            VisualElement mainCard = DsCards.MatchupCard(main, big: true);
            reveals.Add(mainCard);

            VisualElement grid = Ds.Row("ds-row--wrap", "ds-row--top", "mk-reveal-grid");
            var revealOrder = new List<VisualElement> { banner, mainCard };
            for (int index = card.Count - 2; index >= 0; index--)
            {
                VisualElement cell = DsCards.MatchupCard(card[index]);
                cell.AddToClassList("mk-reveal-cell");
                grid.Add(cell);
                revealOrder.Add(cell);
            }
            reveals.Add(grid);
            columns.Add(reveals);

            VisualElement side = Ds.Column("mk-side");
            VisualElement changes = Ds.Panel("Key changes", null, null);
            changes.Add(Change(DsState.Gold, "crown", "New World Champion", "Ewan Thackeray ends Calder Voss's 300-day reign.", null));
            changes.Add(Change(DsState.Good, "trend-up", "Ren Takamori's stock is rising", "Lost, but stole the show: popularity +4.", MockupWhy.WorkerPopularity(MockupData.Get("Ren Takamori"))));
            changes.Add(Change(DsState.Warn, "morale", "Calder Voss is upset", "He wants the rematch at Cold Front.", null));
            changes.Add(Change(DsState.Bad, "injured", "The Cheetah hurt his knee", "Out about 2 weeks. He was banged up going in.", null));
            changes.Add(Change(DsState.Good, "money", "A $1.39M night", "Gate $1.21M, merchandise $0.18M.", MockupWhy.Attendance));
            side.Add(changes);

            VisualElement star = Ds.Panel("Star of the night", null, null, "mk-star-night");
            VisualElement starRow = Ds.Row("ds-row--top");
            starRow.Add(DsCards.PortraitBox(null, Alignment.Heel, "ds-portrait--md", gold: true));
            VisualElement starWords = Ds.Column("mk-star-night__words");
            starWords.Add(Ds.Text("EWAN THACKERAY", "ds-type-title"));
            starWords.Add(new Stars(4.5f, "ds-icon--md"));
            starWords.Add(Ds.Text("Main event of the night and the year so far.", "ds-type-caption"));
            starRow.Add(starWords);
            star.Add(starRow);
            side.Add(star);

            VisualElement next = Ds.Row("mk-results-next");
            next.Add(Ds.Button("Watch the replay", null, DsButtonKind.Ghost, "play"));
            next.Add(Ds.Spacer());
            SkewButton done = Ds.Cta("Back to the office", () => mock.Show(MockupScreens.Office), "chevron-right");
            next.Add(done);
            side.Add(next);
            columns.Add(side);
            page.Add(columns);

            // The reveal: one card after another (instant during the screenshot tour).
            if (!MockupShots.Running)
            {
                for (int index = 0; index < revealOrder.Count; index++)
                {
                    VisualElement element = revealOrder[index];
                    element.AddToClassList("mk-reveal");
                    element.schedule.Execute(() => element.RemoveFromClassList("mk-reveal")).StartingIn(250 + index * 180);
                }
            }
            return page;
        }

        private static VisualElement Change(DsState state, string icon, string title, string detail, WhyBreakdown why)
        {
            VisualElement row = Ds.Row("ds-row--top", "mk-change", Ds.StateClass(state));
            VisualElement badge = Ds.El("mk-need__icon");
            badge.Add(new Icon(icon, "ds-icon--md"));
            row.Add(badge);
            VisualElement words = Ds.Column("mk-need__words");
            VisualElement top = Ds.Row();
            top.Add(Ds.Text(title, "mk-need__title"));
            words.Add(top);
            words.Add(Ds.Text(detail, "mk-need__detail"));
            row.Add(words);
            if (why != null) Ds.Why(row, why, top);
            return row;
        }
    }
}
