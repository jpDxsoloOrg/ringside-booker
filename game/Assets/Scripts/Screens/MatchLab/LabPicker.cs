using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.MatchLab
{
    /// <summary>
    /// The worker picker sheet (the web's <c>WorkerPickerSheet</c>): your roster or everyone in the
    /// business from <c>match.labWorkers</c>, searchable, most popular first. Picking someone puts
    /// them on the side and closes the sheet; people already placed and people who can't work show why.
    /// </summary>
    public static class LabPicker
    {
        public static void Open(VisualElement anchor, LabState state, string title, string role, Func<LabPerson, bool> onPick)
        {
            string scope = "mine";
            string search = string.Empty;
            VisualElement body = Ds.Column("lab-picker");
            ScreenDs.Style(body, "Screens/MatchLab");
            VisualElement list = Ds.Column("lab-picker__list").Named("lab-picker-list");
            Label count = Ds.Text(string.Empty, "lab-picker__count");
            OverlayHandle handle = null;
            int ticket = 0;

            async Task Load()
            {
                int mine = ++ticket;
                var args = new JObject { ["scope"] = scope, ["regionId"] = state.RegionId, ["limit"] = 120 };
                if (state.PromotionId != null) args["promotionId"] = state.PromotionId;
                if (!string.IsNullOrWhiteSpace(search)) args["search"] = search.Trim().Length > 40 ? search.Trim().Substring(0, 40) : search.Trim();
                if (role != null) args["role"] = role;
                QueryResult<JToken> answer = await Kit.Game.Client.Query("match.labWorkers", args);
                if (mine != ticket) return;
                list.Clear();
                if (!answer.Ok)
                {
                    list.Add(Kit.Error(Kit.Reasons(answer.Reasons)));
                    return;
                }
                List<JToken> rows = Kit.Arr(answer.Data, "rows").ToList();
                int total = (int)(Kit.Num(answer.Data, "total") ?? rows.Count);
                count.text = total > rows.Count ? $"Showing {rows.Count} of {total}. Search to narrow it down." : $"{total} people";
                if (rows.Count == 0) list.Add(Ds.Empty("search", "Nobody found", "Try another name, or look at everyone."));
                foreach (JToken row in rows) list.Add(Row(row));
            }

            VisualElement Row(JToken row)
            {
                LabPerson person = LabPerson.FromRow(row);
                bool available = Kit.Bool(row, "available");
                int placed = state.SideOf(person.Id);
                var button = new Button(() =>
                {
                    if (onPick(person)) handle?.Close();
                }) { text = string.Empty, name = $"pick-{person.Id}" };
                button.AddToClassList("lab-picker__row");
                button.Add(DsCards.PortraitBox(ScreenDs.Picture(person.ImageRef), Alignment.Tweener, "ds-portrait--xs"));
                VisualElement words = Ds.Column("lab-picker__words");
                words.Add(Ds.Text(person.Name, "lab-picker__name"));
                string where = person.PromotionShortName ?? "Free agent";
                string extra = !available ? Kit.Str(row, "unavailableReason") ?? "Not available"
                    : placed >= 0 ? $"Already on {LabText.SideLabel(placed)}"
                    : person.NonWrestler ? "Doesn't wrestle" : null;
                words.Add(Ds.Text(extra == null ? where : $"{where} · {extra}", "lab-picker__detail"));
                button.Add(words);
                button.Add(Ds.Spacer());
                VisualElement popularity = Ds.Dot(ScreenDs.PopularityState(person.Popularity), $"{ScreenDs.PopularityWord(person.Popularity)} {Math.Round(person.Popularity)}");
                button.Add(popularity);
                if (!available || placed >= 0) button.AddToClassList("lab-picker__row--muted");
                button.SetEnabled(placed < 0);
                return button;
            }

            VisualElement scopes = ScreenDs.Choices(new[] { ("mine", "Your roster"), ("everyone", "Everyone") }, scope, picked =>
            {
                scope = picked;
                foreach (Button chip in body.Query<Button>(className: "ds-chip").ToList())
                {
                    chip.EnableInClassList("ds-chip--selected", chip.name == $"picker-scope-{picked}");
                }
                _ = Load();
            }, "picker-scope");
            body.Add(scopes);
            body.Add(ScreenDs.SearchBox("Search by name…", text =>
            {
                search = text;
                _ = Load();
            }, "picker-search"));
            body.Add(count);
            body.Add(list);
            handle = DsOverlay.SideSheet(anchor, title, body, "Match lab", null, 520f);
            _ = Load();
        }
    }
}
