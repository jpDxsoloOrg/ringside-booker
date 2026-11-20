#!/usr/bin/env node
// Renders the app icon (POL9-10) from game/branding/app-icon.svg (48 px and up) and
// app-icon-small.svg (16-32 px) to PNGs, then packs the Windows .ico with ImageMagick.
//
//   node game/tools/icon/build-app-icon.mjs [<node_modules folder that has playwright>]
//
// Outputs:
//   game/branding/app-icon-<size>.png   16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512, 1024
//   game/branding/app-icon.ico          16, 20, 24, 32, 40, 48, 64, 96, 128, 256 (exe, installer, shortcuts)
//   game/Assets/UI/AppIcon/AppIcon-<size>.png  the sizes Unity's Windows player icon list asks for
//
// Needs Playwright's Chromium (npx playwright install chromium) and ImageMagick's `convert`.
// The SVGs use Barlow Condensed ExtraBold; the page loads it from game/Assets/UI/Fonts.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const gameDir = resolve(here, '..', '..');
const branding = join(gameDir, 'branding');
const unityIcons = join(gameDir, 'Assets', 'UI', 'AppIcon');
const modules = resolve(process.argv[2] ?? join(gameDir, '..', 'node_modules'));
const require = createRequire(join(modules, 'noop.js'));
const { chromium } = require('playwright');

const SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512, 1024];
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
const UNITY_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024];
const SMALL_MAX = 32;

// A data URL: a page set with setContent may not load file:// fonts.
const font = `data:font/ttf;base64,${readFileSync(join(gameDir, 'Assets', 'UI', 'Fonts', 'BarlowCondensed-ExtraBold.ttf')).toString('base64')}`;
const svgs = {
  large: readFileSync(join(branding, 'app-icon.svg'), 'utf8'),
  small: readFileSync(join(branding, 'app-icon-small.svg'), 'utf8'),
};

function page(svg, size) {
  const sized = svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
  return `<!doctype html><html><head><style>
@font-face { font-family: 'Barlow Condensed'; font-weight: 800; src: url('${font}'); }
html, body { margin: 0; padding: 0; background: transparent; }
svg { display: block; }
</style></head><body>${sized}</body></html>`;
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ deviceScaleFactor: 1 });
  const tab = await context.newPage();
  for (const size of SIZES) {
    await tab.setViewportSize({ width: size, height: size });
    await tab.setContent(page(size <= SMALL_MAX ? svgs.small : svgs.large, size));
    await tab.evaluate(async () => {
      await document.fonts.load("800 20px 'Barlow Condensed'");
      await document.fonts.ready;
    });
    const loaded = await tab.evaluate(() => document.fonts.check("800 20px 'Barlow Condensed'"));
    if (!loaded) throw new Error('Barlow Condensed did not load');
    const out = join(branding, `app-icon-${size}.png`);
    await tab.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    console.log(`wrote ${out}`);
  }
} finally {
  await browser.close();
}

execFileSync('convert', [...ICO_SIZES.map((size) => join(branding, `app-icon-${size}.png`)), join(branding, 'app-icon.ico')]);
console.log(`wrote ${join(branding, 'app-icon.ico')}`);

mkdirSync(unityIcons, { recursive: true });
for (const size of UNITY_SIZES) {
  copyFileSync(join(branding, `app-icon-${size}.png`), join(unityIcons, `AppIcon-${size}.png`));
}
console.log(`copied ${UNITY_SIZES.length} sizes to ${unityIcons}`);
