using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Day;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// The Roster (the web's RosterScreen): a tab per role group over <c>roster.rows</c> with push,
    /// overall and popularity (Why? through <c>roster.explain</c>), momentum, morale, availability
    /// and contract end; Set push on each row (<c>roster.setPush</c>); and the Injuries tab over
    /// <c>health.report</c>, which marks new injuries seen (clearing the day's Roster stop).
    /// </summary>
    public static class RosterScreen
    {
        private static readonly (string id, string label)[] Tabs =
        {
            ("wrestlers", "Wrestlers"),
            ("managers", "Managers"),
            ("announcers", "Announcers"),
            ("referees", "Referees"),
            ("producers", "Producers"),
            ("others", "Others"),
            (DayControlLogic.InjuriesTabId, "Injuries"),
        };

        public static VisualElement Build(ScreenContext context)
        {
            string tab = context.Route.Param("tab") ?? "wrestlers";
            VisualElement screen = Kit.Screen("roster", "Roster");
            screen.Add(Kit.Chips(Tabs.Select(entry => (entry.id, entry.label)), tab,
                picked => context.Navigator.Go(ShellRoute.With("roster", "tab", picked)), "roster-tabs"));
            VisualElement host = Ui.El("rb-roster");
            screen.Add(host);
            if (tab == DayControlLogic.InjuriesTabId) Kit.Live(host, () => RenderInjuries(host));
            else Kit.Live(host, () => RenderGroup(host, tab, context));
            return screen;
        }

        private static async Task RenderGroup(VisualElement host, string group, ScreenContext context)
        {
            EngineClient client = Kit.Game.Client;
            QueryResult<JToken> rows = await client.Query("roster.rows", new JObject { ["group"] = group });
            QueryResult<JToken> summary = await client.Query("roster.summary");
            host.Clear();
            if (!rows.Ok)
            {
                host.Add(Kit.Error(Kit.Reasons(rows.Reasons)));
                return;
            }

            if (summary.Ok)
            {
                JToken byPush = Kit.Obj(summary.Data, "byPush");
                host.Add(Kit.Note(
                    $"{Kit.Num(summary.Data, "total")} under contract · " +
                    string.Join(" · ", Kit.CardPushes.Select(push => $"{Kit.PushLabel(push)} {Kit.Num(byPush, push) ?? 0}")) +
                    (Kit.Num(summary.Data, "unavailable") is double away && away > 0 ? $" · {away} unavailable" : string.Empty),
                    "rb-subtitle"));
            }

            List<JToken> list = Kit.Arr(rows.Data, "rows").ToList();
            if (list.Count == 0)
            {
                host.Add(Kit.Note(Kit.Str(rows.Data, "unavailableReason") ?? $"No {group} under contract."));
                return;
            }

            bool wrestlers = group == "wrestlers";
            Import.Pictures.PictureProvider pictures = WorkshopWorlds.CurrentPictures;
            var table = new Kit.Table(host,
                new[] { "Name", "Brand", "Push", "Expects", "Overall", "Popularity", "Momentum", "Morale", "Availability", "Contract ends" },
                new[] { 2.2f, 1.4f, 1.6f, 1.1f, 1f, 1.1f, 0.9f, 0.8f, 1.3f, 1.2f });
            table.Root.name = "roster-table";
            foreach (JToken row in list)
            {
                string employmentId = Kit.Str(row, "employmentId");
                double overall = Kit.Num(row, "overall.value") ?? 0;
                double popularity = Kit.Num(row, "popularity") ?? 0;
                string push = Kit.Str(row, "push");

                VisualElement name = Ui.El("rb-row", "rb-row--tight").With(
                    Portrait(pictures, Kit.Str(row, "imageRef")),
                    Ui.El("rb-cell-stack").With(
                        Ui.Text(Kit.Str(row, "ringName"), "t-ui-semibold"),
                        Ui.Text($"{Kit.Capital(Kit.Str(row, "alignment"))} · {Kit.Num(row, "age")}", "t-xs", "t-muted")));

                VisualElement pushCell = Ui.El("rb-row", "rb-row--tight");
                pushCell.Add(Ui.Text(Kit.PushLabel(push), "rb-table__text"));
                if (wrestlers && push != "none")
                {
                    Button set = Ui.Btn("Set", () => SetPushSheet.Open(context.Overlay, row), "btn--link");
                    set.name = $"set-push-{employmentId}";
                    set.tooltip = $"Set push — {Kit.Str(row, "ringName")}";
                    pushCell.Add(set);
                }

                string verdict = Kit.Str(row, "pushGap.verdict");
                Label expects = Ui.Text(Kit.PushLabel(Kit.Str(row, "expectedPush")), "rb-table__text");
                if (verdict == "underPushed") expects.AddToClassList("t-negative");

                VisualElement overallCell = Ui.El("rb-row", "rb-row--tight").With(
                    Ui.Text($"{Kit.Decimal1(overall)} {Kit.Str(row, "overall.grade")}", "rb-table__text"),
                    Kit.WhyExplain("Overall", overall, "roster.explain", new JObject { ["employmentId"] = employmentId, ["metric"] = "overall" }));
                VisualElement popularityCell = Ui.El("rb-row", "rb-row--tight").With(
                    Ui.Text(Kit.Decimal1(popularity), "rb-table__text", "t-data"),
                    Kit.WhyExplain("Popularity", popularity, "roster.explain", new JObject { ["employmentId"] = employmentId, ["metric"] = "popularity" }, "points"));

                double? momentum = Kit.Num(row, "momentum.value");
                double? morale = Kit.Num(row, "morale.value");
                VisualElement momentumCell = Ui.El("rb-row", "rb-row--tight").With(
                    Ui.Text(momentum.HasValue ? Kit.Decimal1(momentum) : Kit.NoValue, "rb-table__text"),
                    momentum.HasValue ? Kit.WhyRef("Momentum", momentum.Value, Kit.Obj(row, "momentum.traceRef")) : null);
                VisualElement moraleCell = Ui.El("rb-row", "rb-row--tight").With(
                    Ui.Text(morale.HasValue ? Kit.Decimal1(morale) : Kit.NoValue, "rb-table__text"),
                    morale.HasValue ? Kit.WhyRef("Morale", morale.Value, Kit.Obj(row, "morale.traceRef")) : null);

                string status = Kit.Str(row, "availability.status");
                Label availability = Ui.Text(AvailabilityText(row), "rb-table__text", "t-wrap");
                if (status != "available") availability.AddToClassList("t-negative");

                string ends = Kit.Str(row, "endsOn");
                double? daysLeft = Kit.Num(row, "daysLeft");
                Label contract = Ui.Text(ends == null ? "Open-ended" : $"{Kit.Date(ends)}", "rb-table__text");
                if (daysLeft.HasValue && daysLeft.Value <= 60) contract.AddToClassList("t-negative");

                table.AddRow(name, Kit.Str(row, "brandName") ?? "Shared", pushCell, expects, overallCell, popularityCell,
                    momentumCell, moraleCell, availability, contract).name = $"roster-row-{employmentId}";
            }
        }

        /// <summary>A small portrait from a workshop world mod's pictures (placeholder when missing); nothing for a world without pictures.</summary>
        public static VisualElement Portrait(Import.Pictures.PictureProvider pictures, string imageRef)
        {
            if (pictures == null) return null;
            var image = new Image { image = pictures.Get(imageRef), scaleMode = UnityEngine.ScaleMode.ScaleAndCrop };
            image.AddToClassList("rb-portrait");
            return image;
        }

        private static string AvailabilityText(JToken row)
        {
            string status = Kit.Str(row, "availability.status");
            if (status == "available" || status == null) return "Available";
            string until = Kit.Str(row, "availability.until");
            string reason = Kit.Str(row, "availability.reason") ?? Kit.Capital(status);
            return until == null ? reason : $"{reason} until {Kit.Date(until)}";
        }

        private static async Task RenderInjuries(VisualElement host)
        {
            EngineGame game = Kit.Game;
            QueryResult<JToken> report = await game.Client.Query("health.report",
                new JObject { ["promotionId"] = game.PromotionId });
            host.Clear();
            if (!report.Ok)
            {
                host.Add(Kit.Error(Kit.Reasons(report.Reasons)));
                return;
            }

            await Acknowledge(report.Data);

            List<JToken> rows = Kit.Arr(report.Data, "rows").ToList();
            host.Add(Kit.Note($"Who is out as of {Kit.Date(Kit.Str(report.Data, "asOf"), true)}, soonest back first.", "rb-subtitle"));
            if (rows.Count == 0)
            {
                host.Add(Kit.Note("Nobody on your roster is injured."));
                return;
            }
            var table = new Kit.Table(host,
                new[] { "Name", "Injury", "Severity", "Since", "Back", "Days left", "Condition lost", "Can work angles" },
                new[] { 2f, 2f, 1f, 1.1f, 1.1f, 1f, 1.1f, 1f });
            table.Root.name = "injuries-table";
            foreach (JToken row in rows)
            {
                double daysOut = Kit.Num(row, "daysOut") ?? 0;
                double? remaining = Kit.Num(row, "daysRemaining");
                double loss = Kit.Num(row, "conditionLoss") ?? 0;
                table.AddRow(
                    Ui.Text(Kit.Str(row, "name"), "t-ui-semibold"),
                    $"{Kit.Str(row, "label")} ({Kit.Str(row, "bodyPart")})",
                    Kit.Capital(Kit.Str(row, "severity")),
                    Kit.Date(Kit.Str(row, "since")),
                    Kit.Date(Kit.Str(row, "expectedReturn")),
                    Ui.El("rb-row", "rb-row--tight").With(
                        Ui.Text(remaining.HasValue ? TextFormat.DayCount((int)remaining.Value) : Kit.NoValue, "rb-table__text"),
                        Kit.WhyRef("Time out", daysOut, Kit.Obj(row, "durationTraceRef"), "days")),
                    Ui.El("rb-row", "rb-row--tight").With(
                        Ui.Text(Kit.Decimal1(loss), "rb-table__text"),
                        Kit.WhyRef("Condition lost", loss, Kit.Obj(row, "conditionLossTraceRef"))),
                    Kit.Bool(row, "canWorkAngles") ? "Yes" : "No");
            }
        }

        /// <summary>Opening the tab marks every injury the player has not seen as seen (the web's useAcknowledgeOnView).</summary>
        private static async Task Acknowledge(JToken report)
        {
            EngineGame game = Kit.Game;
            if (game.Client.IsAdvancing) return;
            var ids = new HashSet<string>(Kit.Arr(report, "waitingForViewer").Select(id => (string)id));
            foreach (JToken row in Kit.Arr(report, "rows"))
            {
                if (Kit.Bool(row, "pendingNotice")) ids.Add(Kit.Str(row, "injuryId"));
            }
            List<string> all = ids.Where(id => id != null).ToList();
            for (int start = 0; start < all.Count; start += 50)
            {
                await game.Client.Command("health.acknowledgeInjuries",
                    new JObject { ["injuryIds"] = new JArray(all.Skip(start).Take(50)) });
            }
        }
    }

    /// <summary>The Set push sheet (the web's SetPushSheet): one wrestler's card position.</summary>
    public static class SetPushSheet
    {
        public static void Open(OverlayLayer overlay, JToken row)
        {
            string name = Kit.Str(row, "ringName");
            string current = Kit.Str(row, "push");
            string expected = Kit.Str(row, "expectedPush");
            string picked = current;
            Sheet sheet = Sheet.Open(overlay, $"Set push — {name}", SheetPlacement.Right);
            sheet.Root.name = "set-push-sheet";
            sheet.Body.Add(Ui.Text(TextFormat.Upper("Card position"), "field-label"));
            VisualElement options = Ui.El("rb-stack");
            var buttons = new List<(Button button, string push)>();
            foreach (string push in Kit.CardPushes)
            {
                string value = push;
                string hint = push == current && push == expected ? "Current · Expects"
                    : push == current ? "Current" : push == expected ? "Expects" : string.Empty;
                Button option = Ui.Button(string.Empty, null, "choice-chip", "rb-option");
                option.Add(Ui.Text(Kit.PushLabel(push), "choice-chip__label"));
                if (hint.Length > 0) option.Add(Ui.Text(hint, "choice-chip__detail"));
                option.clicked += () =>
                {
                    picked = value;
                    foreach ((Button other, string otherPush) in buttons) other.EnableInClassList("choice-chip--selected", otherPush == picked);
                };
                option.EnableInClassList("choice-chip--selected", push == current);
                buttons.Add((option, push));
                options.Add(option);
            }
            sheet.Body.Add(options);
            sheet.Body.Add(Kit.Note("Pushing someone below where they expect to be costs morale; above it raises what they expect next."));
            Label feedback = Kit.Feedback();
            sheet.Body.Add(feedback);
            sheet.AddFooterButton("Cancel", sheet.Close, "btn--ghost");
            Button save = sheet.AddFooterButton("Save", async () =>
            {
                if (picked == current)
                {
                    sheet.Close();
                    return;
                }
                CommandResult<JToken> result = await Kit.Run("roster.setPush",
                    new JObject { ["employmentIds"] = new JArray(Kit.Str(row, "employmentId")), ["push"] = picked }, feedback);
                if (result.Ok) sheet.Close();
            }, "btn--primary");
            save.name = "set-push-save";
        }
    }
}
