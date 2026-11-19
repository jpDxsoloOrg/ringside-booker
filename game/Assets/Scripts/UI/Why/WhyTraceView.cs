using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Why
{
    /// <summary>
    /// A trace as a tree the player can open step by step (the web's <c>TraceTree</c>): the root's
    /// value is the headline, its steps are rows, and any step with sub-steps is a group (open down
    /// to depth 2 at first). Checks that changed nothing stay hidden behind "Show checks that
    /// didn't apply".
    ///
    /// Keyboard: Up and Down move between visible rows, Right opens a group or steps into it, Left
    /// closes it or steps out to the parent, Home and End jump, Enter and Space open or close.
    /// </summary>
    public sealed class WhyTraceView : VisualElement
    {
        /// <summary>Groups down to this depth start open; deeper ones start closed. Top-level rows are depth 1.</summary>
        public const int DefaultOpenDepth = 2;

        public const string UssClassName = "why-trace";

        private readonly TraceNode root;
        private readonly WhyLinks links;
        private readonly Action onLinkFollowed;
        private readonly VisualElement toolbar = new VisualElement();
        private readonly VisualElement treeList = new VisualElement();
        private readonly ScrollView scroll = new ScrollView(ScrollViewMode.Vertical);
        private readonly Dictionary<string, VisualElement> rowsByPath = new Dictionary<string, VisualElement>();
        private HashSet<string> expanded;
        private bool showAllChecks;
        private string focusedPath;
        private TreeModel model;
        private List<string> order = new List<string>();

        public WhyTraceView(TraceNode givenRoot, WhyLinks links = null, Action onLinkFollowed = null, bool defaultShowAllChecks = false)
        {
            // Every step reads in its calculation's unit, so a money step shows dollars, not cents.
            root = TraceStepUnits.WithStepUnits(givenRoot ?? throw new ArgumentNullException(nameof(givenRoot)));
            this.links = links;
            this.onLinkFollowed = onLinkFollowed;
            showAllChecks = defaultShowAllChecks;
            AddToClassList(UssClassName);

            var headline = new VisualElement();
            headline.AddToClassList("why-headline");
            var headlineLabel = new Label(root.Label);
            headlineLabel.AddToClassList("why-headline__label");
            var headlineValue = new Label(TraceWording.ValueText(root));
            headlineValue.AddToClassList("why-headline__value");
            headline.Add(headlineLabel);
            headline.Add(headlineValue);
            Add(headline);

            toolbar.AddToClassList("why-toolbar");
            Add(toolbar);

            treeList.AddToClassList("why-tree");
            treeList.RegisterCallback<KeyDownEvent>(OnKeyDown);
            // Arrow keys move between rows here, not between the panel's controls.
            treeList.RegisterCallback<NavigationMoveEvent>(evt =>
            {
                if (evt.direction == NavigationMoveEvent.Direction.Next || evt.direction == NavigationMoveEvent.Direction.Previous) return;
                evt.StopPropagation();
                focusController?.IgnoreEvent(evt);
            });
            scroll.AddToClassList("why-tree-scroll");
            scroll.Add(treeList);
            Add(scroll);

            TreeModel all = BuildModel(true);
            expanded = new HashSet<string>(all.GroupPaths.Where(path => all.Entries[path].Depth < DefaultOpenDepth));
            Rebuild();
        }

        /// <summary>The trace shown, with every step's unit filled in.</summary>
        public TraceNode Root => root;

        /// <summary>Whether the checks that changed nothing are on show.</summary>
        public bool ShowAllChecks
        {
            get => showAllChecks;
            set
            {
                if (showAllChecks == value) return;
                showAllChecks = value;
                Rebuild();
            }
        }

        /// <summary>How many rows "Show checks that didn't apply" hides.</summary>
        public int HiddenCheckCount => model.HiddenCheckCount;

        /// <summary>The visible rows' paths, in reading order (<c>"0"</c>, <c>"0.1"</c>…).</summary>
        public IReadOnlyList<string> VisiblePaths => order;

        /// <summary>Opens every group.</summary>
        public void ExpandAll()
        {
            expanded = new HashSet<string>(BuildModel(true).GroupPaths);
            Rebuild();
        }

        /// <summary>Closes every group.</summary>
        public void CollapseAll()
        {
            expanded = new HashSet<string>();
            Rebuild();
        }

        /// <summary>Moves keyboard focus to the row that takes Tab (the first row at first).</summary>
        public bool FocusFirstRow()
        {
            string path = TabStopPath();
            if (path == null || !rowsByPath.TryGetValue(path, out VisualElement row)) return false;
            row.Focus();
            return true;
        }

        private sealed class TreeEntry
        {
            public string Path;
            public TraceNode Node;
            public TraceLine Line;
            public int Depth;
            public string ParentPath;
            public List<string> ChildPaths;
        }

        private sealed class TreeModel
        {
            public readonly Dictionary<string, TreeEntry> Entries = new Dictionary<string, TreeEntry>();
            public readonly List<string> TopLevelPaths = new List<string>();
            public readonly List<string> GroupPaths = new List<string>();
            public int HiddenCheckCount;
        }

        private static string PathOf(string parentPath, int index) =>
            parentPath == null ? index.ToString() : parentPath + "." + index;

        private static int CountHiddenChecks(IReadOnlyList<TraceNode> nodes)
        {
            int count = 0;
            foreach (TraceNode node in nodes)
            {
                if (TraceWording.Describe(node).HiddenByDefault) count++;
                count += CountHiddenChecks(node.ChildList);
            }
            return count;
        }

        /// <summary>Walks the trace once: which nodes are shown, their paths, parents and shown children.</summary>
        private TreeModel BuildModel(bool showAll)
        {
            var result = new TreeModel();
            List<string> AddLevel(IReadOnlyList<TraceNode> nodes, string parentPath, int depth)
            {
                var shown = new List<string>();
                for (int index = 0; index < nodes.Count; index++)
                {
                    TraceNode node = nodes[index];
                    TraceLine line = TraceWording.Describe(node);
                    if (!showAll && line.HiddenByDefault) continue;
                    string path = PathOf(parentPath, index);
                    shown.Add(path);
                    List<string> childPaths = AddLevel(node.ChildList, path, depth + 1);
                    if (childPaths.Count > 0) result.GroupPaths.Add(path);
                    result.Entries[path] = new TreeEntry
                    {
                        Path = path, Node = node, Line = line, Depth = depth, ParentPath = parentPath, ChildPaths = childPaths,
                    };
                }
                return shown;
            }
            IReadOnlyList<TraceNode> topLevel = TraceText.TopLevelNodes(root);
            result.TopLevelPaths.AddRange(AddLevel(topLevel, null, 1));
            result.HiddenCheckCount = CountHiddenChecks(topLevel);
            return result;
        }

        private List<string> VisibleOrder()
        {
            var visible = new List<string>();
            void Visit(IEnumerable<string> paths)
            {
                foreach (string path in paths)
                {
                    visible.Add(path);
                    if (expanded.Contains(path) && model.Entries.TryGetValue(path, out TreeEntry entry)) Visit(entry.ChildPaths);
                }
            }
            Visit(model.TopLevelPaths);
            return visible;
        }

        /// <summary>The row that takes Tab: the focused one, else its nearest shown ancestor, else the first.</summary>
        private string TabStopPath()
        {
            for (string path = focusedPath; path != null; path = path.Contains('.') ? path.Substring(0, path.LastIndexOf('.')) : null)
            {
                if (order.Contains(path)) return path;
            }
            return order.Count > 0 ? order[0] : null;
        }

        private void Rebuild()
        {
            bool hadFocus = focusedPath != null && rowsByPath.TryGetValue(focusedPath, out VisualElement focusedRow)
                && focusedRow.focusController?.focusedElement == focusedRow;
            model = BuildModel(showAllChecks);
            order = VisibleOrder();
            BuildToolbar();
            treeList.Clear();
            rowsByPath.Clear();
            string tabStop = TabStopPath();
            foreach (string path in model.TopLevelPaths) treeList.Add(BuildRow(model.Entries[path], tabStop));
            if (hadFocus && tabStop != null && rowsByPath.TryGetValue(tabStop, out VisualElement row))
            {
                focusedPath = tabStop;
                row.schedule.Execute(() => row.Focus());
            }
        }

        private void BuildToolbar()
        {
            toolbar.Clear();
            if (model.GroupPaths.Count > 0)
            {
                toolbar.Add(ToolbarButton("Expand all", ExpandAll));
                toolbar.Add(ToolbarButton("Collapse all", CollapseAll));
            }
            if (model.HiddenCheckCount > 0)
            {
                Button toggle = ToolbarButton($"Show checks that didn't apply ({model.HiddenCheckCount})", () => ShowAllChecks = !ShowAllChecks);
                toggle.EnableInClassList("why-button--pressed", showAllChecks);
                toggle.name = "why-show-checks";
                toolbar.Add(toggle);
            }
            toolbar.style.display = toolbar.childCount > 0 ? DisplayStyle.Flex : DisplayStyle.None;
        }

        private static Button ToolbarButton(string text, Action clicked)
        {
            var button = new Button(clicked) { text = text };
            button.AddToClassList("why-button");
            button.AddToClassList("why-button--ghost");
            return button;
        }

        private VisualElement BuildRow(TreeEntry entry, string tabStop)
        {
            bool isGroup = entry.ChildPaths.Count > 0;
            bool isOpen = isGroup && expanded.Contains(entry.Path);

            var item = new VisualElement { focusable = true, tabIndex = entry.Path == tabStop ? 0 : -1 };
            item.AddToClassList("why-item");
            item.EnableInClassList("why-item--group", isGroup);
            item.userData = entry.Path;
            rowsByPath[entry.Path] = item;
            item.RegisterCallback<FocusInEvent>(evt =>
            {
                if (evt.target == item) focusedPath = entry.Path;
            });

            var row = new VisualElement();
            row.AddToClassList("why-row");
            var chevron = new Label(isGroup ? (isOpen ? "▾" : "▸") : string.Empty);
            chevron.AddToClassList("why-row__chevron");
            row.Add(chevron);
            row.Add(BuildContent(entry));
            row.RegisterCallback<ClickEvent>(evt =>
            {
                if (evt.target is VisualElement target && target.ClassListContains("why-link")) return;
                focusedPath = entry.Path;
                if (isGroup) SetGroupOpen(entry.Path, !expanded.Contains(entry.Path));
                else item.Focus();
            });
            item.Add(row);

            if (isOpen)
            {
                var children = new VisualElement();
                children.AddToClassList("why-children");
                foreach (string childPath in entry.ChildPaths) children.Add(BuildRow(model.Entries[childPath], tabStop));
                item.Add(children);
            }
            return item;
        }

        private VisualElement BuildContent(TreeEntry entry)
        {
            TraceLine line = entry.Line;
            var content = new VisualElement();
            content.AddToClassList("why-row__content");

            var words = new VisualElement();
            words.AddToClassList("why-line");
            string toneClass = "why-tone--" + line.Tone.ToString().ToLowerInvariant();
            TraceNode node = entry.Node;
            if (node.Kind == TraceKinds.Input && node.Ref != null && links != null && links.CanOpen(node.Ref))
            {
                // An input that points at an entity links its label there.
                var link = new Label(node.Label) { focusable = true, tabIndex = -1 };
                link.AddToClassList("why-link");
                link.AddToClassList(toneClass);
                EntityRef target = node.Ref;
                void Follow()
                {
                    onLinkFollowed?.Invoke();
                    links.Open(target);
                }
                link.RegisterCallback<ClickEvent>(evt =>
                {
                    evt.StopPropagation();
                    Follow();
                });
                link.RegisterCallback<KeyDownEvent>(evt =>
                {
                    if (evt.keyCode != KeyCode.Return && evt.keyCode != KeyCode.KeypadEnter) return;
                    evt.StopPropagation();
                    Follow();
                });
                link.tooltip = $"Open {node.Label}";
                words.Add(link);
                var rest = new Label(": " + TraceFormat.Value(node.Value, node.Unit));
                rest.AddToClassList("why-line__text");
                rest.AddToClassList(toneClass);
                words.Add(rest);
            }
            else
            {
                var text = new Label(line.Text);
                text.AddToClassList("why-line__text");
                text.AddToClassList(toneClass);
                text.EnableInClassList("why-line__text--formula", node.Kind == TraceKinds.Formula);
                words.Add(text);
            }
            if (line.Badge != null)
            {
                var badge = new Label(line.Badge);
                badge.AddToClassList("why-badge");
                words.Add(badge);
            }
            foreach (string detail in line.Details)
            {
                var detailLabel = new Label(detail);
                detailLabel.AddToClassList("why-detail");
                words.Add(detailLabel);
            }
            content.Add(words);

            if (line.Items.Count > 0)
            {
                var options = new VisualElement();
                options.AddToClassList("why-options");
                foreach (string itemText in line.Items)
                {
                    var option = new Label(itemText);
                    option.AddToClassList("why-option");
                    options.Add(option);
                }
                content.Add(options);
            }
            return content;
        }

        private void SetGroupOpen(string path, bool open)
        {
            if (expanded.Contains(path) == open) return;
            if (open) expanded.Add(path);
            else expanded.Remove(path);
            focusedPath = path;
            Rebuild();
            FocusPath(path);
        }

        private void FocusPath(string path)
        {
            if (path == null) return;
            focusedPath = path;
            if (!rowsByPath.TryGetValue(path, out VisualElement row)) return;
            // Roving tab stop: only the focused row is in the Tab order.
            foreach (VisualElement other in rowsByPath.Values) other.tabIndex = -1;
            row.tabIndex = 0;
            row.Focus();
            // A row built this frame may not take focus until it has been laid out.
            row.schedule.Execute(() =>
            {
                if (focusedPath != path) return;
                if (row.focusController?.focusedElement != row) row.Focus();
                if (row.panel != null) scroll.ScrollTo(row);
            });
        }

        private string PathFromTarget(IEventHandler target)
        {
            for (var element = target as VisualElement; element != null && element != treeList; element = element.parent)
            {
                if (element.ClassListContains("why-link")) return null;
                if (element.ClassListContains("why-item")) return element.userData as string;
            }
            return null;
        }

        private void OnKeyDown(KeyDownEvent evt)
        {
            string path = PathFromTarget(evt.target);
            if (path == null || !model.Entries.TryGetValue(path, out TreeEntry entry)) return;
            int index = order.IndexOf(path);
            bool isGroup = entry.ChildPaths.Count > 0;
            bool isOpen = isGroup && expanded.Contains(path);
            void MoveTo(int target)
            {
                if (target >= 0 && target < order.Count) FocusPath(order[target]);
            }

            switch (evt.keyCode)
            {
                case KeyCode.DownArrow:
                    MoveTo(index + 1);
                    break;
                case KeyCode.UpArrow:
                    MoveTo(index - 1);
                    break;
                case KeyCode.Home:
                    MoveTo(0);
                    break;
                case KeyCode.End:
                    MoveTo(order.Count - 1);
                    break;
                case KeyCode.RightArrow:
                    if (isGroup && !isOpen) SetGroupOpen(path, true);
                    else if (isOpen) FocusPath(entry.ChildPaths[0]);
                    break;
                case KeyCode.LeftArrow:
                    if (isOpen) SetGroupOpen(path, false);
                    else if (entry.ParentPath != null) FocusPath(entry.ParentPath);
                    break;
                case KeyCode.Return:
                case KeyCode.KeypadEnter:
                case KeyCode.Space:
                    if (isGroup) SetGroupOpen(path, !isOpen);
                    break;
                default:
                    return;
            }
            evt.StopPropagation();
        }
    }
}
