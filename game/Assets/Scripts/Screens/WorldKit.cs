using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Newtonsoft.Json.Linq;
using RingsideBooker.Import.Pictures;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Why;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// Shared pieces for the world screens on the UNITY-11 design system (UNITY-15): the plain words
    /// for engine values (popularity, morale, condition, push, style, roles), portraits and logos
    /// from workshop worlds, the page head, the search box, the quiet Why? on a real
    /// <see cref="WhyButton"/>, and a "show more" pager for long lists. Layout classes are
    /// <c>wl-</c> (Assets/UI/Screens/World.uss); the look comes from the <c>ds-</c> components.
    /// </summary>
    public static class W
    {
        /// <summary>Rows a long table or card grid draws before "Show more".</summary>
        public const int PageSize = 100;

        // ---- Words ------------------------------------------------------------------------------

        public static Alignment Side(string alignment) => alignment switch
        {
            "face" => Alignment.Face,
            "heel" => Alignment.Heel,
            _ => Alignment.Tweener,
        };

        public static string SideWord(string alignment) => alignment switch
        {
            "face" => "Face",
            "heel" => "Heel",
            "tweener" => "Tweener",
            _ => Kit.NoValue,
        };

        /// <summary>The side as a FACE / HEEL tag (tweeners get a quiet one).</summary>
        public static VisualElement SideTag(string alignment) =>
            alignment == "face" || alignment == "heel" ? Ds.Tag(SideWord(alignment), alignment) : Ds.Tag(SideWord(alignment));

        /// <summary>A card position as the mockups word it: "Main eventer", "Upper card", "Midcard".</summary>
        public static string PushWord(string push) => push switch
        {
            "mainEvent" => "Main eventer",
            "upperCard" => "Upper card",
            "midCard" => "Midcard",
            "lowerCard" => "Lower card",
            "enhancement" => "Enhancement",
            _ => null,
        };

        public static int PushRank(string push) => push switch
        {
            "mainEvent" => 5,
            "upperCard" => 4,
            "midCard" => 3,
            "lowerCard" => 2,
            "enhancement" => 1,
            _ => 0,
        };

        public static readonly string[] Styles = { "allRounder", "technician", "brawler", "highFlyer", "powerhouse", "hardcore", "striker", "grappler", "showman", "nonWrestler" };

        public static string StyleWord(string style) => style switch
        {
            "allRounder" => "All-rounder",
            "technician" => "Technician",
            "brawler" => "Brawler",
            "highFlyer" => "High-flyer",
            "powerhouse" => "Powerhouse",
            "hardcore" => "Hardcore",
            "striker" => "Striker",
            "grappler" => "Grappler",
            "showman" => "Showman",
            "nonWrestler" => "Non-wrestler",
            null => Kit.NoValue,
            _ => Words(style),
        };

        public static readonly string[] Roles = { "wrestler", "occasionalWrestler", "manager", "presenter", "announcer", "referee", "producer" };

        public static string RoleWord(string role) => role switch
        {
            "wrestler" => "Wrestler",
            "occasionalWrestler" => "Occasional wrestler",
            "manager" => "Manager",
            "presenter" => "Presenter",
            "announcer" => "Announcer",
            "referee" => "Referee",
            "producer" => "Producer",
            "booker" => "Booker",
            null => Kit.NoValue,
            _ => Words(role),
        };

        public static string PromotionStyleWord(string style) => style switch
        {
            "mainstream" => "Mainstream",
            "traditional" => "Traditional",
            "technical" => "Technical",
            "hardHitting" => "Hard-hitting",
            "hardcore" => "Hardcore",
            "highFlying" => "High-flying",
            "entertainment" => "Entertainment",
            null => Kit.NoValue,
            _ => Words(style),
        };

        public static string GenderWord(string gender) => gender switch
        {
            "male" => "Men",
            "female" => "Women",
            "nonBinary" => "Non-binary",
            _ => Kit.NoValue,
        };

        /// <summary>camelCase to "Camel case".</summary>
        public static string Words(string key)
        {
            if (string.IsNullOrEmpty(key)) return key;
            var text = new System.Text.StringBuilder();
            foreach (char letter in key)
            {
                if (char.IsUpper(letter) && text.Length > 0) text.Append(' ').Append(char.ToLowerInvariant(letter));
                else text.Append(text.Length == 0 ? char.ToUpperInvariant(letter) : letter);
            }
            return text.ToString();
        }

        /// <summary>Popularity in words, words first ("Huge star 73"), coloured gold for the biggest names.</summary>
        public static (DsState state, string word) Popularity(double? value)
        {
            if (!value.HasValue) return (DsState.Neutral, "Unknown");
            double popularity = value.Value;
            if (popularity >= 70) return (DsState.Gold, "Huge star");
            if (popularity >= 55) return (DsState.Info, "Star");
            if (popularity >= 40) return (DsState.Info, "Well known");
            if (popularity >= 25) return (DsState.Neutral, "Known");
            if (popularity >= 10) return (DsState.Neutral, "Little known");
            return (DsState.Neutral, "Unknown");
        }

        /// <summary>Morale (−100 to 100) in words.</summary>
        public static (DsState state, string word) Morale(double? value)
        {
            if (!value.HasValue) return (DsState.Neutral, Kit.NoValue);
            double morale = value.Value;
            if (morale >= 40) return (DsState.Good, "Happy");
            if (morale >= -15) return (DsState.Neutral, "Content");
            if (morale >= -45) return (DsState.Warn, "Unhappy");
            return (DsState.Bad, "Wants out");
        }

        /// <summary>Availability as a condition word: healthy, hurting (injured or in rehab) or away.</summary>
        public static (DsState state, string word) Condition(string status, string label = null)
        {
            switch (status)
            {
                case null:
                case "available": return (DsState.Good, "Healthy");
                case "injured": return (DsState.Bad, "Hurting");
                case "rehab": return (DsState.Warn, "In rehab");
                case "notDebuted": return (DsState.Neutral, "Not debuted");
                case "retired": return (DsState.Neutral, "Retired");
                default: return (DsState.Warn, label ?? Words(status));
            }
        }

        /// <summary>A 0–100 skill as a word and a state for its meter.</summary>
        public static (DsState state, string word) Skill(double value)
        {
            DsState state = value >= 75 ? DsState.Good : value >= 50 ? DsState.Info : DsState.Neutral;
            string word = value >= 80 ? "Excellent" : value >= 65 ? "Good" : value >= 50 ? "Solid" : value >= 35 ? "Raw" : "Poor";
            return (state, word);
        }

        /// <summary>A show score (0–100) in words.</summary>
        public static (DsState state, string word) ShowScore(double? score)
        {
            if (!score.HasValue) return (DsState.Neutral, Kit.NoValue);
            double value = score.Value;
            if (value >= 80) return (DsState.Gold, "Classic");
            if (value >= 65) return (DsState.Good, "Great");
            if (value >= 50) return (DsState.Info, "Good");
            if (value >= 35) return (DsState.Neutral, "Fair");
            return (DsState.Warn, "Poor");
        }

        public static string Trait(string trait) => trait switch
        {
            "injuryProne" => "Gets hurt easily",
            "agesBadly" => "Ages badly",
            "agesWell" => "Ages well",
            "shrinksOnBigStage" => "Shrinks on a big stage",
            "bigMatchPerformer" => "Big-match performer",
            "poorSeller" => "Poor seller",
            "generousSeller" => "Generous seller",
            "teacher" => "Good teacher",
            "egotist" => "Big ego",
            "coaster" => "Coasts",
            "refusesComedy" => "Won't do comedy",
            "refusesHardcore" => "Won't do hardcore",
            _ => Words(trait),
        };

        public static DsState TraitState(string trait) => trait switch
        {
            "injuryProne" or "agesBadly" or "shrinksOnBigStage" or "poorSeller" or "egotist" or "troublemaker" or "sensitive" or "slowLearner" => DsState.Warn,
            "durable" or "workhorse" or "professional" or "teacher" or "bigMatchPerformer" or "generousSeller" or "loyal" or "fastLearner" or "agesWell" or "selfless" => DsState.Good,
            _ => DsState.Info,
        };

        /// <summary>A contract end as the roster shows it: "Ends Mar 9" when it's close, else "Mar 2027".</summary>
        public static string ContractWord(string endsOn, double? daysLeft, out bool soon)
        {
            soon = daysLeft.HasValue && daysLeft.Value <= 60;
            if (endsOn == null) return "Open-ended";
            if (!GameDate.TryParse(endsOn, out GameDate date)) return endsOn;
            var when = new DateTime(date.Year, date.Month, date.Day);
            return soon ? "Ends " + when.ToString("MMM d", CultureInfo.InvariantCulture) : when.ToString("MMM yyyy", CultureInfo.InvariantCulture);
        }

        public static string Money(double? cents) => cents.HasValue ? TextFormat.Money((long)Math.Round(cents.Value)) : Kit.NoValue;

        public static string Int(double? value) => value.HasValue ? Math.Round(value.Value).ToString("0", CultureInfo.InvariantCulture) : Kit.NoValue;

        // ---- Pictures ---------------------------------------------------------------------------

        /// <summary>A workshop world's picture for a person, or null (the portrait paints a silhouette).</summary>
        public static Texture2D Picture(string imageRef)
        {
            PictureProvider pictures = WorkshopWorlds.CurrentPictures;
            if (pictures == null || string.IsNullOrEmpty(imageRef)) return null;
            try
            {
                return pictures.HasPicture(imageRef) ? pictures.Get(imageRef) : null;
            }
            catch (Exception exception)
            {
                Debug.LogWarning($"[World] picture: {exception.Message}");
                return null;
            }
        }

        public static VisualElement Portrait(string imageRef, string alignment, string sizeClass, bool champion = false) =>
            DsCards.PortraitBox(Picture(imageRef), Side(alignment), sizeClass, champion);

        /// <summary>A promotion's logo: the workshop picture fitted inside, else a monogram on its colour.</summary>
        public static VisualElement Logo(string logoRef, string shortName, string color, string sizeClass = "ds-logo--sm")
        {
            Texture2D picture = PromotionLogos.Texture(WorkshopWorlds.CurrentPictures, logoRef);
            VisualElement logo = DsCards.Logo(Monogram(shortName), color ?? "#334155", sizeClass, picture);
            if (picture != null) logo.style.unityBackgroundScaleMode = ScaleMode.ScaleToFit;
            return logo;
        }

        public static string Monogram(string shortName)
        {
            if (string.IsNullOrEmpty(shortName)) return "?";
            string letters = new string(shortName.Where(char.IsLetterOrDigit).ToArray());
            return letters.Length <= 3 ? letters : letters.Substring(0, letters.Length >= 4 && shortName.Length <= 5 ? 4 : 2);
        }

        // ---- Layout ------------------------------------------------------------------------------

        /// <summary>The page root: a column that never squeezes its rows (UNITY-13 rule).</summary>
        public static VisualElement Page(string id)
        {
            VisualElement page = Ds.Column("wl-page").Named($"screen-{id}");
            return page;
        }

        /// <summary>Title, a quiet line under it, and whatever sits on the right (a view switch).</summary>
        public static VisualElement Head(string title, string subtitle, out Label subtitleLabel, params VisualElement[] right)
        {
            VisualElement head = Ds.Row("wl-head");
            VisualElement titles = Ds.Column("wl-head__titles");
            titles.Add(Ds.Text(TextFormat.Upper(title), "ds-type-headline", "wl-head__title"));
            subtitleLabel = Ds.Text(subtitle ?? string.Empty, "ds-type-caption", "wl-head__subtitle");
            titles.Add(subtitleLabel);
            head.Add(titles);
            head.Add(Ds.Spacer());
            foreach (VisualElement element in right)
            {
                if (element != null) head.Add(element);
            }
            return head;
        }

        /// <summary>A search box that calls <paramref name="changed"/> as the player types.</summary>
        public static VisualElement Search(string placeholder, string value, Action<string> changed, string name)
        {
            VisualElement box = Ds.Row("wl-search");
            box.Add(new Icon("search", "ds-icon--sm", "wl-search__icon"));
            var field = new TextField { name = name, value = value ?? string.Empty };
            field.AddToClassList("wl-search__field");
            field.textEdition.placeholder = placeholder;
            field.RegisterValueChangedCallback(evt => changed(evt.newValue ?? string.Empty));
            box.Add(field);
            return box;
        }

        /// <summary>The micro label ("WORTH A LOOK", "IN THE RING").</summary>
        public static Label Label(string text) => Ds.Text(TextFormat.Upper(text), "wl-label");

        /// <summary>A quiet number after a word ("Huge star 73").</summary>
        public static Label QuietNumber(string text) => Ds.Text(text, "wl-num-quiet");

        /// <summary>One skill line: label, a word on a meter, the number.</summary>
        public static VisualElement SkillLine(string label, double value)
        {
            (DsState state, string word) = Skill(value);
            VisualElement row = Ds.Row("wl-skill");
            row.Add(Ds.Text(label, "wl-skill__label"));
            row.Add(Ds.Meter((float)(value / 100.0), state, word));
            row.Add(QuietNumber(Int(value)));
            return row;
        }

        /// <summary>
        /// Makes a UNITY-08 <see cref="WhyButton"/> quiet, the design system's way: a small "?" that
        /// shows when <paramref name="host"/> is hovered or the button has focus. Returns the host.
        /// </summary>
        public static VisualElement QuietWhy(VisualElement host, WhyButton why)
        {
            if (why == null) return host;
            host.AddToClassList("ds-why-host");
            why.text = string.Empty;
            why.AddToClassList("ds-why");
            why.AddToClassList("wl-why");
            why.Add(new Icon("why", "ds-icon--xs"));
            host.Add(why);
            return host;
        }

        /// <summary>A word with its state dot, a quiet number and the quiet Why?.</summary>
        public static VisualElement DotNumber(DsState state, string word, string number, WhyButton why = null)
        {
            VisualElement cell = Ds.Row("wl-dot-num");
            cell.Add(Ds.Dot(state, word));
            if (number != null) cell.Add(QuietNumber(number));
            return QuietWhy(cell, why);
        }

        /// <summary>A text cell for <see cref="DsTable{T}"/>.</summary>
        public static Label Cell(string text, bool strong = false, bool number = false)
        {
            Label label = Ds.Text(text ?? Kit.NoValue, "ds-cell__text");
            if (strong) label.AddToClassList("ds-cell__text--strong");
            if (number) label.AddToClassList("ds-cell__text--num");
            return label;
        }

        /// <summary>Portrait, name (and an optional crown and detail line), one line each with an ellipsis.</summary>
        public static VisualElement NameCell(string name, string imageRef, string alignment, bool champion = false, string detail = null)
        {
            VisualElement cell = Ds.Row("wl-name-cell");
            cell.Add(Portrait(imageRef, alignment, "ds-portrait--xs", champion));
            VisualElement words = Ds.Column("wl-name-cell__words");
            words.Add(Ds.Text(name ?? Kit.NoValue, "ds-cell__text", "ds-cell__text--strong", "wl-name-cell__name"));
            if (detail != null) words.Add(Ds.Text(detail, "wl-name-cell__detail"));
            cell.Add(words);
            if (champion) cell.Add(new Icon("crown", "ds-icon--xs", "wl-name-cell__crown"));
            return cell;
        }

        /// <summary>Logo and promotion short name in one cell.</summary>
        public static VisualElement PromotionCell(string logoRef, string shortName, string name, string color)
        {
            VisualElement cell = Ds.Row("wl-promo-cell");
            if (shortName == null && name == null)
            {
                cell.Add(Ds.Text("Free agent", "ds-cell__text", "wl-quiet-text"));
                return cell;
            }
            VisualElement logo = Logo(logoRef, shortName ?? name, color, "wl-logo--xs");
            cell.Add(logo);
            cell.Add(Ds.Text(name ?? shortName, "ds-cell__text", "wl-promo-cell__name"));
            return cell;
        }

        /// <summary>
        /// A "Show more" footer under a long list: draws <see cref="PageSize"/> more each press.
        /// <paramref name="shown"/> is how many are drawn, <paramref name="total"/> how many there are.
        /// </summary>
        public static VisualElement More(int shown, int total, Action more, string noun)
        {
            VisualElement row = Ds.Row("wl-more");
            row.Add(Ds.Text($"Showing {TextFormat.Number(Math.Min(shown, total))} of {TextFormat.Number(total)} {noun}", "ds-type-caption"));
            if (shown < total)
            {
                Button button = Ds.Button($"Show {Math.Min(PageSize, total - shown)} more", more, DsButtonKind.Secondary, "chevron-down");
                button.name = "list-more";
                row.Add(button);
            }
            return row;
        }

        /// <summary>An empty state that fits a table's place.</summary>
        public static VisualElement Empty(string icon, string title, string hint = null) => Ds.Empty(icon, title, hint);

        /// <summary>A popover of chip groups behind one Filter button. Each group is (label, options, selected, pick).</summary>
        public static VisualElement FilterGroup(string label, IEnumerable<(string value, string text)> options, string selected, Action<string> pick)
        {
            VisualElement group = Ds.Column("wl-filter-group");
            group.Add(Label(label));
            VisualElement chips = Ds.Row("ds-row--wrap", "wl-filter-group__chips");
            Button any = Ds.Chip("Any", selected == null, () => pick(null));
            chips.Add(any);
            foreach ((string value, string text) in options)
            {
                string captured = value;
                chips.Add(Ds.Chip(text, selected == value, () => pick(captured)));
            }
            group.Add(chips);
            return group;
        }

        /// <summary>The removable pills that show which filters are on.</summary>
        public static VisualElement ActiveFilters(IEnumerable<(string text, Action clear)> filters, Action clearAll)
        {
            List<(string text, Action clear)> list = filters.ToList();
            VisualElement row = Ds.Row("ds-row--wrap", "wl-active-filters");
            if (list.Count == 0) return row;
            row.Add(Label("Filters"));
            foreach ((string text, Action clear) in list)
            {
                Button pill = Ds.Chip(text, true, clear, null, "close");
                row.Add(pill);
            }
            Button all = Ds.Button("Clear all", clearAll, DsButtonKind.Ghost);
            all.AddToClassList("ds-btn--link");
            row.Add(all);
            return row;
        }

        public static JObject Args(params (string key, JToken value)[] pairs)
        {
            var args = new JObject();
            foreach ((string key, JToken value) in pairs)
            {
                if (value != null && value.Type != JTokenType.Null) args[key] = value;
            }
            return args;
        }
    }
}

namespace RingsideBooker.Screens
{
    /// <summary>
    /// A <see cref="DsTable{T}"/> over a long list: a header click sorts the whole list (each
    /// column's <see cref="DsColumn{T}.SortKey"/>), the table draws <see cref="W.PageSize"/> rows,
    /// and "Show more" adds the next page. Keeps big worlds (thousands of people or shows) quick.
    /// </summary>
    public sealed class PagedTable<T> : VisualElement
    {
        private readonly List<T> all;
        private readonly string noun;
        private readonly VisualElement footer;
        private List<T> ordered;
        private int shown;

        public PagedTable(IEnumerable<DsColumn<T>> columns, IEnumerable<T> rows, string noun, Func<T, VisualElement> details = null,
            string sortId = null, bool descending = false)
        {
            AddToClassList("wl-paged");
            all = rows.ToList();
            ordered = all;
            this.noun = noun;
            Table = new DsTable<T>(columns, Array.Empty<T>(), details);
            Table.ExternalSort = Sort;
            Add(Table);
            footer = Ds.Column("wl-paged__footer");
            Add(footer);
            shown = W.PageSize;
            if (sortId != null)
            {
                Table.ShowSort(sortId, descending);
                Order(sortId, descending);
            }
            Draw();
        }

        public DsTable<T> Table { get; }

        public int Count => all.Count;

        private void Sort(string columnId, bool descending)
        {
            Order(columnId, descending);
            shown = W.PageSize;
            Draw();
        }

        private void Order(string columnId, bool descending)
        {
            DsColumn<T> column = Table.Columns.FirstOrDefault(c => c.Id == columnId && c.SortKey != null);
            if (column == null) return;
            ordered = descending ? all.OrderByDescending(row => column.SortKey(row)).ToList() : all.OrderBy(row => column.SortKey(row)).ToList();
        }

        private void Draw()
        {
            Table.SetRows(ordered.Take(shown));
            footer.Clear();
            if (all.Count > W.PageSize) footer.Add(W.More(shown, all.Count, () =>
            {
                shown += W.PageSize;
                Draw();
            }, noun));
        }
    }
}
