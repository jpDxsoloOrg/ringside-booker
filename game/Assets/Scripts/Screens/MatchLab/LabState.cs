using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;

namespace RingsideBooker.Screens.MatchLab
{
    /// <summary>One person the lab placed, as the picker described them (<c>match.labWorkers</c> row).</summary>
    public sealed class LabPerson
    {
        public string Id;
        public string Name;
        public string PromotionShortName;
        public string ImageRef;
        public double Popularity;
        public bool NonWrestler;

        public static LabPerson FromRow(JToken row) => new LabPerson
        {
            Id = (string)row?["personId"],
            Name = (string)row?["name"],
            PromotionShortName = (string)row?["promotionShortName"],
            Popularity = row?["popularity"]?.Type == JTokenType.Float || row?["popularity"]?.Type == JTokenType.Integer ? (double)row["popularity"] : 0,
            NonWrestler = (string)row?["style"] == "nonWrestler",
        };
    }

    /// <summary>One beat of an angle: its key and the people in its first and second group.</summary>
    public sealed class LabBeat
    {
        public string BeatKey;
        public readonly List<string> GroupOne = new List<string>();
        public readonly List<string> GroupTwo = new List<string>();

        public IEnumerable<string> Everyone => GroupOne.Concat(GroupTwo);
    }

    /// <summary>What a match Run landed: the arguments, the night shown in full and the batch (null at 1 run).</summary>
    public sealed class LabRun
    {
        public JObject Args;
        public string PlanKey;
        public JToken Simulation;
        public JToken Preview;
        public JToken Batch;
        public int Runs;
        public int Seed;
        public string Date;
    }

    /// <summary>What an angle Run landed.</summary>
    public sealed class LabAngleRun
    {
        public JObject Args;
        public JToken Result;
        public string Date;
    }

    /// <summary>
    /// The Match lab's state for the session (the web's <c>labStore</c>): the setup, the sides, the
    /// result plan, Runs, the angle draft and the last answers. It never touches the world; leaving the
    /// lab and coming back keeps the line-up, and a different game starts it again. Pure C#, so the
    /// argument building is tested without the engine.
    /// </summary>
    public sealed class LabState
    {
        /// <summary>The most sides the lab builds and the most people on one side (the preview's limits).</summary>
        public const int MaxSides = 30;
        public const int MaxSideSize = 6;
        public const int MaxRuns = 100;
        public const int MaxBeats = 8;
        public const int SeedMax = int.MaxValue;

        public static readonly string[] SlotRoles = { "opener", "midcard", "semiMain", "mainEvent" };
        public static readonly string[] Durations = { "short", "standard", "long" };

        public bool Seeded;
        public string Kind = "match";
        public string TypeKey;
        public string AngleTypeKey;
        public string SlotRole = "midcard";
        /// <summary>Short / standard / long, or null for the slot's usual time (D-10: never minutes).</summary>
        public string BookedTime;
        public string Importance = "regular";
        public string RegionId;
        public bool Televised = true;
        public string PromotionId;
        public string Setting;

        public List<List<string>> Sides = new List<List<string>> { new List<string>(), new List<string>() };
        public readonly Dictionary<string, LabPerson> People = new Dictionary<string, LabPerson>();

        /// <summary>"auto", "draw" or the 0-based side as text.</summary>
        public string Winner = "auto";
        public string FinishKey;
        public readonly Dictionary<string, double> FatigueOverrides = new Dictionary<string, double>();
        public int Runs = 1;

        public readonly List<LabBeat> Beats = new List<LabBeat>();

        public LabRun LastRun;
        public LabAngleRun LastAngle;
        public bool Pending;
        public string Refusal;

        /// <summary>The game the state belongs to: a different one resets it.</summary>
        public object Owner;

        public bool IsAngle => Kind == "angle";

        /// <summary>Seeds the setup from <c>match.labOptions</c> the first time the lab opens on a world.</summary>
        public void Seed(JToken options, int sideCount)
        {
            if (Seeded) return;
            JToken defaults = options?["defaults"];
            Seeded = true;
            TypeKey = (string)defaults?["typeKey"];
            SlotRole = (string)defaults?["slotRole"] ?? "midcard";
            Importance = (string)defaults?["importance"] ?? "regular";
            RegionId = (string)defaults?["regionId"];
            Televised = defaults?["televised"]?.Type != JTokenType.Boolean || (bool)defaults["televised"];
            PromotionId = (string)options?["promotion"]?["id"];
            Sides = ResizeSides(new List<List<string>>(), Math.Max(1, sideCount));
        }

        /// <summary>
        /// <paramref name="sides"/> resized to <paramref name="count"/>: empty sides come off the end or
        /// are added, but a side someone stands on is never dropped.
        /// </summary>
        public static List<List<string>> ResizeSides(List<List<string>> sides, int count)
        {
            var next = sides.Select(side => new List<string>(side)).ToList();
            while (next.Count > count && next[next.Count - 1].Count == 0) next.RemoveAt(next.Count - 1);
            while (next.Count < count) next.Add(new List<string>());
            return next;
        }

        public void SetType(string typeKey, int minSides)
        {
            if (typeKey != TypeKey) Winner = "auto";
            TypeKey = typeKey;
            Sides = ResizeSides(Sides, minSides);
            FinishKey = null;
        }

        /// <summary>The side a person stands on (0-based), or -1.</summary>
        public int SideOf(string personId)
        {
            for (int index = 0; index < Sides.Count; index++)
            {
                if (Sides[index].Contains(personId)) return index;
            }
            return -1;
        }

        /// <summary>Puts a person on a side; false when the side is full or they already stand somewhere.</summary>
        public bool AddPerson(int side, LabPerson person)
        {
            if (person?.Id == null || side < 0 || side >= Sides.Count) return false;
            if (Sides[side].Count >= MaxSideSize || SideOf(person.Id) >= 0) return false;
            Sides[side].Add(person.Id);
            People[person.Id] = person;
            return true;
        }

        public void RemovePerson(int side, string personId)
        {
            if (side >= 0 && side < Sides.Count) Sides[side].Remove(personId);
            FatigueOverrides.Remove(personId);
        }

        public bool AddSide()
        {
            if (Sides.Count >= MaxSides) return false;
            Sides.Add(new List<string>());
            return true;
        }

        public void RemoveSide(int side)
        {
            if (Sides.Count <= 1 || side < 0 || side >= Sides.Count) return;
            foreach (string id in Sides[side]) FatigueOverrides.Remove(id);
            Sides.RemoveAt(side);
            if (int.TryParse(Winner, out int winning) && winning >= side) Winner = "auto";
        }

        public string NameOf(string personId) =>
            personId != null && People.TryGetValue(personId, out LabPerson person) ? person.Name : personId;

        /// <summary>Runs kept whole and within 1 to <see cref="MaxRuns"/>.</summary>
        public static int ClampRuns(int runs) => Math.Min(MaxRuns, Math.Max(1, runs));

        /// <summary>A fresh seed for <paramref name="runs"/> nights (night i rolls with seed + i).</summary>
        public static int FreshSeed(int runs, Random random) =>
            random.Next(0, SeedMax - (ClampRuns(runs) - 1));

        /// <summary>The preview arguments for a match or talking segment, or null while something is missing.</summary>
        public JObject PreviewArgs(int previewSeed)
        {
            if (TypeKey == null || RegionId == null || PromotionId == null) return null;
            if (Sides.Count == 0 || Sides.Any(side => side.Count == 0)) return null;
            var args = new JObject
            {
                ["kind"] = "match",
                ["typeKey"] = TypeKey,
                ["sides"] = new JArray(Sides.Select(side => new JArray(side))),
                ["slotRole"] = SlotRole,
                ["importance"] = Importance,
                ["regionId"] = RegionId,
                ["televised"] = Televised,
                ["promotionId"] = PromotionId,
                ["previewSeed"] = previewSeed,
            };
            if (BookedTime != null) args["bookedTime"] = BookedTime;
            return args;
        }

        /// <summary>The planned winner as the engine takes it: "auto", "draw" or <c>{ side }</c>.</summary>
        public JToken WinnerArg() =>
            int.TryParse(Winner, out int side) ? new JObject { ["side"] = side } : (JToken)(Winner == "draw" ? "draw" : "auto");

        /// <summary>The Physical panel's what-ifs for the people still on a side.</summary>
        public JObject Extensions()
        {
            var overrides = new JObject();
            foreach (string id in Sides.SelectMany(side => side))
            {
                if (FatigueOverrides.TryGetValue(id, out double fatigue)) overrides[id] = fatigue;
            }
            var physical = new JObject();
            if (overrides.Count > 0) physical["fatigueOverrides"] = overrides;
            return new JObject { ["physical"] = physical };
        }

        /// <summary><c>match.simulate</c>'s arguments: the preview's plus the plan and the physical what-ifs.</summary>
        public JObject SimulateArgs(int previewSeed)
        {
            JObject args = PreviewArgs(previewSeed);
            if (args == null) return null;
            args["winner"] = WinnerArg();
            args["finishKey"] = FinishKey;
            args["methodKey"] = null;
            args["extensions"] = Extensions();
            return args;
        }

        /// <summary><c>match.simulateBatch</c>'s arguments: <paramref name="runs"/> nights from <paramref name="firstSeed"/>.</summary>
        public JObject BatchArgs(int firstSeed, int runs)
        {
            JObject args = SimulateArgs(firstSeed);
            if (args == null) return null;
            args["runs"] = ClampRuns(runs);
            return args;
        }

        /// <summary>A key for the plan (winner and finish), so a changed plan reads as out of date.</summary>
        public string PlanKey() => $"{Winner}|{FinishKey}";

        /// <summary>
        /// True when the segment or the plan changed after the Run on screen: the result says "Out of
        /// date: run again" rather than re-running on every change. Runs and the seed don't count.
        /// </summary>
        public bool IsOutOfDate(LabRun shown)
        {
            if (shown == null) return false;
            int seed = (int?)shown.Args?["previewSeed"] ?? 0;
            JObject now = PreviewArgs(seed);
            if (now == null) return true;
            return !JToken.DeepEquals(now, shown.Args) || PlanKey() != shown.PlanKey;
        }

        // ---- Angle mode -------------------------------------------------------------------------

        /// <summary>The <c>match.previewAngle</c> arguments, or null while a beat has an empty first group.</summary>
        public JObject AngleArgs(int previewSeed)
        {
            if (AngleTypeKey == null || RegionId == null || PromotionId == null || Beats.Count == 0) return null;
            if (Beats.Any(beat => beat.BeatKey == null || beat.GroupOne.Count == 0)) return null;
            var args = new JObject
            {
                ["importance"] = Importance,
                ["regionId"] = RegionId,
                ["televised"] = Televised,
                ["slotRole"] = SlotRole,
                ["promotionId"] = PromotionId,
                ["angleTypeKey"] = AngleTypeKey,
                ["beats"] = new JArray(Beats.Select(beat => new JObject
                {
                    ["beatKey"] = beat.BeatKey,
                    ["groupOne"] = new JArray(beat.GroupOne),
                    ["groupTwo"] = new JArray(beat.GroupTwo),
                })),
                ["previewSeed"] = previewSeed,
                ["aftermath"] = true,
            };
            if (Setting != null) args["setting"] = Setting;
            if (BookedTime != null) args["bookedTime"] = BookedTime;
            return args;
        }

        public bool IsAngleOutOfDate(LabAngleRun shown)
        {
            if (shown == null) return false;
            JObject now = AngleArgs((int?)shown.Args?["previewSeed"] ?? 0);
            return now == null || !JToken.DeepEquals(now, shown.Args);
        }

        /// <summary>Starts the angle draft from an angle type: its default beat, empty.</summary>
        public void SetAngleType(string angleTypeKey, string defaultBeatKey, string firstSetting)
        {
            AngleTypeKey = angleTypeKey;
            Setting = firstSetting;
            var keep = Beats.SelectMany(beat => beat.Everyone).Distinct().ToList();
            Beats.Clear();
            var beat0 = new LabBeat { BeatKey = defaultBeatKey };
            beat0.GroupOne.AddRange(keep.Take(4));
            Beats.Add(beat0);
        }
    }
}
