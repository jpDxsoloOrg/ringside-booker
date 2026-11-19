using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using Newtonsoft.Json;

namespace RingsideBooker.Import.Sqlite
{
    /// <summary>
    /// Writes SQLite tables as JSON in the shape the engine's world mod converter takes:
    /// <c>{"tableName": [ {"column": value, …}, … ], …}</c>. Integers and reals become JSON numbers,
    /// text becomes strings, NULL becomes null and blobs are left out (the world tables have none).
    /// A table that is not in the database is left out, so the converter can say which is missing.
    /// </summary>
    public static class SqliteJsonReader
    {
        /// <summary>Writes the listed tables (those that exist) to <paramref name="writer"/> as one JSON object.</summary>
        public static void WriteTables(SqliteDatabase database, IEnumerable<string> tables, JsonWriter writer)
        {
            if (database == null)
            {
                throw new ArgumentNullException(nameof(database));
            }

            var present = new HashSet<string>(database.TableNames(), StringComparer.Ordinal);
            writer.WriteStartObject();
            foreach (var table in tables)
            {
                if (!present.Contains(table))
                {
                    continue;
                }

                writer.WritePropertyName(table);
                WriteRows(database, table, writer);
            }

            writer.WriteEndObject();
        }

        /// <summary>The listed tables as a JSON object string.</summary>
        public static string ReadTablesJson(SqliteDatabase database, IEnumerable<string> tables)
        {
            using (var text = new StringWriter(CultureInfo.InvariantCulture))
            using (var writer = new JsonTextWriter(text))
            {
                WriteTables(database, tables, writer);
                writer.Flush();
                return text.ToString();
            }
        }

        private static void WriteRows(SqliteDatabase database, string table, JsonWriter writer)
        {
            writer.WriteStartArray();
            using (var statement = database.Prepare($"SELECT * FROM \"{table.Replace("\"", "\"\"")}\""))
            {
                var columns = new string[statement.ColumnCount];
                for (var column = 0; column < columns.Length; column++)
                {
                    columns[column] = statement.ColumnName(column);
                }

                while (statement.Step())
                {
                    writer.WriteStartObject();
                    for (var column = 0; column < columns.Length; column++)
                    {
                        var type = statement.ColumnType(column);
                        if (type == SqliteNative.TypeBlob)
                        {
                            continue;
                        }

                        writer.WritePropertyName(columns[column]);
                        switch (type)
                        {
                            case SqliteNative.TypeInteger:
                                writer.WriteValue(statement.GetInt64(column));
                                break;
                            case SqliteNative.TypeFloat:
                                var value = statement.GetDouble(column);
                                if (double.IsNaN(value) || double.IsInfinity(value))
                                {
                                    writer.WriteNull();
                                }
                                else
                                {
                                    writer.WriteValue(value);
                                }

                                break;
                            case SqliteNative.TypeText:
                                writer.WriteValue(statement.GetText(column));
                                break;
                            default:
                                writer.WriteNull();
                                break;
                        }
                    }

                    writer.WriteEndObject();
                }
            }

            writer.WriteEndArray();
        }
    }
}
