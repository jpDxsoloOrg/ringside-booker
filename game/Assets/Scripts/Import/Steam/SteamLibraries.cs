using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace RingsideBooker.Import.Steam
{
    /// <summary>
    /// Finds the player's Steam library folders on Windows: the Steam install (from the registry,
    /// <c>HKCU\Software\Valve\Steam\SteamPath</c>, then <c>HKLM\…\Valve\Steam\InstallPath</c>, then
    /// <c>C:\Program Files (x86)\Steam</c>), and every library listed in its
    /// <c>steamapps\libraryfolders.vdf</c>. Only folders that exist are returned.
    /// </summary>
    public static class SteamLibraries
    {
        public const string DefaultSteamFolder = @"C:\Program Files (x86)\Steam";

        /// <summary>Every existing Steam library folder (each holds a <c>steamapps</c> folder), Steam's own first.</summary>
        public static List<string> Find()
        {
            var installs = new List<string>();
            AddIfPresent(installs, ReadRegistryString(HkeyCurrentUser, @"Software\Valve\Steam", "SteamPath"));
            AddIfPresent(installs, ReadRegistryString(HkeyLocalMachine, @"SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath"));
            AddIfPresent(installs, ReadRegistryString(HkeyLocalMachine, @"SOFTWARE\Valve\Steam", "InstallPath"));
            AddIfPresent(installs, DefaultSteamFolder);

            var libraries = new List<string>();
            foreach (var install in installs)
            {
                AddIfPresent(libraries, install);
                foreach (var vdf in new[]
                         {
                             Path.Combine(install, "steamapps", "libraryfolders.vdf"),
                             Path.Combine(install, "config", "libraryfolders.vdf"),
                         })
                {
                    if (!File.Exists(vdf))
                    {
                        continue;
                    }

                    string text;
                    try
                    {
                        text = File.ReadAllText(vdf);
                    }
                    catch (IOException)
                    {
                        continue;
                    }
                    catch (UnauthorizedAccessException)
                    {
                        continue;
                    }

                    foreach (var path in ParseLibraryFolders(text))
                    {
                        AddIfPresent(libraries, path);
                    }
                }
            }

            return libraries;
        }

        /// <summary>
        /// The library paths in a <c>libraryfolders.vdf</c>: the <c>path</c> of each numbered entry
        /// (current format), or a numbered entry's plain string value (the old format).
        /// </summary>
        public static List<string> ParseLibraryFolders(string vdfText)
        {
            var paths = new List<string>();
            var root = VdfParser.Parse(vdfText);
            var folders = root["libraryfolders"] ?? root["LibraryFolders"];
            if (folders == null)
            {
                return paths;
            }

            foreach (var entry in folders.Children)
            {
                if (!int.TryParse(entry.Key, out _))
                {
                    continue;
                }

                var path = entry.Value.Value ?? entry.Value["path"]?.Value;
                if (!string.IsNullOrWhiteSpace(path))
                {
                    paths.Add(path);
                }
            }

            return paths;
        }

        /// <summary>A Steam path as Windows writes it (forward slashes from the registry are normalised).</summary>
        public static string Normalise(string path)
        {
            return path.Replace('/', Path.DirectorySeparatorChar).TrimEnd(Path.DirectorySeparatorChar);
        }

        private static void AddIfPresent(List<string> list, string path)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                return;
            }

            var normalised = Normalise(path);
            if (!Directory.Exists(normalised))
            {
                return;
            }

            foreach (var existing in list)
            {
                if (string.Equals(existing, normalised, StringComparison.OrdinalIgnoreCase))
                {
                    return;
                }
            }

            list.Add(normalised);
        }

        // The registry through advapi32, which works in any Windows player (Microsoft.Win32.Registry
        // is not part of Unity's .NET Standard profile).
        private static readonly UIntPtr HkeyCurrentUser = new UIntPtr(0x80000001u);
        private static readonly UIntPtr HkeyLocalMachine = new UIntPtr(0x80000002u);
        private const uint RrfRtRegSz = 0x00000002;
        private const int ErrorSuccess = 0;

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, EntryPoint = "RegGetValueW")]
        private static extern int RegGetValue(UIntPtr key, string subKey, string valueName, uint flags, IntPtr type, StringBuilder data, ref uint dataBytes);

        /// <summary>A REG_SZ value, or null when it is missing or this is not Windows.</summary>
        public static string ReadRegistryString(UIntPtr root, string subKey, string valueName)
        {
            if (Environment.OSVersion.Platform != PlatformID.Win32NT)
            {
                return null;
            }

            try
            {
                uint size = 2048;
                var buffer = new StringBuilder((int)size / 2);
                var result = RegGetValue(root, subKey, valueName, RrfRtRegSz, IntPtr.Zero, buffer, ref size);
                return result == ErrorSuccess ? buffer.ToString() : null;
            }
            catch (DllNotFoundException)
            {
                return null;
            }
            catch (EntryPointNotFoundException)
            {
                return null;
            }
        }
    }
}
