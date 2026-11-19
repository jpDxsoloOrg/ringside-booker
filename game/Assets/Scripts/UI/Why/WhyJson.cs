using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace RingsideBooker.UI.Why
{
    /// <summary>
    /// A small JSON reader for the engine's answers. Objects become
    /// <c>Dictionary&lt;string, object&gt;</c>, arrays <c>List&lt;object&gt;</c>, numbers
    /// <c>double</c>, and <c>true</c>/<c>false</c>/<c>null</c> their C# values. Unity's
    /// JsonUtility cannot read a trace (a value may be a number, a yes/no, text or null), so the
    /// Why? panel reads traces with this instead.
    /// </summary>
    public static class WhyJson
    {
        /// <summary>Reads one JSON document. Throws <see cref="FormatException"/> on bad JSON.</summary>
        public static object Parse(string json)
        {
            if (json == null) throw new ArgumentNullException(nameof(json));
            var reader = new Reader(json);
            reader.SkipWhitespace();
            object value = reader.ReadValue();
            reader.SkipWhitespace();
            if (!reader.AtEnd) throw reader.Error("Unexpected text after the JSON value");
            return value;
        }

        private sealed class Reader
        {
            private readonly string text;
            private int position;

            public Reader(string text)
            {
                this.text = text;
            }

            public bool AtEnd => position >= text.Length;

            public FormatException Error(string message) =>
                new FormatException($"{message} at character {position}");

            public void SkipWhitespace()
            {
                while (position < text.Length)
                {
                    char c = text[position];
                    if (c != ' ' && c != '\t' && c != '\n' && c != '\r') return;
                    position++;
                }
            }

            public object ReadValue()
            {
                if (AtEnd) throw Error("Unexpected end of JSON");
                char c = text[position];
                switch (c)
                {
                    case '{':
                        return ReadObject();
                    case '[':
                        return ReadArray();
                    case '"':
                        return ReadString();
                    case 't':
                        ReadWord("true");
                        return true;
                    case 'f':
                        ReadWord("false");
                        return false;
                    case 'n':
                        ReadWord("null");
                        return null;
                    default:
                        if (c == '-' || (c >= '0' && c <= '9')) return ReadNumber();
                        throw Error($"Unexpected character '{c}'");
                }
            }

            private void ReadWord(string word)
            {
                if (string.CompareOrdinal(text, position, word, 0, word.Length) != 0)
                {
                    throw Error($"Expected {word}");
                }
                position += word.Length;
            }

            private Dictionary<string, object> ReadObject()
            {
                var result = new Dictionary<string, object>(StringComparer.Ordinal);
                position++; // {
                SkipWhitespace();
                if (!AtEnd && text[position] == '}')
                {
                    position++;
                    return result;
                }
                while (true)
                {
                    SkipWhitespace();
                    if (AtEnd || text[position] != '"') throw Error("Expected a property name");
                    string key = ReadString();
                    SkipWhitespace();
                    if (AtEnd || text[position] != ':') throw Error("Expected ':'");
                    position++;
                    SkipWhitespace();
                    result[key] = ReadValue();
                    SkipWhitespace();
                    if (AtEnd) throw Error("Unexpected end of JSON in an object");
                    char c = text[position++];
                    if (c == '}') return result;
                    if (c != ',') throw Error("Expected ',' or '}'");
                }
            }

            private List<object> ReadArray()
            {
                var result = new List<object>();
                position++; // [
                SkipWhitespace();
                if (!AtEnd && text[position] == ']')
                {
                    position++;
                    return result;
                }
                while (true)
                {
                    SkipWhitespace();
                    result.Add(ReadValue());
                    SkipWhitespace();
                    if (AtEnd) throw Error("Unexpected end of JSON in an array");
                    char c = text[position++];
                    if (c == ']') return result;
                    if (c != ',') throw Error("Expected ',' or ']'");
                }
            }

            private string ReadString()
            {
                position++; // opening quote
                var builder = new StringBuilder();
                while (true)
                {
                    if (AtEnd) throw Error("Unterminated string");
                    char c = text[position++];
                    if (c == '"') return builder.ToString();
                    if (c != '\\')
                    {
                        builder.Append(c);
                        continue;
                    }
                    if (AtEnd) throw Error("Unterminated escape");
                    char escape = text[position++];
                    switch (escape)
                    {
                        case '"': builder.Append('"'); break;
                        case '\\': builder.Append('\\'); break;
                        case '/': builder.Append('/'); break;
                        case 'b': builder.Append('\b'); break;
                        case 'f': builder.Append('\f'); break;
                        case 'n': builder.Append('\n'); break;
                        case 'r': builder.Append('\r'); break;
                        case 't': builder.Append('\t'); break;
                        case 'u':
                            if (position + 4 > text.Length) throw Error("Bad \\u escape");
                            string hex = text.Substring(position, 4);
                            if (!int.TryParse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out int code))
                            {
                                throw Error("Bad \\u escape");
                            }
                            builder.Append((char)code);
                            position += 4;
                            break;
                        default:
                            throw Error($"Bad escape '\\{escape}'");
                    }
                }
            }

            private double ReadNumber()
            {
                int start = position;
                if (text[position] == '-') position++;
                while (position < text.Length)
                {
                    char c = text[position];
                    if ((c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-')
                    {
                        position++;
                        continue;
                    }
                    break;
                }
                string number = text.Substring(start, position - start);
                if (!double.TryParse(number, NumberStyles.Float, CultureInfo.InvariantCulture, out double value))
                {
                    throw Error($"Bad number '{number}'");
                }
                return value;
            }
        }
    }
}
