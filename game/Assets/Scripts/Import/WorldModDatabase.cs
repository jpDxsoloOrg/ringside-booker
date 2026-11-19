using System;
using System.Collections.Generic;
using System.IO;
using RingsideBooker.Import.Sqlite;

namespace RingsideBooker.Import
{
    /// <summary>
    /// Reads a workshop world mod's database without ever touching the mod folder: the <c>.db</c>
    /// (and its <c>-wal</c> journal, when the mod was saved in WAL mode) is copied to a private temp
    /// folder and opened there, so SQLite can replay the journal and nothing in the Steam folder is
    /// locked or written. Only the database is copied; pictures stay where they are.
    /// </summary>
    public sealed class WorldModDatabase : IDisposable
    {
        /// <summary>The tables the engine's converter reads (packages/engine-host/src/worldMod/convert.ts).</summary>
        public static readonly string[] WorldTables =
        {
            "gameworld", "workers", "workerpictures", "promotions", "brands", "contracts", "titles",
            "titlehistory", "tagteams", "promotiontagteams", "venues", "events", "eventDates", "networks",
            "networkDeals", "networkAvailability", "countries", "regions",
        };

        /// <summary>Tables the converter only counts, to report what it does not import.</summary>
        public static readonly string[] CountedTables =
        {
            "stables", "stableworkers", "relationships", "chemistry", "alteregos", "gimmicks", "matchgimmicks",
            "angleTemplates", "templateBeats", "randomEvent", "futurePics", "futureowners",
            "promotionrelationships", "segments", "eventinstance", "emails", "news", "finances",
            "financehistory", "saveinfo", "storylines", "storylinehistories", "storylineworkers", "tournaments",
            "promises", "currentbooking", "aiChatMessages", "contractoffers", "workerhistory", "workerhistoryv2",
        };

        private readonly string tempFolder;

        private WorldModDatabase(string tempFolder, SqliteDatabase database)
        {
            this.tempFolder = tempFolder;
            Database = database;
        }

        public SqliteDatabase Database { get; }

        /// <summary>Copies <paramref name="databasePath"/> (and its journal) to a temp folder and opens the copy.</summary>
        public static WorldModDatabase OpenCopy(string databasePath)
        {
            if (!File.Exists(databasePath))
            {
                throw new FileNotFoundException("The world mod database was not found", databasePath);
            }

            var tempFolder = Path.Combine(Path.GetTempPath(), "RingsideBooker", "worldmod-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(tempFolder);
            try
            {
                var copy = Path.Combine(tempFolder, "world.db");
                File.Copy(databasePath, copy);
                var wal = databasePath + "-wal";
                if (File.Exists(wal) && new FileInfo(wal).Length > 0)
                {
                    File.Copy(wal, copy + "-wal");
                }

                return new WorldModDatabase(tempFolder, SqliteDatabase.OpenOrCreate(copy));
            }
            catch
            {
                TryDelete(tempFolder);
                throw;
            }
        }

        /// <summary>Every table the converter needs, as the JSON object it takes.</summary>
        public string ReadTablesJson()
        {
            var tables = new List<string>(WorldTables);
            tables.AddRange(CountedTables);
            return SqliteJsonReader.ReadTablesJson(Database, tables);
        }

        /// <summary>The <c>gameworld</c> row's name, start date and picture folder, or nulls.</summary>
        public (string worldName, string startDate, string imageFolder) ReadWorldInfo()
        {
            if (!Database.TableNames().Contains("gameworld"))
            {
                return (null, null, null);
            }

            using (var statement = Database.Prepare("SELECT worldName, startDate, imageFolder FROM gameworld LIMIT 1"))
            {
                if (!statement.Step())
                {
                    return (null, null, null);
                }

                string Read(int column) => statement.ColumnType(column) == SqliteNative.TypeNull ? null : statement.GetText(column);
                return (Read(0), Read(1), Read(2));
            }
        }

        /// <summary>Rows in <paramref name="table"/>, or -1 when the database has no such table.</summary>
        public long CountRows(string table)
        {
            if (!Database.TableNames().Contains(table))
            {
                return -1;
            }

            using (var statement = Database.Prepare("SELECT COUNT(*) FROM \"" + table.Replace("\"", "\"\"") + "\""))
            {
                return statement.Step() ? statement.GetInt64(0) : 0;
            }
        }

        public void Dispose()
        {
            Database.Dispose();
            TryDelete(tempFolder);
        }

        private static void TryDelete(string folder)
        {
            try
            {
                if (Directory.Exists(folder))
                {
                    Directory.Delete(folder, true);
                }
            }
            catch (IOException)
            {
                // A leftover temp copy is harmless; the OS temp cleaner removes it.
            }
            catch (UnauthorizedAccessException)
            {
            }
        }
    }
}
