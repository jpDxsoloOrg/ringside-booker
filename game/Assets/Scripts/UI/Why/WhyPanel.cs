using System;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Why
{
    /// <summary>
    /// The Why? panel (the web's <c>TracePanel</c>): a side sheet that shows how a number was
    /// worked out, step by step, with the final value pinned at the top, and Copy as text in the
    /// footer. An inline trace shows at once; a reference or loader is asked when the panel opens
    /// (with a loading state), and an older result whose trace was summarised says so plainly.
    ///
    /// The element is a full-size overlay (a dimmed backdrop plus the sheet on the right). Open it
    /// with <see cref="WhyPanelHost.Open"/> (or a <see cref="WhyButton"/>) so only one panel is
    /// open at a time and focus returns to the button on close. Esc, the close button and a click
    /// on the backdrop close it.
    /// </summary>
    public sealed class WhyPanel : VisualElement
    {
        public const string UssClassName = "why-overlay";

        private readonly WhySource source;
        private readonly WhyLinks links;
        private readonly VisualElement sheet = new VisualElement();
        private readonly VisualElement body = new VisualElement();
        private readonly VisualElement footer = new VisualElement();
        private readonly Label copyStatus = new Label();
        private readonly Button copyButton;
        private readonly Button closeButton;
        private Func<string> copyText;
        private bool closed;

        /// <summary>Builds a panel. <see cref="WhyPanelHost.Open"/> is the usual way in.</summary>
        public WhyPanel(string title, WhySource source, WhyLinks links = null)
        {
            this.source = source ?? throw new ArgumentNullException(nameof(source));
            this.links = links;
            Title = title ?? string.Empty;
            AddToClassList(UssClassName);
            WhyStyles.Apply(this);
            focusable = false;
            pickingMode = PickingMode.Position;

            // A click on the dimmed backdrop (not inside the sheet) closes the panel.
            RegisterCallback<PointerDownEvent>(evt =>
            {
                if (evt.target == this) Close();
            });
            // Esc closes from anywhere inside; NavigationCancel is the runtime's Esc/back action.
            RegisterCallback<KeyDownEvent>(evt =>
            {
                if (evt.keyCode != KeyCode.Escape) return;
                evt.StopPropagation();
                Close();
            }, TrickleDown.TrickleDown);
            RegisterCallback<NavigationCancelEvent>(evt =>
            {
                evt.StopPropagation();
                Close();
            }, TrickleDown.TrickleDown);

            sheet.AddToClassList("why-sheet");
            sheet.pickingMode = PickingMode.Position;
            Add(sheet);

            var header = new VisualElement();
            header.AddToClassList("why-sheet__header");
            var titleLabel = new Label(Title);
            titleLabel.AddToClassList("why-sheet__title");
            header.Add(titleLabel);
            closeButton = new Button(Close) { text = "×", tooltip = "Close", name = "why-close" };
            closeButton.AddToClassList("why-button");
            closeButton.AddToClassList("why-button--icon");
            header.Add(closeButton);
            sheet.Add(header);

            body.AddToClassList("why-sheet__body");
            sheet.Add(body);

            footer.AddToClassList("why-sheet__footer");
            copyStatus.AddToClassList("why-copy__status");
            footer.Add(copyStatus);
            copyButton = new Button(CopyAsText) { text = "Copy as text", name = "why-copy" };
            copyButton.AddToClassList("why-button");
            copyButton.AddToClassList("why-button--secondary");
            footer.Add(copyButton);
            sheet.Add(footer);
            SetCopyText(null);

            Load();
        }

        /// <summary>The panel's heading, usually what the number is ("Attendance").</summary>
        public string Title { get; }

        /// <summary>The trace view, once a full trace is showing (null while loading, for a summary or an error).</summary>
        public WhyTraceView TraceView { get; private set; }

        /// <summary>Copy as text's text, or null while there is nothing to copy.</summary>
        public string CopyText => copyText?.Invoke();

        /// <summary>Raised once when the panel closes (before it leaves the hierarchy).</summary>
        public event Action Closed;

        /// <summary>Closes the panel: removes it and raises <see cref="Closed"/>.</summary>
        public void Close()
        {
            if (closed) return;
            closed = true;
            Closed?.Invoke();
            RemoveFromHierarchy();
        }

        public bool IsClosed => closed;

        /// <summary>
        /// True when an outside overlay (the shell's overlay layer) draws the scrim and holds the
        /// panel: the panel then draws only its sheet and lets clicks beside it through.
        /// </summary>
        public bool Embedded
        {
            get => ClassListContains(UssClassName + "--embedded");
            set
            {
                EnableInClassList(UssClassName + "--embedded", value);
                pickingMode = value ? PickingMode.Ignore : PickingMode.Position;
            }
        }

        /// <summary>Puts keyboard focus inside the panel: the first row, else the close button.</summary>
        public void FocusInside()
        {
            if (TraceView != null && TraceView.FocusFirstRow()) return;
            closeButton.Focus();
        }

        private void Load()
        {
            if (!source.IsInline) ShowLoading();
            source.Load(result =>
            {
                if (closed) return;
                Show(result);
            });
        }

        private void ShowLoading()
        {
            body.Clear();
            var loading = new Label("Loading the breakdown…");
            loading.AddToClassList("why-notice");
            loading.AddToClassList("why-loading");
            body.Add(loading);
        }

        private void Show(TraceLoadResult result)
        {
            bool focusWasInside = focusController?.focusedElement is VisualElement focused && Contains(focused);
            body.Clear();
            TraceView = null;
            switch (result.Status)
            {
                case TraceLoadStatus.Trace:
                    TraceView = new WhyTraceView(result.Trace, links, () =>
                    {
                        if (links != null && links.CloseOnOpen) Close();
                    });
                    body.Add(TraceView);
                    TraceNode trace = result.Trace;
                    SetCopyText(() => TraceText.ToText(trace));
                    break;
                case TraceLoadStatus.Summary:
                    body.Add(BuildSummary(result.Summary));
                    TraceEntry summary = result.Summary;
                    SetCopyText(() => TraceText.SummaryToText(summary));
                    break;
                case TraceLoadStatus.None:
                    body.Add(Notice(source.NoBreakdownText, "why-notice"));
                    SetCopyText(null);
                    break;
                default:
                    body.Add(Notice($"{TraceText.LoadFailedText} {result.Error}", "why-error"));
                    SetCopyText(null);
                    break;
            }
            if (focusWasInside) FocusInside();
        }

        private static Label Notice(string text, string className)
        {
            var label = new Label(text);
            label.AddToClassList(className);
            return label;
        }

        /// <summary>What an older result keeps once its full breakdown is gone.</summary>
        private static VisualElement BuildSummary(TraceEntry summary)
        {
            var view = new VisualElement();
            view.AddToClassList("why-trace");
            var headline = new VisualElement();
            headline.AddToClassList("why-headline");
            var label = new Label(summary.Label);
            label.AddToClassList("why-headline__label");
            var value = new Label(TraceFormat.Value(summary.Value, summary.Unit));
            value.AddToClassList("why-headline__value");
            headline.Add(label);
            headline.Add(value);
            view.Add(headline);

            view.Add(Notice("ⓘ " + TraceText.SummaryNotice(summary), "why-notice"));
            view.Add(Notice(TraceText.SummaryDateText(summary), "why-detail"));
            if (summary.TopContributors != null && summary.TopContributors.Count > 0)
            {
                var heading = new Label("What moved it most");
                heading.AddToClassList("why-summary__heading");
                view.Add(heading);
                foreach (TraceContributor contributor in summary.TopContributors)
                {
                    var line = new Label(TraceText.ContributorText(contributor, summary.Unit));
                    line.AddToClassList("why-line__text");
                    line.AddToClassList(contributor.Effect > 0 ? "why-tone--positive" : "why-tone--negative");
                    view.Add(line);
                }
            }
            return view;
        }

        private void SetCopyText(Func<string> getText)
        {
            copyText = getText;
            copyStatus.text = string.Empty;
            footer.style.display = getText == null ? DisplayStyle.None : DisplayStyle.Flex;
        }

        private void CopyAsText()
        {
            string text = copyText?.Invoke();
            if (text == null) return;
            try
            {
                WhyPanelHost.CopyToClipboard(text);
                copyStatus.text = "Copied";
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[Why] Copy as text failed: {exception.Message}");
                copyStatus.text = "Could not copy";
            }
        }
    }
}
