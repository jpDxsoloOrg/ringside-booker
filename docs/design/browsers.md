# Supported browsers

The game is browser-first (desktop) with a secondary phone view. It supports:

| Browser                                                                                                            | From          | Why this version                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Safari on iPhone and iPad (and every iOS browser: Chrome, Firefox and Edge on iOS all run Safari's engine, WebKit) | iOS 15.4      | Every iPhone that runs iOS 15 can update to 15.4 or later; 15.4 brought `:has()`, `dvh`, `Array.prototype.at`, `Object.hasOwn`, `structuredClone` and `crypto.randomUUID`, which the app uses |
| Safari on macOS                                                                                                    | 15.4          | Same engine as above                                                                                                                                                                          |
| Chrome, Edge (desktop and Android)                                                                                 | 111           | About two years back; covers everything the bundle uses                                                                                                                                       |
| Firefox                                                                                                            | 115 (the ESR) | About two years back                                                                                                                                                                          |

The list lives in `apps/web/vite.config.ts` (`browserTargets`), which Vite passes to esbuild as
`build.target` and `build.cssTarget`, so JavaScript syntax and the CSS esbuild knows how to rewrite
are lowered for these browsers.

## What the build lowers, and what it cannot

- **Range media queries** (`@media (width < 48rem)`): iOS Safari reads them only from 16.4, so on
  older iPhones every phone rule was ignored and the desktop layout rendered squeezed (UI-30).
  esbuild does not rewrite media queries, so `@csstools/postcss-media-minmax` in
  `apps/web/postcss.config.js` lowers them to `min-width` / `max-width`. The breakpoints themselves
  are written that way too, because `breakpoints.ts` hands the same text to `matchMedia`. The
  phone e2e check fails if a range media query reaches the built CSS.
- **Container queries and container units** (`@container`, `cqi`), Safari 16.0: used for narrow
  desktop windows in the top bar, where an older Safari just keeps every item. Where a phone depends
  on one there is a fallback: the Match lab result stacks its numbers under `@supports not
(container-type: inline-size)`, and the champion swipe row sizes cards in `vw` first.
- **The `lh` unit**, Safari 16.4: the day control's date has a `calc(line-height * 1em)` fallback.
- **`overscroll-behavior`** (Safari 16) and **`text-wrap: balance`** (Safari 17.5): progressive;
  older browsers simply scroll-chain or wrap normally.
- **`CompressionStream` / `DecompressionStream`**, Safari 16.4: saves are gzip. Where the streams are
  missing the engine uses fflate (`packages/engine/src/persistence/gzip.ts`); both write standard
  gzip and read each other's files.
- **Regex lookbehind** (Safari 16.4) cannot be lowered. Neither the app nor its dependencies use it
  today; check the built bundle for `(?<=` / `(?<!` before adding one.

## Phone rules

- Every screen fits a 360px-wide phone with no sideways page scroll. Wide tables scroll inside their
  own box or turn into cards.
- Text fields are at least 16px on touch screens (`global.css`). iOS Safari zooms the page in when
  a smaller field takes focus and keeps the zoom across screens, so the player has to pinch back
  out. Never fix this with `maximum-scale=1` or `user-scalable=no`: that takes zoom away from
  people who need it.
- On touch screens a sheet or popover does not put focus in a text field when it opens
  (`firstOpenFocusIn`), so the keyboard only comes up when the player taps the field.
- Tap targets are at least 44px (`--tap-target-min`). One-line text links and chips get the room
  from hidden padding (`--tap-pad-block`) with a matching negative margin, so lists keep their
  spacing.

`e2e/phone-played.spec.ts` checks all of this at 390px and 360px with a played save
(`e2e/fixtures/build-played-save.ts`: a default-world game three weeks in), on Chromium and WebKit.

## Running WebKit locally

`npx playwright install --with-deps webkit` installs WebKit and the system libraries it needs; the
libraries need root:

```sh
sudo npx playwright install-deps webkit
```

Then `E2E_WEBKIT=1 npm run e2e -w @ringside/web -- --project=phone-webkit`.

Without root (WSL, a shared machine), unpack the libraries into a user folder and start WebKit
through a wrapper script. On Ubuntu 22.04:

```sh
mkdir -p ~/webkit-libs/debs && cd ~/webkit-libs/debs
apt-get download libgtk-4-1 libgraphene-1.0-0 libxslt1.1 libevent-2.1-7 libopus0 \
  libgstreamer1.0-0 libgstreamer-plugins-bad1.0-0 libavif13 libharfbuzz-icu0 libmanette-0.2-0 \
  libenchant-2-2 libsecret-1-0 libhyphen0 libgles2 libglvnd0 libx264-163 \
  libcairo-script-interpreter2 libevdev2 libgav1-0 libgudev-1.0-0 liborc-0.4-0 libyuv0 \
  libabsl20210324 libgstreamer-plugins-base1.0-0 libgstreamer-gl1.0-0
for deb in *.deb; do dpkg -x "$deb" ~/webkit-libs/root; done
ln -sf libx264.so.163 ~/webkit-libs/root/usr/lib/x86_64-linux-gnu/libx264.so
```

(If `apt-get download` 404s on a package, the local package lists are stale: fetch the newer
`.deb` from the Ubuntu archive by hand.) The wrapper repeats what Playwright's own `MiniBrowser`
script does, with the extra library folder on the path:

```sh
#!/bin/sh
MYDIR="$HOME/.cache/ms-playwright/webkit-<build>/minibrowser-wpe"
export WEBKIT_EXEC_PATH="$MYDIR/bin" WEBKIT_INJECTED_BUNDLE_PATH="$MYDIR/lib"
export WEBKIT_INSPECTOR_RESOURCES_PATH="$MYDIR/share" WEBKIT_FORCE_COMPLEX_TEXT=1
export LD_LIBRARY_PATH="$MYDIR/lib:$MYDIR/sys/lib:$HOME/webkit-libs/root/usr/lib/x86_64-linux-gnu"
exec "$MYDIR/bin/MiniBrowser" "$@"
```

Run the phone projects with it:

```sh
E2E_WEBKIT=1 E2E_WEBKIT_EXECUTABLE=~/webkit-libs/run-webkit.sh \
  PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1 \
  npm run e2e -w @ringside/web -- --project=phone --project=phone-webkit
```

Playwright's WebKit is a current WebKit, so it shows how the layout behaves in Safari's engine but
not what an older iOS ignores. For that, the build checks above (no range media queries in the
built CSS) are the guard.
