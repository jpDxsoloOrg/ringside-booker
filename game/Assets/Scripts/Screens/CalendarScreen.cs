using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// The Calendar (the web's CalendarView, month grid): the shows in a month from
    /// <c>calendar.range</c> (yours or the whole world), and a show sheet from <c>calendar.show</c>
    /// with links to book it, run it or read its results.
    /// </summary>
    public static class CalendarScreen
    {
        private static readonly string[] Weekdays = { "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" };

        public static VisualElement Build(ScreenContext context)
        {
            VisualElement screen = Kit.Screen("calendar", "Calendar");
            VisualElement host = Ui.El("rb-calendar");
            screen.Add(host);
            Kit.Live(host, () => Render(host, context));
            return screen;
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
            VisualElement bar = Ui.El("rb-row", "rb-toolbar");
            bar.Add(Ui.Btn("‹", () => context.Navigator.Go(ShellRoute.With("calendar", "month", MonthParam(month.AddMonths(-1)), "scope", scope)), "btn--ghost"));
            bar.Add(Ui.Text(TextFormat.Upper(month.Iso.Length > 0 ? new DateTime(month.Year, month.Month, 1).ToString("MMMM yyyy", System.Globalization.CultureInfo.InvariantCulture) : string.Empty), "rb-title", "rb-toolbar__title"));
            bar.Add(Ui.Btn("›", () => context.Navigator.Go(ShellRoute.With("calendar", "month", MonthParam(month.AddMonths(1)), "scope", scope)), "btn--ghost"));
            bar.Add(Ui.Btn("Today", () => context.Navigator.Go(ShellRoute.With("calendar", "scope", scope)), "btn--ghost"));
            bar.Add(Ui.El("rb-spacer"));
            bar.Add(Kit.Chips(new[] { ("mine", "Your shows"), ("world", "Whole world") }, scope,
                picked => context.Navigator.Go(ShellRoute.With("calendar", "month", MonthParam(month), "scope", picked))));
            host.Add(bar);

            if (!range.Ok)
            {
                host.Add(Kit.Error(Kit.Reasons(range.Reasons)));
                return;
            }

            var byDate = Kit.Arr(range.Data, "shows").GroupBy(show => Kit.Str(show, "date"))
                .ToDictionary(group => group.Key, group => group.ToList());

            VisualElement grid = Ui.El("rb-month").Named("calendar-grid");
            VisualElement head = Ui.El("rb-month__week", "rb-month__head");
            foreach (string weekday in Weekdays) head.Add(Ui.El("rb-month__cell", "rb-month__cell--head").With(Ui.Text(TextFormat.Upper(weekday), "section-label")));
            grid.Add(head);

            int offset = ((int)month.DayOfWeek + 6) % 7; // Monday first
            GameDate cursor = month.AddDays(-offset);
            while (cursor <= last)
            {
                VisualElement week = Ui.El("rb-month__week");
                for (int day = 0; day < 7; day++)
                {
                    week.Add(DayCell(cursor, month, today, byDate, context));
                    cursor = cursor.AddDays(1);
                }
                grid.Add(week);
            }
            host.Add(grid);
        }

        private static VisualElement DayCell(GameDate date, GameDate month, GameDate today, Dictionary<string, List<JToken>> byDate, ScreenContext context)
        {
            VisualElement cell = Ui.El("rb-month__cell");
            if (date.Month != month.Month) cell.AddToClassList("rb-month__cell--outside");
            if (date == today) cell.AddToClassList("rb-month__cell--today");
            cell.Add(Ui.Text(date.Day.ToString(), "rb-month__day"));
            if (byDate.TryGetValue(date.Iso, out List<JToken> shows))
            {
                foreach (JToken show in shows.Take(4))
                {
                    string id = Kit.Str(show, "eventInstanceId");
                    Button chip = Ui.Button(string.Empty, () => ShowSheet.Open(context, id), "rb-show-chip");
                    chip.name = $"calendar-show-{id}";
                    if (Kit.Bool(show, "isOwn")) chip.AddToClassList("rb-show-chip--own");
                    if (Kit.Str(show, "status") == "completed") chip.AddToClassList("rb-show-chip--done");
                    if (Kit.Str(show, "importance") != "regular") chip.AddToClassList("rb-show-chip--major");
                    chip.Add(Ui.Text(Kit.Str(show, "name"), "rb-show-chip__label"));
                    chip.tooltip = $"{Kit.Str(show, "promotion.name")}: {Kit.Str(show, "name")}";
                    cell.Add(chip);
                }
                if (shows.Count > 4) cell.Add(Ui.Text($"+{shows.Count - 4} more", "t-xs", "t-muted"));
            }
            return cell;
        }
    }

    /// <summary>A show's sheet (the web's ShowDetailSheet) over <c>calendar.show</c>.</summary>
    public static class ShowSheet
    {
        public static async void Open(ScreenContext context, string eventInstanceId)
        {
            EngineGame game = Kit.Game;
            QueryResult<JToken> answer = await game.Client.Query("calendar.show", new JObject { ["eventInstanceId"] = eventInstanceId });
            JToken show = answer.Ok ? answer.Data : null;
            Sheet sheet = Sheet.Open(context.Overlay, Kit.Str(show, "name") ?? "Show", SheetPlacement.Right);
            sheet.Root.name = "show-sheet";
            if (show == null || show.Type == JTokenType.Null)
            {
                sheet.Body.Add(Kit.Error(answer.Ok ? "That show isn't on the calendar any more." : Kit.Reasons(answer.Reasons)));
                return;
            }

            VisualElement body = sheet.Body;
            body.Add(Kit.Line("Promotion", Kit.Str(show, "promotion.name")));
            if (Kit.Str(show, "brand.name") is string brand) body.Add(Kit.Line("Brand", brand));
            body.Add(Kit.Line("Date", Kit.Date(Kit.Str(show, "date"), true),
                Kit.WhyTrace("Placement", 0, Kit.Obj(show, "placementTrace"), null, "Why this date")));
            if (Kit.Str(show, "definition.recurrenceText") is string recurrence) body.Add(Kit.Line("Runs", recurrence));
            body.Add(Kit.Line("Importance", Kit.Capital(Kit.Str(show, "importance"))));
            string venue = Kit.Str(show, "venue.name") ?? Kit.Str(show, "genericVenue.name");
            if (venue != null)
            {
                double? capacity = Kit.Num(show, "venue.capacity");
                body.Add(Kit.Line("Venue", capacity.HasValue ? $"{venue} ({TextFormat.Number((long)capacity.Value)} seats)" : venue));
            }
            body.Add(Kit.Line("Region", $"{Kit.Str(show, "region.name")}, {Kit.Str(show, "region.countryName")}"));
            body.Add(Kit.Line("Televised", Kit.Bool(show, "televised") ? "Yes" : "No"));
            string status = Kit.Str(show, "status");
            body.Add(Kit.Line("Status", Kit.Capital(status)));
            body.Add(Kit.Line("Card", $"{Kit.Num(show, "segmentCount") ?? 0} of {Kit.Num(show, "format.slots")} slots"));
            if (Kit.Num(show, "score") is double score) body.Add(Kit.Line("Score", Kit.Whole(score)));

            bool own = Kit.Bool(show, "isOwn");
            if (own && status == "completed")
            {
                sheet.AddFooterButton("See the results", () =>
                {
                    sheet.Close();
                    context.Navigator.Go(ShellRoute.With(ScreenIds.ShowResults, "event", eventInstanceId));
                }, "btn--primary");
            }
            else if (own && status != "cancelled")
            {
                sheet.AddFooterButton("Open the card", () =>
                {
                    sheet.Close();
                    context.Navigator.Go(ShellRoute.With("booking", "event", eventInstanceId));
                }, "btn--primary");
            }
        }
    }
}
