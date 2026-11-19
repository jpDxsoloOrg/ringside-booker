using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// "Choose a venue" (the web's VenuePickerSheet, EVT6-06): the venues from <c>boxOffice.venues</c>
    /// in groups (the show's region, the rest of the country, abroad behind a switch that asks with
    /// <c>scope: 'world'</c>, and the generic local venues), each with its expected crowd and how
    /// well it fits. Unavailable venues stay listed with the reason. Picking a row selects it; Use this
    /// venue sends <c>booking.setVenue</c> and Pick for me <c>booking.autoVenue</c>.
    /// </summary>
    public static class VenuePicker
    {
        private static readonly string[] Groups = { "region", "country", "abroad", "generic" };

        public static void Open(VisualElement anyElement, string eventId)
        {
            var state = new State { EventId = eventId };
            VisualElement body = Ds.Column("fc-venues").Named("venue-picker");
            VisualElement footer = Ds.Row("fc-venues__footer");
            state.Message = Ds.Text(string.Empty, "fc-refusal");
            state.Message.SetShown(false);
            Button use = Ds.Button("Use this venue", async () => await Use(state), DsButtonKind.Primary, "check");
            use.name = "venue-use";
            use.SetEnabled(false);
            state.UseButton = use;
            Button auto = Ds.Button("Pick for me", async () => await PickForMe(state), DsButtonKind.Secondary, "sparkles");
            auto.name = "venue-auto";
            footer.Add(use);
            footer.Add(auto);
            state.Body = body;
            VisualElement wrap = Ds.Column();
            wrap.Add(body);
            wrap.Add(state.Message);
            state.Handle = DsOverlay.SideSheet(anyElement, "Choose a venue", FightCardStyles.Apply(wrap), "Venue", footer, 560f);
            _ = Load(state);
        }

        private sealed class State
        {
            public string EventId;
            public string Scope = "country";
            public string Selected;
            public JToken Options;
            public VisualElement Body;
            public Label Message;
            public Button UseButton;
            public OverlayHandle Handle;
        }

        private static async Task Load(State state)
        {
            state.Body.Clear();
            state.Body.Add(Ds.Loading("Finding venues…"));
            QueryResult<JToken> answer = await Kit.Game.Client.Query("boxOffice.venues", new JObject { ["eventInstanceId"] = state.EventId, ["scope"] = state.Scope });
            if (!answer.Ok)
            {
                state.Body.Clear();
                state.Body.Add(Ds.Text(Kit.Reasons(answer.Reasons), "fc-hint"));
                return;
            }
            state.Options = answer.Data;
            Draw(state);
        }

        private static string ChoiceKey(JToken choice) =>
            Kit.Str(choice, "kind") == "venue" ? Kit.Str(choice, "venueId") : $"generic:{Kit.Str(choice, "tier")}";

        private static void Draw(State state)
        {
            VisualElement body = state.Body;
            body.Clear();
            body.Add(Ds.Text("Expected crowds are for this card at each venue. Choosing a venue in another region moves the show there.", "fc-hint"));
            List<JToken> options = Kit.Arr(state.Options, "options").ToList();
            JToken local = options.FirstOrDefault(option => Kit.Str(option, "group") == "generic") ?? Kit.Obj(state.Options, "current") ?? Kit.Obj(state.Options, "suggested");
            string region = Kit.Str(local, "regionName") ?? "this region";
            string country = Kit.Str(local, "countryName") ?? "this country";
            foreach (string group in Groups)
            {
                if (group == "abroad")
                {
                    Button abroad = Ds.Chip("Show venues in other countries", state.Scope == "world", () =>
                    {
                        state.Scope = state.Scope == "world" ? "country" : "world";
                        _ = Load(state);
                    }, null, "map");
                    abroad.name = "venue-abroad";
                    body.Add(Ds.Row("fc-venues__switch").With(abroad));
                }
                List<JToken> rows = options.Where(option => Kit.Str(option, "group") == group).ToList();
                if (rows.Count == 0) continue;
                body.Add(Ds.SectionHeader(group switch
                {
                    "region" => $"In {region}",
                    "country" => $"Elsewhere in {country}",
                    "abroad" => "Abroad",
                    _ => "Local venues (generic)",
                }));
                foreach (JToken option in rows) body.Add(Row(state, option));
            }
            JToken chosen = options.FirstOrDefault(option => ChoiceKey(Kit.Obj(option, "choice")) == state.Selected);
            state.UseButton.SetEnabled(chosen != null && Kit.Obj(chosen, "disabled") == null && !Kit.Bool(chosen, "current"));
        }

        private static VisualElement Row(State state, JToken option)
        {
            string key = ChoiceKey(Kit.Obj(option, "choice"));
            bool disabled = Kit.Obj(option, "disabled") != null;
            var row = new Button(() =>
            {
                if (disabled) return;
                state.Selected = key;
                Draw(state);
            }) { text = string.Empty, name = $"venue-{key}" };
            row.AddToClassList("fc-venue");
            row.EnableInClassList("fc-venue--selected", state.Selected == key);
            row.EnableInClassList("fc-venue--disabled", disabled);
            VisualElement words = Ds.Column("fc-venue__words");
            VisualElement name = Ds.Row("fc-venue__name-row");
            name.Add(Ds.Text(Kit.Str(option, "name"), "fc-venue__name"));
            if (Kit.Bool(option, "preferred")) name.Add(Ds.Pill(DsState.Gold, "Preferred", "star"));
            if (Kit.Bool(option, "current")) name.Add(Ds.Pill(DsState.Info, "Current", "check"));
            words.Add(name);
            words.Add(Ds.Text($"{Kit.Str(option, "regionName")}, {Kit.Str(option, "countryName")} · {Kit.Capital(Kit.Str(option, "venueKind"))} · Capacity {TextFormat.Number((long)(Kit.Num(option, "capacity") ?? 0))}", "fc-venue__facts"));
            double low = Kit.Num(option, "low") ?? 0;
            double high = Kit.Num(option, "high") ?? 0;
            string range = low == high ? TextFormat.Number((long)low) : $"{TextFormat.Number((long)low)} – {TextFormat.Number((long)high)}";
            VisualElement crowd = Ds.Row("fc-venue__crowd");
            crowd.Add(Ds.Text($"Expected {range}", "fc-venue__expected"));
            string fit = Kit.Str(option, "fit");
            crowd.Add(Ds.Pill(fit == "likelySellOut" ? DsState.Good : fit == "willLookEmpty" ? DsState.Warn : DsState.Info, Kit.Str(option, "fitLabel") ?? Kit.Capital(fit)));
            words.Add(crowd);
            if (disabled) words.Add(Ds.Text($"Unavailable: {Kit.Str(option, "disabled.message")}", "fc-venue__reason"));
            row.Add(words);
            return row;
        }

        private static async Task Use(State state)
        {
            JToken chosen = Kit.Arr(state.Options, "options").FirstOrDefault(option => ChoiceKey(Kit.Obj(option, "choice")) == state.Selected);
            if (chosen == null) return;
            CommandResult<JToken> result = await Kit.Game.Client.Command("booking.setVenue",
                new JObject { ["eventInstanceId"] = state.EventId, ["choice"] = Kit.Obj(chosen, "choice").DeepClone() });
            Settle(state, result, $"The show moves to {Kit.Str(chosen, "name")}");
        }

        private static async Task PickForMe(State state)
        {
            CommandResult<JToken> result = await Kit.Game.Client.Command("booking.autoVenue", new JObject { ["eventInstanceId"] = state.EventId });
            Settle(state, result, result.Ok ? $"Booked {Kit.Str(result.Data, "venue.name") ?? "the suggested venue"}" : null);
        }

        private static void Settle(State state, CommandResult<JToken> result, string done)
        {
            if (!result.Ok)
            {
                state.Message.text = Kit.Reasons(result.Reasons);
                state.Message.SetShown(true);
                return;
            }
            VisualElement anchor = state.Body;
            state.Handle?.Close();
            if (done != null) DsOverlay.Toast(anchor, done, DsState.Good, null, 3f);
        }
    }
}
