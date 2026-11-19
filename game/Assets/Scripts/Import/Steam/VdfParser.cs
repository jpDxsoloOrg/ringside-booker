using System;
using System.Collections.Generic;
using System.Text;

namespace RingsideBooker.Import.Steam
{
    /// <summary>
    /// A node of Valve's text KeyValues format (VDF): either a string value or a block of child
    /// nodes. Keys keep their order; lookups ignore case, as Steam does.
    /// </summary>
    public sealed class VdfNode
    {
        private readonly List<KeyValuePair<string, VdfNode>> children = new List<KeyValuePair<string, VdfNode>>();

        public VdfNode(string value = null)
        {
            Value = value;
        }

        /// <summary>The text of a value node; null for a block.</summary>
        public string Value { get; }

        public IReadOnlyList<KeyValuePair<string, VdfNode>> Children => children;

        internal void Add(string key, VdfNode node) => children.Add(new KeyValuePair<string, VdfNode>(key, node));

        /// <summary>The first child named <paramref name="key"/> (any case), or null.</summary>
        public VdfNode this[string key]
        {
            get
            {
                foreach (var child in children)
                {
                    if (string.Equals(child.Key, key, StringComparison.OrdinalIgnoreCase))
                    {
                        return child.Value;
                    }
                }

                return null;
            }
        }
    }

    /// <summary>
    /// Parses text VDF such as <c>steamapps/libraryfolders.vdf</c>: quoted or bare tokens, <c>{ }</c>
    /// blocks, <c>//</c> comments, and the escapes <c>\\ \" \n \t</c>. Conditional suffixes such as
    /// <c>[$WIN32]</c> are skipped. It never throws on malformed text; it returns what it could read.
    /// </summary>
    public static class VdfParser
    {
        public static VdfNode Parse(string text)
        {
            var root = new VdfNode();
            if (string.IsNullOrEmpty(text))
            {
                return root;
            }

            var position = 0;
            ParseBlock(text, ref position, root);
            return root;
        }

        private static void ParseBlock(string text, ref int position, VdfNode parent)
        {
            while (true)
            {
                var key = NextToken(text, ref position, out var keyKind);
                if (keyKind == TokenKind.End || keyKind == TokenKind.Close)
                {
                    return;
                }

                if (keyKind == TokenKind.Open)
                {
                    // A stray block with no key: read and drop it.
                    ParseBlock(text, ref position, new VdfNode());
                    continue;
                }

                var value = NextToken(text, ref position, out var valueKind);
                if (valueKind == TokenKind.Open)
                {
                    var block = new VdfNode();
                    ParseBlock(text, ref position, block);
                    parent.Add(key, block);
                }
                else if (valueKind == TokenKind.String)
                {
                    parent.Add(key, new VdfNode(value));
                }
                else
                {
                    // A key with no value: the block (or the file) ends here.
                    return;
                }
            }
        }

        private enum TokenKind
        {
            String,
            Open,
            Close,
            End,
        }

        private static string NextToken(string text, ref int position, out TokenKind kind)
        {
            while (position < text.Length)
            {
                var character = text[position];
                if (char.IsWhiteSpace(character))
                {
                    position++;
                    continue;
                }

                if (character == '/' && position + 1 < text.Length && text[position + 1] == '/')
                {
                    while (position < text.Length && text[position] != '\n')
                    {
                        position++;
                    }

                    continue;
                }

                if (character == '[')
                {
                    // A platform condition such as [$WIN32]: not a token.
                    while (position < text.Length && text[position] != ']')
                    {
                        position++;
                    }

                    position++;
                    continue;
                }

                break;
            }

            if (position >= text.Length)
            {
                kind = TokenKind.End;
                return null;
            }

            var first = text[position];
            if (first == '{')
            {
                position++;
                kind = TokenKind.Open;
                return null;
            }

            if (first == '}')
            {
                position++;
                kind = TokenKind.Close;
                return null;
            }

            var builder = new StringBuilder();
            kind = TokenKind.String;
            if (first == '"')
            {
                position++;
                while (position < text.Length && text[position] != '"')
                {
                    var character = text[position];
                    if (character == '\\' && position + 1 < text.Length)
                    {
                        position++;
                        var escaped = text[position];
                        builder.Append(escaped == 'n' ? '\n' : escaped == 't' ? '\t' : escaped);
                    }
                    else
                    {
                        builder.Append(character);
                    }

                    position++;
                }

                position++;
                return builder.ToString();
            }

            while (position < text.Length && !char.IsWhiteSpace(text[position]) && text[position] != '{' && text[position] != '}' && text[position] != '"')
            {
                builder.Append(text[position]);
                position++;
            }

            return builder.ToString();
        }
    }
}
