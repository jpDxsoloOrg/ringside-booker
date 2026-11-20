using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Newtonsoft.Json.Linq;

namespace RingsideBooker.Import
{
    /// <summary>What a folder the player chose holds: its world mods, or why it holds none.</summary>
    public sealed class FolderCheck
    {
        public FolderCheck(string folder, IReadOnlyList<WorkshopMod> mods, string problem)
        {
            Folder = folder;
            Mods = mods?.ToList() ?? new List<WorkshopMod>();
            Problem = problem;
        }

        /// <summary>The folder as chosen.</summary>
        public string Folder { get; }

        /// <summary>The mods found: the folder itself, or each folder one level down that is a mod.</summary>
        public IReadOnlyList<WorkshopMod> Mods { get; }

        /// <summary>Why the folder can't be imported, in plain words; null when it holds a mod.</summary>
        public string Problem { get; }

        public bool Ok => Problem == null;
    }

    /// <summary>
    /// Mod folders the player chooses themselves (UNITY-34), next to the Steam workshop scan. A
    /// folder qualifies when it holds the mod's database (the same top-level <c>.db</c> file the
    /// scan looks for); the picture folder is optional. A folder with no database of its own may
    /// hold several mods one level down, and then each of them is listed.
    /// </summary>
    public static class ModFolders
    {
        public const string MissingFolderProblem = "That folder could not be found. It may have been moved or deleted.";

        public const string NoDatabaseProblem =
            "This folder has no world database in it. Choose the mod's own folder, the one that holds its .db file " +
            "(the picture folder is optional), or a folder with mod folders inside it.";

        /// <summary>The mods in <paramref name="folder"/> (itself, else one level down), or the problem in words.</summary>
        public static FolderCheck Inspect(string folder)
        {
            if (string.IsNullOrWhiteSpace(folder) || !Directory.Exists(folder))
            {
                return new FolderCheck(folder, null, MissingFolderProblem);
            }

            if (WorkshopModScanner.FindDatabase(folder) != null)
            {
                return new FolderCheck(folder, new[] { WorkshopModScanner.Describe(folder, ItemIdFor(folder)) }, null);
            }

            var mods = new List<WorkshopMod>();
            string[] children;
            try
            {
                children = Directory.GetDirectories(folder);
            }
            catch (Exception error) when (error is IOException || error is UnauthorizedAccessException)
            {
                children = Array.Empty<string>();
            }

            Array.Sort(children, StringComparer.OrdinalIgnoreCase);
            foreach (var child in children)
            {
                if (WorkshopModScanner.FindDatabase(child) == null) continue;
                mods.Add(WorkshopModScanner.Describe(child, ItemIdFor(child)));
            }

            return mods.Count == 0 ? new FolderCheck(folder, null, NoDatabaseProblem) : new FolderCheck(folder, mods, null);
        }

        /// <summary>
        /// The id a chosen mod folder gets. A folder named by a workshop item id keeps it, so a
        /// workshop folder picked by hand is the same world as the scanned one. Any other folder gets
        /// <c>f</c> plus a hash of its full path: stable, and safe to log or put in element names
        /// (a folder's name may be the mod's name).
        /// </summary>
        public static string ItemIdFor(string folder)
        {
            string full = Normalize(folder);
            string name = Path.GetFileName(full);
            if (name.Length > 0 && name.All(character => character >= '0' && character <= '9')) return name;
            using (var sha = SHA1.Create())
            {
                byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(full.ToLowerInvariant()));
                var id = new StringBuilder("f");
                for (int index = 0; index < 6; index++) id.Append(hash[index].ToString("x2"));
                return id.ToString();
            }
        }

        /// <summary>True when the id is a workshop item id (digits), not a hashed folder id.</summary>
        public static bool IsWorkshopItemId(string itemId) =>
            !string.IsNullOrEmpty(itemId) && itemId.All(character => character >= '0' && character <= '9');

        /// <summary>The full path without a trailing separator.</summary>
        public static string Normalize(string folder)
        {
            if (string.IsNullOrWhiteSpace(folder)) return string.Empty;
            string full = Path.GetFullPath(folder.Trim());
            string root = Path.GetPathRoot(full) ?? string.Empty;
            return full.Length > root.Length ? full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) : full;
        }
    }

    /// <summary>
    /// The import settings (<c>import-settings.json</c> next to the saves folder, never in a save):
    /// the mod folders the player chose, in the order they were added.
    /// </summary>
    public sealed class ImportFolderSettings
    {
        public const string FileName = "import-settings.json";

        private readonly string path;

        public ImportFolderSettings(string path)
        {
            this.path = path;
        }

        /// <summary>The settings file.</summary>
        public string FilePath => path;

        /// <summary>The chosen folders (read fresh each time; a missing or damaged file is an empty list).</summary>
        public IReadOnlyList<string> Folders
        {
            get
            {
                try
                {
                    if (!File.Exists(path)) return Array.Empty<string>();
                    JArray folders = JObject.Parse(File.ReadAllText(path))["folders"] as JArray;
                    return folders?.Select(token => token.Type == JTokenType.String ? (string)token : null)
                        .Where(folder => !string.IsNullOrWhiteSpace(folder)).ToList() ?? new List<string>();
                }
                catch (Exception)
                {
                    return Array.Empty<string>();
                }
            }
        }

        /// <summary>Remembers a folder; false when it is already remembered (any letter case).</summary>
        public bool Add(string folder)
        {
            string normal = ModFolders.Normalize(folder);
            if (normal.Length == 0) return false;
            List<string> folders = Folders.ToList();
            if (folders.Any(known => SameFolder(known, normal))) return false;
            folders.Add(normal);
            Write(folders);
            return true;
        }

        /// <summary>Forgets a folder; false when it was not remembered. The folder itself is never touched.</summary>
        public bool Remove(string folder)
        {
            List<string> folders = Folders.ToList();
            int removed = folders.RemoveAll(known => SameFolder(known, folder));
            if (removed == 0) return false;
            Write(folders);
            return true;
        }

        public static bool SameFolder(string first, string second) =>
            string.Equals(ModFolders.Normalize(first), ModFolders.Normalize(second), StringComparison.OrdinalIgnoreCase);

        private void Write(List<string> folders)
        {
            JObject settings;
            try
            {
                settings = File.Exists(path) ? JObject.Parse(File.ReadAllText(path)) : new JObject();
            }
            catch (Exception)
            {
                settings = new JObject();
            }

            settings["folders"] = new JArray(folders);
            string directory = Path.GetDirectoryName(path);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            string temp = path + ".tmp";
            File.WriteAllText(temp, settings.ToString());
            if (File.Exists(path)) File.Delete(path);
            File.Move(temp, path);
        }
    }
}
