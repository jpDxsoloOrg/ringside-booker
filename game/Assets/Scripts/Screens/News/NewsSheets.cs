using System;
using System.Collections.Generic;
using System.Linq;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.UI;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Design;
using RingsideBooker.UI.Navigation;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine.UIElements;
using WhyEntityRef = RingsideBooker.UI.Why.EntityRef;

namespace RingsideBooker.Screens.News
{
    /// <summary>
    /// One story (the web's NewsStorySheet) in a side sheet: the headline names it; under it the
    /// kind and date, the full story, who is in it (each a link where a screen exists), importance,
    /// buzz with its quiet Why?, a link to the show's results, and how long the archive keeps it.
    /// A story that has left the archive says so.
    /// </summary>
    public static class NewsStorySheet
    {
        /// <summary>The story sheet open now, or null (tours).</summary>
        public static OverlayHandle Current { get; private set; }

        public static async void Open(VisualElement anchor, string newsId, GameDate today, ShellNavigator navigator)
        {
            EngineGame game = Kit.Game;
            if (game == null || anchor == null) return;
            QueryResult<JToken> answer = await game.Client.Query("news.item", new JObject { ["newsId"] = newsId });
            if (anchor.panel == null) return;
            VisualElement body = Ds.Column("nw-sheet").Named("news-story");
            NewsScreen.Style(body);
            if (!answer.Ok || answer.Data == null)
            {
                body.Add(Ds.Empty("newspaper", "This story can't be shown",
                    string.IsNullOrEmpty(answer.ReasonText) ? "This story is no longer in the news archive" : answer.ReasonText));
                Current = DsOverlay.SideSheet(anchor, "Story not found", body, "NEWS", null, 520f);
                return;
            }

            JToken item = answer.Data["item"];
            Dictionary<string, NewsName> names = NewsText.NamesFrom(answer.Data["names"]);
            string kind = Kit.Str(item, "kind");
            string headline = NewsText.Render(item["headline"], names);

            VisualElement meta = Ds.Row("nw-sheet__meta");
            meta.Add(Ds.Pill(NewsModel.KindState(kind), Kit.Str(item, "kindLabel") ?? NewsModel.KindLabel(kind), NewsModel.KindIcon(kind)));
            if (Kit.Bool(item, "frontPage")) meta.Add(Ds.Pill(DsState.Gold, "Front page", "star"));
            meta.Add(Ds.Text(GameDate.TryParse(Kit.Str(item, "date"), out GameDate date) ? date.Long : Kit.Str(item, "date"), "nw-sheet__date"));
            body.Add(meta);

            body.Add(Ds.Text(NewsText.Render(item["body"], names), "nw-sheet__body"));

            List<NewsName> entities = NewsModel.EntitiesOf(item, names);
            OverlayHandle handle = null;
            if (entities.Count > 0)
            {
                body.Add(Ds.Text("WHO'S IN THIS STORY", "nw-sheet__section"));
                VisualElement who = Ds.Row("ds-row--wrap", "nw-who").Named("news-story-who");
                foreach (NewsName entity in entities) who.Add(WhoChip(entity, () => handle?.Close(), navigator));
                body.Add(who);
            }

            int buzz = NewsModel.ShownBuzz(Kit.Num(item, "buzz") ?? 0);
            VisualElement facts = Ds.El("ds-kv", "nw-facts");
            facts.Add(Fact("Importance", Ds.Text(NewsModel.ImportanceLabel((int)(Kit.Num(item, "importance") ?? 0)), "ds-kv__value")));
            facts.Add(Fact("Buzz", NewsUi.Value($"{buzz} · {NewsModel.BuzzWord(buzz)}", NewsUi.BuzzWhy(item, buzz), "ds-kv__value")));
            body.Add(facts);

            string showId = Kit.Str(item, "refs.eventInstanceId");
            if (showId != null && ScreenRegistry.IsLive(ScreenIds.ShowResults) && navigator != null)
            {
                Button results = Ds.Button("See results", () =>
                {
                    handle?.Close();
                    navigator.Go(ShellRoute.With(ScreenIds.ShowResults, "event", showId));
                }, DsButtonKind.Ghost, "chevron-right");
                results.name = "news-story-results";
                body.Add(Ds.Row("nw-sheet__links").With(results));
            }
            body.Add(Ds.Text(NewsModel.ArchiveText(item), "nw-sheet__archive"));
            Current = handle = DsOverlay.SideSheet(anchor, headline, body, TextFormat.Upper(NewsModel.When(Kit.Str(item, "date"), today)), null, 520f);
            if (handle != null) handle.Entry.name = "news-story-sheet";
        }

        private static VisualElement Fact(string key, VisualElement value)
        {
            VisualElement row = Ds.El("ds-kv__row", "nw-facts__row");
            row.Add(Ds.Text(key, "ds-kv__key"));
            row.Add(value);
            return row;
        }

        /// <summary>A person (portrait), promotion, title or show the story names; a link when a screen shows it.</summary>
        private static VisualElement WhoChip(NewsName entity, Action close, ShellNavigator navigator)
        {
            ShellRoute route = navigator == null ? null : EngineGame.EntityRoute(new WhyEntityRef(entity.Kind, entity.Id));
            var chip = new Button(() =>
            {
                if (route == null) return;
                close();
                navigator.Go(route);
            }) { text = string.Empty, name = "news-who-" + entity.Id };
            chip.AddToClassList("nw-who__chip");
            chip.SetEnabled(route != null);
            if (entity.Kind == "person") chip.Add(NewsPeople.Portrait(entity.Id, "ds-portrait--xs"));
            else chip.Add(new Icon(entity.Kind == "promotion" ? "building" : entity.Kind == "eventInstance" ? "tv" : entity.Kind == "title" ? "trophy" : "info", "ds-icon--sm", "nw-who__icon"));
            chip.Add(Ds.Text(entity.Name, "nw-who__name"));
            return chip;
        }
    }

    /// <summary>
    /// News alerts (the web's NewsAlertSheet): a switch per <c>news.alertRules</c> rule, then "Stop
    /// long skips for these stories". Save sends only what changed (<c>news.setAlertRules</c>);
    /// Cancel or Esc drops the changes. Without a promotion the switches are off with "Alerts are for players".
    /// </summary>
    public static class NewsAlertSheet
    {
        public const string Title = "News alerts";
        public const string StopSkipLabel = "Stop long skips for these stories";
        public const string Note = "Your alerts stop long skips. They don't change the game.";
        public const string ForPlayers = "Alerts are for players";

        public static OverlayHandle Current { get; private set; }

        public static async void Open(VisualElement anchor)
        {
            EngineGame game = Kit.Game;
            if (game == null || anchor == null) return;
            bool canEdit = game.PromotionId != null;
            QueryResult<JToken> answer = await game.Client.Query("news.alertRules");
            if (anchor.panel == null) return;

            VisualElement body = Ds.Column("nw-alerts").Named("news-alerts-sheet");
            NewsScreen.Style(body);
            body.Add(Ds.Text(Note, "nw-alerts__note"));
            if (!canEdit) body.Add(Ds.Text(ForPlayers, "nw-alerts__notice"));
            var draftRules = new Dictionary<string, bool>();
            bool? draftStop = null;
            Label errors = Ds.Text(string.Empty, "nw-alerts__error").Named("news-alerts-error");
            errors.SetShown(false);

            if (!answer.Ok || answer.Data == null)
            {
                body.Add(Ds.Text(string.IsNullOrEmpty(answer.ReasonText) ? "Your alerts could not be read." : answer.ReasonText, "nw-alerts__error"));
            }
            else
            {
                body.Add(Ds.Text("TELL ME ABOUT", "nw-sheet__section"));
                foreach (JToken rule in Kit.Arr(answer.Data, "rules"))
                {
                    string id = Kit.Str(rule, "id");
                    body.Add(Switch(Kit.Str(rule, "label"), Kit.Bool(rule, "enabled"), on => draftRules[id] = on,
                        Kit.Str(rule, "description"), canEdit, "news-alert-" + id));
                }
                VisualElement stop = Ds.Column("nw-alerts__stop");
                stop.Add(Switch(StopSkipLabel, answer.Data["stopSkip"]?.Type != JTokenType.Boolean || (bool)answer.Data["stopSkip"],
                    on => draftStop = on, "The day button turns into Open news until you read the story.", canEdit, "news-alert-stop-skip"));
                body.Add(stop);
            }
            body.Add(errors);

            OverlayHandle handle = null;
            VisualElement footer = Ds.Row("nw-alerts__footer");
            Button cancel = Ds.Button("Cancel", () => handle?.Close(), DsButtonKind.Ghost);
            cancel.name = "news-alerts-cancel";
            Button save = null;
            save = Ds.Button("Save", async () =>
            {
                JObject change = NewsModel.AlertChange(answer.Data, draftRules, draftStop);
                if (change == null)
                {
                    handle?.Close();
                    return;
                }
                save.SetEnabled(false);
                CommandResult<JToken> result = await game.Client.Command("news.setAlertRules", change);
                save.SetEnabled(true);
                if (result.Ok)
                {
                    handle?.Close();
                    DsOverlay.Toast(anchor, "Alerts saved");
                }
                else
                {
                    errors.text = Kit.Reasons(result.Reasons);
                    errors.SetShown(true);
                }
            }, DsButtonKind.Primary);
            save.name = "news-alerts-save";
            save.SetEnabled(canEdit && answer.Ok);
            footer.Add(Ds.Spacer());
            footer.Add(cancel);
            footer.Add(save);
            NewsScreen.Style(footer);
            Current = handle = DsOverlay.SideSheet(anchor, Title, body, "NEWS", footer, 460f);
        }

        /// <summary>A switch row on the ds-check look: a box, the label and a quiet description.</summary>
        private static Button Switch(string label, bool on, Action<bool> changed, string description, bool enabled, string name)
        {
            bool state = on;
            VisualElement box = Ds.El("ds-check__box");
            Button row = null;
            row = new Button(() =>
            {
                state = !state;
                Draw();
                changed?.Invoke(state);
            }) { text = string.Empty, name = name };
            row.AddToClassList("ds-check");
            row.AddToClassList("nw-switch");
            row.Add(box);
            VisualElement words = Ds.Column("nw-switch__words");
            words.Add(Ds.Text(label, "ds-check__label", "nw-switch__label"));
            if (!string.IsNullOrEmpty(description)) words.Add(Ds.Text(description, "nw-switch__hint"));
            row.Add(words);
            row.SetEnabled(enabled);
            Draw();
            return row;

            void Draw()
            {
                box.Clear();
                if (state) box.Add(new Icon("check", "ds-icon--xs", "ds-check__tick"));
                row.EnableInClassList("ds-check--on", state);
            }
        }
    }
}
