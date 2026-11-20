using System;
using NUnit.Framework;
using RingsideBooker.Saves;
using RingsideBooker.UI.SaveUi;

namespace RingsideBooker.Tests.SaveUi
{
    /// <summary>The "Last saved" chip's words (POL1-04).</summary>
    public sealed class LastSavedChipTests
    {
        private static SaveSlotInfo Slot(string gameDate) => new SaveSlotInfo
        {
            SlotId = "career",
            Label = "Career",
            GameDate = gameDate,
            SavedAt = new DateTimeOffset(2026, 11, 19, 14, 22, 0, TimeSpan.Zero),
        };

        [Test]
        public void ShowsTheGameDateOfTheLastSave()
        {
            var (text, detail, warning) = LastSavedChip.Words(Slot("2027-01-11"), SaveKind.Autosave, null, 5);
            Assert.AreEqual("Saved 11 Jan", text);
            StringAssert.StartsWith("11 Jan 2027, at ", detail);
            StringAssert.Contains("(saved automatically). 5 backups kept.", detail);
            Assert.IsFalse(warning);

            Assert.AreEqual("Loaded 3 Feb", LastSavedChip.Words(Slot("2027-02-03"), SaveKind.LoadedBackup, null, 1).Text);
            StringAssert.EndsWith("(loaded from a backup). 1 backup kept.", LastSavedChip.Words(Slot("2027-02-03"), SaveKind.LoadedBackup, null, 1).Detail);
        }

        [Test]
        public void AFailedSaveIsAWarningAndNamesTheLastGoodOne()
        {
            var (text, detail, warning) = LastSavedChip.Words(Slot("2027-01-11"), SaveKind.Autosave, SaveVerifier.NotReplacedMessage, 5);
            Assert.AreEqual("Not saved", text);
            Assert.IsTrue(warning);
            StringAssert.StartsWith(SaveVerifier.NotReplacedMessage, detail);
            StringAssert.EndsWith("The last good save is from 11 Jan 2027.", detail);
        }

        [Test]
        public void HiddenWithoutASave()
        {
            Assert.IsNull(LastSavedChip.Words(null, SaveKind.Loaded, null, 0).Text);
        }
    }
}
