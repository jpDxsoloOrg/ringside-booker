using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using RingsideBooker.UI.Design;

namespace RingsideBooker.UI.Mockups
{
    /// <summary>One roster member in the mockups (default world, Altura Wrestling Entertainment).</summary>
    public sealed class MockWorker
    {
        public string Name;
        public string Gender;
        public Alignment Alignment;
        public string Push;
        public string Style;
        public int Age;
        public int Ringwork;
        public int Mic;
        public int Charisma;
        public int Stamina;
        public int Popularity;
        public int Condition;
        public int MonthlyWage;
        public DateTime ContractEnds;
        public string Champion;
        public string Traits;
        public int Morale;
        public string Trend;
        public DsState TrendState;

        public string Position => Push switch
        {
            "mainEvent" => "Main eventer",
            "upperCard" => "Upper card",
            "midCard" => "Midcard",
            "lowerCard" => "Lower card",
            _ => "Enhancement",
        };

        public int PushRank => Push switch
        {
            "mainEvent" => 5,
            "upperCard" => 4,
            "midCard" => 3,
            "lowerCard" => 2,
            _ => 1,
        };

        public string StyleWord => Style switch
        {
            "allRounder" => "All-rounder",
            "highFlyer" => "High-flyer",
            "powerhouse" => "Powerhouse",
            "technician" => "Technician",
            "showman" => "Showman",
            "striker" => "Striker",
            "brawler" => "Brawler",
            "grappler" => "Grappler",
            "hardcore" => "Hardcore",
            _ => Style,
        };

        public string PopularityWord => Popularity >= 70 ? "Huge star" : Popularity >= 55 ? "Star" : Popularity >= 40 ? "Well known" : Popularity >= 25 ? "Known" : "Unknown";

        public (DsState state, string word) ConditionState => Condition >= 80 ? (DsState.Good, "Healthy")
            : Condition >= 65 ? (DsState.Neutral, "Sore")
            : Condition >= 58 ? (DsState.Warn, "Banged up")
            : (DsState.Bad, "Hurting");

        public (DsState state, string word) MoraleState => Morale >= 70 ? (DsState.Good, "Happy")
            : Morale >= 45 ? (DsState.Neutral, "Content")
            : Morale >= 30 ? (DsState.Warn, "Unhappy")
            : (DsState.Bad, "Wants out");

        /// <summary>In-ring quality in one number (the details panel shows the parts).</summary>
        public int Overall => (int)Math.Round((Ringwork * 2 + Charisma + Mic) / 4.0);

        public bool ContractSoon => ContractEnds <= MockupData.Today.AddDays(75);

        public string ContractWord => ContractSoon ? $"Ends {ContractEnds:MMM d}" : ContractEnds.ToString("MMM yyyy", CultureInfo.InvariantCulture);

        public WorkerCard ToCard() => new WorkerCard
        {
            Id = Name,
            Name = Name,
            Position = Position,
            Alignment = Alignment,
            Style = StyleWord,
            Popularity = Popularity,
            PopularityWord = PopularityWord,
            Morale = MoraleState.state,
            MoraleWord = MoraleState.word,
            Condition = ConditionState.state,
            ConditionWord = ConditionState.word,
            Champion = Champion?.Replace("Altura ", string.Empty),
            Trend = Trend,
            TrendState = TrendState,
        };
    }

    public sealed class Standing
    {
        public Standing(string name, string region, int popularity, int prestige, string trend, DsState trendState)
        {
            Name = name;
            Region = region;
            Popularity = popularity;
            Prestige = prestige;
            Trend = trend;
            TrendState = trendState;
        }

        public string Name { get; }
        public string Region { get; }
        public int Popularity { get; }
        public int Prestige { get; }
        public string Trend { get; }
        public DsState TrendState { get; }
    }

    /// <summary>
    /// Sample data for the UNITY-11 mockups, taken from the shipped default world (content/worlds/default):
    /// the player runs Altura Wrestling Entertainment; names, titles, shows, venues, attributes,
    /// contracts and reigns are the world's own. Morale, recent form, show results and news are made up
    /// for the mockups (the engine fills them in the real screens).
    /// </summary>
    public static class MockupData
    {
        public static readonly DateTime Today = new DateTime(2027, 1, 25);

        public const string Promotion = "Altura Wrestling Entertainment";
        public const string PromotionShort = "AW";
        public const string PromotionColor = "#2b6cb0";

        public static readonly IReadOnlyList<MockWorker> Roster = Build();

        public static MockWorker Get(string name) => Roster.First(worker => worker.Name == name);

        private static MockWorker W(string name, string gender, Alignment alignment, string push, string style, int age,
            int ringwork, int mic, int charisma, int stamina, int popularity, int condition, int wage, string ends,
            string champion, string traits) => new MockWorker
        {
            Name = name,
            Gender = gender,
            Alignment = alignment,
            Push = push,
            Style = style,
            Age = age,
            Ringwork = ringwork,
            Mic = mic,
            Charisma = charisma,
            Stamina = stamina,
            Popularity = popularity,
            Condition = condition,
            MonthlyWage = wage,
            ContractEnds = DateTime.ParseExact(ends, "yyyy-MM-dd", CultureInfo.InvariantCulture),
            Champion = champion == null ? null : champion + (champion.EndsWith("Team") ? " Champions" : " Champion"),
            Traits = traits,
        };

        private static IReadOnlyList<MockWorker> Build()
        {
            var roster = new List<MockWorker>
            {
                W("Megan \"Mariner\" Warren", "female", Alignment.Heel, "lowerCard", "striker", 24, 44, 26, 53, 72, 25, 92, 8000, "2027-04-13", null, "durable"),
                W("Karen Hill", "female", Alignment.Heel, "lowerCard", "brawler", 43, 64, 52, 41, 48, 26, 56, 8000, "2029-02-17", null, "coaster"),
                W("The Cheetah", "male", Alignment.Face, "upperCard", "allRounder", 45, 78, 52, 59, 60, 55, 55, 30000, "2027-11-09", null, "slowLearner"),
                W("Electric Tempest", "male", Alignment.Face, "lowerCard", "technician", 34, 54, 38, 35, 59, 27, 65, 8000, "2028-12-06", null, "slowLearner, durable, shrinksOnBigStage, poorSeller, lovesHardcore"),
                W("Maestro", "female", Alignment.Heel, "midCard", "showman", 41, 52, 43, 42, 33, 36, 69, 15000, "2028-07-22", null, "workhorse, teacher"),
                W("Ironside", "male", Alignment.Face, "upperCard", "showman", 46, 75, 87, 57, 60, 48, 69, 30000, "2027-09-21", "Altura Tag Team", "teacher, professional"),
                W("Sunshine Murray", "male", Alignment.Heel, "lowerCard", "technician", 31, 53, 34, 27, 60, 27, 83, 8000, "2027-08-27", null, "journeyman"),
                W("Notorious Leviathan", "female", Alignment.Face, "lowerCard", "highFlyer", 26, 64, 36, 65, 50, 24, 87, 8000, "2028-11-24", null, "durable"),
                W("Muhammad Sidhu", "male", Alignment.Face, "midCard", "powerhouse", 33, 70, 45, 52, 61, 40, 74, 15000, "2028-04-19", null, ""),
                W("The Stalker", "female", Alignment.Face, "lowerCard", "showman", 32, 53, 58, 35, 55, 26, 76, 8000, "2027-03-13", null, "workhorse"),
                W("Daring Mayhem", "male", Alignment.Heel, "upperCard", "technician", 36, 82, 45, 56, 68, 56, 83, 30000, "2028-05-02", "Altura Tag Team", "slowLearner, durable, professional"),
                W("The Buffalo", "male", Alignment.Face, "lowerCard", "technician", 25, 45, 54, 43, 53, 25, 87, 8000, "2028-12-31", null, "coaster, professional, journeyman, refusesComedy"),
                W("Jessica Ashworth", "female", Alignment.Heel, "enhancement", "allRounder", 28, 42, 28, 36, 52, 16, 83, 4000, "2028-12-16", null, "injuryProne, poorSeller, sensitive, naturalFace"),
                W("Matthew Collins", "male", Alignment.Face, "midCard", "allRounder", 30, 51, 27, 48, 77, 36, 84, 15000, "2027-04-23", null, "poorSeller, professional, egotist"),
                W("Martín", "male", Alignment.Heel, "lowerCard", "grappler", 30, 48, 21, 18, 57, 26, 80, 8000, "2027-06-29", null, "fastLearner, egotist"),
                W("Freddie", "male", Alignment.Heel, "midCard", "striker", 31, 62, 66, 53, 40, 37, 79, 15000, "2028-06-29", null, "agesBadly, journeyman"),
                W("The Blade", "male", Alignment.Heel, "midCard", "showman", 47, 54, 36, 42, 38, 38, 61, 15000, "2027-03-04", null, "bigMatchPerformer, professional"),
                W("The Orca", "male", Alignment.Face, "enhancement", "showman", 21, 19, 20, 32, 73, 15, 95, 4000, "2029-02-20", null, "agesWell, injuryProne, journeyman, refusesComedy"),
                W("Hard Rampage", "male", Alignment.Face, "midCard", "powerhouse", 39, 65, 51, 43, 52, 35, 70, 15000, "2027-07-11", null, "tagSpecialist, sensitive, egotist, journeyman"),
                W("Juggernaut", "female", Alignment.Heel, "upperCard", "allRounder", 46, 55, 66, 66, 42, 49, 62, 30000, "2029-06-02", null, "egotist"),
                W("Quick Sorcerer", "male", Alignment.Face, "enhancement", "striker", 24, 27, 27, 46, 61, 16, 83, 4000, "2029-05-18", null, "egotist"),
                W("Edward Harrison", "male", Alignment.Heel, "upperCard", "grappler", 45, 69, 53, 67, 46, 53, 56, 30000, "2029-04-10", null, "durable, prankster"),
                W("Brave Elizabeth", "female", Alignment.Face, "upperCard", "brawler", 28, 49, 66, 54, 65, 56, 83, 30000, "2028-05-27", null, "slowLearner, coaster, poorSeller"),
                W("The Storm", "male", Alignment.Face, "enhancement", "allRounder", 26, 42, 38, 63, 18, 15, 86, 4000, "2029-04-21", null, "workhorse"),
                W("Agustín Giménez", "male", Alignment.Face, "midCard", "allRounder", 29, 51, 41, 56, 63, 38, 84, 15000, "2028-02-28", null, "agesBadly, durable, workhorse, shrinksOnBigStage, refusesComedy"),
                W("Highlander Danladi", "female", Alignment.Heel, "enhancement", "brawler", 28, 49, 24, 25, 57, 16, 77, 4000, "2029-06-18", null, "slowLearner, professional, prankster"),
                W("The Monsoon", "nonBinary", Alignment.Heel, "midCard", "technician", 27, 44, 56, 61, 64, 38, 87, 15000, "2027-12-03", null, "injuryProne, workhorse"),
                W("Crimson Wraith", "female", Alignment.Face, "midCard", "allRounder", 42, 64, 67, 45, 72, 34, 55, 15000, "2029-02-03", null, "fastLearner, loyal"),
                W("Babatunde Earl", "male", Alignment.Face, "midCard", "powerhouse", 37, 49, 58, 55, 42, 36, 66, 15000, "2029-04-11", null, "generousSeller"),
                W("Braveheart", "male", Alignment.Heel, "midCard", "allRounder", 35, 58, 31, 47, 54, 34, 71, 15000, "2028-04-13", null, "workhorse, teacher, professional, loyal"),
                W("Aliyu \"Firecracker\" Afolabi", "male", Alignment.Face, "lowerCard", "technician", 22, 40, 18, 45, 62, 26, 91, 8000, "2029-05-13", null, "slowLearner, agesBadly, selfless"),
                W("Daisy Pharaoh", "female", Alignment.Heel, "enhancement", "hardcore", 27, 24, 30, 32, 37, 14, 80, 4000, "2027-09-10", null, "fastLearner, agesBadly, workhorse, bigMatchPerformer"),
                W("Ángel Rodríguez Diez", "male", Alignment.Heel, "lowerCard", "brawler", 26, 49, 43, 20, 65, 24, 83, 8000, "2027-03-22", null, "selfless, lovesComedy"),
                W("Sarah Arnold", "female", Alignment.Face, "midCard", "highFlyer", 38, 49, 61, 53, 56, 41, 67, 15000, "2028-04-19", null, "injuryProne, tagSpecialist"),
                W("Crashing Bison", "male", Alignment.Heel, "enhancement", "allRounder", 21, 43, 29, 23, 56, 16, 92, 4000, "2027-12-31", null, "agesWell, durable, troublemaker, loyal"),
                W("Pascual Caballero", "male", Alignment.Heel, "midCard", "technician", 45, 59, 52, 52, 49, 40, 59, 15000, "2027-04-16", null, "fastLearner, bigMatchPerformer, professional, naturalHeel"),
                W("Mean Kraken", "male", Alignment.Heel, "midCard", "showman", 52, 69, 66, 41, 56, 37, 56, 15000, "2028-03-26", null, ""),
                W("Calder Voss", "male", Alignment.Face, "mainEvent", "showman", 35, 78, 86, 88, 65, 73, 86, 60000, "2027-03-09", "Altura World", "agesBadly, durable, coaster, generousSeller, professional, lovesComedy"),
                W("Ewan Thackeray", "male", Alignment.Heel, "mainEvent", "grappler", 38, 87, 52, 67, 64, 72, 63, 60000, "2028-04-04", null, "agesBadly, shrinksOnBigStage, teacher"),
                W("Jett Amberley", "male", Alignment.Face, "mainEvent", "highFlyer", 28, 61, 63, 65, 82, 71, 80, 60000, "2028-12-21", "Altura Grand", "workhorse, loyal, naturalHeel"),
                W("Kip Santangelo", "male", Alignment.Face, "upperCard", "allRounder", 25, 57, 52, 74, 67, 56, 79, 30000, "2029-03-15", "Altura Breakout", "slowLearner, injuryProne, professional"),
                W("Ren Takamori", "male", Alignment.Face, "mainEvent", "striker", 31, 65, 61, 74, 58, 65, 80, 60000, "2028-03-15", null, "workhorse"),
                W("Rook Halvorsen", "male", Alignment.Heel, "upperCard", "technician", 32, 84, 46, 61, 69, 49, 92, 30000, "2028-01-05", "Altura Keystone", "bigMatchPerformer, refusesHardcore"),
                W("Sable Whitcombe", "female", Alignment.Heel, "mainEvent", "technician", 30, 85, 75, 66, 55, 66, 70, 60000, "2027-03-10", "Altura Women's", "fastLearner, agesBadly, bigMatchPerformer, prankster, journeyman, lovesComedy"),
            };
            // Morale and form are not in the world file: a steady made-up spread, plus the story beats
            // the mockups use (Thackeray wants his title shot, Voss is on a roll).
            foreach (MockWorker worker in roster)
            {
                int seed = Math.Abs(worker.Name.Aggregate(17, (hash, c) => hash * 31 + c)) % 100;
                worker.Morale = 40 + seed / 2;
            }
            Set(roster, "Ewan Thackeray", 34, "−3", DsState.Bad);
            Set(roster, "Calder Voss", 82, "+4", DsState.Good);
            Set(roster, "Jett Amberley", 77, "+3", DsState.Good);
            Set(roster, "Sable Whitcombe", 74, "+2", DsState.Good);
            Set(roster, "Kip Santangelo", 71, "+5", DsState.Good);
            Set(roster, "Ren Takamori", 63, "+1", DsState.Good);
            Set(roster, "Rook Halvorsen", 66, "+2", DsState.Good);
            Set(roster, "Juggernaut", 38, "−2", DsState.Bad);
            Set(roster, "The Blade", 28, "−1", DsState.Bad);
            return roster;
        }

        private static void Set(List<MockWorker> roster, string name, int morale, string trend, DsState trendState)
        {
            MockWorker worker = roster.First(w => w.Name == name);
            worker.Morale = morale;
            worker.Trend = trend;
            worker.TrendState = trendState;
        }

        // ---- Shows ----------------------------------------------------------------------------------------

        public static ShowCardData Showcase(int booked = 8) => new ShowCardData
        {
            Name = "Altura Showcase",
            Logo = "AW",
            LogoColor = PromotionColor,
            When = "Sun 31 Jan 2027",
            Venue = "Brackwater Arena, Mid-Atlantic",
            Importance = "Monthly special",
            ImportanceState = DsState.Gold,
            Booked = booked,
            Slots = 9,
            Countdown = "In 6 days",
        };

        public static ShowCardData MainstageTonight() => new ShowCardData
        {
            Name = "Altura Mainstage",
            Logo = "AW",
            LogoColor = PromotionColor,
            When = "Tonight · Mon 25 Jan",
            Venue = "Harrowmere Arena, Northeast",
            Importance = "Weekly TV",
            ImportanceState = DsState.Info,
            Booked = 4,
            Slots = 6,
            Countdown = "Tonight",
        };

        public static ShowCardData Overclock() => new ShowCardData
        {
            Name = "Altura Overclock",
            Logo = "AW",
            LogoColor = PromotionColor,
            When = "Wed 27 Jan",
            Venue = "Calderwick Arena, Northeast",
            Importance = "Weekly TV",
            ImportanceState = DsState.Info,
            Booked = 0,
            Slots = 6,
            Countdown = "In 2 days",
        };

        public static ShowCardData ColdFront() => new ShowCardData
        {
            Name = "Cold Front",
            Logo = "AW",
            LogoColor = PromotionColor,
            When = "Sun 14 Feb",
            Venue = "Velmont Lakeshore Arena, Ontario",
            Importance = "Major event",
            ImportanceState = DsState.Gold,
            Booked = 0,
            Slots = 9,
            Countdown = "In 20 days",
        };

        /// <summary>Time used on the Showcase card (Short 1, Standard 2, Long 3 of the show's 20).</summary>
        public const int ShowcaseTimeUsed = 19;
        public const int ShowcaseTimeTotal = 20;

        /// <summary>The Showcase card (8 matches + a pre-show bout), main event last.</summary>
        public static List<Matchup> ShowcaseCard()
        {
            MatchupSide S(string name, string note = null)
            {
                MockWorker worker = Get(name);
                return new MatchupSide(name, worker.Alignment, note, worker.Champion);
            }

            var tag = new MatchupSide("Desert Ghost", Alignment.Face, "Champions 98 days", "Altura Tag Team Champions") { Members = "Ironside & Daring Mayhem" };
            var challengers = new MatchupSide("Granite Centurion", Alignment.Heel, "Won the #1 contender match") { Members = "Juggernaut & Crimson Wraith" };

            return new List<Matchup>
            {
                new Matchup { Slot = "Pre-show", MatchType = "Singles", A = S("The Buffalo"), B = S("Martín"), Length = "Short", Stars = 2f },
                new Matchup { Slot = "Opener", MatchType = "Singles", A = S("Brave Elizabeth", "Won last 3"), B = S("Maestro"), Length = "Standard", Stars = 3f },
                new Matchup { Slot = "Midcard", MatchType = "Singles", A = S("Muhammad Sidhu"), B = S("Mean Kraken", "Feud: week 3"), Length = "Short", Stars = 2.5f },
                new Matchup
                {
                    Slot = "Midcard", MatchType = "Tag team", Title = "Altura Tag Team Championship", A = tag, B = challengers, Length = "Standard", Stars = 3.5f,
                },
                new Matchup
                {
                    Slot = "Midcard", MatchType = "Singles", Title = "Altura Breakout Championship", A = S("Kip Santangelo", "7 defences"), B = S("Agustín Giménez"), Length = "Standard", Stars = 3f,
                },
                new Matchup
                {
                    Slot = "Upper card", MatchType = "Singles", A = S("The Cheetah"), B = S("Edward Harrison"), Length = "Standard", Stars = 3f,
                    Flags = { (DsState.Warn, "The Cheetah is banged up"), },
                },
                new Matchup
                {
                    Slot = "Semi-main", MatchType = "Singles", Title = "Altura Women's Championship", A = S("Sable Whitcombe", "8 defences"), B = S("Sarah Arnold", "Earned the shot"), Length = "Long", Stars = 3.5f,
                },
                new Matchup
                {
                    Slot = "Co-main", MatchType = "Singles", Title = "Altura Keystone Championship", A = S("Rook Halvorsen", "3 defences"), B = S("Ren Takamori", "Unbeaten in January"), Length = "Long", Stars = 4f,
                },
                new Matchup
                {
                    Slot = "Main event", MatchType = "Singles · No disqualification", Title = "Altura World Championship", A = S("Calder Voss", "Champion 300 days"), B = S("Ewan Thackeray", "Wants his rematch"), Length = "Long", Stars = 4.5f,
                },
            };
        }

        // ---- Office -----------------------------------------------------------------------------------------

        public static readonly string[] Ticker =
        {
            "Thackeray: \"Voss has been ducking me since March\"",
            "Showcase in Brackwater is 82% sold, 6 days out",
            "Tessen Pro sign two from the free-agent pool",
            "Cielo Alto Lucha Libre extend their TV deal to 2029",
            "Kip Santangelo passes seven Breakout title defences",
            "Golden Poppy Wrestling move their monthly to Fridays",
        };

        public static readonly NewsItem[] Stories =
        {
            new NewsItem { Kicker = "Your promotion", Headline = "Mainstage drew 14,850 at Harrowmere, a January best", Dek = "Gate up 9% on last week; merchandise led by Voss shirts.", When = "Yesterday", Icon = "trend-up", State = DsState.Good },
            new NewsItem { Kicker = "Rivals", Headline = "Tessen Pro Wrestling sign two free agents", Dek = "Both were on your shortlist.", When = "2 days ago", Icon = "building", State = DsState.Info },
            new NewsItem { Kicker = "Locker room", Headline = "Juggernaut unhappy with her spot on the card", Dek = "She has asked for a singles match at Showcase.", When = "2 days ago", Icon = "morale", State = DsState.Warn },
            new NewsItem { Kicker = "Industry", Headline = "Cielo Alto Lucha Libre extend their TV deal to 2029", When = "3 days ago", Icon = "tv", State = DsState.Neutral },
        };

        /// <summary>Promotions by popularity in their home region (the world's starting numbers).</summary>
        public static readonly Standing[] Standings =
        {
            new Standing("Altura Wrestling Entertainment", "Northeast", 75, 80, "+1", DsState.Good),
            new Standing("Tessen Pro Wrestling", "Kanto", 65, 75, "+2", DsState.Good),
            new Standing("Cielo Alto Lucha Libre", "Mexico City", 65, 70, "0", DsState.Neutral),
            new Standing("Boreal Championship Wrestling", "Ontario", 42, 58, "−1", DsState.Bad),
            new Standing("Ashlar Pro Wrestling", "North England", 42, 52, "0", DsState.Neutral),
            new Standing("Blast Furnace Wrestling", "Great Lakes", 42, 48, "+1", DsState.Good),
            new Standing("Eisenwerk Wrestling", "West Germany", 40, 45, "0", DsState.Neutral),
            new Standing("Longleaf Championship Wrestling", "Southeast", 40, 55, "−1", DsState.Bad),
        };
    }
}
