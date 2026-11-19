using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;
using RingsideBooker.Import.Pictures;
using RingsideBooker.UI.Bridge;
using RingsideBooker.UI.Shell;
using RingsideBooker.UI.Widgets;
using UnityEngine;
using UnityEngine.UIElements;

namespace RingsideBooker.Screens
{
    /// <summary>
    /// Promotion logos (UNITY-13): a workshop world mod's promotions carry a <c>logoRef</c> that
    /// points into the mod's picture folder. <see cref="Badge"/> draws the logo fitted inside a fixed
    /// box (aspect ratio kept) and falls back to the two-letter monogram when there is no picture: a
    /// built-in world, a roster-only import, or a missing file. Logos come from the
    /// <see cref="WorkshopWorlds.CurrentPictures"/> of the running game (the remembered mod folder
    /// of the save slot, so they come back after Continue/Load), or from a pack's pictures on the
    /// New game wizard.
    /// </summary>
    public static class PromotionLogos
    {
        private static EngineGame cachedFor;
        private static Task<Dictionary<string, (string logoRef, string shortName)>> loading;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        private static void Install()
        {
            SidebarView.LogoTexture = logoRef => Texture(WorkshopWorlds.CurrentPictures, logoRef);
        }

        /// <summary>The logo picture for <paramref name="logoRef"/>, or null when there is none.</summary>
        public static Texture2D Texture(PictureProvider pictures, string logoRef)
        {
            if (pictures == null || string.IsNullOrEmpty(logoRef) || pictures.RosterOnly) return null;
            Texture2D texture = pictures.Get(logoRef);
            return texture == null || texture == pictures.Placeholder ? null : texture;
        }

        /// <summary>
        /// A square box (size from <paramref name="sizeClass"/>, e.g. <c>rb-logo--sm</c>) with the logo
        /// fitted inside, or the monogram of <paramref name="shortName"/> when there is no picture.
        /// </summary>
        public static VisualElement Badge(PictureProvider pictures, string logoRef, string shortName, string sizeClass = "rb-logo--md")
        {
            VisualElement box = Ui.El("rb-logo", sizeClass);
            Texture2D texture = Texture(pictures, logoRef);
            if (texture != null)
            {
                box.AddToClassList("rb-logo--picture");
                var image = new Image { image = texture, scaleMode = ScaleMode.ScaleToFit };
                image.AddToClassList("rb-logo__image");
                box.Add(image);
            }
            else
            {
                box.Add(Ui.Text(SidebarView.Monogram(shortName), "rb-logo__monogram"));
            }
            return box;
        }

        /// <summary>A badge for a promotion of the running game, looked up by id (logo refs are cached per game).</summary>
        public static async Task<VisualElement> BadgeForAsync(string promotionId, string shortName, string sizeClass = "rb-logo--md")
        {
            (string logoRef, string knownShortName) = await LookupAsync(promotionId);
            return Badge(WorkshopWorlds.CurrentPictures, logoRef, shortName ?? knownShortName, sizeClass);
        }

        /// <summary>
        /// Adds a badge at the start of <paramref name="row"/> once the logo ref is known (the row is
        /// drawn straight away; the badge slots in when <c>promotions.list</c> answers, cached after).
        /// </summary>
        public static void Prepend(VisualElement row, string promotionId, string shortName, string sizeClass = "rb-logo--md")
        {
            if (row == null || string.IsNullOrEmpty(promotionId)) return;
            _ = Fill();

            async Task Fill()
            {
                try
                {
                    VisualElement badge = await BadgeForAsync(promotionId, shortName, sizeClass);
                    row.Insert(0, badge);
                }
                catch (Exception exception)
                {
                    Debug.LogWarning($"[PromotionLogos] {exception.GetType().Name}");
                }
            }
        }

        // ---- Show logos ---------------------------------------------------------------------------

        private static EngineGame showsCachedFor;
        private static readonly Dictionary<string, Task<(string logoRef, string promotionId)>> ShowLookups =
            new Dictionary<string, Task<(string, string)>>();

        /// <summary>
        /// Adds a show's badge at the start of <paramref name="row"/>: the show's own logo (its
        /// definition's <c>logoRef</c>: <paramref name="showLogoRef"/> when the caller has it, else read
        /// once per show with <c>calendar.show</c>), else its promotion's logo, else the promotion's
        /// monogram as the neutral placeholder.
        /// </summary>
        public static void PrependShow(VisualElement row, string eventInstanceId, string showLogoRef, string promotionId, string sizeClass = "rb-logo--md")
        {
            if (row == null || EngineGame.Current == null) return;
            _ = Fill();

            async Task Fill()
            {
                try
                {
                    VisualElement badge = await ShowBadgeAsync(eventInstanceId, showLogoRef, promotionId, sizeClass);
                    if (badge != null) row.Insert(0, badge);
                }
                catch (Exception exception)
                {
                    Debug.LogWarning($"[PromotionLogos] show: {exception.GetType().Name}");
                }
            }
        }

        /// <summary>The show logo picture only (no fallback), or null: the calendar's small cell icons.</summary>
        public static Texture2D ShowTexture(string showLogoRef) => Texture(WorkshopWorlds.CurrentPictures, showLogoRef);

        private static async Task<VisualElement> ShowBadgeAsync(string eventInstanceId, string showLogoRef, string promotionId, string sizeClass)
        {
            PictureProvider pictures = WorkshopWorlds.CurrentPictures;
            if (showLogoRef == null && eventInstanceId != null)
            {
                (string logoRef, string ownerId) = await ShowLookupAsync(eventInstanceId);
                showLogoRef = logoRef;
                promotionId ??= ownerId;
            }
            if (Texture(pictures, showLogoRef) != null) return Badge(pictures, showLogoRef, null, sizeClass);
            promotionId ??= EngineGame.Current?.PromotionId;
            return string.IsNullOrEmpty(promotionId) ? null : await BadgeForAsync(promotionId, null, sizeClass);
        }

        private static Task<(string logoRef, string promotionId)> ShowLookupAsync(string eventInstanceId)
        {
            EngineGame game = EngineGame.Current;
            if (showsCachedFor != game)
            {
                showsCachedFor = game;
                ShowLookups.Clear();
            }
            if (!ShowLookups.TryGetValue(eventInstanceId, out Task<(string, string)> lookup))
            {
                lookup = ReadShow(game.Client, eventInstanceId);
                ShowLookups[eventInstanceId] = lookup;
            }
            return lookup;
        }

        private static async Task<(string logoRef, string promotionId)> ReadShow(EngineClient client, string eventInstanceId)
        {
            QueryResult<JToken> answer = await client.Query("calendar.show", new JObject { ["eventInstanceId"] = eventInstanceId });
            if (!answer.Ok || answer.Data == null || answer.Data.Type != JTokenType.Object) return (null, null);
            return (Kit.Str(answer.Data, "logoRef"), Kit.Str(answer.Data, "promotion.id"));
        }

        /// <summary>The logo ref of a promotion in the running game, or null.</summary>
        public static async Task<string> LogoRefAsync(string promotionId) => (await LookupAsync(promotionId)).logoRef;

        /// <summary>The logo ref and short name of a promotion in the running game (nulls when unknown).</summary>
        public static async Task<(string logoRef, string shortName)> LookupAsync(string promotionId)
        {
            EngineGame game = EngineGame.Current;
            if (game == null || string.IsNullOrEmpty(promotionId)) return (null, null);
            if (cachedFor != game || loading == null)
            {
                cachedFor = game;
                loading = Load(game.Client);
            }
            Dictionary<string, (string, string)> logos = await loading;
            return logos.TryGetValue(promotionId, out (string, string) found) ? found : (null, null);
        }

        private static async Task<Dictionary<string, (string logoRef, string shortName)>> Load(EngineClient client)
        {
            var logos = new Dictionary<string, (string, string)>();
            QueryResult<JToken> list = await client.Query("promotions.list");
            if (!list.Ok || !(list.Data is JArray rows)) return logos;
            foreach (JToken row in rows)
            {
                string id = Kit.Str(row, "promotionId");
                if (id != null) logos[id] = (Kit.Str(row, "logoRef"), Kit.Str(row, "shortName"));
            }
            return logos;
        }
    }
}
