using System;
using System.Collections.Generic;
using System.IO;
using UnityEngine;

namespace RingsideBooker.Import.Pictures
{
    /// <summary>
    /// Turns a person's, promotion's, title's or venue's picture reference into a texture, reading
    /// the file in place from the workshop world mod's picture folder the first time it is shown
    /// (nothing is copied, and there is no size budget). A missing, unreadable or undecodable file,
    /// a reference that is not a world mod one, and every picture of a roster-only import get the
    /// placeholder. Textures are cached per reference until <see cref="Clear"/> or <see cref="Dispose"/>.
    /// Use on the main thread (it creates textures).
    /// </summary>
    public sealed class PictureProvider : IDisposable
    {
        private readonly string pictureFolder;
        private readonly Dictionary<string, Texture2D> cache = new Dictionary<string, Texture2D>(StringComparer.Ordinal);
        private Texture2D placeholder;

        /// <param name="pictureFolder">The mod's picture folder (<see cref="WorkshopMod.PictureFolder"/>), or null.</param>
        /// <param name="rosterOnly">True for a roster-only import: never read any picture.</param>
        public PictureProvider(string pictureFolder, bool rosterOnly)
        {
            this.pictureFolder = pictureFolder == null ? null : Path.GetFullPath(pictureFolder);
            RosterOnly = rosterOnly;
        }

        public bool RosterOnly { get; }

        /// <summary>How many files have been read from disk so far.</summary>
        public int FilesRead { get; private set; }

        /// <summary>The texture shown when there is no picture: a plain grey square.</summary>
        public Texture2D Placeholder
        {
            get
            {
                if (placeholder == null)
                {
                    placeholder = new Texture2D(2, 2, TextureFormat.RGBA32, false) { name = "picture-placeholder" };
                    var grey = new Color32(96, 100, 108, 255);
                    placeholder.SetPixels32(new[] { grey, grey, grey, grey });
                    placeholder.Apply(false, true);
                }

                return placeholder;
            }
        }

        /// <summary>The full file path a reference points at, or null when it cannot point inside the picture folder.</summary>
        public string PathFor(string imageRef)
        {
            if (pictureFolder == null)
            {
                return null;
            }

            var relative = PictureRef.Decode(imageRef);
            if (relative == null)
            {
                return null;
            }

            var full = Path.GetFullPath(Path.Combine(pictureFolder, relative.Replace('/', Path.DirectorySeparatorChar)));
            var root = pictureFolder.EndsWith(Path.DirectorySeparatorChar.ToString(), StringComparison.Ordinal)
                ? pictureFolder
                : pictureFolder + Path.DirectorySeparatorChar;
            return full.StartsWith(root, StringComparison.OrdinalIgnoreCase) ? full : null;
        }

        /// <summary>True when the reference has a real picture on disk (always false for roster-only).</summary>
        public bool HasPicture(string imageRef)
        {
            if (RosterOnly || string.IsNullOrEmpty(imageRef))
            {
                return false;
            }

            var path = PathFor(imageRef);
            return path != null && File.Exists(path);
        }

        /// <summary>The picture for a reference, or the placeholder.</summary>
        public Texture2D Get(string imageRef)
        {
            if (RosterOnly || string.IsNullOrEmpty(imageRef))
            {
                return Placeholder;
            }

            if (cache.TryGetValue(imageRef, out var cached))
            {
                return cached != null ? cached : Placeholder;
            }

            var texture = Load(imageRef);
            cache[imageRef] = texture;
            return texture != null ? texture : Placeholder;
        }

        private Texture2D Load(string imageRef)
        {
            var path = PathFor(imageRef);
            if (path == null || !File.Exists(path))
            {
                return null;
            }

            byte[] bytes;
            try
            {
                bytes = File.ReadAllBytes(path);
            }
            catch (IOException)
            {
                return null;
            }
            catch (UnauthorizedAccessException)
            {
                return null;
            }

            FilesRead++;
            var texture = new Texture2D(2, 2, TextureFormat.RGBA32, false) { name = imageRef };
            if (!texture.LoadImage(bytes, true))
            {
                DestroyTexture(texture);
                return null;
            }

            return texture;
        }

        /// <summary>Frees every cached texture.</summary>
        public void Clear()
        {
            foreach (var texture in cache.Values)
            {
                if (texture != null)
                {
                    DestroyTexture(texture);
                }
            }

            cache.Clear();
        }

        public void Dispose()
        {
            Clear();
            if (placeholder != null)
            {
                DestroyTexture(placeholder);
                placeholder = null;
            }
        }

        private static void DestroyTexture(Texture2D texture)
        {
            if (Application.isPlaying)
            {
                UnityEngine.Object.Destroy(texture);
            }
            else
            {
                UnityEngine.Object.DestroyImmediate(texture);
            }
        }
    }
}
