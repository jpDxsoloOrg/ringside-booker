using System.Collections.Generic;
using System.Linq;

namespace RingsideBooker.Screens
{
    /// <summary>One row of the beats editor: a beat and who is in its one or two groups.</summary>
    public sealed class BeatRow
    {
        public string BeatKey;
        public readonly List<string> GroupOne = new List<string>();
        public readonly List<string> GroupTwo = new List<string>();

        public BeatRow(string beatKey, IEnumerable<string> groupOne = null, IEnumerable<string> groupTwo = null)
        {
            BeatKey = beatKey;
            if (groupOne != null) GroupOne.AddRange(groupOne);
            if (groupTwo != null) GroupTwo.AddRange(groupTwo);
        }

        public IEnumerable<string> Everyone => GroupOne.Concat(GroupTwo);
    }

    /// <summary>Two people who must share a side but face each other in a beat.</summary>
    public readonly struct SideConflict
    {
        public SideConflict(string personA, string personB, int beatIndex)
        {
            PersonA = personA;
            PersonB = personB;
            BeatIndex = beatIndex;
        }

        public string PersonA { get; }
        public string PersonB { get; }
        public int BeatIndex { get; }
    }

    /// <summary>
    /// The talking segment's beat rules (the web's beatsDraft.ts and the engine's beatGroups.ts,
    /// MTCH5): a stored beat is <c>{beatKey, personIds}</c>, group one first; a two-group beat's groups
    /// come back from the people's sides. <see cref="AssignSides"/> gives everyone one side for the
    /// whole angle, or names the pair that makes it impossible.
    /// </summary>
    public static class AngleBeats
    {
        /// <summary>The most beats an angle may hold at all (the engine's MAX_ANGLE_BEATS).</summary>
        public const int MaxBeats = 8;

        /// <summary>
        /// The editor rows for stored beats, split as the rater splits them: in a two-group beat,
        /// everyone on its first person's side is group one. Before any were stored: the default beat
        /// with every speaker, side 0 in group one and the rest in group two.
        /// </summary>
        public static List<BeatRow> RowsOf(IReadOnlyList<(string beatKey, IReadOnlyList<string> personIds)> stored,
            IReadOnlyDictionary<string, int> sideOf, string defaultBeatKey, IReadOnlyList<string> speakers,
            System.Func<string, bool> twoGroups)
        {
            int Side(string personId) => sideOf.TryGetValue(personId, out int side) ? side : 0;
            if (stored != null)
            {
                return stored.Select(beat =>
                {
                    if (!twoGroups(beat.beatKey) || beat.personIds.Count == 0) return new BeatRow(beat.beatKey, beat.personIds);
                    int first = Side(beat.personIds[0]);
                    return new BeatRow(beat.beatKey,
                        beat.personIds.Where(person => Side(person) == first),
                        beat.personIds.Where(person => Side(person) != first));
                }).ToList();
            }
            if (defaultBeatKey == null) return new List<BeatRow>();
            List<string> ordered = speakers.OrderBy(Side).ToList();
            List<string> groupOne = ordered.Where(person => Side(person) == 0).ToList();
            List<string> others = ordered.Where(person => Side(person) != 0).ToList();
            if (!twoGroups(defaultBeatKey)) return new List<BeatRow> { new BeatRow(defaultBeatKey, groupOne.Concat(others)) };
            return groupOne.Count == 0
                ? new List<BeatRow> { new BeatRow(defaultBeatKey, others) }
                : new List<BeatRow> { new BeatRow(defaultBeatKey, groupOne, others) };
        }

        /// <summary>
        /// One side per person (0, 1, 2… in order of first appearance) so every two-group beat gets
        /// its groups back: group one shares a side, nobody in group two is on it. Returns false with
        /// the first conflict when that can't be done.
        /// </summary>
        public static bool AssignSides(IReadOnlyList<BeatRow> beats, System.Func<string, bool> twoGroups,
            out Dictionary<string, int> sides, out SideConflict conflict)
        {
            var parent = new Dictionary<string, string>();
            var order = new List<string>();

            string Root(string person)
            {
                string current = person;
                while (parent.TryGetValue(current, out string next) && next != current) current = next;
                return current;
            }

            void Join(string left, string right)
            {
                string leftRoot = Root(left);
                string rightRoot = Root(right);
                if (leftRoot != rightRoot) parent[rightRoot] = leftRoot;
            }

            bool IsTwo(BeatRow beat) => twoGroups(beat.BeatKey) || beat.GroupTwo.Count > 0;

            foreach (BeatRow beat in beats)
            {
                foreach (string person in beat.Everyone)
                {
                    if (!order.Contains(person)) order.Add(person);
                    if (!parent.ContainsKey(person)) parent[person] = person;
                }
                if (beat.GroupOne.Count > 0 && IsTwo(beat))
                {
                    foreach (string person in beat.GroupOne.Skip(1)) Join(beat.GroupOne[0], person);
                }
            }

            for (int index = 0; index < beats.Count; index++)
            {
                BeatRow beat = beats[index];
                foreach (string personA in beat.GroupOne)
                {
                    string opposed = beat.GroupTwo.FirstOrDefault(personB => Root(personA) == Root(personB));
                    if (opposed != null)
                    {
                        sides = null;
                        conflict = new SideConflict(personA, opposed, index);
                        return false;
                    }
                }
            }

            bool JoinConflicts(string left, string right) => beats.Any(beat => IsTwo(beat) &&
                ((beat.GroupOne.Any(person => Root(person) == left) && beat.GroupTwo.Any(person => Root(person) == right)) ||
                 (beat.GroupOne.Any(person => Root(person) == right) && beat.GroupTwo.Any(person => Root(person) == left))));

            foreach (BeatRow beat in beats)
            {
                if (beat.GroupTwo.Count == 0 || !IsTwo(beat)) continue;
                foreach (string person in beat.GroupTwo.Skip(1))
                {
                    string left = Root(beat.GroupTwo[0]);
                    string right = Root(person);
                    if (left != right && !JoinConflicts(left, right)) Join(beat.GroupTwo[0], person);
                }
            }

            var sideByRoot = new Dictionary<string, int>();
            sides = new Dictionary<string, int>();
            foreach (string person in order)
            {
                string root = Root(person);
                if (!sideByRoot.TryGetValue(root, out int side))
                {
                    side = sideByRoot.Count;
                    sideByRoot[root] = side;
                }
                sides[person] = side;
            }
            conflict = default;
            return true;
        }

        /// <summary>"X and Y are together in beat 1 but opposed in beat 3; booking can't store that".</summary>
        public static string ConflictMessage(IReadOnlyList<BeatRow> beats, SideConflict conflict, System.Func<string, string> nameOf,
            System.Func<string, bool> twoGroups)
        {
            int together = -1;
            for (int index = 0; index < beats.Count; index++)
            {
                BeatRow beat = beats[index];
                if (twoGroups(beat.BeatKey) && beat.GroupOne.Contains(conflict.PersonA) && beat.GroupOne.Contains(conflict.PersonB))
                {
                    together = index;
                    break;
                }
            }
            string how = together < 0 ? "must be on the same side" : $"are together in beat {together + 1}";
            return $"{nameOf(conflict.PersonA)} and {nameOf(conflict.PersonB)} {how} but opposed in beat {conflict.BeatIndex + 1}; booking can't store that";
        }

        /// <summary>The beats as booking stores them: group one first, then group two.</summary>
        public static List<(string beatKey, List<string> personIds)> ToStored(IEnumerable<BeatRow> beats) =>
            beats.Select(beat => (beat.BeatKey, beat.GroupOne.Concat(beat.GroupTwo).ToList())).ToList();

        /// <summary>"Short slot: up to 2 beats" (the engine's beatLimitMessage).</summary>
        public static string LimitMessage(string durationClass, int max) =>
            $"{CardWords.Length(durationClass)} slot: up to {max} {(max == 1 ? "beat" : "beats")}";
    }
}
