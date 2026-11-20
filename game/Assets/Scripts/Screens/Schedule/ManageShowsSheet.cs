using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens.Schedule
{
    /// <summary>
    /// Manage shows (EVT8-03): your recurring shows from <c>calendar.definitions</c> in a table
    /// (name, how often, size, next date, state) with Edit and Retire…, on Running and Retired tabs,
    /// plus a New show button. Redraws itself when the world changes (after a save or a retire).
    /// </summary>
    public sealed class ManageShowsSheet
    {
        public static ManageShowsSheet Current { get; private set; }

        private readonly ScreenContext context;
        private readonly string promotionId;
        private readonly VisualElement body = Ds.Column("sc-manage");
        private readonly VisualElement footer = Ds.Row("sc-footer");
        private OverlayHandle handle;
        private string tab = "running";

        private ManageShowsSheet(ScreenContext context, string promotionId)
        {
            this.context = context;
            this.promotionId = promotionId;
        }

        /// <summary>The rows on show (tours).</summary>
        public List<JToken> Rows { get; private set; } = new List<JToken>();

        public bool Busy { get; private set; }

        public static void Open(ScreenContext context, string promotionId)
        {
            var sheet = new ManageShowsSheet(context, promotionId);
            Current = sheet;
            ScheduleEditor.Style(sheet.body);
            sheet.footer.Add(Ds.Spacer());
            Button add = Ds.Button("New show", () => ScheduleEditor.OpenMenu(sheet.footer, context, promotionId), DsButtonKind.Primary, "add");
            add.name = "manage-new-show";
            sheet.footer.Add(add);
            Button close = Ds.Button("Close", () => sheet.handle?.Close(), DsButtonKind.Ghost);
            close.name = "manage-close";
            sheet.footer.Add(close);
            sheet.handle = ScheduleEditor.Sheet(context, "Your shows", sheet.body, sheet.footer, "Schedule", 820f, "schedule-manage");
            if (sheet.handle == null) return;
            EngineClient client = Kit.Game.Client;
            void Changed(long revision) => _ = sheet.Render();
            client.OnStateChanged += Changed;
            sheet.handle.Closed += () =>
            {
                client.OnStateChanged -= Changed;
                if (Current == sheet) Current = null;
            };
            _ = sheet.Render();
        }

        /// <summary>Switches between the Running and Retired tabs.</summary>
        public void SelectTab(string id)
        {
            tab = id;
            _ = Render();
        }

        private async Task Render()
        {
            Busy = true;
            QueryResult<JToken> answer = await Kit.Game.Client.Query("calendar.definitions", new JObject { ["promotionId"] = promotionId });
            Busy = false;
            body.Clear();
            if (!answer.Ok)
            {
                body.Add(Kit.Error(Kit.Reasons(answer.Reasons)));
                return;
            }
            List<JToken> all = Kit.Arr(answer.Data).ToList();
            int retiredCount = all.Count(row => Kit.Str(row, "state") == "retired");
            var tabs = new DsTabs { name = "manage-tabs" };
            tabs.Add("running", "Running", all.Count - retiredCount).Add("retired", "Retired", retiredCount);
            tabs.Select(tab, false);
            tabs.Selected += SelectTab;
            body.Add(tabs);
            Rows = all.Where(row => (Kit.Str(row, "state") == "retired") == (tab == "retired")).ToList();
            if (Rows.Count == 0)
            {
                body.Add(tab == "retired"
                    ? Ds.Empty("calendar", "No retired shows", "Shows you retire stay here with their history.")
                    : Ds.Empty("calendar", "No recurring shows yet", "Start a weekly TV show or a monthly special.", "New recurring show",
                        () => DefinitionEditorSheet.Open(context, promotionId, null), "add"));
                return;
            }
            var columns = new List<DsColumn<JToken>>
            {
                new DsColumn<JToken>("name", "Show", row =>
                {
                    VisualElement cell = Ds.Column("sc-show-cell");
                    cell.Add(Ds.Text(Kit.Str(row, "name"), "sc-show-cell__name"));
                    string brand = Kit.Str(row, "brandName");
                    cell.Add(Ds.Text(brand ?? "Whole promotion", "sc-show-cell__brand"));
                    return cell;
                }) { Grow = 2f, MinWidth = 170, Pinned = true, SortKey = row => Kit.Str(row, "name") },
                new DsColumn<JToken>("runs", "Runs", row => Cell(Kit.Str(row, "recurrenceText"))) { Grow = 1.8f, MinWidth = 160 },
                new DsColumn<JToken>("size", "Size", row =>
                {
                    VisualElement cell = Ds.Column("sc-size-cell");
                    string importance = Kit.Str(row, "importance");
                    cell.Add(importance == "major" || importance == "flagship" ? Ds.Tag(W.Words(importance), "gold") : Ds.Tag(W.Words(importance)));
                    cell.Add(Ds.Text(ScheduleEditor.SizeWords(Kit.Num(row, "format.slots"), Kit.Num(row, "format.preShowSlots")), "sc-show-cell__brand"));
                    return cell;
                }) { Grow = 1.2f, MinWidth = 120 },
                new DsColumn<JToken>("next", "Next", row => Cell(Kit.Str(row, "nextDate") is string next ? Kit.Date(next, true) : "—")) { Grow = 1.1f, MinWidth = 110, SortKey = row => Kit.Str(row, "nextDate") ?? "9999" },
                new DsColumn<JToken>("state", "State", row => StatePill(row)) { Grow = 1f, MinWidth = 100 },
                new DsColumn<JToken>("actions", string.Empty, row => Actions(row)) { Grow = 1.3f, MinWidth = 170 },
            };
            var table = new DsTable<JToken>(columns, Rows) { name = "manage-table" };
            body.Add(table);
            body.Add(Ds.Text("Editing a show changes its upcoming dates; shows that are already booked, run or taped are kept as they are.", "dsf-hint"));
        }

        private static VisualElement Cell(string text)
        {
            Label label = Ds.Text(text ?? "—", "sc-cell");
            return label;
        }

        private static VisualElement StatePill(JToken row)
        {
            switch (Kit.Str(row, "state"))
            {
                case "retired":
                    return Ds.Pill(DsState.Neutral, Kit.Str(row, "activeUntil") is string until ? $"Ended {Kit.Date(until)}" : "Retired", "stop");
                case "starts":
                    return Ds.Pill(DsState.Info, $"Starts {Kit.Date(Kit.Str(row, "activeFrom"))}", "calendar");
                default:
                    return Kit.Str(row, "activeUntil") is string last
                        ? Ds.Pill(DsState.Warn, $"Ends {Kit.Date(last)}", "warning")
                        : Ds.Pill(DsState.Good, "Running", "check");
            }
        }

        private VisualElement Actions(JToken row)
        {
            VisualElement cell = Ds.Row("sc-actions");
            if (!Kit.Bool(row, "editable")) return cell;
            string id = Kit.Str(row, "eventDefinitionId");
            Button edit = Ds.Button("Edit", () => DefinitionEditorSheet.Open(context, promotionId, row), DsButtonKind.Ghost, "edit");
            edit.name = $"manage-edit-{id}";
            cell.Add(edit);
            Button retire = Ds.Button("Retire…", () => RetireShowDialog.Open(context, row), DsButtonKind.Ghost, "trash");
            retire.name = $"manage-retire-{id}";
            cell.Add(retire);
            return cell;
        }

        public void Close() => handle?.Close();
    }
}
