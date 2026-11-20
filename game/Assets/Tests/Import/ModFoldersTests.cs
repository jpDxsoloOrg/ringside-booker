using System;
using System.IO;
using System.Linq;
using NUnit.Framework;
using RingsideBooker.Import.Sqlite;

namespace RingsideBooker.Import.Tests
{
    /// <summary>
    /// Mod folders the player chooses (UNITY-34): which folders qualify, a folder of several mods,
    /// stable log-safe ids, and the remembered list in the import settings. Generated fictional
    /// databases in a temp folder.
    /// </summary>
    public sealed class ModFoldersTests
    {
        private string root;

        [SetUp]
        public void SetUp()
        {
            root = Path.Combine(Path.GetTempPath(), "rb-mod-folders-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
        }

        [TearDown]
        public void TearDown()
        {
            if (Directory.Exists(root)) Directory.Delete(root, true);
        }

        /// <summary>A fictional world mod folder: a database naming the picture folder, and the pictures when asked.</summary>
        private string MakeMod(string folder, string worldName, bool pictures, int people = 2)
        {
            Directory.CreateDirectory(folder);
            using (var db = SqliteDatabase.OpenOrCreate(Path.Combine(folder, "Fictional.db")))
            {
                db.Execute(
                    "CREATE TABLE gameworld (worldName TEXT, startDate TEXT, imageFolder TEXT);" +
                    "CREATE TABLE workers (workerID INTEGER, name TEXT);" +
                    "CREATE TABLE promotions (promotionID INTEGER, name TEXT)");
                db.Execute("INSERT INTO gameworld VALUES (?1, '2011-02-07', 'FictionalPics')", worldName);
                for (int id = 1; id <= people; id++) db.Execute($"INSERT INTO workers VALUES ({id}, 'Person {id}')");
                db.Execute("INSERT INTO promotions VALUES (1, 'Granite Prime')");
            }

            if (pictures) Directory.CreateDirectory(Path.Combine(folder, "FictionalPics", "people"));
            return folder;
        }

        [Test]
        public void AFolderWithTheDatabaseIsOneModAndPicturesAreOptional()
        {
            string withPictures = MakeMod(Path.Combine(root, "Granite World"), "Granite World", pictures: true);
            FolderCheck check = ModFolders.Inspect(withPictures);
            Assert.That(check.Ok, Is.True);
            Assert.That(check.Mods, Has.Count.EqualTo(1));
            WorkshopMod mod = check.Mods[0];
            Assert.That(mod.WorldName, Is.EqualTo("Granite World"));
            Assert.That(mod.Folder, Is.EqualTo(withPictures));
            Assert.That(mod.DatabasePath, Is.EqualTo(Path.Combine(withPictures, "Fictional.db")));
            Assert.That(mod.PictureFolder, Is.EqualTo(Path.Combine(withPictures, "FictionalPics")));
            Assert.That(mod.IsWorld, Is.True);
            Assert.That(mod.PackId, Does.StartWith("wm-f"), "a folder that is not a workshop item gets a hashed id");

            string noPictures = MakeMod(Path.Combine(root, "Bare World"), "Bare World", pictures: false);
            FolderCheck bare = ModFolders.Inspect(noPictures);
            Assert.That(bare.Ok, Is.True, "the picture folder is optional");
            Assert.That(Directory.Exists(bare.Mods[0].PictureFolder), Is.False);
        }

        [Test]
        public void AFolderWithoutADatabaseSaysWhatIsMissing()
        {
            string empty = Path.Combine(root, "Just pictures");
            Directory.CreateDirectory(Path.Combine(empty, "FictionalPics"));
            File.WriteAllText(Path.Combine(empty, "readme.txt"), "no database");
            File.WriteAllText(Path.Combine(empty, "Fictional.dbx"), "not a database file");

            FolderCheck check = ModFolders.Inspect(empty);
            Assert.That(check.Ok, Is.False);
            Assert.That(check.Mods, Is.Empty);
            Assert.That(check.Problem, Is.EqualTo(ModFolders.NoDatabaseProblem));
            Assert.That(check.Problem, Does.Contain(".db file"));

            FolderCheck missing = ModFolders.Inspect(Path.Combine(root, "gone"));
            Assert.That(missing.Problem, Is.EqualTo(ModFolders.MissingFolderProblem));
            Assert.That(ModFolders.Inspect(null).Ok, Is.False);
        }

        [Test]
        public void AParentFolderListsEachModOneLevelDown()
        {
            string parent = Path.Combine(root, "My mods");
            MakeMod(Path.Combine(parent, "B Second"), "Second World", pictures: false);
            MakeMod(Path.Combine(parent, "A First"), "First World", pictures: true);
            Directory.CreateDirectory(Path.Combine(parent, "C Empty"));
            MakeMod(Path.Combine(parent, "D Deep", "inner"), "Too Deep", pictures: false);

            FolderCheck check = ModFolders.Inspect(parent);
            Assert.That(check.Ok, Is.True);
            Assert.That(check.Mods.Select(mod => mod.WorldName), Is.EqualTo(new[] { "First World", "Second World" }),
                "sorted by folder; empty folders and mods two levels down are left out");
            Assert.That(check.Mods.Select(mod => mod.PackId).Distinct().Count(), Is.EqualTo(2));
        }

        [Test]
        public void AnAddOnWithNoPeopleIsListedButIsNotAWorld()
        {
            string addOn = MakeMod(Path.Combine(root, "Add-on"), "Events Pack", pictures: false, people: 0);
            FolderCheck check = ModFolders.Inspect(addOn);
            Assert.That(check.Ok, Is.True);
            Assert.That(check.Mods[0].IsWorld, Is.False);
        }

        [Test]
        public void IdsAreStableWorkshopIdsStayAndOtherNamesAreHashed()
        {
            string workshop = Path.Combine(root, "content", "1234567");
            Assert.That(ModFolders.ItemIdFor(workshop), Is.EqualTo("1234567"));
            Assert.That(ModFolders.ItemIdFor(workshop + Path.DirectorySeparatorChar), Is.EqualTo("1234567"));
            Assert.That(WorkshopModScanner.PackIdFor(ModFolders.ItemIdFor(workshop)), Is.EqualTo("wm-1234567"),
                "a workshop folder chosen by hand is the same world as the scanned one");

            string named = Path.Combine(root, "Granite World");
            string id = ModFolders.ItemIdFor(named);
            Assert.That(id, Does.Match("^f[0-9a-f]{12}$"));
            Assert.That(id, Does.Not.Contain("Granite"), "the id never carries the folder's name");
            Assert.That(ModFolders.ItemIdFor(named + Path.DirectorySeparatorChar), Is.EqualTo(id));
            Assert.That(ModFolders.ItemIdFor(named.ToUpperInvariant()), Is.EqualTo(id), "Windows paths ignore case");
            Assert.That(ModFolders.ItemIdFor(Path.Combine(root, "Other World")), Is.Not.EqualTo(id));
            Assert.That(ModFolders.IsWorkshopItemId("1234567"), Is.True);
            Assert.That(ModFolders.IsWorkshopItemId(id), Is.False);
        }

        [Test]
        public void TheSettingsRememberFoldersOnceAndForgetThem()
        {
            string path = Path.Combine(root, "settings", ImportFolderSettings.FileName);
            var settings = new ImportFolderSettings(path);
            Assert.That(settings.Folders, Is.Empty);

            string first = Path.Combine(root, "First");
            string second = Path.Combine(root, "Second");
            Assert.That(settings.Add(first), Is.True);
            Assert.That(settings.Add(first + Path.DirectorySeparatorChar), Is.False, "the same folder is listed once");
            Assert.That(settings.Add(second), Is.True);
            Assert.That(new ImportFolderSettings(path).Folders, Is.EqualTo(new[] { first, second }), "kept on disk, in order");

            Assert.That(settings.Remove(first.ToUpperInvariant()), Is.True);
            Assert.That(settings.Remove(first), Is.False);
            Assert.That(settings.Folders, Is.EqualTo(new[] { second }));
            Assert.That(Directory.Exists(root), Is.True);

            File.WriteAllText(path, "{ not json");
            Assert.That(settings.Folders, Is.Empty, "a damaged file reads as no folders");
            Assert.That(settings.Add(first), Is.True, "and is rewritten on the next change");
            Assert.That(settings.Folders, Is.EqualTo(new[] { first }));
        }
    }
}
