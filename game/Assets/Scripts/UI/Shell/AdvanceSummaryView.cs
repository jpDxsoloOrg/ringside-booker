using System.Collections.Generic;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Day;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.UI.Shell
{
    /// <summary>
    /// The "Last advance" banner above the screen (the web's AdvanceSummaryBanner): "Advanced 30
    /// days to Friday, March 14, 2031", why it stopped, "See results" links, tonight's show, contract
    /// and offer lines, and a link to any failed background steps. It stays until dismissed or until
    /// the next advance replaces it.
    /// </summary>
    public sealed class AdvanceSummaryView
    {
        private readonly VisualElement slot;
        private readonly ShellNavigator navigator;
        private readonly OverlayLayer overlay;
        private AdvanceReport shown;

        public AdvanceSummaryView(VisualElement slot, ShellNavigator navigator, OverlayLayer overlay)
        {
            this.slot = slot;
            this.navigator = navigator;
            this.overlay = overlay;
        }

        public void Render(IDayControl day)
        {
            AdvanceReport report = day.LastReport;
            if (ReferenceEquals(report, shown)) return;
            shown = report;
            slot.Clear();
            if (!AdvanceSummaryText.NeedsBanner(report)) return;
            slot.Add(Build(report, day));
        }

        private VisualElement Build(AdvanceReport report, IDayControl day)
        {
            AdvanceSummaryText text = AdvanceSummaryText.Describe(report);
            VisualElement banner = Ui.El("summary").Named("advance-summary");
            banner.tooltip = text.Announcement;
            if (report.Refused) banner.AddToClassList("summary--warning");

            VisualElement body = Ui.El("summary__body");
            body.Add(Ui.Text(TextFormat.Upper("Last advance"), "section-label", "summary__eyebrow"));
            body.Add(Ui.Text(TextFormat.Upper(text.Headline), "summary__headline"));

            // A news stop matters less than the shows the skip ran, so its reason comes after their links.
            bool newsStop = AdvanceSummaryText.StoppedForNews(report);
            if (!newsStop) AddReason(body, text.Reason);
            if (report.Results.Count > 0) body.Add(ResultsLinks(report.Results));
            if (newsStop) AddReason(body, text.Reason);

            if (report.Tonight != null)
            {
                if (text.Reason != report.Tonight.Reason) AddReason(body, report.Tonight.Reason);
                var destination = DayControlLogic.GateDestination(report.Tonight, new[] { report.Tonight }, report.TonightRoute);
                if (destination.HasValue)
                {
                    ShellRoute to = destination.Value.to;
                    body.Add(Ui.El("summary__links").With(Ui.Btn(destination.Value.label, () => navigator.Go(to), "btn--link").Also("btn--link-first")));
                }
            }

            AddLines(body, report.ContractLines, ShellRoute.With("contracts", "tab", "expiring"), null);
            AddLines(body, report.OfferLines, ShellRoute.With("contracts", "tab", "offers"), "See your offers");

            if (!report.Refused && text.Failures != null)
            {
                Button failures = Ui.Btn($"⚠ {text.Failures}", () => OpenFailures(report.Failures), "btn--link");
                failures.AddToClassList("summary__failure");
                body.Add(failures);
            }

            Button dismiss = Ui.Btn("×", day.DismissReport, "btn--ghost");
            dismiss.AddToClassList("btn--icon");
            dismiss.tooltip = "Dismiss";
            dismiss.name = "advance-summary-dismiss";
            return banner.With(body, dismiss);
        }

        private static void AddReason(VisualElement body, string reason)
        {
            if (!string.IsNullOrEmpty(reason)) body.Add(Ui.Text(reason, "summary__reason"));
        }

        private VisualElement ResultsLinks(IReadOnlyList<ShowResultLink> results)
        {
            VisualElement links = Ui.El("summary__links");
            for (int index = 0; index < results.Count && index < AdvanceSummaryText.MaxResultsLinks; index++)
            {
                ShowResultLink show = results[index];
                Button link = Ui.Btn(AdvanceSummaryText.SeeResultsText(show),
                    () => navigator.Go(ShellRoute.With(ScreenIds.ShowResults, "event", show.EventInstanceId, "reveal", "1")), "btn--link");
                if (index == 0) link.AddToClassList("btn--link-first");
                links.Add(link);
            }
            string more = AdvanceSummaryText.MoreText(results.Count, AdvanceSummaryText.MaxResultsLinks);
            if (more != null) links.Add(Ui.Text(more, "summary__reason"));
            return links;
        }

        /// <summary>Up to three lines, then "and N more" (or <paramref name="always"/>) linking to <paramref name="to"/>.</summary>
        private void AddLines(VisualElement body, IReadOnlyList<string> lines, ShellRoute to, string always)
        {
            if (lines.Count == 0) return;
            VisualElement block = Ui.El("summary__links");
            for (int index = 0; index < lines.Count && index < AdvanceSummaryText.MaxContractLines; index++)
            {
                block.Add(Ui.Text(lines[index], "summary__reason"));
            }
            string more = AdvanceSummaryText.MoreText(lines.Count, AdvanceSummaryText.MaxContractLines);
            string linkText = more ?? always;
            if (linkText != null) block.Add(Ui.Btn(linkText, () => navigator.Go(to), "btn--link"));
            body.Add(block);
        }

        /// <summary>Every step that failed during the advance: date, step id and message, ready to copy.</summary>
        private void OpenFailures(IReadOnlyList<AdvanceFailure> failures)
        {
            Sheet sheet = Sheet.Open(overlay, "Background steps that failed");
            sheet.Body.Add(Ui.Text("The rest of each day ran as normal. These steps were skipped and their changes undone.", "field-hint"));
            var list = new VisualElement();
            list.style.marginTop = 12;
            foreach (AdvanceFailure failure in failures)
            {
                list.Add(Ui.El("list-row").With(
                    Ui.El("list-row__meta").With(Ui.Text(failure.Date.Short, "t-muted", "t-xs"), Ui.Text(failure.StepId, "mono")),
                    Ui.Text(failure.Message, "t-sm", "t-wrap")));
            }
            sheet.Body.Add(list);
            Label status = Ui.Text(string.Empty, "t-muted", "t-sm");
            status.style.flexGrow = 1;
            sheet.Footer.Insert(0, status);
            sheet.AddFooterButton("Copy details", () =>
            {
                GUIUtility.systemCopyBuffer = AdvanceSummaryText.FailuresToText(failures);
                status.text = "Copied";
            });
        }
    }

    internal static class ElementClassExtensions
    {
        public static T Also<T>(this T element, string className) where T : VisualElement
        {
            element.AddToClassList(className);
            return element;
        }
    }
}
