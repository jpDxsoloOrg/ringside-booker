using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// The Calendar on the UNITY-11 design (UNITY-15; the web's CalendarView, month grid): the shows
    /// in a month from <c>calendar.range</c> (yours or the whole world) as chips with their show or
    /// promotion logo, today ringed, done shows quiet and big shows in gold; and a show sheet from
    /// <c>calendar.show</c> with links to book it, run it or read its results.
    /// </summary>
    public static class CalendarScreen
    {
        private static readonly string[] Weekdays = { "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" };
        private const int ChipsPerDay = 4;

        public static VisualElement Build(ScreenContext context)
        {
            VisualElement page = W.Page("calendar");
            VisualElement host = Ds.Column("wl-host");
            page.Add(host);
            Kit.Live(host, () => Render(host, context));
            return page;
        }

        private static async Task Render(VisualElement host, ScreenContext context)
        {
            EngineGame game = Kit.Game;
            GameDate today = game.ShellData.Snapshot.Date;
            string scope = context.Route.Param("scope") ?? "mine";
            GameDate month = GameDate.TryParse((context.Route.Param("month") ?? string.Empty) + "-01", out GameDate parsed)
                ? parsed : today.StartOfMonth;
            GameDate last = month.AddMonths(1).AddDays(-1);

            QueryResult<JToken> range = await game.Client.Query("calendar.range",
                new JObject { ["from"] = month.Iso, ["to"] = last.Iso, ["scope"] = scope });
            host.Clear();

            string MonthParam(GameDate date) => date.Iso.Substring(0, 7);
            string title = new DateTime(month.Year, month.Month, 1).ToString("MMMM yyyy", CultureInfo.InvariantCulture);
            List<JToken> shows = range.Ok ? Kit.Arr(range.Data, "shows").ToList() : new List<JToken>();
            int upcoming = shows.Count(s => Kit.Str(s, "status") != "completed" && Kit.Str(s, "status") != "cancelled");
            string subtitle = range.Ok
                ? $"{shows.Count} shows in {title}" + (upcoming > 0 ? $" · {upcoming} still to run" : string.Empty)
                : string.Empty;

            var scopeSwitch = new DsTabs(segmented: true);
            scopeSwitch.Add("mine", "Your shows", null, "calendar").Add("world", "Whole world", null, "building");
            scopeSwitch.Select(scope, false);
            scopeSwitch.name = "calendar-scope";
            scopeSwitch.Selected += picked => context.Navigator.Go(ShellRoute.With("calendar", "month", MonthParam(month), "scope", picked));
            host.Add(W.Head("Calendar", subtitle, out _, scopeSwitch));

            VisualElement bar = Ds.Row("wl-toolbar", "wl-month-bar");
            Button previous = Ds.IconButton("chevron-left", "Previous month", () => context.Navigator.Go(ShellRoute.With("calendar", "month", MonthParam(month.AddMonths(-1)), "scope", scope)), false);
            previous.name = "calendar-previous";
            bar.Add(previous);
            bar.Add(Ds.Text(TextFormat.Upper(title), "ds-type-title", "wl-month-bar__title"));
            Button next = Ds.IconButton("chevron-right", "Next month", () => context.Navigator.Go(ShellRoute.With("calendar", "month", MonthParam(month.AddMonths(1)), "scope", scope)), false);
            next.name = "calendar-next";
            bar.Add(next);
            Button todayButton = Ds.Button("Today", () => context.Navigator.Go(ShellRoute.With("calendar", "scope", scope)), DsButtonKind.Ghost, "calendar");
            todayButton.name = "calendar-today";
            bar.Add(todayButton);
            bar.Add(Ds.Spacer());
            VisualElement legend = Ds.Row("wl-legend");
            legend.Add(Ds.Dot(DsState.Live, "Yours"));
            legend.Add(Ds.Dot(DsState.Gold, "Big show"));
            legend.Add(Ds.Dot(DsState.Neutral, "Done"));
            bar.Add(legend);
            host.Add(bar);

            if (!range.Ok)
            {
                host.Add(Kit.Error(Kit.Reasons(range.Reasons)));
                return;
            }

            var byDate = shows.GroupBy(show => Kit.Str(show, "date"))
                .ToDictionary(group => group.Key, group => group.OrderByDescending(s => Kit.Bool(s, "isOwn")).ThenByDescending(s => Big(s)).ToList());

            VisualElement grid = Ds.Column("wl-month").Named("calendar-grid");
            VisualElement head = Ds.Row("wl-month__week", "wl-month__head");
            foreach (string weekday in Weekdays) head.Add(Ds.El("wl-month__cell", "wl-month__cell--head").With(W.Label(weekday)));
            grid.Add(head);

            int offset = ((int)month.DayOfWeek + 6) % 7; // Monday first
            GameDate cursor = month.AddDays(-offset);
            while (cursor <= last)
            {
                VisualElement week = Ds.Row("wl-month__week");
                for (int day = 0; day < 7; day++)
                {
                    week.Add(DayCell(cursor, month, today, byDate, context));
                    cursor = cursor.AddDays(1);
                }
                grid.Add(week);
            }
            host.Add(grid);
        }

        private static bool Big(JToken show)
        {
            string importance = Kit.Str(show, "importance");
            return importance == "major" || importance == "flagship";
        }

        private static VisualElement DayCell(GameDate date, GameDate month, GameDate today, Dictionary<string, List<JToken>> byDate, ScreenContext context)
        {
            VisualElement cell = Ds.Column("wl-month__cell");
            if (date.Month != month.Month) cell.AddToClassList("wl-month__cell--outside");
            if (date < today) cell.AddToClassList("wl-month__cell--past");
            VisualElement top = Ds.Row("wl-month__top");
            Label number = Ds.Text(date.Day.ToString(CultureInfo.InvariantCulture), "wl-month__day");
            top.Add(number);
            if (date == today)
            {
                cell.AddToClassList("wl-month__cell--today");
                top.Add(Ds.Text("TODAY", "wl-month__today"));
            }
            cell.Add(top);
            if (byDate.TryGetValue(date.Iso, out List<JToken> shows))
            {
                foreach (JToken show in shows.Take(ChipsPerDay)) cell.Add(Chip(show, context));
                if (shows.Count > ChipsPerDay)
                {
                    Button more = Ds.Button($"+{shows.Count - ChipsPerDay} more", () => DayList(context, date, shows), DsButtonKind.Ghost);
                    more.AddToClassList("ds-btn--link");
                    more.AddToClassList("wl-month__more");
                    cell.Add(more);
                }
            }
            return cell;
        }

        private static Button Chip(JToken show, ScreenContext context)
        {
            string id = Kit.Str(show, "eventInstanceId");
            var chip = new Button(() => ShowSheet.Open(context, id)) { text = string.Empty };
            chip.AddToClassList("wl-show-chip");
            chip.name = $"calendar-show-{id}";
            string status = Kit.Str(show, "status");
            if (Kit.Bool(show, "isOwn")) chip.AddToClassList("wl-show-chip--own");
            if (Big(show)) chip.AddToClassList("wl-show-chip--big");
            if (status == "completed") chip.AddToClassList("wl-show-chip--done");
            if (status == "cancelled") chip.AddToClassList("wl-show-chip--cancelled");
            UnityEngine.Texture2D logo = PromotionLogos.ShowTexture(Kit.Str(show, "logoRef"));
            if (logo != null)
            {
                VisualElement plate = DsCards.Logo(null, null, "wl-logo--chip", logo);
                plate.style.unityBackgroundScaleMode = UnityEngine.ScaleMode.ScaleToFit;
                chip.Add(plate);
            }
            else chip.Add(W.Logo(null, Kit.Str(show, "promotion.shortName"), Kit.Str(show, "promotion.color"), "wl-logo--chip"));
            chip.Add(Ds.Text(Kit.Str(show, "name"), "wl-show-chip__label"));
            if (status == "completed") chip.Add(new Icon("check", "ds-icon--xs", "wl-show-chip__icon"));
            DsTooltip.Attach(chip, $"{Kit.Str(show, "promotion.name")} · {W.Words(Kit.Str(show, "importance"))}" + (status == "completed" && Kit.Num(show, "score") is double score ? $" · scored {W.Int(score)}" : string.Empty), Kit.Str(show, "name"));
            return chip;
        }

        /// <summary>A busy day's full list in a sheet.</summary>
        private static void DayList(ScreenContext context, GameDate date, List<JToken> shows)
        {
            VisualElement body = Ds.Column("wl-day-list");
            OverlayHandle handle = null;
            foreach (JToken show in shows)
            {
                Button chip = Chip(show, context);
                chip.clicked += () => handle?.Close();
                body.Add(chip);
            }
            handle = DsOverlay.SideSheet(context.Overlay.Layer, date.DayMonthYear, body, $"{shows.Count} shows", null, 420f);
        }
    }

    /// <summary>A show's sheet (the web's ShowDetailSheet) over <c>calendar.show</c>, on the design system.</summary>
    public static class ShowSheet
    {
        public static async void Open(ScreenContext context, string eventInstanceId)
        {
            EngineGame game = Kit.Game;
            QueryResult<JToken> answer = await game.Client.Query("calendar.show", new JObject { ["eventInstanceId"] = eventInstanceId });
            JToken show = answer.Ok ? answer.Data : null;
            VisualElement body = Ds.Column("wl-show-sheet");
            OverlayHandle handle = null;
            if (show == null || show.Type == JTokenType.Null)
            {
                body.Add(Kit.Error(answer.Ok ? "That show isn't on the calendar any more." : Kit.Reasons(answer.Reasons)));
                handle = DsOverlay.SideSheet(context.Overlay.Layer, "Show", body, null, null, 460f);
                if (handle != null) handle.Content.name = "show-sheet";
                return;
            }

            string promotionId = Kit.Str(show, "promotion.id");
            string status = Kit.Str(show, "status");
            bool own = Kit.Bool(show, "isOwn");

            VisualElement hero = Ds.Row("ds-row--top", "wl-hero").Named("show-sheet-logo");
            VisualElement logoSlot = Ds.Row("wl-logo-slot");
            UnityEngine.Texture2D showLogo = PromotionLogos.ShowTexture(Kit.Str(show, "logoRef"));
            if (showLogo != null)
            {
                VisualElement plate = DsCards.Logo(null, null, "ds-logo--lg", showLogo);
                plate.style.unityBackgroundScaleMode = UnityEngine.ScaleMode.ScaleToFit;
                logoSlot.Add(plate);
            }
            else PromotionsScreen.FillLogo(logoSlot, promotionId, Kit.Str(show, "promotion.shortName"), "ds-logo--lg");
            hero.Add(logoSlot);
            VisualElement words = Ds.Column("wl-hero__words");
            words.Add(Ds.Text(TextFormat.Upper(Kit.Str(show, "name")), "ds-type-headline", "wl-hero__name"));
            Button promotionLink = Ds.Button(Kit.Str(show, "promotion.name"), () =>
            {
                handle?.Close();
                context.Navigator.Go(ShellRoute.With(PromotionsScreen.ProfileId, "id", promotionId));
            }, DsButtonKind.Ghost);
            promotionLink.AddToClassList("ds-btn--link");
            promotionLink.AddToClassList("wl-hero__employer-link");
            words.Add(promotionLink);
            VisualElement tags = Ds.Row("ds-row--wrap", "wl-hero__tags");
            tags.Add(StatusPill(status));
            string importance = Kit.Str(show, "importance");
            tags.Add(importance == "major" || importance == "flagship" ? Ds.Tag(W.Words(importance), "gold") : Ds.Tag(W.Words(importance)));
            if (Kit.Bool(show, "televised")) tags.Add(Ds.Tag("TV", "live"));
            if (own) tags.Add(Ds.Tag("Yours", "live"));
            words.Add(tags);
            hero.Add(words);
            body.Add(hero);

            if (status == "completed" && Kit.Num(show, "score") is double score)
            {
                (DsState state, string word) = W.ShowScore(score);
                VisualElement tiles = Ds.Row("wl-tiles");
                tiles.Add(WorkerProfileScreen.Tile("Show score", W.Int(score), word, state, null, true));
                tiles.Add(WorkerProfileScreen.Tile("Card", $"{W.Int(Kit.Num(show, "segmentCount"))}", "segments ran", DsState.Neutral, null, true));
                body.Add(tiles);
            }

            body.Add(Ds.SectionHeader("When and where"));
            var pairs = new List<(string, string)> { ("Date", Kit.Date(Kit.Str(show, "date"), true)) };
            if (Kit.Str(show, "definition.recurrenceText") is string recurrence) pairs.Add(("Runs", recurrence));
            if (Kit.Str(show, "brand.name") is string brand) pairs.Add(("Brand", brand));
            string venue = Kit.Str(show, "venue.name") ?? Kit.Str(show, "genericVenue.name");
            if (venue != null)
            {
                double? capacity = Kit.Num(show, "venue.capacity");
                pairs.Add(("Venue", capacity.HasValue ? $"{venue} ({TextFormat.Number((long)capacity.Value)} seats)" : venue));
            }
            pairs.Add(("Region", $"{Kit.Str(show, "region.name")}, {Kit.Str(show, "region.countryName")}"));
            if (status != "completed") pairs.Add(("Card", $"{Kit.Num(show, "segmentCount") ?? 0} of {Kit.Num(show, "format.slots")} slots booked"));
            body.Add(Ds.KeyValues(pairs.ToArray()));
            if (Kit.Obj(show, "placementTrace") != null)
            {
                VisualElement why = Ds.Row("wl-dot-num", "wl-gap-top");
                why.Add(Ds.Text("Why this date and venue", "ds-type-caption"));
                why.AddToClassList("ds-why-host--hover");
                W.QuietWhy(why, Kit.WhyTrace("Placement", 0, Kit.Obj(show, "placementTrace"), null, "Why this date"));
                body.Add(why);
            }
            if (Kit.Str(show, "cancellation.reason") is string reason) body.Add(Ds.Pill(DsState.Warn, reason, "warning"));

            VisualElement footer = Ds.Row();
            footer.Add(Ds.Spacer());
            if (status == "completed")
            {
                Button results = Ds.Button("See the results", () =>
                {
                    handle?.Close();
                    context.Navigator.Go(ShellRoute.With(ScreenIds.ShowResults, "event", eventInstanceId));
                }, DsButtonKind.Primary, "chevron-right");
                results.name = "show-sheet-results";
                footer.Add(results);
            }
            else if (own && status != "cancelled")
            {
                Button card = Ds.Button("Open the card", () =>
                {
                    handle?.Close();
                    context.Navigator.Go(ShellRoute.With("booking", "event", eventInstanceId));
                }, DsButtonKind.Primary, "booking");
                card.name = "show-sheet-book";
                footer.Add(card);
            }
            handle = DsOverlay.SideSheet(context.Overlay.Layer, Kit.Str(show, "name") ?? "Show", body, Kit.Str(show, "promotion.shortName"), footer, 460f);
            if (handle != null) handle.Content.name = "show-sheet";
        }

        private static VisualElement StatusPill(string status) => status switch
        {
            "completed" => Ds.Pill(DsState.Neutral, "Done", "check"),
            "cancelled" => Ds.Pill(DsState.Bad, "Cancelled", "stop"),
            "live" => Ds.Pill(DsState.Live, "Live now", "live"),
            _ => Ds.Pill(DsState.Info, "Scheduled", "calendar"),
        };
    }
}
