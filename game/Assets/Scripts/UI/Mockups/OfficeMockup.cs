using System.Linq;
using RingsideBooker.UI.Design;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Mockups
{
    /// <summary>
    /// Office as a sports homepage: the ticker, the lead story, what needs you today, the next card,
    /// money at a glance, your roster's rankings and the promotion standings. The decisions come first
    /// (Needs you today, top right); everything else is one click away.
    /// </summary>
    public static class OfficeMockup
    {
        public static VisualElement Build(MockupController mock)
        {
            VisualElement page = Ds.Column("mk-page");
            page.Add(DsCards.Ticker("Latest", MockupData.Ticker, animate: !MockupShots.Running));

            VisualElement columns = Ds.Row("ds-row--top", "mk-columns");
            VisualElement main = Ds.Column("mk-main");
            VisualElement side = Ds.Column("mk-side");
            columns.Add(main);
            columns.Add(side);
            page.Add(columns);

            // Lead story: the biggest thing in your world this week, with the two faces of the main event.
            VisualElement leadFaces = Ds.Row("mk-lead__faces");
            leadFaces.Add(DsCards.PortraitBox(null, Alignment.Face, "ds-portrait--xl", gold: true, name: "Calder Voss"));
            VisualElement vs = new SkewShape();
            vs.AddToClassList("mk-lead__vs");
            vs.Add(Ds.Text("VS", "mk-lead__vs-text"));
            leadFaces.Add(vs);
            leadFaces.Add(DsCards.PortraitBox(null, Alignment.Heel, "ds-portrait--xl", name: "Ewan Thackeray"));
            VisualElement lead = DsCards.NewsCard(new NewsItem
            {
                Kicker = "Showcase · Main event",
                Headline = "Thackeray gets his rematch: Voss defends the World title on Sunday",
                Dek = "No disqualification, a long match, Brackwater Arena. The winner goes into Cold Front as champion.",
                When = "Booked yesterday",
                Icon = "trophy",
                State = DsState.Gold,
            }, lead: true, feature: leadFaces);
            lead.AddToClassList("mk-lead");
            main.Add(lead);

            VisualElement twin = Ds.Row("ds-row--top", "mk-twin");
            twin.Add(NextCard(mock));
            twin.Add(TopStories());
            main.Add(twin);
            main.Add(Standings());

            side.Add(NeedsYou(mock));
            side.Add(Money());
            side.Add(Rankings(mock));
            return page;
        }

        private static VisualElement NeedsYou(MockupController mock)
        {
            VisualElement panel = Ds.Panel("Needs you today", null, null, "mk-needs");
            panel.Add(Need(DsState.Live, "live", "Mainstage is tonight", "2 of 6 slots still open", "Book it", () => mock.Go("booking"), primary: true));
            panel.Add(Need(DsState.Warn, "contracts", "Sable Whitcombe's contract ends in 6 weeks", "Your Women's Champion. She's happy to talk.", "Talk", null));
            panel.Add(Need(DsState.Warn, "morale", "Juggernaut is unhappy with her spot", "She wants a singles match at Showcase.", "See why", null));
            panel.Add(Need(DsState.Info, "inbox", "2 offers waiting", "A free agent and a venue booking.", "Open", null));
            panel.Add(Ds.Text("Everything else is running fine.", "mk-quiet"));
            return panel;
        }

        private static VisualElement Need(DsState state, string icon, string title, string detail, string action, System.Action onAction, bool primary = false)
        {
            VisualElement row = Ds.Row("mk-need", Ds.StateClass(state));
            VisualElement badge = Ds.El("mk-need__icon");
            badge.Add(new Icon(icon, "ds-icon--md"));
            row.Add(badge);
            VisualElement words = Ds.Column("mk-need__words");
            words.Add(Ds.Text(title, "mk-need__title"));
            words.Add(Ds.Text(detail, "mk-need__detail"));
            row.Add(words);
            row.Add(Ds.Button(action, onAction, primary ? DsButtonKind.Primary : DsButtonKind.Secondary));
            return row;
        }

        private static VisualElement NextCard(MockupController mock)
        {
            VisualElement panel = Ds.Panel("Next big show", "Open the card", () => mock.Go("booking"), "mk-grow");
            panel.Add(DsCards.ShowCard(MockupData.Showcase()));
            VisualElement list = Ds.Column("mk-mini-card");
            foreach (Matchup match in MockupData.ShowcaseCard().Where(m => m.Title != null).Reverse().Take(4))
            {
                VisualElement row = Ds.Row("mk-mini-match");
                row.Add(new Icon("trophy", "ds-icon--xs", "mk-mini-match__icon"));
                row.Add(Ds.Text(match.A.Name, "mk-mini-match__name"));
                row.Add(Ds.Text("vs", "mk-mini-match__vs"));
                row.Add(Ds.Text(match.B.Name, "mk-mini-match__name"));
                row.Add(Ds.Spacer());
                row.Add(Ds.Text(match.Title.Replace(" Championship", ""), "mk-mini-match__title"));
                list.Add(row);
            }
            panel.Add(list);
            VisualElement upcoming = Ds.Row("mk-upcoming");
            upcoming.Add(Ds.Text("ALSO THIS WEEK", "mk-label"));
            upcoming.Add(Ds.Chip("Mainstage · Tonight · 4/6", false, () => mock.Go("booking"), null, "tv"));
            upcoming.Add(Ds.Chip("Overclock · Wed · 0/6", false, () => mock.Go("booking"), null, "tv"));
            panel.Add(upcoming);
            return panel;
        }

        private static VisualElement TopStories()
        {
            VisualElement panel = Ds.Panel("Top stories", "All news", null, "mk-grow", "mk-stories");
            foreach (NewsItem item in MockupData.Stories.Take(3)) panel.Add(DsCards.NewsCard(item));
            return panel;
        }

        private static VisualElement Money()
        {
            VisualElement panel = Ds.Panel("Money at a glance", "Finances", null);
            VisualElement tiles = Ds.Row("mk-tiles");
            tiles.Add(Ds.StatTile("Cash", "$40.62M", "Plenty in the bank", DsState.Good, why: MockupWhy.Cash));
            tiles.Add(Ds.StatTile("This month", "+$1.10M", "Ahead of last month", DsState.Good));
            tiles.Add(Ds.StatTile("Payday Feb 1", "−$0.95M", "Wages, all covered", DsState.Neutral));
            panel.Add(tiles);
            panel.Add(Ds.Meter(0.62f, DsState.Info, "Budget used"));
            panel.Add(Ds.Text("62% of January's budget spent with a week to go.", "mk-quiet"));
            return panel;
        }

        private static VisualElement Rankings(MockupController mock)
        {
            VisualElement panel = Ds.Panel("Power rankings", "Roster", () => mock.Go("roster"));
            var tabs = new DsTabs(segmented: true);
            tabs.Add("roster", "Your roster").Add("women", "Women").Add("tag", "Tag teams");
            panel.Add(tabs);
            int rank = 1;
            foreach (MockWorker worker in MockupData.Roster.OrderByDescending(w => w.Popularity * 2 + w.Overall).Take(8))
            {
                VisualElement row = Ds.Row("mk-rank");
                row.Add(Ds.Text(rank.ToString(), "mk-rank__number"));
                row.Add(DsCards.PortraitBox(null, worker.Alignment, "ds-portrait--xs", worker.Champion != null, worker.Name));
                VisualElement words = Ds.Column("mk-rank__words");
                words.Add(Ds.Text(worker.Name, "mk-rank__name"));
                words.Add(Ds.Text(worker.Champion ?? worker.Position, worker.Champion != null ? "mk-rank__champ" : "mk-rank__role"));
                row.Add(words);
                row.Add(Ds.Spacer());
                DsState trendState = worker.TrendState;
                VisualElement trend = Ds.El("ds-trend", Ds.StateClass(trendState));
                trend.Add(new Icon(trendState == DsState.Good ? "up" : trendState == DsState.Bad ? "down" : "flat", "ds-icon--xs"));
                row.Add(trend);
                panel.Add(row);
                rank++;
            }
            return panel;
        }

        private static VisualElement Standings()
        {
            VisualElement panel = Ds.Panel("Standings: biggest promotions", "World", null, "mk-standings");
            var table = new DsTable<Standing>(new[]
            {
                new DsColumn<Standing>("rank", "#", row => Ds.Text((System.Array.IndexOf(MockupData.Standings, row) + 1).ToString(), "ds-cell__text", "ds-cell__text--muted")) { Width = 40 },
                new DsColumn<Standing>("name", "Promotion", row => Ds.Text(row.Name, "ds-cell__text", row.Name == MockupData.Promotion ? "ds-cell__text--strong" : "ds-cell__text--plain")) { Grow = 3, Pinned = true, SortKey = row => row.Name },
                DsColumn<Standing>.Text("region", "Home", row => row.Region),
                new DsColumn<Standing>("pop", "Popularity", row => Popularity(row.Popularity)) { Grow = 1.5f, SortKey = row => row.Popularity, Help = "How popular they are in their home region, in words, then the number." },
                new DsColumn<Standing>("trend", "Month", row => Trend(row.Trend, row.TrendState)) { Width = 80, Align = DsAlign.Right },
                new DsColumn<Standing>("prestige", "Prestige", row => Ds.Text(row.Prestige.ToString(), "ds-cell__text", "ds-cell__text--num")) { Width = 90, Align = DsAlign.Right, Default = false, SortKey = row => row.Prestige },
            }, MockupData.Standings);
            panel.Add(table);
            return panel;
        }

        public static VisualElement Popularity(int value)
        {
            string word = value >= 70 ? "Huge" : value >= 55 ? "Big" : value >= 40 ? "Solid" : value >= 25 ? "Small" : "Tiny";
            DsState state = value >= 70 ? DsState.Gold : value >= 55 ? DsState.Info : DsState.Neutral;
            VisualElement cell = Ds.Row();
            cell.Add(Ds.Dot(state, word));
            cell.Add(Ds.Text(value.ToString(), "mk-num-quiet"));
            return cell;
        }

        public static VisualElement Trend(string text, DsState state)
        {
            VisualElement trend = Ds.El("ds-trend", Ds.StateClass(state), "mk-trend-cell");
            trend.Add(new Icon(state == DsState.Good ? "up" : state == DsState.Bad ? "down" : "flat", "ds-icon--xs"));
            trend.Add(Ds.Text(text, "ds-trend__text"));
            return trend;
        }
    }
}
