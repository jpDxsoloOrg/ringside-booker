using System;
using System.Collections.Generic;
using System.Linq;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Design
{
    public enum DsAlign
    {
        Left,
        Right,
        Center,
    }

    /// <summary>One column of a <see cref="DsTable{T}"/>.</summary>
    public sealed class DsColumn<T>
    {
        public DsColumn(string id, string header, Func<T, VisualElement> cell)
        {
            Id = id;
            Header = header;
            Cell = cell;
        }

        public string Id { get; }
        public string Header { get; }
        public Func<T, VisualElement> Cell { get; }
        /// <summary>Fixed width in px; 0 means the column grows (<see cref="Grow"/>).</summary>
        public float Width { get; set; }
        public float Grow { get; set; } = 1f;
        public float MinWidth { get; set; } = 60f;
        public DsAlign Align { get; set; }
        /// <summary>What the column sorts by; null = not sortable.</summary>
        public Func<T, IComparable> SortKey { get; set; }
        /// <summary>Shown before the player picks columns. Extra columns live in the column picker.</summary>
        public bool Default { get; set; } = true;
        /// <summary>Always shown (the name column); the picker lists it disabled.</summary>
        public bool Pinned { get; set; }
        /// <summary>Header tooltip: what the column means, in plain words.</summary>
        public string Help { get; set; }

        /// <summary>A text cell from a function (the common case).</summary>
        public static DsColumn<T> Text(string id, string header, Func<T, string> text, string cellClass = null) =>
            new DsColumn<T>(id, header, row => Ui.Text(text(row), "ds-cell__text", cellClass ?? "ds-cell__text--plain"));
    }

    /// <summary>
    /// The compact data table (UNITY-11): 30 px rows, sortable headers, a short default column set
    /// with more columns in a column picker, rows that expand to a details area, and a row click
    /// hook (open a side sheet). Rows are plain elements, fine for a roster-sized list.
    /// </summary>
    public sealed class DsTable<T> : VisualElement
    {
        private readonly List<DsColumn<T>> columns;
        private readonly HashSet<string> shownColumns;
        private readonly VisualElement header;
        private readonly VisualElement body;
        private readonly Func<T, VisualElement> details;
        private readonly HashSet<T> expanded = new HashSet<T>();
        private List<T> rows;
        private string sortId;
        private bool sortDescending;
        private T selected;

        public DsTable(IEnumerable<DsColumn<T>> columns, IEnumerable<T> rows, Func<T, VisualElement> details = null)
        {
            AddToClassList("ds-table");
            this.columns = columns.ToList();
            this.rows = rows.ToList();
            this.details = details;
            shownColumns = new HashSet<string>(this.columns.Where(column => column.Default || column.Pinned).Select(column => column.Id));
            header = Ui.El("ds-table__header");
            body = Ui.El("ds-table__body");
            Add(header);
            Add(body);
            Render();
        }

        /// <summary>Called when a row is clicked (not its expand chevron).</summary>
        public event Action<T> RowClicked;

        public IReadOnlyList<DsColumn<T>> Columns => columns;
        public bool IsVisible(string columnId) => shownColumns.Contains(columnId);

        public void SetRows(IEnumerable<T> newRows)
        {
            rows = newRows.ToList();
            Render();
        }

        public void SortBy(string columnId, bool descending)
        {
            sortId = columnId;
            sortDescending = descending;
            Render();
        }

        public void SetColumnVisible(string columnId, bool show)
        {
            DsColumn<T> column = columns.FirstOrDefault(c => c.Id == columnId);
            if (column == null || column.Pinned) return;
            if (show) shownColumns.Add(columnId);
            else shownColumns.Remove(columnId);
            Render();
        }

        public void ResetColumns()
        {
            shownColumns.Clear();
            foreach (DsColumn<T> column in columns.Where(c => c.Default || c.Pinned)) shownColumns.Add(column.Id);
            Render();
        }

        public void SetExpanded(T row, bool open)
        {
            if (open) expanded.Add(row);
            else expanded.Remove(row);
            Render();
        }

        public void Select(T row)
        {
            selected = row;
            Render();
        }

        /// <summary>The column picker (a popover from the columns button): tick the columns to show.</summary>
        public void OpenColumnPicker(VisualElement anchor)
        {
            VisualElement picker = Ui.El("ds-column-picker");
            picker.Add(Ui.Text(TextFormat.Upper("Columns"), "ds-column-picker__title"));
            picker.Add(Ui.Text("Pick what the table shows. Extra columns are for when you want more detail.", "ds-column-picker__hint"));
            foreach (DsColumn<T> column in columns)
            {
                DsColumn<T> target = column;
                bool on = shownColumns.Contains(column.Id);
                VisualElement box = Ui.El("ds-check__box");
                if (on) box.Add(new Icon("check", "ds-icon--xs", "ds-check__tick"));
                var row = new Button(() =>
                {
                    SetColumnVisible(target.Id, !shownColumns.Contains(target.Id));
                    bool now = shownColumns.Contains(target.Id);
                    box.Clear();
                    if (now) box.Add(new Icon("check", "ds-icon--xs", "ds-check__tick"));
                    box.parent.EnableInClassList("ds-check--on", now);
                }) { text = string.Empty };
                row.AddToClassList("ds-check");
                row.EnableInClassList("ds-check--on", on);
                row.SetEnabled(!column.Pinned);
                row.Add(box);
                row.Add(Ui.Text(column.Header, "ds-check__label"));
                if (!column.Default && !column.Pinned) row.Add(Ui.Text("extra", "ds-check__extra"));
                picker.Add(row);
            }
            VisualElement footer = Ui.El("ds-row", "ds-column-picker__footer");
            footer.Add(Ds.Button("Reset to default", ResetColumns, DsButtonKind.Ghost, "reset"));
            picker.Add(footer);
            DsOverlay.Popover(anchor, picker);
        }

        private void Render()
        {
            header.Clear();
            body.Clear();
            List<DsColumn<T>> shown = columns.Where(column => shownColumns.Contains(column.Id)).ToList();

            if (details != null) header.Add(Ui.El("ds-table__expander"));
            foreach (DsColumn<T> column in shown)
            {
                DsColumn<T> target = column;
                VisualElement cell = HeaderCell(column);
                if (column.SortKey != null)
                {
                    cell.AddToClassList("ds-table__th--sortable");
                    cell.RegisterCallback<ClickEvent>(_ => SortBy(target.Id, sortId == target.Id ? !sortDescending : target.Align == DsAlign.Right));
                }
                header.Add(cell);
            }

            IEnumerable<T> ordered = rows;
            DsColumn<T> sortColumn = columns.FirstOrDefault(column => column.Id == sortId && column.SortKey != null);
            if (sortColumn != null)
            {
                ordered = sortDescending
                    ? rows.OrderByDescending(row => sortColumn.SortKey(row))
                    : rows.OrderBy(row => sortColumn.SortKey(row));
            }

            int index = 0;
            foreach (T row in ordered)
            {
                T item = row;
                VisualElement line = Ui.El("ds-table__row");
                if (index++ % 2 == 1) line.AddToClassList("ds-table__row--alt");
                bool isOpen = expanded.Contains(row);
                line.EnableInClassList("ds-table__row--open", isOpen);
                line.EnableInClassList("ds-table__row--selected", Equals(row, selected) && selected != null);
                if (details != null)
                {
                    var chevron = new Button(() => SetExpanded(item, !expanded.Contains(item))) { text = string.Empty };
                    chevron.AddToClassList("ds-table__expander");
                    chevron.Add(new Icon(isOpen ? "chevron-down" : "chevron-right", "ds-icon--sm"));
                    chevron.tooltip = isOpen ? "Less" : "More";
                    line.Add(chevron);
                }
                foreach (DsColumn<T> column in shown)
                {
                    VisualElement cell = Cell(column);
                    VisualElement content = column.Cell(row);
                    if (content != null) cell.Add(content);
                    line.Add(cell);
                }
                line.RegisterCallback<ClickEvent>(evt =>
                {
                    // Buttons inside the row (the chevron, a Why?) do their own thing.
                    if (evt.target is VisualElement target && target.GetFirstOfType<Button>() != null) return;
                    RowClicked?.Invoke(item);
                });
                body.Add(line);
                if (isOpen && details != null)
                {
                    VisualElement more = Ui.El("ds-table__details");
                    more.Add(details(row));
                    body.Add(more);
                }
            }

            // The column picker button sits at the end of the header.
            Button pick = Ds.IconButton("columns", "Columns: show or hide extra columns", null);
            pick.AddToClassList("ds-table__picker");
            pick.name = "table-columns";
            pick.clicked += () => OpenColumnPicker(pick);
            header.Add(pick);
        }

        private VisualElement HeaderCell(DsColumn<T> column)
        {
            VisualElement cell = Cell(column);
            cell.AddToClassList("ds-table__th");
            cell.Add(Ui.Text(TextFormat.Upper(column.Header), "ds-table__th-label"));
            if (column.SortKey != null)
            {
                bool active = column.Id == sortId;
                var icon = new Icon(active ? (sortDescending ? "sort-desc" : "sort-asc") : "sort", "ds-icon--xs", "ds-table__sort");
                icon.EnableInClassList("ds-table__sort--active", active);
                cell.Add(icon);
            }
            if (column.Help != null) DsTooltip.Attach(cell, column.Help, column.Header);
            return cell;
        }

        private static VisualElement Cell(DsColumn<T> column)
        {
            VisualElement cell = Ui.El("ds-table__cell");
            if (column.Width > 0)
            {
                cell.style.width = column.Width;
                cell.style.flexGrow = 0;
                cell.style.flexShrink = 0;
            }
            else
            {
                cell.style.flexGrow = column.Grow;
                cell.style.flexBasis = 0;
                cell.style.minWidth = column.MinWidth;
            }
            if (column.Align == DsAlign.Right) cell.AddToClassList("ds-table__cell--right");
            else if (column.Align == DsAlign.Center) cell.AddToClassList("ds-table__cell--center");
            return cell;
        }
    }
}
