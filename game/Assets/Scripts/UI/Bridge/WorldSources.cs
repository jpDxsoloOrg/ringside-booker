using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using RingsideBooker.Engine;

namespace RingsideBooker.UI.Bridge
{
    /// <summary>
    /// One world the New game wizard offers: the bundled default world, or one a
    /// <see cref="IWorldSource"/> lists (an installed workshop world mod, UNITY-06).
    /// </summary>
    public sealed class WorldChoice
    {
        public WorldChoice(string id, string name, string description = null, string detail = null)
        {
            Id = id ?? throw new ArgumentNullException(nameof(id));
            Name = name ?? id;
            Description = description ?? string.Empty;
            Detail = detail ?? string.Empty;
        }

        /// <summary>The root pack id the engine starts the world from (<c>rootPackId</c>).</summary>
        public string Id { get; }
        public string Name { get; }
        public string Description { get; }
        /// <summary>A short line under the name, such as the author and version.</summary>
        public string Detail { get; }

        /// <summary>A note the source sets while previewing (an import report summary), shown by the wizard. No names.</summary>
        public string Notice { get; set; }

        /// <summary>
        /// The wizard's preview of the world (promotions, settings, start date). Default:
        /// <c>client.PreviewWorld(Id)</c>. Override when the world needs preparing first.
        /// </summary>
        public Func<EngineClient, Task<WorldPreviewResult>> Preview { get; set; }

        /// <summary>
        /// Starts the game from the wizard's options (the engine's new-game input, with
        /// <c>rootPackId</c> already set to <see cref="Id"/>). Default: <c>client.NewGame(options)</c>.
        /// </summary>
        public Func<EngineClient, JObject, Task<NewGameResult>> NewGame { get; set; }

        internal Task<WorldPreviewResult> RunPreview(EngineClient client) =>
            Preview != null ? Preview(client) : client.PreviewWorld(Id);

        internal Task<NewGameResult> RunNewGame(EngineClient client, JObject options) =>
            NewGame != null ? NewGame(client, options) : client.NewGame(options);
    }

    /// <summary>Lists extra worlds for the New game wizard (UNITY-06 registers the workshop mods' source).</summary>
    public interface IWorldSource
    {
        /// <summary>The group's heading in the wizard, such as "Workshop mods".</summary>
        string Label { get; }

        /// <summary>The worlds to offer now. Called each time the wizard opens; may be empty.</summary>
        Task<IReadOnlyList<WorldChoice>> ListAsync(EngineClient client);
    }

    /// <summary>The registered <see cref="IWorldSource"/>s, in registration order.</summary>
    public static class WorldSources
    {
        private static readonly List<IWorldSource> Sources = new List<IWorldSource>();

        public static IReadOnlyList<IWorldSource> All => Sources;

        /// <summary>Adds a source (once; registering the same instance again does nothing).</summary>
        public static void Register(IWorldSource source)
        {
            if (source == null) throw new ArgumentNullException(nameof(source));
            if (!Sources.Contains(source)) Sources.Add(source);
        }

        public static void Unregister(IWorldSource source) => Sources.Remove(source);
    }
}
