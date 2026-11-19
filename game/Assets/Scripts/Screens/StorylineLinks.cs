using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// The storyline section (the web's StorylineEditorSection, CRTV4-04): which storylines a saved
    /// segment counts for (<c>storylines.linkOptions</c>). The linked ones first, each with its heat,
    /// how many of its people are here and a Finale switch (<c>storylines.setFinale</c>; moving a
    /// finale from another segment asks first); then suggestions (a storyline with someone in the
    /// segment) and the others behind "Link another". Links are written at once with
    /// <c>storylines.linkSegment</c>; <paramref name="onLinks"/> hears the new list so an open editor
    /// saves the same links back.
    /// </summary>
    public static class StorylineLinks
    {
        public const string SaveFirstText = "Save the segment first to link a storyline.";

        public static VisualElement Build(string segmentId, Label feedback, Action<IReadOnlyList<string>> onLinks)
        {
            VisualElement host = Ds.Column("fc-story").Named("storyline-links");
            if (segmentId == null)
            {
                host.Add(Ds.Text(SaveFirstText, "fc-hint"));
                return host;
            }
            var state = new State { SegmentId = segmentId, Feedback = feedback, OnLinks = onLinks };
            host.RegisterCallback<AttachToPanelEvent>(evt => _ = Draw(host, state));
            return host;
        }

        private sealed class State
        {
            public string SegmentId;
            public Label Feedback;
            public Action<IReadOnlyList<string>> OnLinks;
            public bool ShowOthers;
            public string Refusal;
        }

        private static async Task Draw(VisualElement host, State state)
        {
            EngineGame game = Kit.Game;
            if (game == null) return;
            QueryResult<JToken> answer = await game.Client.Query("storylines.linkOptions", new JObject { ["segmentId"] = state.SegmentId });
            host.Clear();
            if (!answer.Ok)
            {
                host.Add(Ds.Text(Kit.Reasons(answer.Reasons), "fc-hint"));
                return;
            }
            JToken data = answer.Data;
            if (Kit.Str(data, "kind") == "unavailable")
            {
                host.Add(Ds.Text(Kit.Str(data, "reason.message") ?? "Storylines can't be linked here.", "fc-hint"));
                return;
            }
            bool locked = Kit.Bool(data, "locked");
            bool canFinale = Kit.Bool(data, "canSetFinale");
            int max = (int)(Kit.Num(data, "maxLinks") ?? 2);
            List<JToken> linked = Kit.Arr(data, "linked").ToList();
            List<JToken> suggestions = Kit.Arr(data, "suggestions").ToList();
            List<JToken> others = Kit.Arr(data, "others").ToList();
            List<string> linkedIds = linked.Select(row => Kit.Str(row, "storylineId")).ToList();
            bool full = linkedIds.Count >= max;

            if (locked) host.Add(Ds.Text("This show's card can no longer change, so its links are fixed.", "fc-hint"));
            if (linked.Count == 0 && suggestions.Count == 0 && others.Count == 0)
            {
                host.Add(Ds.Text("Your promotion has no active storylines.", "fc-hint"));
                return;
            }

            foreach (JToken row in linked)
            {
                string id = Kit.Str(row, "storylineId");
                VisualElement line = Ds.Row("fc-story__row", "fc-story__row--linked").Named($"story-linked-{id}");
                line.Add(new Icon("link", "ds-icon--sm", "fc-story__icon"));
                VisualElement words = Ds.Column("fc-story__words");
                words.Add(Ds.Text(Kit.Str(row, "name"), "fc-story__name"));
                string note = !Kit.Bool(row, "active") ? "Won't count: this storyline has ended"
                    : !Kit.Arr(row, "membersHere").Any() ? "Won't count: nobody from this story is in the segment"
                    : $"{HeatWord(Kit.Num(row, "heat"))} · {Kit.Arr(row, "membersHere").Count()} here";
                words.Add(Ds.Text(note, "fc-story__note"));
                if (Kit.Obj(row, "finaleElsewhere") is JToken elsewhere)
                {
                    words.Add(Ds.Text($"Finale is currently {Kit.Str(elsewhere, "showName")}, {Kit.Str(elsewhere, "slot")}", "fc-story__note"));
                }
                line.Add(words);
                line.Add(Ds.Spacer());
                if (canFinale && !locked)
                {
                    bool isFinale = Kit.Bool(row, "isFinale");
                    Button finale = Ds.Chip(isFinale ? "Finale" : "Make finale", isFinale, () => SetFinale(host, state, row, !isFinale), null, "crown");
                    finale.name = $"story-finale-{id}";
                    line.Add(finale);
                }
                else if (Kit.Bool(row, "isFinale")) line.Add(Ds.Pill(DsState.Gold, "Finale", "crown"));
                if (!locked)
                {
                    Button unlink = Ds.IconButton("close", "Unlink", async () => await Write(host, state, linkedIds.Where(other => other != id).ToList()));
                    unlink.name = $"story-unlink-{id}";
                    line.Add(unlink);
                }
                host.Add(line);
            }

            if (!locked && suggestions.Count > 0)
            {
                host.Add(Ds.Text("SUGGESTED", "fc-label", "fc-label--block"));
                foreach (JToken row in suggestions)
                {
                    string id = Kit.Str(row, "storylineId");
                    VisualElement line = Ds.Row("fc-story__row").Named($"story-suggested-{id}");
                    line.Add(new Icon("storylines", "ds-icon--sm", "fc-story__icon"));
                    VisualElement words = Ds.Column("fc-story__words");
                    words.Add(Ds.Text(Kit.Str(row, "name"), "fc-story__name"));
                    words.Add(Ds.Text($"{HeatWord(Kit.Num(row, "heat"))} · {Kit.Arr(row, "membersHere").Count()} here", "fc-story__note"));
                    line.Add(words);
                    line.Add(Ds.Spacer());
                    Button link = Ds.Button("Link", async () => await Write(host, state, linkedIds.Append(id).ToList()), DsButtonKind.Secondary, "link");
                    link.name = $"story-link-{id}";
                    link.SetEnabled(!full);
                    line.Add(link);
                    host.Add(line);
                }
            }

            if (!locked && others.Count > 0)
            {
                Button toggle = Ds.Button(state.ShowOthers ? "Hide other storylines" : $"Link another storyline ({others.Count})", () =>
                {
                    state.ShowOthers = !state.ShowOthers;
                    _ = Draw(host, state);
                }, DsButtonKind.Ghost, state.ShowOthers ? "chevron-down" : "chevron-right");
                toggle.name = "story-others";
                toggle.AddToClassList("fc-more");
                host.Add(toggle);
                if (state.ShowOthers)
                {
                    VisualElement chips = Ds.Row("fc-chip-row");
                    foreach (JToken row in others)
                    {
                        string id = Kit.Str(row, "storylineId");
                        Button chip = Ds.Chip(Kit.Str(row, "name"), false, async () => await Write(host, state, linkedIds.Append(id).ToList()), null, "add");
                        chip.name = $"story-other-{id}";
                        chip.SetEnabled(!full);
                        chips.Add(chip);
                    }
                    host.Add(chips);
                }
            }
            if (full && !locked) host.Add(Ds.Text($"A segment can count for at most {max} {(max == 1 ? "storyline" : "storylines")}.", "fc-hint"));
            if (state.Refusal != null) host.Add(Ds.Text(state.Refusal, "fc-refusal"));
        }

        private static string HeatWord(double? heat)
        {
            double value = heat ?? 0;
            return value >= 70 ? $"Hot ({value:0})" : value >= 40 ? $"Warm ({value:0})" : $"Cool ({value:0})";
        }

        private static async Task Write(VisualElement host, State state, List<string> storylineIds)
        {
            CommandResult<JToken> result = await Kit.Game.Client.Command("storylines.linkSegment",
                new JObject { ["segmentId"] = state.SegmentId, ["storylineIds"] = new JArray(storylineIds) });
            state.Refusal = result.Ok ? null : Kit.Reasons(result.Reasons);
            if (result.Ok) state.OnLinks?.Invoke(Kit.Arr(result.Data, "storylineIds").Select(id => (string)id).ToList());
            if (host.panel != null) await Draw(host, state);
        }

        private static void SetFinale(VisualElement host, State state, JToken row, bool on)
        {
            async Task Send()
            {
                CommandResult<JToken> result = await Kit.Game.Client.Command("storylines.setFinale",
                    new JObject { ["storylineId"] = Kit.Str(row, "storylineId"), ["segmentId"] = on ? state.SegmentId : null });
                state.Refusal = result.Ok ? null : Kit.Reasons(result.Reasons);
                if (host.panel != null) await Draw(host, state);
            }

            JToken elsewhere = Kit.Obj(row, "finaleElsewhere");
            if (on && elsewhere != null)
            {
                VisualElement body = Ds.Column();
                body.Add(Ds.Text("A storyline has one finale. The other segment stays linked but is no longer its finale.", "ds-type-body", "fc-wrap"));
                DsOverlay.Modal(host, $"Move the finale of '{Kit.Str(row, "name")}' here from {Kit.Str(elsewhere, "showName")}, {Kit.Str(elsewhere, "slot")}?", body,
                    ("Keep it there", DsButtonKind.Ghost, null),
                    ("Move finale", DsButtonKind.Primary, () => _ = Send()));
                return;
            }
            _ = Send();
        }
    }
}
