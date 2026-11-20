using System;
using System.IO;
using System.IO.Compression;
using System.Text;
using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace RingsideBooker.Saves
{
    /// <summary>
    /// Verify-before-write (POL1-04): checks the exact bytes the engine handed back before they may
    /// replace a slot's save. It mirrors the cheap stages of the engine's <c>inspectSave</c> (decode,
    /// parse, format) in C# on the thread pool, so it never queues work on the engine thread:
    /// the gzip unpacks to the end, the JSON reads to the end, <c>format</c> is the save format, and
    /// the header's label, game date and schema fingerprint are the ones the save said it wrote.
    /// </summary>
    public static class SaveVerifier
    {
        public const string Format = "ringside-booker/save";

        /// <summary>What the player reads when a save does not check out.</summary>
        public const string NotReplacedMessage =
            "This save did not check out, so nothing was replaced. Your previous save and backups are untouched.";

        private static readonly UTF8Encoding StrictUtf8 = new UTF8Encoding(false, true);

        /// <summary>
        /// Null when <paramref name="bytes"/> is a whole save whose header matches
        /// <paramref name="expectedHeader"/> (label, game date, schema fingerprint); otherwise what is wrong.
        /// </summary>
        /// <param name="expectedHeader">The header the engine reported for these bytes; null skips the header comparison.</param>
        /// <param name="expectedFingerprint">This build's save schema fingerprint; null skips that check.</param>
        public static string Check(byte[] bytes, JToken expectedHeader, string expectedFingerprint)
        {
            if (bytes == null || bytes.Length == 0) return "The save is empty.";
            JToken header;
            string format;
            try
            {
                using (Stream input = Open(bytes))
                using (var text = new StreamReader(input, StrictUtf8, false))
                using (var reader = new JsonTextReader(text) { DateParseHandling = DateParseHandling.None })
                {
                    (header, format) = ReadTopLevel(reader);
                }
            }
            catch (Exception error) when (error is InvalidDataException || error is IOException || error is JsonException || error is DecoderFallbackException)
            {
                return "The save could not be read back: " + error.Message;
            }

            if (format != Format) return "The save's format is " + (format ?? "missing") + ".";
            if (header == null || header.Type != JTokenType.Object) return "The save has no header.";
            if (expectedHeader != null && expectedHeader.Type == JTokenType.Object)
            {
                foreach (string key in new[] { "label", "gameDate", "schemaFingerprint" })
                {
                    string want = Text(expectedHeader, key);
                    string got = Text(header, key);
                    if (!string.Equals(want, got, StringComparison.Ordinal))
                    {
                        return $"The save's header {key} is {got ?? "missing"}, expected {want ?? "none"}.";
                    }
                }
            }

            if (expectedFingerprint != null && !string.Equals(Text(header, "schemaFingerprint"), expectedFingerprint, StringComparison.Ordinal))
            {
                return "The save's schema fingerprint is not this build's.";
            }

            return null;
        }

        private static Stream Open(byte[] bytes)
        {
            var raw = new MemoryStream(bytes, false);
            if (bytes.Length >= 2 && bytes[0] == 0x1f && bytes[1] == 0x8b) return new GZipStream(raw, CompressionMode.Decompress);
            return raw;
        }

        // Reads the whole document (so a truncated or broken file fails) and keeps only the header and format.
        private static (JToken header, string format) ReadTopLevel(JsonTextReader reader)
        {
            if (!reader.Read() || reader.TokenType != JsonToken.StartObject) throw new JsonReaderException("The save is not a JSON object.");
            JToken header = null;
            string format = null;
            while (reader.Read())
            {
                if (reader.TokenType == JsonToken.EndObject && reader.Depth == 0)
                {
                    if (reader.Read()) throw new JsonReaderException("Unexpected data after the save document.");
                    return (header, format);
                }

                if (reader.TokenType != JsonToken.PropertyName) throw new JsonReaderException("Unexpected " + reader.TokenType + " in the save document.");
                string name = (string)reader.Value;
                if (!reader.Read()) break;
                if (name == "header") header = JToken.ReadFrom(reader);
                else if (name == "format") format = reader.TokenType == JsonToken.String ? (string)reader.Value : null;
                else reader.Skip();
            }

            throw new JsonReaderException("The save document ends early.");
        }

        private static string Text(JToken token, string key)
        {
            JToken value = token[key];
            return value == null || value.Type == JTokenType.Null ? null : value.ToString();
        }
    }
}
