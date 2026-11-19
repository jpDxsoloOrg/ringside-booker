using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI.Bridge;
using RingsideBooker.Import.Pictures;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>One person as the fight card draws them: name, face or heel, picture.</summary>
    public sealed class PersonFacts
    {
        public string Id;
        public string Name;
        public string ImageRef;
        public Alignment Alignment = Alignment.Tweener;
    }

    /// <summary>
    /// Your roster by person (<c>roster.rows</c>, every group): who is a face or a heel and their
    /// picture, for the matchup cards on Booking, Show night and Results (the card views carry names
    /// and pictures but not alignments).
    /// </summary>
    public sealed class CardPeople
    {
        private readonly Dictionary<string, PersonFacts> byId = new Dictionary<string, PersonFacts>();

        public static async Task<CardPeople> LoadAsync()
        {
            var people = new CardPeople();
            EngineGame game = Kit.Game;
            if (game == null) return people;
            QueryResult<JToken> rows = await game.Client.Query("roster.rows", new JObject());
            if (!rows.Ok) return people;
            foreach (JToken row in Kit.Arr(rows.Data, "rows"))
            {
                string id = Kit.Str(row, "personId");
                if (id == null) continue;
                people.byId[id] = new PersonFacts
                {
                    Id = id,
                    Name = Kit.Str(row, "ringName"),
                    ImageRef = Kit.Str(row, "imageRef"),
                    Alignment = CardWords.AlignmentOf(Kit.Str(row, "alignment")),
                };
            }
            return people;
        }

        public PersonFacts Get(string personId) =>
            personId != null && byId.TryGetValue(personId, out PersonFacts facts) ? facts : null;

        public Alignment AlignmentOf(string personId) => Get(personId)?.Alignment ?? Alignment.Tweener;

        /// <summary>The workshop world's picture for <paramref name="imageRef"/>, or null (a painted silhouette).</summary>
        public static Texture2D Picture(string imageRef)
        {
            PictureProvider pictures = WorkshopWorlds.CurrentPictures;
            if (pictures == null || string.IsNullOrEmpty(imageRef)) return null;
            return pictures.Get(imageRef);
        }
    }

    /// <summary>Plain words the fight card screens share. Never minutes (D-10): lengths are Short, Standard or Long.</summary>
    /// <summary>
    /// A founded promotion starts with nobody under contract: signing people is part of the
    /// challenge (owner, UNITY-22). Until there are enough wrestlers to fill a card, Booking, its
    /// Auto-fill and the Office say so in plain words and offer one way to Contracts › Free agents.
    /// </summary>
    public static class Signing
    {
        /// <summary>Fewer wrestlers than this can't fill a card (two matches, say an opener and a main event).</summary>
        public const int MinWrestlers = 4;
        public const string Title = "Sign some wrestlers first";
        public const string Action = "Find free agents";

        public static ShellRoute Route => ShellRoute.With("contracts", "tab", "free-agents");

        /// <summary>The wrestlers in a <c>roster.rows</c> answer.</summary>
        public static int Wrestlers(JToken rosterRows) => Kit.Arr(rosterRows, "rows").Count(row => Kit.Str(row, "group") == "wrestlers");

        public static bool Needed(int wrestlers) => wrestlers < MinWrestlers;

        public static string Detail(int wrestlers) => wrestlers == 0
            ? "Nobody is under contract yet. Free agents are waiting for an offer."
            : $"Only {wrestlers} {(wrestlers == 1 ? "wrestler is" : "wrestlers are")} under contract: not enough to fill a card.";
    }

    public static class CardWords
    {
        public static readonly string[] Lengths = { "short", "standard", "long" };

        public static string Length(string durationClass) => durationClass switch
        {
            "short" => "Short",
            "standard" => "Standard",
            "long" => "Long",
            _ => Kit.Capital(durationClass) ?? string.Empty,
        };

        public static Alignment AlignmentOf(string alignment) => alignment switch
        {
            "face" => Alignment.Face,
            "heel" => Alignment.Heel,
            _ => Alignment.Tweener,
        };

        /// <summary>A show's or a match's stars in a word ("Great show", "Solid").</summary>
        public static string StarsWord(double stars, bool show = false)
        {
            string word = stars >= 4.5 ? "Classic" : stars >= 4 ? "Great" : stars >= 3 ? "Good" : stars >= 2 ? "Solid" : stars >= 1 ? "Poor" : "Awful";
            return show ? $"{word} show" : word;
        }

        public static string Importance(string importance) => importance switch
        {
            "house" => "House show",
            "minor" => "Minor show",
            "regular" => "Regular show",
            "major" => "Major show",
            "flagship" => "Flagship show",
            _ => Kit.Capital(importance) ?? "Show",
        };

        public static DsState ImportanceState(string importance) =>
            importance == "major" || importance == "flagship" ? DsState.Gold : DsState.Info;

        public static string Countdown(double daysUntil) =>
            daysUntil <= 0 ? "Tonight" : daysUntil == 1 ? "Tomorrow" : $"In {daysUntil:0} days";

        /// <summary>"Calder Voss" → "Voss"; "The Cheetah" stays whole (the running order's short names).</summary>
        public static string Short(string name)
        {
            if (string.IsNullOrEmpty(name)) return string.Empty;
            string[] parts = name.Split(' ');
            return parts.Length > 1 && parts[0] != "The" && !name.Contains("&") ? parts.Last() : name;
        }

        /// <summary>"Altura World Championship" → "Altura World Champion" (who holds it).</summary>
        public static string Champion(string titleName) =>
            titleName == null ? null : titleName.EndsWith("Championship") ? titleName.Substring(0, titleName.Length - "ship".Length) : $"{titleName} champion";

        public static string Title(string titleName) =>
            titleName == null ? null : titleName.EndsWith(" Championship") ? titleName.Replace(" Championship", " title") : titleName;
    }

    /// <summary>Turns the engine's card and results views into the design system's matchup cards.</summary>
    public static class Matchups
    {
        /// <summary>A booked segment (<c>booking.card</c> slot) as a matchup: side one left, the rest right.</summary>
        public static Matchup FromBooking(JToken slot, JToken segment, CardPeople people)
        {
            bool match = Kit.Str(segment, "kind") == "match";
            List<JToken> sides = Kit.Arr(segment, "sides").ToList();
            var titleHolders = new HashSet<string>(Kit.Arr(segment, "titles").SelectMany(title => Kit.Arr(title, "holderIds")).Select(id => (string)id));
            string titleName = Kit.Str(Kit.Arr(segment, "titles").FirstOrDefault(), "name");
            var matchup = new Matchup
            {
                Slot = Kit.Str(slot, "roleLabel") ?? string.Empty,
                MatchType = Kit.Str(segment, "typeName"),
                Title = titleName,
                Length = CardWords.Length(Kit.Str(slot, "bookedTime") ?? Kit.Str(slot, "durationClass")),
                IsSegment = !match,
            };
            if (!match)
            {
                IEnumerable<JToken> everyone = sides.SelectMany(side => Kit.Arr(side, "people"));
                matchup.A = Side(Kit.Str(segment, "label") ?? string.Join(" & ", everyone.Select(person => Kit.Str(person, "ringName"))),
                    everyone.ToList(), people, null, Kit.Str(segment, "talkLine"));
                return matchup;
            }
            matchup.A = sides.Count > 0 ? BookingSide(sides[0], people, titleHolders, titleName) : null;
            List<JToken> rest = sides.Skip(1).ToList();
            if (rest.Count == 1) matchup.B = BookingSide(rest[0], people, titleHolders, titleName);
            else if (rest.Count > 1)
            {
                List<JToken> others = rest.SelectMany(side => Kit.Arr(side, "people")).ToList();
                matchup.B = Side(string.Join(", ", rest.Select(side => Kit.Str(side, "name"))), others, people, null, $"{rest.Count} sides");
            }
            return matchup;
        }

        private static MatchupSide BookingSide(JToken side, CardPeople people, HashSet<string> holders, string titleName)
        {
            List<JToken> members = Kit.Arr(side, "people").ToList();
            bool champion = members.Count > 0 && members.All(person => holders.Contains(Kit.Str(person, "personId")));
            MatchupSide built = Side(Kit.Str(side, "name") ?? string.Join(" & ", members.Select(person => Kit.Str(person, "ringName"))),
                members, people, champion ? titleName ?? "Champion" : null, null);
            if (members.Count > 1) built.Members = string.Join(" & ", members.Select(person => Kit.Str(person, "ringName")));
            return built;
        }

        private static MatchupSide Side(string name, IReadOnlyList<JToken> members, CardPeople people, string champion, string note)
        {
            JToken lead = members.FirstOrDefault();
            string leadId = Kit.Str(lead, "personId");
            string imageRef = Kit.Str(lead, "imageRef") ?? people?.Get(leadId)?.ImageRef;
            Alignment alignment = people?.AlignmentOf(leadId) ?? Alignment.Tweener;
            return new MatchupSide(name ?? "Nobody yet", alignment, note, champion, CardPeople.Picture(imageRef));
        }

        /// <summary>
        /// A segment from <c>shows.results</c> / <c>shows.liveState</c>. With an outcome the winners
        /// lead on the left (DEF.); a new champion carries the crown.
        /// </summary>
        public static Matchup FromResult(JToken segment, CardPeople people, bool withResult)
        {
            bool match = Kit.Str(segment, "kind") == "match";
            List<JToken> sides = Kit.Arr(segment, "sides").ToList();
            JToken outcome = withResult ? Kit.Obj(segment, "outcome") : null;
            JToken title = Kit.Arr(segment, "titles").FirstOrDefault();
            var matchup = new Matchup
            {
                Slot = Kit.Str(segment, "roleLabel") ?? string.Empty,
                MatchType = Kit.Str(segment, "typeName"),
                Title = Kit.Str(title, "name"),
                Length = CardWords.Length(Kit.Str(segment, "durationClass")),
                IsSegment = !match,
            };
            JToken rating = withResult ? Kit.Obj(segment, "rating") : null;
            if (rating != null) matchup.Stars = (float)(Kit.Num(rating, "stars") ?? 0);
            if (!match)
            {
                List<JToken> everyone = sides.SelectMany(side => Kit.Arr(side, "members")).ToList();
                matchup.A = ResultSide(Kit.Str(segment, "label") ?? string.Join(" & ", sides.Select(side => Kit.Str(side, "label"))), everyone, people, null);
                return matchup;
            }

            int winningSide = Kit.Str(outcome, "kind") == "win" ? (int)(Kit.Num(outcome, "winningSide") ?? -1) : -1;
            bool newChampion = Kit.Str(title, "outcome") == "newChampion";
            JToken winners = sides.FirstOrDefault(side => (int)(Kit.Num(side, "side") ?? -2) == winningSide);
            List<JToken> ordered = winners == null ? sides : new[] { winners }.Concat(sides.Where(side => side != winners)).ToList();
            string titleName = Kit.Str(title, "name");
            string Champion(JToken side) => titleName != null && side == winners && Kit.Str(title, "outcome") != "stillVacant" ? titleName : null;
            matchup.A = ordered.Count > 0 ? ResultSide(Kit.Str(ordered[0], "label"), Kit.Arr(ordered[0], "members").ToList(), people, Champion(ordered[0]),
                newChampion && ordered[0] == winners ? "New champion" : null) : null;
            List<JToken> rest = ordered.Skip(1).ToList();
            if (rest.Count > 0)
            {
                matchup.B = ResultSide(string.Join(", ", rest.Select(side => Kit.Str(side, "label"))),
                    rest.SelectMany(side => Kit.Arr(side, "members")).ToList(), people, null);
            }
            if (outcome != null)
            {
                string kind = Kit.Str(outcome, "kind");
                matchup.Winner = winners != null ? 0 : (int?)null;
                matchup.Finish = kind == "draw" ? "Draw" : kind == "noContest" ? "No contest"
                    : string.Join(" · ", new[] { Kit.Str(outcome, "methodName"), Kit.Str(outcome, "finishName") }.Where(text => !string.IsNullOrEmpty(text)));
            }
            return matchup;
        }

        private static MatchupSide ResultSide(string label, IReadOnlyList<JToken> members, CardPeople people, string champion, string note = null)
        {
            JToken lead = members.FirstOrDefault();
            string leadId = Kit.Str(lead, "personId");
            string imageRef = Kit.Str(lead, "imageRef") ?? people?.Get(leadId)?.ImageRef;
            var side = new MatchupSide(label ?? string.Empty, people?.AlignmentOf(leadId) ?? Alignment.Tweener, note, champion, CardPeople.Picture(imageRef));
            if (members.Count > 1 && label != null && !label.Contains("&")) side.Members = string.Join(" & ", members.Select(member => Kit.Str(member, "name")));
            return side;
        }

        /// <summary>Adds stars to a card's top row after it was drawn (previews arrive later).</summary>
        public static void AddStars(VisualElement card, float stars)
        {
            VisualElement top = card.Q<VisualElement>(className: "ds-match__top");
            if (top == null) return;
            top.Query<Stars>().ForEach(old => old.RemoveFromHierarchy());
            var element = new Stars(stars, "ds-icon--sm");
            element.AddToClassList("ds-match__stars");
            top.Add(element);
        }
    }

    public static class ElementExtensions
    {
        /// <summary>Adds <paramref name="child"/> when there is one (Why? buttons are null without a trace).</summary>
        public static void AddOpt(this VisualElement parent, VisualElement child)
        {
            if (child != null) parent.Add(child);
        }
    }

    /// <summary>The fight card screens' stylesheet (Resources/Screens/FightCard.uss), added once per screen root.</summary>
    public static class FightCardStyles
    {
        private const string ResourcePath = "Screens/FightCard";
        private static StyleSheet sheet;

        public static T Apply<T>(T element) where T : VisualElement
        {
            if (sheet == null) sheet = Resources.Load<StyleSheet>(ResourcePath);
            if (sheet != null && !element.styleSheets.Contains(sheet)) element.styleSheets.Add(sheet);
            return element;
        }
    }
}
