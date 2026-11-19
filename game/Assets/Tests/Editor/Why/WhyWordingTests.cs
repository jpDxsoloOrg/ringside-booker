using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using RingsideBooker.UI.Why;
using UnityEngine;

namespace RingsideBooker.Tests.Why
{
    /// <summary>
    /// The Why? panel's words match the web panel's. Each <c>*.json</c> trace (the engine's
    /// <c>trace.get</c> answer data) sits next to a <c>*.web.txt</c> that the web app's
    /// <c>traceToText</c>/<c>summaryToText</c> wrote for it; Copy as text here must give the same
    /// text, character for character.
    /// </summary>
    public sealed class WhyWordingTests
    {
        private static IEnumerable<string> TraceFiles()
        {
            string[] folders =
            {
                Path.Combine(Application.dataPath, "UI/Why/Samples"),
                Path.Combine(Application.dataPath, "Tests/Editor/Why/Fixtures"),
            };
            return folders.SelectMany(folder => Directory.GetFiles(folder, "*.json")).OrderBy(path => path);
        }

        [TestCaseSource(nameof(TraceFiles))]
        public void CopyAsTextMatchesTheWebText(string jsonPath)
        {
            TraceEntry entry = TraceReader.ParseEntry(File.ReadAllText(jsonPath));
            string expected = File.ReadAllText(Path.ChangeExtension(jsonPath, null) + ".web.txt").TrimEnd('\n');
            string actual = TraceText.EntryToText(entry);

            string[] expectedLines = expected.Split('\n');
            string[] actualLines = actual.Split('\n');
            for (int index = 0; index < Mathf.Min(expectedLines.Length, actualLines.Length); index++)
            {
                Assert.AreEqual(expectedLines[index], actualLines[index], $"{Path.GetFileName(jsonPath)} line {index + 1}");
            }
            Assert.AreEqual(expectedLines.Length, actualLines.Length, $"{Path.GetFileName(jsonPath)} line count");
        }

        [TestCase("mainEvent", "Main event")]
        [TestCase("lightHeavyweight", "Light heavyweight")]
        [TestCase("side:0", "Side 1")]
        [TestCase("method.count-out", "Count out")]
        [TestCase("finish.double-count-out", "Double count out")]
        [TestCase("Test Promotion A", "Test Promotion A")]
        [TestCase("per_0001", "per_0001")]
        [TestCase("", "")]
        public void ChoiceTextReadsCodesAsWords(string code, string words)
        {
            Assert.AreEqual(words, TraceWording.ChoiceText(code));
        }

        [Test]
        public void ReadsTheHostsTraceGetAnswer()
        {
            string json = File.ReadAllText(Path.Combine(Application.dataPath, "UI/Why/Samples/attendance.json"));
            TraceLoadResult loaded = TraceReader.ReadTraceGetAnswer("{\"revision\":3,\"result\":{\"ok\":true,\"data\":" + json + "}}");
            Assert.AreEqual(TraceLoadStatus.Trace, loaded.Status);
            Assert.AreEqual("Crowd: 300", TraceText.Headline(loaded.Trace));

            Assert.AreEqual(TraceLoadStatus.None,
                TraceReader.ReadTraceGetAnswer("{\"revision\":3,\"result\":{\"ok\":true,\"data\":null}}").Status);

            TraceLoadResult failed = TraceReader.ReadTraceGetAnswer(
                "{\"revision\":3,\"result\":{\"ok\":false,\"reasons\":[{\"code\":\"noWorld\",\"message\":\"No game is loaded.\"}]}}");
            Assert.AreEqual(TraceLoadStatus.Error, failed.Status);
            Assert.AreEqual("No game is loaded.", failed.Error);
        }

        [Test]
        public void HidesChecksThatChangedNothingByDefault()
        {
            TraceNode clamp = TraceReader.ParseNode(
                "{\"kind\":\"clamp\",\"label\":\"Range\",\"min\":0,\"max\":100,\"before\":71,\"after\":71,\"applied\":false,\"value\":71}");
            TraceLine line = TraceWording.Describe(clamp);
            Assert.IsTrue(line.HiddenByDefault);
            Assert.AreEqual("Checked 71 against 0–100: already in range · Range", TraceWording.LineText(line));
        }
    }
}
