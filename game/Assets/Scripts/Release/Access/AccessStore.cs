using System;
using System.Globalization;
using System.IO;
using Newtonsoft.Json.Linq;
using UnityEngine;

namespace RingsideBooker.Release.Access
{
    /// <summary>
    /// The licence on disk: <c>persistentDataPath/access.json</c> (AppData\LocalLow\jpDxsolo\Ringside
    /// Booker on Windows) with the random install id, the token and when the game last tried to check
    /// back. Never in a save, never in a bug report. Removing the code keeps the install id, so the same
    /// computer doesn't use up another of the code's slots when the code is entered again.
    /// </summary>
    public sealed class AccessStore
    {
        public const string FileName = "access.json";

        private readonly string path;

        public AccessStore(string folder = null)
        {
            path = Path.Combine(folder ?? Application.persistentDataPath, FileName);
            Load();
        }

        public string InstallId { get; private set; }
        public string Token { get; private set; }
        public DateTime? LastAttemptUtc { get; private set; }

        public string FilePath => path;

        public void SetToken(string token)
        {
            Token = token;
            Save();
        }

        public void ClearToken()
        {
            Token = null;
            LastAttemptUtc = null;
            Save();
        }

        public void MarkAttempt(DateTime utc)
        {
            LastAttemptUtc = utc;
            Save();
        }

        private void Load()
        {
            try
            {
                if (File.Exists(path))
                {
                    // Dates stay strings (Json.NET would otherwise turn the ISO time into a DateTime).
                    var reader = new Newtonsoft.Json.JsonTextReader(new StringReader(File.ReadAllText(path))) { DateParseHandling = Newtonsoft.Json.DateParseHandling.None };
                    JObject json = JObject.Load(reader);
                    InstallId = json.Value<string>("installId");
                    Token = json.Value<string>("token");
                    string attempt = json.Value<string>("lastAttemptUtc");
                    if (DateTime.TryParse(attempt, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out DateTime when)) LastAttemptUtc = when;
                }
            }
            catch (Exception error)
            {
                Debug.LogWarning($"[Access] {FileName} unreadable ({error.GetType().Name}); asking for the code again");
                Token = null;
            }
            if (string.IsNullOrEmpty(InstallId))
            {
                InstallId = Guid.NewGuid().ToString("D");
                Save();
            }
        }

        private void Save()
        {
            try
            {
                var json = new JObject
                {
                    ["installId"] = InstallId,
                    ["token"] = Token,
                    ["lastAttemptUtc"] = LastAttemptUtc?.ToString("o", CultureInfo.InvariantCulture),
                };
                Directory.CreateDirectory(Path.GetDirectoryName(path));
                string temp = path + ".tmp";
                File.WriteAllText(temp, json.ToString());
                if (File.Exists(path)) File.Replace(temp, path, null);
                else File.Move(temp, path);
            }
            catch (Exception error)
            {
                Debug.LogWarning($"[Access] could not save {FileName}: {error.GetType().Name}");
            }
        }
    }
}
