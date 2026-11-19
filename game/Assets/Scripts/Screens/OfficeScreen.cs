using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.Screens.Office;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;
using BridgeGateHit = RingsideBooker.UI.Bridge.GateHit;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// The Office as a sports homepage (UNITY-21, on the UNITY-11 mockup): the lead story with a
    /// matchup graphic, what needs you today (one action each), the next show, top stories, money at a
    /// glance, power rankings and the promotion standings. The shell owns the news ticker.
    /// Queries: <c>office.dashboard</c>, <c>calendar.nextShow</c>, <c>booking.card</c>,
    /// <c>calendar.range</c>, <c>shows.lastCompleted</c>, <c>news.top</c>, <c>promotions.list</c>,
    /// <c>finance.overview</c>, <c>roster.rows</c>, <c>titles.list</c>, <c>sim.pendingGates</c>,
    /// <c>contracts.counts</c>/<c>list</c>/<c>offers</c>. Power rankings have no query of their own:
    /// they rank the roster by popularity and momentum (<see cref="OfficeLogic.PowerRankings"/>).
    /// </summary>
    public static class OfficeScreen
    {
        private static string rankingFilter = "all";

        public static VisualElement Build(ScreenContext context)
        {
            VisualElement screen = Ui.El("rb-screen", "oh-screen").Named("screen-dashboard");
            ScreenDs.Style(screen, "Screens/OfficeHome");
            VisualElement host = Ds.Column("oh-page").Named("office-home");
            screen.Add(host);
            Kit.Live(host, () => Render(host, context));
            return screen;
        }

        private sealed class Data
        {
            public JToken Dashboard;
            public JToken NextShow;
            public JToken Card;
            public JToken Week;
            public JToken LastShow;
            public JToken News;
            public JToken Promotions;
            public JToken Finance;
            public JToken Roster;
            public JToken Titles;
            public List<BridgeGateHit> Gates = new List<BridgeGateHit>();
            public JToken Counts;
            public JToken Expiring;
            public JToken Active;
            public JToken Offers;
            public string PromotionId;
            public string Today;
        }

        /// <summary>
        /// Everything the homepage shows, in one trip to the engine (UNITY-23's <c>EngineClient.Read</c>):
        /// the reader runs on the engine thread, so the follow-up queries that depend on earlier
        /// answers (the next card, the people who want to leave) stay in the same trip.
        /// </summary>
        private static Task<Data> Load() => Kit.Game.Client.Read("office", reader =>
        {
            JToken Get(string name, JObject args = null)
            {
                QueryResult<JToken> answer = reader.Query(name, args);
                return answer.Ok ? answer.Data : null;
            }

            var data = new Data { Dashboard = Get("office.dashboard") };
            data.PromotionId = Kit.Str(data.Dashboard, "promotion.promotionId");
            data.Today = Kit.Str(data.Dashboard, "date");
            data.News = Get("news.top");
            data.Promotions = Get("promotions.list");
            JToken gates = Get("sim.pendingGates");
            data.Gates = Kit.Arr(gates, "hits").Select(hit => new BridgeGateHit(
                Kit.Str(hit, "gateId"), Kit.Str(hit, "reason"), Kit.Str(hit, "actionHint"),
                Kit.Obj(hit, "subject") is JToken subject && subject.Type == JTokenType.Object ? new GateSubject(Kit.Str(subject, "kind"), Kit.Str(subject, "id")) : null)).ToList();
            if (data.PromotionId == null) return data;

            var promotion = new JObject { ["promotionId"] = data.PromotionId };
            data.NextShow = Get("calendar.nextShow", new JObject { ["scope"] = "mine" });
            string nextId = Kit.Str(data.NextShow, "show.eventInstanceId");
            if (nextId != null && (Kit.Num(data.NextShow, "show.segmentCount") ?? 0) > 0)
            {
                data.Card = Get("booking.card", new JObject { ["eventInstanceId"] = nextId });
            }
            if (data.Today != null && DateTime.TryParse(data.Today, out DateTime today))
            {
                data.Week = Get("calendar.range", new JObject { ["from"] = data.Today, ["to"] = today.AddDays(7).ToString("yyyy-MM-dd"), ["scope"] = "mine" });
            }
            data.LastShow = Get("shows.lastCompleted", new JObject { ["scope"] = "mine" });
            data.Finance = Get("finance.overview", promotion);
            data.Roster = Get("roster.rows", promotion);
            data.Titles = Get("titles.list", new JObject { ["scope"] = "own", ["status"] = "active" });
            data.Counts = Get("contracts.counts");
            data.Expiring = Get("contracts.list", new JObject { ["tab"] = "expiring" });
            if ((Kit.Num(data.Counts, "wantsToLeave") ?? 0) > 0) data.Active = Get("contracts.list", new JObject { ["tab"] = "active" });
            data.Offers = Get("contracts.offers", new JObject { ["promotionId"] = data.PromotionId, ["status"] = "open" });
            return data;
        });

        private static async Task Render(VisualElement host, ScreenContext context)
        {
            Data data = await Load();
            host.Clear();
            if (data.Dashboard == null)
            {
                host.Add(Ds.Empty("office", "The Office can't open", "The game didn't answer. Try again after the next day."));
                return;
            }

            VisualElement columns = Ds.Row("ds-row--top", "oh-columns");
            VisualElement main = Ds.Column("oh-main");
            VisualElement side = Ds.Column("oh-side");
            columns.Add(main);
            columns.Add(side);
            host.Add(columns);

            main.Add(Lead(data, context));
            if (data.PromotionId != null)
            {
                VisualElement twin = Ds.Row("ds-row--top", "oh-twin");
                twin.Add(NextShow(data, context));
                twin.Add(TopStories(data, context));
                main.Add(twin);
            }
            else
            {
                main.Add(TopStories(data, context));
            }
            main.Add(Standings(data));

            side.Add(NeedsYou(data, context));
            if (data.PromotionId != null)
            {
                side.Add(Money(data, context));
                side.Add(Rankings(data, context));
            }
        }

        // ---- Lead story ---------------------------------------------------------------------------

        private static VisualElement Lead(Data data, ScreenContext context)
        {
            NewsItem item;
            VisualElement feature;
            Action open = null;

            JToken mainEvent = MainEvent(data.Card);
            JToken show = Kit.Obj(data.NextShow, "show");
            JToken last = data.LastShow;
            double daysUntil = Kit.Num(data.NextShow, "daysUntil") ?? 99;
            if (mainEvent != null && daysUntil <= 10)
            {
                List<JToken> sides = Kit.Arr(mainEvent, "segment.sides").ToList();
                string title = Kit.Str(mainEvent, "segment.titles[0].name");
                string a = SideName(sides.ElementAtOrDefault(0));
                string b = SideName(sides.ElementAtOrDefault(1));
                string venue = Kit.Str(show, "venue.name") ?? Kit.Str(show, "genericVenue.name");
                string length = MatchLab.LabText.TimeWord(Kit.Str(mainEvent, "durationClass")).ToLowerInvariant();
                item = new NewsItem
                {
                    Kicker = $"{Kit.Str(show, "name")} · Main event",
                    Headline = title != null ? $"{a} and {b} fight for the {title}" : $"{a} meets {b} in the main event",
                    Dek = $"{Kit.Capital(OfficeLogic.Days(daysUntil))}{(venue == null ? string.Empty : $" at {venue}")}. A {length} {Kit.Str(mainEvent, "segment.typeName")?.ToLowerInvariant() ?? "match"} closes the show.",
                    When = Kit.Date(Kit.Str(show, "date"), true),
                    Icon = title != null ? "trophy" : "versus",
                    State = title != null ? DsState.Gold : DsState.Live,
                };
                feature = Faces(SideFace(sides.ElementAtOrDefault(0), data, title), SideFace(sides.ElementAtOrDefault(1), data, title));
                string id = Kit.Str(show, "eventInstanceId");
                open = () => context.Navigator.Go(ShellRoute.With("booking", "event", id));
            }
            else if (last != null && last.Type == JTokenType.Object && Kit.Str(last, "mainEvent.winnerSide") != null)
            {
                List<string> sides = Kit.Arr(last, "mainEvent.sides").Select(side => (string)side).ToList();
                string winner = Kit.Str(last, "mainEvent.winnerSide");
                string loser = sides.FirstOrDefault(side => side != winner);
                double stars = Kit.Num(last, "stars") ?? 0;
                item = new NewsItem
                {
                    Kicker = $"{Kit.Str(last, "name")} · Last show",
                    Headline = loser != null ? $"{winner} beats {loser} to close {Kit.Str(last, "name")}" : $"{winner} wins the main event",
                    Dek = $"The show scored {Kit.Whole(Kit.Num(last, "score"))}, {stars:0.##} stars.",
                    When = Kit.Date(Kit.Str(last, "date"), true),
                    Icon = "trophy",
                    State = DsState.Gold,
                };
                feature = Faces(PersonFace(winner, data), PersonFace(loser, data));
                string id = Kit.Str(last, "eventInstanceId");
                open = () => context.Navigator.Go(ShellRoute.With(ScreenIds.ShowResults, "event", id));
            }
            else
            {
                JToken story = Kit.Arr(data.News, "hero").Concat(Kit.Arr(data.News, "ticker"))
                    .FirstOrDefault(candidate => OfficeLogic.StoryLine(candidate, Kit.Obj(data.News, "names")) != null);
                string line = story == null ? null : OfficeLogic.StoryLine(story, Kit.Obj(data.News, "names"));
                List<RankedWorker> top = OfficeLogic.PowerRankings(data.Roster, data.Titles, "all", 2);
                item = new NewsItem
                {
                    Kicker = story == null ? "Your world" : Kit.Str(story, "kindLabel") ?? "News",
                    Headline = line != null ? $"{Kit.Str(story, "kindLabel") ?? "News"}: {line}"
                        : top.Count >= 2 ? $"{top[0].Name} and {top[1].Name} lead the way" : "A new season starts",
                    Dek = "The first shows decide who the fans talk about next.",
                    When = story == null ? null : Kit.Date(Kit.Str(story, "date")),
                    Icon = "newspaper",
                    State = DsState.Info,
                };
                feature = Faces(RankedFace(top.ElementAtOrDefault(0)), RankedFace(top.ElementAtOrDefault(1)));
            }

            VisualElement lead = DsCards.NewsCard(item, lead: true, feature: feature);
            lead.AddToClassList("oh-lead");
            lead.name = "office-lead";
            if (open != null)
            {
                lead.focusable = true;
                lead.AddManipulator(new Clickable(open));
                lead.AddToClassList("oh-clickable");
            }
            return lead;
        }

        private static JToken MainEvent(JToken card)
        {
            if (card == null) return null;
            List<JToken> slots = Kit.Arr(card, "sections").Where(section => !Kit.Bool(section, "preShow")).SelectMany(section => Kit.Arr(section, "slots")).ToList();
            return slots.LastOrDefault(slot => Kit.Str(slot, "segment.kind") == "match" && Kit.Arr(slot, "segment.sides").Count() >= 2);
        }

        private static string SideName(JToken side) =>
            Kit.Str(side, "name") ?? ScreenDs.JoinNames(Kit.Arr(side, "people").Select(person => Kit.Str(person, "name") ?? Kit.Str(person, "ringName")));

        private static VisualElement SideFace(JToken side, Data data, string title)
        {
            JToken first = Kit.Arr(side, "people").FirstOrDefault();
            string personId = Kit.Str(first, "personId");
            JToken row = Kit.Arr(data.Roster, "rows").FirstOrDefault(r => Kit.Str(r, "personId") == personId);
            bool champion = title != null && Kit.Arr(data.Titles, "groups").SelectMany(group => Kit.Arr(group, "titles"))
                .Any(t => Kit.Str(t, "name") == title && Kit.Arr(t, "champion.holders").Any(holder => Kit.Str(holder, "personId") == personId));
            return Face(Kit.Str(row, "imageRef") ?? Kit.Str(first, "imageRef"), ScreenDs.AlignmentOf(Kit.Str(row, "alignment")), champion);
        }

        private static VisualElement PersonFace(string ringName, Data data)
        {
            JToken row = Kit.Arr(data.Roster, "rows").FirstOrDefault(r => Kit.Str(r, "ringName") == ringName);
            return Face(Kit.Str(row, "imageRef"), ScreenDs.AlignmentOf(Kit.Str(row, "alignment")), false);
        }

        private static VisualElement RankedFace(RankedWorker worker) =>
            Face(worker?.ImageRef, ScreenDs.AlignmentOf(worker?.Alignment), worker?.Champion != null);

        private static VisualElement Face(string imageRef, Alignment alignment, bool gold) =>
            DsCards.PortraitBox(ScreenDs.Picture(imageRef), alignment, "ds-portrait--xl", gold);

        private static VisualElement Faces(VisualElement left, VisualElement right)
        {
            VisualElement faces = Ds.Row("oh-lead__faces");
            faces.Add(left);
            VisualElement vs = new SkewShape();
            vs.AddToClassList("oh-lead__vs");
            vs.Add(Ds.Text("VS", "oh-lead__vs-text"));
            faces.Add(vs);
            faces.Add(right);
            return faces;
        }

        // ---- Needs you today ----------------------------------------------------------------------

        private static VisualElement NeedsYou(Data data, ScreenContext context)
        {
            List<NeedItem> items = OfficeLogic.NeedsToday(data.Gates, data.NextShow, data.Counts, data.Expiring, data.Active, data.Offers);
            VisualElement panel = Ds.Panel("Needs you today", null, null, "oh-needs").Named("office-needs");
            if (items.Count == 0)
            {
                panel.Add(Ds.Text("Nothing needs you right now. Book ahead, or press Next day.", "oh-quiet"));
                return panel;
            }
            foreach (NeedItem item in items.Take(6)) panel.Add(Need(item, context));
            panel.Add(Ds.Text(items.Count > 6 ? $"And {items.Count - 6} more." : "Everything else is running fine.", "oh-quiet"));
            return panel;
        }

        private static VisualElement Need(NeedItem item, ScreenContext context)
        {
            VisualElement row = Ds.Row("oh-need", Ds.StateClass(item.State)).Named($"need-{item.Id}");
            VisualElement badge = Ds.El("oh-need__icon");
            badge.Add(new Icon(item.Icon, "ds-icon--md"));
            row.Add(badge);
            VisualElement words = Ds.Column("oh-need__words");
            words.Add(Ds.Text(item.Title, "oh-need__title"));
            if (item.Detail != null) words.Add(Ds.Text(item.Detail, "oh-need__detail"));
            row.Add(words);
            Button action = Ds.Button(item.Action, () => Act(item, context), item.Primary ? DsButtonKind.Primary : DsButtonKind.Secondary);
            action.name = $"need-action-{item.Id}";
            action.AddToClassList("oh-need__action");
            row.Add(action);
            return row;
        }

        /// <summary>Goes to the screen that deals with it; a stop whose screen isn't built yet opens Needs attention.</summary>
        private static void Act(NeedItem item, ScreenContext context)
        {
            if (item.Route != null && ScreenRegistry.IsLive(item.Route.ScreenId))
            {
                context.Navigator.Go(item.Route);
                return;
            }
            if (item.Gate != null && ShellController.Current?.DayControl != null)
            {
                ShellController.Current.DayControl.OpenWaitingSheet();
                return;
            }
            if (item.Route != null) context.Navigator.Go(item.Route);
        }

        // ---- Next show ----------------------------------------------------------------------------

        private static VisualElement NextShow(Data data, ScreenContext context)
        {
            JToken show = Kit.Obj(data.NextShow, "show");
            string id = Kit.Str(show, "eventInstanceId");
            bool hasShow = show != null && show.Type == JTokenType.Object;
            VisualElement panel = Ds.Panel("Next show", hasShow ? "Open the card" : null, () => context.Navigator.Go(ShellRoute.With("booking", "event", id)), "oh-grow").Named("office-next-show");
            if (!hasShow)
            {
                panel.Add(Ds.Empty("calendar", "No show on the calendar", "Add a show from the Calendar."));
                return panel;
            }
            double days = Kit.Num(data.NextShow, "daysUntil") ?? 0;
            string importance = Kit.Str(show, "importance");
            string venue = Kit.Str(show, "venue.name") ?? Kit.Str(show, "genericVenue.name");
            var card = new ShowCardData
            {
                Name = Kit.Str(show, "name"),
                Logo = SidebarView.Monogram(Kit.Str(show, "promotion.shortName") ?? Kit.Str(show, "promotion.name") ?? "?"),
                LogoColor = Kit.Str(show, "promotion.color") ?? "#2b6cb0",
                When = Kit.Date(Kit.Str(show, "date"), true),
                Venue = venue == null ? Kit.Str(show, "region.name") : $"{venue}, {Kit.Str(show, "region.name")}",
                Importance = ImportanceWord(importance, Kit.Bool(show, "televised")),
                ImportanceState = importance == "major" || importance == "flagship" ? DsState.Gold : DsState.Info,
                Booked = (int)(Kit.Num(show, "segmentCount") ?? 0),
                Slots = (int)(Kit.Num(show, "format.slots") ?? 0) + (int)(Kit.Num(show, "format.preShowSlots") ?? 0),
                Countdown = days <= 0 ? "Tonight" : days == 1 ? "Tomorrow" : $"In {days} days",
            };
            VisualElement showCard = DsCards.ShowCard(card);
            showCard.AddManipulator(new Clickable(() => context.Navigator.Go(ShellRoute.With("booking", "event", id))));
            panel.Add(showCard);

            VisualElement list = Ds.Column("oh-mini-card").Named("office-card-list");
            List<JToken> slots = Kit.Arr(data.Card, "sections").SelectMany(section => Kit.Arr(section, "slots"))
                .Where(slot => Kit.Obj(slot, "segment") is JToken segment && segment.Type == JTokenType.Object).Reverse().Take(4).ToList();
            foreach (JToken slot in slots)
            {
                VisualElement row = Ds.Row("oh-mini-match");
                bool title = Kit.Arr(slot, "segment.titles").Any();
                bool match = Kit.Str(slot, "segment.kind") == "match";
                row.Add(new Icon(title ? "trophy" : match ? "versus" : "megaphone", "ds-icon--xs", title ? "oh-mini-match__icon--gold" : "oh-mini-match__icon"));
                List<JToken> sides = Kit.Arr(slot, "segment.sides").ToList();
                if (match && sides.Count >= 2)
                {
                    row.Add(Ds.Text(SideName(sides[0]), "oh-mini-match__name"));
                    row.Add(Ds.Text("vs", "oh-mini-match__vs"));
                    row.Add(Ds.Text(sides.Count > 2 ? $"{SideName(sides[1])} +{sides.Count - 2}" : SideName(sides[1]), "oh-mini-match__name"));
                }
                else
                {
                    row.Add(Ds.Text(Kit.Str(slot, "segment.label") ?? Kit.Str(slot, "segment.typeName") ?? "Segment", "oh-mini-match__name"));
                }
                row.Add(Ds.Spacer());
                row.Add(Ds.Text(title ? Kit.Str(slot, "segment.titles[0].name") : Kit.Str(slot, "roleLabel"), title ? "oh-mini-match__title" : "oh-mini-match__role"));
                list.Add(row);
            }
            if (slots.Count == 0) list.Add(Ds.Text("Nothing booked yet. Open the card to book it, or let Auto-fill start it for you.", "oh-quiet"));
            panel.Add(list);

            List<JToken> week = Kit.Arr(data.Week, "shows").Where(other => Kit.Str(other, "eventInstanceId") != id && Kit.Bool(other, "isOwn")).Take(3).ToList();
            if (week.Count > 0)
            {
                VisualElement upcoming = Ds.Row("ds-row--wrap", "oh-upcoming");
                upcoming.Add(Ds.Text("ALSO THIS WEEK", "oh-label"));
                foreach (JToken other in week)
                {
                    string otherId = Kit.Str(other, "eventInstanceId");
                    int slotsCount = (int)(Kit.Num(other, "format.slots") ?? 0) + (int)(Kit.Num(other, "format.preShowSlots") ?? 0);
                    upcoming.Add(Ds.Chip($"{Kit.Str(other, "name")} · {Kit.Date(Kit.Str(other, "date"))} · {Kit.Num(other, "segmentCount") ?? 0}/{slotsCount}", false,
                        () => context.Navigator.Go(ShellRoute.With("booking", "event", otherId)), null, "tv"));
                }
                panel.Add(upcoming);
            }
            return panel;
        }

        private static string ImportanceWord(string importance, bool televised) => importance switch
        {
            "house" => "House show",
            "minor" => "Minor show",
            "regular" => televised ? "Weekly TV" : "Weekly show",
            "major" => "Special",
            "flagship" => "Flagship",
            _ => Kit.Capital(importance ?? "Show"),
        };

        // ---- Top stories --------------------------------------------------------------------------

        private static VisualElement TopStories(Data data, ScreenContext context)
        {
            VisualElement panel = Ds.Panel("Top stories", "All news", () => context.Navigator.Go(ShellRoute.To("news")), "oh-grow", "oh-stories").Named("office-stories");
            JToken names = Kit.Obj(data.News, "names");
            List<JToken> stories = Kit.Arr(data.News, "hero").Concat(Kit.Arr(data.News, "ticker"))
                .GroupBy(story => Kit.Str(story, "id")).Select(group => group.First())
                .OrderBy(story => OfficeLogic.StoryLine(story, names) == null ? 1 : 0).Take(3).ToList();
            if (stories.Count == 0)
            {
                panel.Add(Ds.Text("Quiet so far. Stories land here as the world moves.", "oh-quiet"));
                return panel;
            }
            foreach (JToken story in stories)
            {
                bool mine = Kit.Arr(story, "refs.promotionIds").Any(id => (string)id == data.PromotionId);
                var item = new NewsItem
                {
                    Kicker = mine ? "Your promotion" : Kit.Str(story, "kindLabel") ?? "News",
                    Headline = OfficeLogic.StoryLine(story, names) is string line ? $"{Kit.Str(story, "kindLabel") ?? "News"}: {line}" : OfficeLogic.HeadlineFromKey(story),
                    When = Kit.Date(Kit.Str(story, "date")),
                    Icon = mine ? "trend-up" : Kit.Bool(story, "frontPage") ? "newspaper" : "building",
                    State = mine ? DsState.Live : Kit.Bool(story, "frontPage") ? DsState.Info : DsState.Neutral,
                };
                VisualElement card = DsCards.NewsCard(item);
                string storyId = Kit.Str(story, "id");
                card.AddManipulator(new Clickable(() => context.Navigator.Go(ShellRoute.With("news", "story", storyId))));
                card.AddToClassList("oh-clickable");
                panel.Add(card);
            }
            return panel;
        }

        // ---- Money at a glance --------------------------------------------------------------------

        private static VisualElement Money(Data data, ScreenContext context)
        {
            VisualElement panel = Ds.Panel("Money at a glance", "Finances", () => context.Navigator.Go(ShellRoute.To("finances")), "oh-money").Named("office-money");
            JToken finance = data.Finance;
            double cash = Kit.Num(finance, "cash") ?? Kit.Num(Kit.Arr(data.Dashboard, "kpis").FirstOrDefault(kpi => Kit.Str(kpi, "key") == "cash"), "value") ?? 0;
            double net = Kit.Num(finance, "thisMonth.net") ?? 0;
            double payroll = Kit.Num(finance, "monthlyPayroll") ?? 0;
            double months = payroll > 0 ? cash / payroll : 0;

            VisualElement tiles = Ds.Row("oh-tiles");
            VisualElement cashTile = Ds.StatTile("Cash", ScreenDs.ShortMoney(cash),
                payroll <= 0 ? "No wages to pay" : months >= 12 ? "Plenty in the bank" : months >= 3 ? $"About {Math.Floor(months)} months of wages" : "Running low",
                months >= 3 || payroll <= 0 ? DsState.Good : months >= 1 ? DsState.Warn : DsState.Bad);
            cashTile.name = "money-cash";
            ScreenDs.WhyRef(cashTile, "Cash", cash, Kit.Obj(finance, "cashTraceRef"), "money", cashTile.Q(className: "ds-stat__top"));
            tiles.Add(cashTile);
            VisualElement monthTile = Ds.StatTile("This month", ScreenDs.SignedMoney(net),
                $"In {ScreenDs.ShortMoney(Kit.Num(finance, "thisMonth.income") ?? 0)}, out {ScreenDs.ShortMoney(Kit.Num(finance, "thisMonth.costs") ?? 0)}",
                net >= 0 ? DsState.Good : DsState.Warn);
            monthTile.name = "money-month";
            tiles.Add(monthTile);
            VisualElement wagesTile = Ds.StatTile("Wages a month", ScreenDs.ShortMoney(payroll), $"{Kit.Num(finance, "paidContracts") ?? 0} people paid", DsState.Neutral);
            wagesTile.name = "money-wages";
            ScreenDs.WhyTrace(wagesTile, "Monthly payroll", payroll, Kit.Obj(finance, "monthlyPayrollTrace"), "money", wagesTile.Q(className: "ds-stat__top"));
            tiles.Add(wagesTile);
            panel.Add(tiles);
            if (payroll > 0)
            {
                float cover = (float)Math.Min(1, months / 12);
                panel.Add(Ds.Meter(cover, months >= 3 ? DsState.Info : DsState.Warn, "Wages covered"));
                panel.Add(Ds.Text(months >= 12 ? "Cash covers more than a year of wages." : $"Cash covers about {Math.Max(0, Math.Floor(months))} months of wages.", "oh-quiet"));
            }
            return panel;
        }

        // ---- Power rankings -----------------------------------------------------------------------

        private static VisualElement Rankings(Data data, ScreenContext context)
        {
            VisualElement panel = Ds.Panel("Power rankings", "Roster", () => context.Navigator.Go(ShellRoute.To("roster")), "oh-rankings").Named("office-rankings");
            var tabs = new DsTabs(segmented: true) { name = "rankings-filter" };
            tabs.Add("all", "Your roster").Add("male", "Men").Add("female", "Women");
            tabs.Select(rankingFilter, false);
            panel.Add(tabs);
            VisualElement list = Ds.Column("oh-rank-list");
            panel.Add(list);
            void Fill()
            {
                list.Clear();
                List<RankedWorker> ranked = OfficeLogic.PowerRankings(data.Roster, data.Titles, rankingFilter);
                if (ranked.Count == 0) list.Add(Ds.Text("No wrestlers here yet.", "oh-quiet"));
                int rank = 1;
                foreach (RankedWorker worker in ranked)
                {
                    VisualElement row = Ds.Row("oh-rank").Named($"rank-{rank}");
                    row.Add(Ds.Text(rank.ToString(), "oh-rank__number"));
                    row.Add(DsCards.PortraitBox(ScreenDs.Picture(worker.ImageRef), ScreenDs.AlignmentOf(worker.Alignment), "ds-portrait--xs", worker.Champion != null));
                    VisualElement words = Ds.Column("oh-rank__words");
                    words.Add(Ds.Text(worker.Name, "oh-rank__name"));
                    words.Add(Ds.Text(worker.Champion ?? Kit.PushLabel(worker.Push), worker.Champion != null ? "oh-rank__champ" : "oh-rank__role"));
                    row.Add(words);
                    row.Add(Ds.Spacer());
                    row.Add(Ds.Dot(ScreenDs.PopularityState(worker.Popularity), ScreenDs.PopularityWord(worker.Popularity)));
                    VisualElement trend = Ds.El("ds-trend", Ds.StateClass(worker.Trend), "oh-rank__trend");
                    trend.Add(new Icon(worker.Trend == DsState.Good ? "up" : worker.Trend == DsState.Bad ? "down" : "flat", "ds-icon--xs"));
                    row.Add(trend);
                    DsTooltip.Attach(row, $"Popularity {Math.Round(worker.Popularity)} · momentum {Math.Round(worker.Momentum)}", worker.Name);
                    string personId = worker.PersonId;
                    if (ScreenRegistry.IsLive(ScreenIds.Worker))
                    {
                        row.AddManipulator(new Clickable(() => context.Navigator.Go(ShellRoute.With(ScreenIds.Worker, "id", personId))));
                        row.AddToClassList("oh-clickable");
                    }
                    list.Add(row);
                    rank++;
                }
            }
            tabs.Selected += filter =>
            {
                rankingFilter = filter;
                Fill();
            };
            Fill();
            panel.Add(Ds.Text("Ranked by popularity with your fans and momentum.", "oh-quiet"));
            return panel;
        }

        // ---- Standings ----------------------------------------------------------------------------

        private sealed class Standing
        {
            public int Rank;
            public JToken Row;
            public double Popularity;
        }

        private static VisualElement Standings(Data data)
        {
            VisualElement panel = Ds.Panel("Standings: biggest promotions", null, null, "oh-standings").Named("office-standings");
            List<JToken> promotions = Kit.Arr(data.Promotions).Where(row => Kit.Str(row, "status") != "closed").ToList();
            var rows = promotions
                .Select(row => new Standing { Row = row, Popularity = Kit.Num(row, "popularity.home.value") ?? 0 })
                .OrderByDescending(standing => standing.Popularity).ToList();
            for (int index = 0; index < rows.Count; index++) rows[index].Rank = index + 1;
            var table = new DsTable<Standing>(new[]
            {
                new DsColumn<Standing>("rank", "#", row => Ds.Text(row.Rank.ToString(), "ds-cell__text", "ds-cell__text--muted")) { Width = 44, SortKey = row => row.Rank },
                new DsColumn<Standing>("name", "Promotion", row =>
                {
                    VisualElement cell = Ds.Row("oh-promo-cell");
                    cell.Add(DsCards.Logo(SidebarView.Monogram(Kit.Str(row.Row, "shortName") ?? Kit.Str(row.Row, "name") ?? "?"), Kit.Str(row.Row, "color") ?? "#334155", "ds-logo--sm", ScreenDs.Picture(Kit.Str(row.Row, "logoRef"))));
                    bool mine = Kit.Str(row.Row, "promotionId") == data.PromotionId;
                    cell.Add(Ds.Text(Kit.Str(row.Row, "name"), "ds-cell__text", mine ? "ds-cell__text--strong" : "ds-cell__text--plain"));
                    if (mine) cell.Add(Ds.Tag("You", "live"));
                    return cell;
                }) { Grow = 3, MinWidth = 240, Pinned = true, SortKey = row => Kit.Str(row.Row, "name") },
                DsColumn<Standing>.Text("home", "Home", row => Kit.Str(row.Row, "homeRegion.name") ?? string.Empty),
                new DsColumn<Standing>("popularity", "Popularity", row =>
                {
                    VisualElement cell = Ds.Row("oh-cell");
                    cell.Add(Ds.Dot(ScreenDs.PopularityState(row.Popularity), ScreenDs.PopularityWord(row.Popularity)));
                    cell.Add(Ds.Text(Math.Round(row.Popularity).ToString(), "oh-num-quiet"));
                    ScreenDs.WhyTrace(cell, $"{Kit.Str(row.Row, "name")} popularity", row.Popularity, Kit.Obj(row.Row, "popularity.home.trace"), "points");
                    return cell;
                }) { Grow = 1.5f, SortKey = row => row.Popularity, Help = "How popular they are in their home country, in words, then the number." },
                new DsColumn<Standing>("prestige", "Prestige", row => Ds.Text(Kit.Whole(Kit.Num(row.Row, "prestige")), "ds-cell__text", "ds-cell__text--num")) { Width = 90, Align = DsAlign.Right, SortKey = row => Kit.Num(row.Row, "prestige") ?? 0 },
                new DsColumn<Standing>("size", "Reach", row => Ds.Text(Kit.Str(row.Row, "size.label") ?? "-", "ds-cell__text")) { Grow = 1, Default = false, SortKey = row => Kit.Num(row.Row, "size.reach") ?? 0 },
                new DsColumn<Standing>("roster", "Roster", row => Ds.Text(Kit.Whole(Kit.Num(row.Row, "rosterCount")), "ds-cell__text", "ds-cell__text--num")) { Width = 80, Align = DsAlign.Right, Default = false, SortKey = row => Kit.Num(row.Row, "rosterCount") ?? 0 },
            }, rows);
            panel.Add(table);
            return panel;
        }
    }
}
