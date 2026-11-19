using System;
using System.Collections.Generic;
using System.IO;
using RingsideBooker.Import.Sqlite;
using RingsideBooker.Import.Steam;

namespace RingsideBooker.Import
{
    /// <summary>One installed workshop world mod: a folder with a database at its top level.</summary>
    public sealed class WorkshopMod
    {
        public WorkshopMod(string itemId, string folder, string databasePath, string worldName, string startDate, string pictureFolderName)
        {
            ItemId = itemId;
            Folder = folder;
            DatabasePath = databasePath;
            WorldName = worldName;
            StartDate = startDate;
            PictureFolderName = pictureFolderName;
        }

        /// <summary>The workshop item id (the folder's name).</summary>
        public string ItemId { get; }

        /// <summary>The mod's folder.</summary>
        public string Folder { get; }

        /// <summary>The <c>.db</c> file at the top of the folder.</summary>
        public string DatabasePath { get; }

        /// <summary>The world's name from <c>gameworld.worldName</c>, or the file name when unreadable.</summary>
        public string WorldName { get; }

        /// <summary>The world's start date (<c>YYYY-MM-DD</c>), or null.</summary>
        public string StartDate { get; }

        /// <summary>The picture folder's name inside <see cref="Folder"/> (<c>gameworld.imageFolder</c>), or null.</summary>
        public string PictureFolderName { get; }

        /// <summary>The full path of the picture folder, or null when the mod names none.</summary>
        public string PictureFolder => PictureFolderName == null ? null : Path.Combine(Folder, PictureFolderName);

        /// <summary>The pack id an import of this mod gets: stable for the same workshop item.</summary>
        public string PackId => WorkshopModScanner.PackIdFor(ItemId);
    }

    /// <summary>
    /// Lists the workshop world mods installed in every Steam library:
    /// <c>&lt;library&gt;\steamapps\workshop\content\&lt;app id&gt;\&lt;item id&gt;\</c> folders that hold a
    /// <c>.db</c> file at the top level. The world's name is read from the database (a temp copy).
    /// </summary>
    public static class WorkshopModScanner
    {
        /// <summary>The Steam app whose workshop holds the world mods this game imports.</summary>
        public const string WorkshopAppId = "1157700";

        /// <summary>Mods in every Steam library on this machine.</summary>
        public static List<WorkshopMod> FindInstalled()
        {
            var mods = new List<WorkshopMod>();
            foreach (var library in SteamLibraries.Find())
            {
                mods.AddRange(FindInLibrary(library));
            }

            return mods;
        }

        /// <summary>Mods in one library folder (the folder that holds <c>steamapps</c>).</summary>
        public static List<WorkshopMod> FindInLibrary(string library)
        {
            var mods = new List<WorkshopMod>();
            var content = Path.Combine(library, "steamapps", "workshop", "content", WorkshopAppId);
            if (!Directory.Exists(content))
            {
                return mods;
            }

            var folders = Directory.GetDirectories(content);
            Array.Sort(folders, StringComparer.OrdinalIgnoreCase);
            foreach (var folder in folders)
            {
                var mod = Describe(folder);
                if (mod != null)
                {
                    mods.Add(mod);
                }
            }

            return mods;
        }

        /// <summary>The mod in <paramref name="folder"/>, or null when it has no database at its top level.</summary>
        public static WorkshopMod Describe(string folder)
        {
            var database = FindDatabase(folder);
            if (database == null)
            {
                return null;
            }

            string worldName = null;
            string startDate = null;
            string imageFolder = null;
            try
            {
                using (var copy = WorldModDatabase.OpenCopy(database))
                {
                    (worldName, startDate, imageFolder) = copy.ReadWorldInfo();
                }
            }
            catch (SqliteException)
            {
                // Listed by file name; the import itself will say what is wrong.
            }
            catch (IOException)
            {
            }

            var itemId = Path.GetFileName(folder.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            return new WorkshopMod(itemId, folder, database, worldName ?? Path.GetFileNameWithoutExtension(database), startDate, imageFolder);
        }

        /// <summary>The first <c>.db</c> file directly in <paramref name="folder"/>, by name, or null.</summary>
        public static string FindDatabase(string folder)
        {
            if (!Directory.Exists(folder))
            {
                return null;
            }

            var files = Directory.GetFiles(folder, "*.db", SearchOption.TopDirectoryOnly);
            Array.Sort(files, StringComparer.OrdinalIgnoreCase);
            foreach (var file in files)
            {
                // GetFiles("*.db") also matches longer extensions on Windows; keep exact .db only.
                if (string.Equals(Path.GetExtension(file), ".db", StringComparison.OrdinalIgnoreCase))
                {
                    return file;
                }
            }

            return null;
        }

        /// <summary><c>wm-</c> plus the item id (letters and digits only, lowercased).</summary>
        public static string PackIdFor(string itemId)
        {
            var clean = new System.Text.StringBuilder();
            foreach (var character in itemId ?? string.Empty)
            {
                if (char.IsLetterOrDigit(character) && character < 128)
                {
                    clean.Append(char.ToLowerInvariant(character));
                }
            }

            var id = clean.Length == 0 ? "world" : clean.ToString();
            return "wm-" + (id.Length > 37 ? id.Substring(0, 37) : id);
        }
    }
}
