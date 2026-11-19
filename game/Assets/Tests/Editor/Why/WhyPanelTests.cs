using System;
using System.IO;
using NUnit.Framework;
using RingsideBooker.UI.Why;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Tests.Why
{
    /// <summary>The Why? panel's states and the host's one-panel-at-a-time and presenter rules, without a live panel.</summary>
    public sealed class WhyPanelTests
    {
        private static TraceEntry Sample(string name) =>
            TraceReader.ParseEntry(File.ReadAllText(Path.Combine(Application.dataPath, "UI/Why/Samples", name + ".json")));

        [TearDown]
        public void ResetHost()
        {
            WhyPanelHost.CloseCurrent();
            WhyPanelHost.Presenter = null;
            WhyPanelHost.DefaultRoot = null;
        }

        [Test]
        public void ShowsAnInlineTraceAndCopiesTheWebText()
        {
            TraceEntry entry = Sample("match-rating");
            var root = new VisualElement();
            WhyPanel panel = WhyPanelHost.Open("Segment score", WhySource.FromEntry(entry), root);

            Assert.AreSame(panel, WhyPanelHost.Current);
            Assert.IsNotNull(panel.TraceView);
            Assert.AreEqual(9, panel.TraceView.HiddenCheckCount);
            Assert.AreEqual(TraceText.ToText(entry.Trace), panel.CopyText);

            int shown = panel.TraceView.VisiblePaths.Count;
            panel.TraceView.ShowAllChecks = true;
            Assert.Greater(panel.TraceView.VisiblePaths.Count, shown);

            panel.Close();
            Assert.IsNull(WhyPanelHost.Current);
            Assert.AreEqual(0, root.childCount);
        }

        [Test]
        public void LoadsByReferenceWhenOpenedAndKeepsTheAnswer()
        {
            TraceEntry entry = Sample("attendance");
            Action<TraceLoadResult> pending = null;
            int loads = 0;
            WhySource source = WhySource.FromRef(entry.Ref, (traceRef, done) =>
            {
                loads++;
                Assert.AreEqual(entry.Ref.Id, traceRef.Id);
                pending = done;
            });
            var root = new VisualElement();
            WhyPanel panel = WhyPanelHost.Open("Crowd", source, root);
            Assert.IsNull(panel.TraceView, "still loading");
            Assert.IsNull(panel.CopyText);

            pending(TraceLoadResult.FromEntry(entry));
            Assert.IsNotNull(panel.TraceView);
            Assert.AreEqual("Crowd: 300", TraceText.Headline(panel.TraceView.Root));

            panel.Close();
            WhyPanel again = WhyPanelHost.Open("Crowd", source, root);
            Assert.IsNotNull(again.TraceView, "the first answer is reused");
            Assert.AreEqual(1, loads);
        }

        [Test]
        public void SaysWhenThereIsNoBreakdownOrItFailed()
        {
            var root = new VisualElement();
            WhyPanel none = WhyPanelHost.Open("Crowd", WhySource.FromRef(new TraceRef("x", "y"), (r, done) => done(TraceLoadResult.NoBreakdown)), root);
            Assert.IsNull(none.TraceView);
            Assert.IsNotNull(none.Q<Label>(className: "why-notice"));
            Assert.AreEqual(TraceText.NoStoredBreakdownText, none.Q<Label>(className: "why-notice").text);

            WhyPanel failed = WhyPanelHost.Open("Crowd", WhySource.FromLoader(done => done(TraceLoadResult.Failed("No game is loaded."))), root);
            Assert.IsTrue(none.IsClosed, "opening another panel closes the first");
            Assert.AreEqual("The breakdown could not be loaded. No game is loaded.", failed.Q<Label>(className: "why-error").text);
        }

        [Test]
        public void HandsThePanelToThePresenterWhenOneIsSet()
        {
            var layer = new VisualElement();
            bool removed = false;
            WhyPanelHost.Presenter = (opener, panel) =>
            {
                layer.Add(panel);
                return () =>
                {
                    removed = true;
                    panel.RemoveFromHierarchy();
                };
            };
            WhyPanel shown = WhyPanelHost.Open("Story buzz", WhySource.FromEntry(Sample("buzz")));
            Assert.IsTrue(shown.Embedded);
            Assert.AreSame(layer, shown.parent);

            shown.Close();
            Assert.IsTrue(removed);
            Assert.AreEqual(0, layer.childCount);
        }

        [Test]
        public void ShowsASummaryForAnOlderResult()
        {
            TraceEntry summary = Sample("segment-summary");
            WhyPanel panel = WhyPanelHost.Open("Segment score", WhySource.FromEntry(summary), new VisualElement());
            Assert.IsNull(panel.TraceView);
            Assert.AreEqual(TraceText.SummaryToText(summary), panel.CopyText);
        }

        [Test]
        public void WhyButtonNamesTheNumberItExplains()
        {
            var button = new WhyButton("Attendance", TraceValue.Of(12400), WhySource.FromEntry(Sample("attendance")), TraceUnits.People);
            Assert.AreEqual("Why is Attendance 12,400 people?", button.tooltip);
            Assert.IsNull(new WhyValue("Attendance", TraceValue.Of(12400), null).Button, "no source, no button");
        }
    }
}
