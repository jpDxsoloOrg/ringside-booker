using NUnit.Framework;
using RingsideBooker.Import.Steam;

namespace RingsideBooker.Import.Tests
{
    public sealed class VdfParserTests
    {
        private const string CurrentFormat = @"""libraryfolders""
{
	""0""
	{
		""path""		""C:\\Program Files (x86)\\Steam""
		""label""		""""
		""contentid""		""1234567890""
		""totalsize""		""0""
		""apps""
		{
			""228980""		""1234""
		}
	}
	// A second drive.
	""1""
	{
		""path""		""E:\\steam""
		""label""		""Games \""fast\""""
		""apps""
		{
			""4000""		""5678""
		}
	}
}
";

        [Test]
        public void ReadsEveryLibraryPathFromTheCurrentFormat()
        {
            var paths = SteamLibraries.ParseLibraryFolders(CurrentFormat);
            Assert.That(paths, Is.EqualTo(new[] { @"C:\Program Files (x86)\Steam", @"E:\steam" }));
        }

        [Test]
        public void ReadsTheOldFormatWithPlainValues()
        {
            const string old = "\"LibraryFolders\"\n{\n\t\"TimeNextStatsReport\"\t\t\"1600000000\"\n\t\"ContentStatsID\"\t\t\"-123\"\n\t\"1\"\t\t\"D:\\\\Games\\\\SteamLibrary\"\n}\n";
            Assert.That(SteamLibraries.ParseLibraryFolders(old), Is.EqualTo(new[] { @"D:\Games\SteamLibrary" }));
        }

        [Test]
        public void KeepsEscapedQuotesAndNestedBlocks()
        {
            var root = VdfParser.Parse(CurrentFormat);
            var second = root["libraryfolders"]["1"];
            Assert.That(second["label"].Value, Is.EqualTo("Games \"fast\""));
            Assert.That(second["apps"]["4000"].Value, Is.EqualTo("5678"));
            Assert.That(root["LIBRARYFOLDERS"], Is.Not.Null, "lookups ignore case");
        }

        [Test]
        public void NeverThrowsOnBrokenText()
        {
            Assert.That(SteamLibraries.ParseLibraryFolders(string.Empty), Is.Empty);
            Assert.That(SteamLibraries.ParseLibraryFolders("\"libraryfolders\" { \"0\" { \"path\" "), Is.Empty);
            Assert.That(SteamLibraries.ParseLibraryFolders("}}}{{{"), Is.Empty);
        }
    }
}
