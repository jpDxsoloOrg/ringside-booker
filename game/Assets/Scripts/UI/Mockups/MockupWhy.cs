using RingsideBooker.UI.Design;

namespace RingsideBooker.UI.Mockups
{
    /// <summary>
    /// Hand-written Why? breakdowns for the mockups: words first, then each part's effect. In the game
    /// these come from the engine's traces (UNITY-08); the numbers here are illustrative.
    /// </summary>
    public static class MockupWhy
    {
        public static readonly WhyBreakdown Cash = new WhyBreakdown(
            "Cash", "$40.62M",
            "Up $1.10M this month: ticket sales and TV money more than covered wages.",
            new WhyLine("TV deals", "+$0.69M", DsState.Good, "National Signal Network (Mainstage) and Kestrel Sports (Overclock)"),
            new WhyLine("Ticket sales", "+$1.12M", DsState.Good, "4 shows, 52,300 tickets"),
            new WhyLine("Merchandise", "+$0.31M", DsState.Good),
            new WhyLine("Wages", "−$0.95M", DsState.Bad, "44 wrestlers and 11 crew"),
            new WhyLine("Production and travel", "−$0.07M", DsState.Bad));

        public static readonly WhyBreakdown Popularity = new WhyBreakdown(
            "Popularity in the Northeast", "75",
            "Very popular at home and still growing: good shows on TV every week.",
            new WhyLine("Show quality (last 4 weeks)", "+1.2", DsState.Good, "Average 3.3 stars"),
            new WhyLine("TV reach", "+0.6", DsState.Good),
            new WhyLine("Star power", "+0.4", DsState.Good, "Calder Voss, Jett Amberley"),
            new WhyLine("Natural fade", "−0.9", DsState.Bad, "Every promotion drifts down a little each month"));

        public static WhyBreakdown WorkerPopularity(MockWorker worker) => new WhyBreakdown(
            $"{worker.Name}'s popularity", worker.Popularity.ToString(),
            $"{worker.PopularityWord} in the Northeast. {(worker.TrendState == DsState.Good ? "Rising after strong TV matches." : worker.TrendState == DsState.Bad ? "Slipping: few wins lately." : "Steady.")}",
            new WhyLine("Match results (last 30 days)", worker.TrendState == DsState.Bad ? "−2" : "+2", worker.TrendState == DsState.Bad ? DsState.Bad : DsState.Good),
            new WhyLine("TV time", "+1", DsState.Good, "On every Mainstage this month"),
            new WhyLine("Card position", worker.PushRank >= 4 ? "+1" : "0", worker.PushRank >= 4 ? DsState.Good : DsState.Neutral, worker.Position),
            new WhyLine("Natural fade", "−1", DsState.Bad));

        public static readonly WhyBreakdown MatchRating = new WhyBreakdown(
            "Expected match rating", "4½ stars",
            "Two of your best in a title match the crowd wants to see. The no-DQ stipulation suits Thackeray.",
            new WhyLine("Ring work (both)", "+1.9", DsState.Good, "Thackeray 87 · Voss 78"),
            new WhyLine("Crowd interest", "+1.2", DsState.Good, "The rematch has built for 4 weeks"),
            new WhyLine("Title on the line", "+0.6", DsState.Good),
            new WhyLine("Chemistry", "+0.5", DsState.Good, "Good: 3 matches together"),
            new WhyLine("Length: Long", "+0.3", DsState.Good, "Room to build a classic"),
            new WhyLine("Thackeray shrinks on a big stage", "−0.2", DsState.Bad));

        public static readonly WhyBreakdown ShowGrade = new WhyBreakdown(
            "Show rating", "4 stars",
            "A great show: three matches at four stars or better and a title change in the main event.",
            new WhyLine("Main event", "4½", DsState.Good, "Thackeray def. Voss"),
            new WhyLine("Co-main", "4", DsState.Good, "Halvorsen def. Takamori"),
            new WhyLine("Women's title", "4", DsState.Good),
            new WhyLine("Pacing", "+0.2", DsState.Good, "No slow stretch"),
            new WhyLine("Pre-show", "2", DsState.Neutral, "Not counted much"));

        public static readonly WhyBreakdown Attendance = new WhyBreakdown(
            "Attendance", "14,212",
            "95% of Brackwater Arena: a monthly special with a World title rematch.",
            new WhyLine("Venue size", "15,000", DsState.Neutral),
            new WhyLine("Hype for the card", "+18%", DsState.Good, "Two title matches advertised"),
            new WhyLine("Ticket price", "−4%", DsState.Bad, "Premium pricing"),
            new WhyLine("Away from home region", "−9%", DsState.Bad, "Mid-Atlantic, not the Northeast"));
    }
}
