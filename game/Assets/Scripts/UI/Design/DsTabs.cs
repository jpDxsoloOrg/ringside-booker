using System;
using System.Collections.Generic;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Design
{
    /// <summary>
    /// Tabs: underlined capitals with an optional count (the default) or a compact segmented switch
    /// (<see cref="Segmented"/>: view modes such as Cards / Table). Raises <see cref="Selected"/>
    /// with the tab id; arrow keys move between tabs.
    /// </summary>
    public sealed class DsTabs : VisualElement
    {
        private readonly Dictionary<string, Button> tabs = new Dictionary<string, Button>();
        private readonly List<string> order = new List<string>();

        public DsTabs(bool segmented = false)
        {
            AddToClassList(segmented ? "ds-segmented" : "ds-tabs");
            Segmented = segmented;
            RegisterCallback<NavigationMoveEvent>(OnMove);
        }

        public bool Segmented { get; }
        public string Current { get; private set; }

        public event Action<string> Selected;

        public DsTabs Add(string id, string label, int? count = null, string icon = null)
        {
            var tab = new Button(() => Select(id)) { text = string.Empty };
            tab.AddToClassList(Segmented ? "ds-segmented__item" : "ds-tab");
            if (icon != null) tab.Add(new Icon(icon, "ds-icon--sm", "ds-tab__icon"));
            tab.Add(Ui.Text(Segmented ? label : TextFormat.Upper(label), "ds-tab__label"));
            if (count.HasValue) tab.Add(Ui.Text(count.Value.ToString(), "ds-tab__count"));
            tab.name = "tab-" + id;
            tabs[id] = tab;
            order.Add(id);
            Add(tab);
            if (Current == null) Select(id, false);
            return this;
        }

        public void Select(string id, bool notify = true)
        {
            if (!tabs.ContainsKey(id)) return;
            Current = id;
            foreach (KeyValuePair<string, Button> pair in tabs)
            {
                pair.Value.EnableInClassList(Segmented ? "ds-segmented__item--current" : "ds-tab--current", pair.Key == id);
            }
            if (notify) Selected?.Invoke(id);
        }

        private void OnMove(NavigationMoveEvent evt)
        {
            int index = order.IndexOf(Current);
            if (evt.direction == NavigationMoveEvent.Direction.Right) index++;
            else if (evt.direction == NavigationMoveEvent.Direction.Left) index--;
            else return;
            if (index < 0 || index >= order.Count) return;
            Select(order[index]);
            tabs[order[index]].Focus();
            evt.StopPropagation();
        }
    }
}
