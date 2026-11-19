using System;
using System.IO;
using System.Linq;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using RingsideBooker.Import.Pictures;
using RingsideBooker.Import.Sqlite;
using UnityEngine;

namespace RingsideBooker.Import.Tests
{
    /// <summary>
    /// The SQLite reader, the workshop folder scan and the picture provider, on a tiny generated
    /// fictional world mod in a temp folder.
    /// </summary>
    public sealed class WorldModReaderTests
    {
        private string root;

        [SetUp]
        public void SetUp()
        {
            root = Path.Combine(Path.GetTempPath(), "rb-import-tests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(root);
        }

        [TearDown]
        public void TearDown()
        {
            if (Directory.Exists(root))
            {
                Directory.Delete(root, true);
            }
        }

        /// <summary>A two-table fictional world mod database at <paramref name="path"/>.</summary>
        private static void MakeDatabase(string path, bool wal = false)
        {
            using (var db = SqliteDatabase.OpenOrCreate(path))
            {
                if (wal)
                {
                    using (var statement = db.Prepare("PRAGMA journal_mode = WAL"))
                    {
                        statement.Step();
                    }
                }

                db.Execute(
                    "CREATE TABLE gameworld (worldName TEXT(100), startDate TEXT(10), imageFolder TEXT(200), databaseVersion INTEGER);" +
                    "CREATE TABLE workers (workerID INTEGER, name TEXT(100), wrestlingSkill REAL, picture TEXT, debutDate TEXT(10), blobby BLOB)");
                db.Execute("INSERT INTO gameworld VALUES (?1, '2010-01-04', 'TestPics', 7)", "Testverse Ünïcode");
                db.Execute("INSERT INTO workers VALUES (1, ?1, 61.5, 'Arlo Quillon.png', NULL, x'00ff')", "Arlo Quillon");
                db.Execute("INSERT INTO workers VALUES (2, 'Bram Marrow', 40, '', '2001-05-05', NULL)");
            }
        }

        [Test]
        public void ReadsTablesAsJsonRowsWithTheirTypes()
        {
            var path = Path.Combine(root, "World.db");
            MakeDatabase(path);
            string json;
            using (var db = SqliteDatabase.OpenReadOnly(path))
            {
                json = SqliteJsonReader.ReadTablesJson(db, new[] { "gameworld", "workers", "missingTable" });
            }

            var tables = JObject.Parse(json);
            Assert.That(tables.Properties().Count(), Is.EqualTo(2), "a missing table is left out");
            var world = (JObject)tables["gameworld"][0];
            Assert.That(world.Value<string>("worldName"), Is.EqualTo("Testverse Ünïcode"));
            Assert.That(world["databaseVersion"].Type, Is.EqualTo(JTokenType.Integer));
            var workers = (JArray)tables["workers"];
            Assert.That(workers, Has.Count.EqualTo(2));
            Assert.That(workers[0]["wrestlingSkill"].Type, Is.EqualTo(JTokenType.Float));
            Assert.That(workers[0].Value<double>("wrestlingSkill"), Is.EqualTo(61.5));
            Assert.That(workers[0]["debutDate"].Type, Is.EqualTo(JTokenType.Null));
            Assert.That(((JObject)workers[0]).Property("blobby"), Is.Null, "blobs are left out");
            Assert.That(workers[1].Value<double>("wrestlingSkill"), Is.EqualTo(40), "a REAL column stores 40 as 40.0");
        }

        [Test]
        public void ReadsAWalDatabaseThroughATempCopyAndLeavesTheModFolderAlone()
        {
            var modFolder = Path.Combine(root, "mod");
            Directory.CreateDirectory(modFolder);
            var path = Path.Combine(modFolder, "World.db");
            MakeDatabase(path, wal: true);
            var before = Directory.GetFiles(modFolder);

            using (var copy = WorldModDatabase.OpenCopy(path))
            {
                var (worldName, startDate, imageFolder) = copy.ReadWorldInfo();
                Assert.That(worldName, Is.EqualTo("Testverse Ünïcode"));
                Assert.That(startDate, Is.EqualTo("2010-01-04"));
                Assert.That(imageFolder, Is.EqualTo("TestPics"));
                var tables = JObject.Parse(copy.ReadTablesJson());
                Assert.That(tables["workers"], Has.Count.EqualTo(2));
            }

            Assert.That(Directory.GetFiles(modFolder), Is.EquivalentTo(before));
        }

        [Test]
        public void FindsModsWithADatabaseInALibrary()
        {
            var content = Path.Combine(root, "steamapps", "workshop", "content", WorkshopModScanner.WorkshopAppId);
            var modFolder = Path.Combine(content, "12345");
            Directory.CreateDirectory(modFolder);
            MakeDatabase(Path.Combine(modFolder, "Testverse.db"));
            Directory.CreateDirectory(Path.Combine(content, "99999"));
            File.WriteAllText(Path.Combine(content, "99999", "notes.txt"), "no database here");

            var mods = WorkshopModScanner.FindInLibrary(root);
            Assert.That(mods, Has.Count.EqualTo(1));
            var mod = mods[0];
            Assert.That(mod.ItemId, Is.EqualTo("12345"));
            Assert.That(mod.PackId, Is.EqualTo("wm-12345"));
            Assert.That(mod.WorldName, Is.EqualTo("Testverse Ünïcode"));
            Assert.That(mod.PictureFolder, Is.EqualTo(Path.Combine(modFolder, "TestPics")));
            Assert.That(WorkshopModScanner.FindInLibrary(Path.Combine(root, "nowhere")), Is.Empty);
        }

        [Test]
        public void DecodesPictureReferencesAndRefusesPathsOutsideTheFolder()
        {
            Assert.That(PictureRef.Decode("wm/people/Big_sDog_s_x28_2_x29_.png"), Is.EqualTo("people/Big Dog (2).png"));
            Assert.That(PictureRef.Decode("wm/people/snake__case.png"), Is.EqualTo("people/snake_case.png"));
            Assert.That(PictureRef.Decode("wm/people/_xdc_ber.png"), Is.EqualTo("people/Über.png"));
            Assert.That(PictureRef.Decode("people/plain.png"), Is.Null);
            Assert.That(PictureRef.Decode("wm/people/.._x2f_.._x2f_secret.png"), Is.Null, "an escaped slash cannot climb out");
            Assert.That(PictureRef.Decode("wm/../secret.png"), Is.Null);
            Assert.That(PictureRef.Decode("wm/people/bad_q"), Is.Null);
        }

        [Test]
        public void LoadsPicturesInPlaceWithAPlaceholderFallback()
        {
            var pictures = Path.Combine(root, "TestPics");
            Directory.CreateDirectory(Path.Combine(pictures, "people"));
            var source = new Texture2D(4, 3, TextureFormat.RGBA32, false);
            File.WriteAllBytes(Path.Combine(pictures, "people", "Arlo Quillon.png"), source.EncodeToPNG());
            UnityEngine.Object.DestroyImmediate(source);

            using (var provider = new PictureProvider(pictures, rosterOnly: false))
            {
                var texture = provider.Get("wm/people/Arlo_sQuillon.png");
                Assert.That(texture.width, Is.EqualTo(4));
                Assert.That(texture.height, Is.EqualTo(3));
                Assert.That(provider.Get("wm/people/Arlo_sQuillon.png"), Is.SameAs(texture), "cached");
                Assert.That(provider.Get("wm/people/Nobody.png"), Is.SameAs(provider.Placeholder));
                Assert.That(provider.Get(null), Is.SameAs(provider.Placeholder));
                Assert.That(provider.FilesRead, Is.EqualTo(1));
            }

            using (var rosterOnly = new PictureProvider(pictures, rosterOnly: true))
            {
                Assert.That(rosterOnly.Get("wm/people/Arlo_sQuillon.png"), Is.SameAs(rosterOnly.Placeholder));
                Assert.That(rosterOnly.HasPicture("wm/people/Arlo_sQuillon.png"), Is.False);
                Assert.That(rosterOnly.FilesRead, Is.EqualTo(0));
            }
        }
    }
}
