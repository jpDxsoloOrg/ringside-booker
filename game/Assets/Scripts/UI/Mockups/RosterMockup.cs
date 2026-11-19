using System.Collections.Generic;
using System.Linq;
using RingsideBooker.UI.Design;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Mockups
{
    /// <summary>
    /// Roster in two views: portrait cards (the default: who's who at a glance) and the compact table
    /// (short default columns, more in the column picker, rows that expand). Filters sit behind one
    /// Filter button; a row or card opens the worker in a side sheet.
    /// </summary>
    public static class RosterMockup
    {
        /// <summary>The table built last (the screenshot tour expands a row and opens its column picker).</summary>
        public static DsTable<MockWorker> LastTable { get; private set; }

        public static VisualElement Build(MockupController mock)
        {
            VisualElement page = Ds.Column("mk-page");

            VisualElement head = Ds.Row("mk-head");
            VisualElement titles = Ds.Column();
            titles.Add(Ds.Text("ROSTER", "ds-type-headline"));
            int champions = MockupData.Roster.Count(w => w.Champion != null);
            int look = MockupData.Roster.Count(w => w.ConditionState.state == DsState.Bad || w.MoraleState.state == DsState.Bad || w.ContractSoon);
            titles.Add(Ds.Text($"{MockupData.Roster.Count} wrestlers · {champions} hold titles · {look} need a look", "ds-type-caption"));
            head.Add(titles);
            head.Add(Ds.Spacer());
            var view = new DsTabs(segmented: true);
            view.Add("cards", "Cards", null, "users").Add("table", "Table", null, "columns");
            view.Select(mock.RosterView, false);
            view.Selected += id =>
            {
                mock.RosterView = id;
                mock.Show(MockupScreens.Roster);
            };
            head.Add(view);
            page.Add(head);

            VisualElement bar = Ds.Row("mk-toolbar");
            var tabs = new DsTabs();
            tabs.Add("all", "All", MockupData.Roster.Count)
                .Add("men", "Men", MockupData.Roster.Count(w => w.Gender == "male"))
                .Add("women", "Women", MockupData.Roster.Count(w => w.Gender != "male"))
                .Add("tag", "Tag teams", 6)
                .Add("champions", "Champions", champions);
            bar.Add(tabs);
            bar.Add(Ds.Spacer());
            bar.Add(Search("Search the roster"));
            bar.Add(Ds.Button("Filter", null, DsButtonKind.Secondary, "filter"));
            bar.Add(Ds.Button("Sort: Card position", null, DsButtonKind.Ghost, "sort"));
            page.Add(bar);

            // Needs-a-look strip: plain words, coloured by state; quiet when nothing's wrong.
            VisualElement attention = Ds.Row("mk-attention");
            attention.Add(Ds.Text("WORTH A LOOK", "mk-label"));
            attention.Add(Ds.Pill(DsState.Bad, "Karen Hill is hurting", "injured"));
            attention.Add(Ds.Pill(DsState.Warn, "Ewan Thackeray is unhappy", "morale"));
            attention.Add(Ds.Pill(DsState.Warn, "4 contracts end by April", "contracts"));
            page.Add(attention);

            List<MockWorker> ordered = MockupData.Roster.OrderByDescending(w => w.PushRank).ThenByDescending(w => w.Popularity).ToList();
            if (mock.RosterView == "table")
            {
                LastTable = Table(ordered);
                LastTable.RowClicked += worker => OpenWorker(mock, worker);
                page.Add(LastTable);
            }
            else
            {
                VisualElement grid = Ds.Row("ds-row--wrap", "ds-row--top", "mk-card-grid");
                foreach (MockWorker worker in ordered)
                {
                    VisualElement card = DsCards.PortraitCard(worker.ToCard());
                    MockWorker target = worker;
                    card.AddManipulator(new Clickable(() => OpenWorker(mock, target)));
                    grid.Add(card);
                }
                page.Add(grid);
            }
            return page;
        }

        public static VisualElement Search(string placeholder)
        {
            VisualElement box = Ds.Row("mk-search");
            box.Add(new Icon("search", "ds-icon--sm", "mk-search__icon"));
            var field = new TextField { name = "roster-search" };
            field.AddToClassList("mk-search__field");
            field.textEdition.placeholder = placeholder;
            box.Add(field);
            return box;
        }

        private static DsTable<MockWorker> Table(IEnumerable<MockWorker> rows)
        {
            var columns = new List<DsColumn<MockWorker>>
            {
                new DsColumn<MockWorker>("name", "Name", NameCell) { Grow = 2.6f, MinWidth = 220, Pinned = true, SortKey = w => w.Name },
                new DsColumn<MockWorker>("position", "Position", w => Ds.Text(w.Position, "ds-cell__text")) { Grow = 1.1f, SortKey = w => w.PushRank, Help = "Where they sit on the card." },
                new DsColumn<MockWorker>("side", "Side", w => Ds.Tag(w.Alignment.ToString(), w.Alignment.ToString().ToLowerInvariant())) { Width = 80, SortKey = w => (int)w.Alignment },
                new DsColumn<MockWorker>("popularity", "Popularity", PopularityCell) { Grow = 1.4f, SortKey = w => w.Popularity, Help = "How well known they are in your home region. Hover a value for Why?" },
                new DsColumn<MockWorker>("morale", "Morale", w => Ds.Dot(w.MoraleState.state, w.MoraleState.word)) { Grow = 1f, SortKey = w => w.Morale },
                new DsColumn<MockWorker>("condition", "Condition", w => Ds.Dot(w.ConditionState.state, w.ConditionState.word)) { Grow = 1f, SortKey = w => w.Condition },
                new DsColumn<MockWorker>("contract", "Contract", w => w.ContractSoon ? Ds.Pill(DsState.Warn, w.ContractWord, "contracts") : Ds.Text(w.ContractWord, "ds-cell__text")) { Grow = 1.1f, SortKey = w => w.ContractEnds },
                new DsColumn<MockWorker>("style", "Style", w => Ds.Text(w.StyleWord, "ds-cell__text")) { Grow = 1f, Default = false, SortKey = w => w.Style },
                new DsColumn<MockWorker>("age", "Age", w => Num(w.Age)) { Width = 60, Align = DsAlign.Right, Default = false, SortKey = w => w.Age },
                new DsColumn<MockWorker>("overall", "In-ring", w => Num(w.Overall)) { Width = 80, Align = DsAlign.Right, Default = false, SortKey = w => w.Overall, Help = "Ring work, charisma and mic in one number." },
                new DsColumn<MockWorker>("ringwork", "Ring work", w => Num(w.Ringwork)) { Width = 90, Align = DsAlign.Right, Default = false, SortKey = w => w.Ringwork },
                new DsColumn<MockWorker>("mic", "Mic", w => Num(w.Mic)) { Width = 60, Align = DsAlign.Right, Default = false, SortKey = w => w.Mic },
                new DsColumn<MockWorker>("charisma", "Charisma", w => Num(w.Charisma)) { Width = 90, Align = DsAlign.Right, Default = false, SortKey = w => w.Charisma },
                new DsColumn<MockWorker>("stamina", "Stamina", w => Num(w.Stamina)) { Width = 80, Align = DsAlign.Right, Default = false, SortKey = w => w.Stamina },
                new DsColumn<MockWorker>("wage", "Wage / month", w => Ds.Text($"${w.MonthlyWage:N0}", "ds-cell__text", "ds-cell__text--num")) { Width = 120, Align = DsAlign.Right, Default = false, SortKey = w => w.MonthlyWage },
            };
            var table = new DsTable<MockWorker>(columns, rows, Details);
            table.AddToClassList("mk-roster-table");
            return table;
        }

        private static VisualElement Num(int value) => Ds.Text(value.ToString(), "ds-cell__text", "ds-cell__text--num");

        private static VisualElement NameCell(MockWorker worker)
        {
            VisualElement cell = Ds.Row("mk-name-cell");
            cell.Add(DsCards.PortraitBox(null, worker.Alignment, "ds-portrait--xs", worker.Champion != null, worker.Name));
            cell.Add(Ds.Text(worker.Name, "ds-cell__text", "ds-cell__text--strong", "mk-name-cell__name"));
            if (worker.Champion != null)
            {
                Icon crown = new Icon("crown", "ds-icon--xs", "mk-name-cell__crown");
                cell.Add(crown);
            }
            return cell;
        }

        private static VisualElement PopularityCell(MockWorker worker)
        {
            VisualElement cell = Ds.Row("mk-pop-cell");
            DsState state = worker.Popularity >= 70 ? DsState.Gold : worker.Popularity >= 45 ? DsState.Info : DsState.Neutral;
            cell.Add(Ds.Dot(state, worker.PopularityWord));
            cell.Add(Ds.Text(worker.Popularity.ToString(), "mk-num-quiet"));
            if (worker.Trend != null)
            {
                VisualElement trend = Ds.El("ds-trend", Ds.StateClass(worker.TrendState), "mk-pop-cell__trend");
                trend.Add(new Icon(worker.TrendState == DsState.Bad ? "down" : "up", "ds-icon--xs"));
                cell.Add(trend);
            }
            Ds.Why(cell, MockupWhy.WorkerPopularity(worker));
            return cell;
        }

        /// <summary>The expanded row: the parts behind the words, and the actions you'd take next.</summary>
        private static VisualElement Details(MockWorker worker)
        {
            VisualElement row = Ds.Row("ds-row--top", "mk-details");
            VisualElement skills = Ds.Column("mk-details__col");
            skills.Add(Ds.Text("IN THE RING", "mk-label"));
            skills.Add(Skill("Ring work", worker.Ringwork));
            skills.Add(Skill("Charisma", worker.Charisma));
            skills.Add(Skill("Mic", worker.Mic));
            skills.Add(Skill("Stamina", worker.Stamina));
            row.Add(skills);

            VisualElement facts = Ds.Column("mk-details__col");
            facts.Add(Ds.Text("ABOUT", "mk-label"));
            facts.Add(Ds.KeyValues(
                ("Style", worker.StyleWord),
                ("Age", worker.Age.ToString()),
                ("Wage", $"${worker.MonthlyWage:N0} a month"),
                ("Contract", worker.ContractEnds.ToString("d MMM yyyy"))));
            row.Add(facts);

            VisualElement notes = Ds.Column("mk-details__col");
            notes.Add(Ds.Text("WORTH KNOWING", "mk-label"));
            foreach (string trait in worker.Traits.Split(',').Select(t => t.Trim()).Where(t => t.Length > 0).Take(3))
            {
                notes.Add(Ds.Pill(TraitState(trait), TraitWords(trait), TraitState(trait) == DsState.Good ? "check" : TraitState(trait) == DsState.Warn ? "warning" : "info"));
            }
            VisualElement actions = Ds.Row("mk-details__actions");
            actions.Add(Ds.Button("Set push", null, DsButtonKind.Secondary, "trend-up"));
            actions.Add(Ds.Button("Contract", null, DsButtonKind.Secondary, "contracts"));
            actions.Add(Ds.Button("Full profile", null, DsButtonKind.Ghost, "chevron-right"));
            notes.Add(actions);
            row.Add(notes);
            return row;
        }

        private static VisualElement Skill(string label, int value)
        {
            DsState state = value >= 75 ? DsState.Good : value >= 50 ? DsState.Info : DsState.Neutral;
            string word = value >= 80 ? "Excellent" : value >= 65 ? "Good" : value >= 50 ? "Solid" : value >= 35 ? "Raw" : "Poor";
            VisualElement row = Ds.Row("mk-skill");
            row.Add(Ds.Text(label, "mk-skill__label"));
            row.Add(Ds.Meter(value / 100f, state, word));
            row.Add(Ds.Text(value.ToString(), "mk-num-quiet"));
            return row;
        }

        private static DsState TraitState(string trait) => trait switch
        {
            "injuryProne" or "agesBadly" or "shrinksOnBigStage" or "poorSeller" or "egotist" or "troublemaker" or "sensitive" => DsState.Warn,
            "durable" or "workhorse" or "professional" or "teacher" or "bigMatchPerformer" or "generousSeller" or "loyal" or "fastLearner" or "agesWell" => DsState.Good,
            _ => DsState.Info,
        };

        private static string TraitWords(string trait) => trait switch
        {
            "injuryProne" => "Gets hurt easily",
            "agesBadly" => "Ages badly",
            "agesWell" => "Ages well",
            "shrinksOnBigStage" => "Shrinks on a big stage",
            "bigMatchPerformer" => "Big-match performer",
            "poorSeller" => "Poor seller",
            "generousSeller" => "Generous seller",
            "durable" => "Durable",
            "workhorse" => "Workhorse",
            "professional" => "Professional",
            "teacher" => "Good teacher",
            "loyal" => "Loyal",
            "fastLearner" => "Fast learner",
            "slowLearner" => "Slow learner",
            "egotist" => "Big ego",
            "troublemaker" => "Troublemaker",
            "sensitive" => "Sensitive",
            "coaster" => "Coasts",
            "journeyman" => "Journeyman",
            "prankster" => "Prankster",
            "tagSpecialist" => "Tag specialist",
            "lovesComedy" => "Loves comedy",
            "refusesComedy" => "Won't do comedy",
            "lovesHardcore" => "Loves hardcore",
            "refusesHardcore" => "Won't do hardcore",
            "selfless" => "Selfless",
            "naturalHeel" => "Natural heel",
            "naturalFace" => "Natural face",
            _ => trait,
        };

        /// <summary>A worker in a side sheet: the full picture without leaving the roster.</summary>
        public static void OpenWorker(MockupController mock, MockWorker worker)
        {
            VisualElement body = Ds.Column("mk-worker");
            VisualElement hero = Ds.Row("ds-row--top", "mk-worker__hero");
            hero.Add(DsCards.PortraitBox(null, worker.Alignment, "ds-portrait--lg", worker.Champion != null, worker.Name));
            VisualElement words = Ds.Column("mk-worker__words");
            if (worker.Champion != null) words.Add(Ds.Pill(DsState.Gold, worker.Champion, "crown"));
            words.Add(Ds.Text(worker.Name.ToUpperInvariant(), "ds-type-headline"));
            VisualElement tags = Ds.Row("mk-worker__tags");
            tags.Add(Ds.Tag(worker.Alignment.ToString(), worker.Alignment.ToString().ToLowerInvariant()));
            tags.Add(Ds.Text($"{worker.Position} · {worker.StyleWord} · {worker.Age}", "ds-type-caption"));
            words.Add(tags);
            VisualElement states = Ds.Column("mk-worker__states");
            states.Add(Ds.Dot(worker.MoraleState.state, $"Morale: {worker.MoraleState.word}"));
            states.Add(Ds.Dot(worker.ConditionState.state, $"Condition: {worker.ConditionState.word}"));
            words.Add(states);
            hero.Add(words);
            body.Add(hero);

            VisualElement tiles = Ds.Row("mk-tiles");
            VisualElement popularity = Ds.StatTile("Popularity", worker.Popularity.ToString(), worker.PopularityWord, DsState.Info, worker.Trend, worker.TrendState, MockupWhy.WorkerPopularity(worker));
            popularity.AddToClassList("ds-stat--sm");
            tiles.Add(popularity);
            VisualElement overall = Ds.StatTile("In-ring", worker.Overall.ToString(), worker.Overall >= 70 ? "Top level" : worker.Overall >= 55 ? "Reliable" : "Developing");
            overall.AddToClassList("ds-stat--sm");
            tiles.Add(overall);
            body.Add(tiles);

            body.Add(Ds.SectionHeader("In the ring"));
            body.Add(Skill("Ring work", worker.Ringwork));
            body.Add(Skill("Charisma", worker.Charisma));
            body.Add(Skill("Mic", worker.Mic));
            body.Add(Skill("Stamina", worker.Stamina));
            body.Add(Ds.SectionHeader("Contract"));
            body.Add(Ds.KeyValues(("Wage", $"${worker.MonthlyWage:N0} a month"), ("Ends", worker.ContractEnds.ToString("d MMM yyyy")), ("Exclusive", "Yes")));
            VisualElement footer = Ds.Row();
            footer.Add(Ds.Button("Set push", null, DsButtonKind.Secondary, "trend-up"));
            footer.Add(Ds.Spacer());
            footer.Add(Ds.Button("Book in a match", () => mock.Go("booking"), DsButtonKind.Primary, "booking"));
            DsOverlay.SideSheet(mock.Shell.Root, worker.Name, body, worker.Position, footer, 480f);
        }
    }
}
