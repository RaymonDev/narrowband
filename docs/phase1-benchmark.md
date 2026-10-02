# Phase 1: offline benchmark

**Verdict: no-go.** Against what plugins get today (sending 8-bit pixels and letting the host quantize),
no dither method or level count saves more than **~1 % of bytes at equal quality**, on any content type,
under any of four quality metrics. The README's bar was ≥ 20 % on at least two types.

The levers *do* matter for developers who already dither. Against Floyd–Steinberg, Bayer 2×2 saves
17–41 % on UI, chart and game content at Floyd–Steinberg's quality. But plain quantization is already the
better default, and the host already does it.

Full tables: [`results/phase1/report.md`](../results/phase1/report.md). Reproduce with
`npm run bench && npm run bench:report && npm run figures` (~30 s).

## Setup

**Corpus** ([`corpus/`](../corpus), built by [`bench/corpus.ts`](../bench/corpus.ts)): 7 content types ×
5 full-screen 576×288 8-bit grey images.

| Type | Images | Source |
|---|---|---|
| ui | dashboard, notifications, settings, music player, navigation | synthetic, HUD style (dark background, anti-aliased) |
| chart | two-series line, gradient area, bars, sparklines, candlesticks | synthetic |
| text | sans 18 px, serif 22 px, monospace code, bullets, 34 px teleprompter | synthetic; prose from *Alice in Wonderland* (public domain) |
| line-art | flowchart, spirograph, gear drawing, icon grid, floor plan | synthetic |
| game | pixel-art platformer, raycaster, space shooter, falling blocks, RPG overworld | synthetic |
| photo | kodim01, 03, 05, 14, 23 | Kodak Lossless True Color Image Suite |
| map | Barcelona, Paris, Tokyo, New York, Amsterdam at z16 | OpenStreetMap tiles, greyscale, inverted for a dark HUD (© OpenStreetMap contributors) |

**Strategies** ([`src/dither.ts`](../src/dither.ts)): plain quantization (`none`), Floyd–Steinberg,
Atkinson, Bayer 2×2 / 4×4 / 8×8 ordered, and void-and-cluster blue noise
([`src/bluenoise.ts`](../src/bluenoise.ts)). Each runs at **16, 12, 8, 6, 4, 3 and 2 levels**, evenly
spread over 0–15. `none` at 16 levels is exactly the host's conversion: the **baseline**.

**Rate** ([`bench/run.ts`](../bench/run.ts)): the frame is split into the four 288×144 containers that
tile the screen. Each container is packed as Gray4 (Phase 0 layout) and compressed with `LZ4_compress_default`,
one block per container. The sum is reported, along with time estimates from the Phase 0 G2 fit and at
nominal 10 / 20 / 30 KB/s.

**Distortion** ([`src/metrics.ts`](../src/metrics.ts)), each against the 8-bit source:
MS-SSIM (primary), SSIM, SSIM after a σ = 1 px Gaussian blur (a crude eye model that forgives fine
dither texture), and PSNR. SSIM matches scikit-image to 1e-14.

**Bytes at equal quality** ([`bench/report.ts`](../bench/report.ts)): each method is a curve through its
level counts. For each image, the method's bytes at the baseline's quality are read off that curve: the
cheapest point at least as good, or log-linear interpolation between neighbouring level counts. A method
that cannot reach the baseline's quality is scored as 0 % (you would just send the baseline).

## Results

### Today's cost

| Content | LZ4 bytes / frame | Compression vs. packed Gray4 | Est. G2 time / frame |
|---|--:|--:|--:|
| ui | 7 968 | 10.4× | 2.0 s |
| chart | 6 197 | 13.4× | 1.7 s |
| text | 13 188 | 6.3× | 2.8 s |
| line-art | 16 409 | 5.1× | 3.4 s |
| game | 13 970 | 5.9× | 3.0 s |
| photo | 57 436 | 1.4× | 10.0 s* |
| map | 57 663 | 1.4× | 10.0 s* |

\* Extrapolated beyond the fitted range (Phase 0 caveat). About 0.7 s of each frame is fixed per-send cost.

### What dithering costs

At 16 levels, relative to the baseline (per-image mean): Floyd–Steinberg **+14 % to +336 %**, blue noise
+19 % to +241 %, Atkinson +5 % to +217 %, Bayer 8×8 +9 % to +56 %, Bayer 4×4 +8 % to +41 %, **Bayer 2×2
+5 % to +28 %**. The README's hypothesis holds: error diffusion and blue noise produce texture LZ4 can't
compress. Among ordered dithers, the shortest period wins. Bayer 2×2 repeats every 2 pixels, which is
exactly one packed byte, so LZ4 finds 4-byte matches everywhere (lever 3, byte alignment, in action).

### Bytes at equal quality

![Bytes vs. quality per content type](img/rd-curves.svg)

| Content | Best method (MS-SSIM) | Saving | Best per image | Best under blurred SSIM |
|---|---|--:|--:|--:|
| ui | plain | 0 % | 0 % | 0.8 % (Bayer 4×4) |
| chart | Bayer 2×2 | 0.8 % | 0.8 % | 2.1 % (Bayer 4×4) |
| text | plain | 0 % | 0 % | 0.6 % (Bayer 2×2) |
| line-art | Bayer 2×2 | 1.2 % | 1.2 % | 0.6 % (Floyd–Steinberg) |
| game | Floyd–Steinberg | 1.2 % | 1.2 % | 2.5 % (Floyd–Steinberg) |
| photo | plain | 0 % | 0 % | 6.7 % (Bayer 2×2), 11.3 % best per image |
| map | plain | 0 % | 0 % | 4.0 % (Bayer 2×2) |

SSIM and PSNR give 0 % everywhere. The ranking is unchanged under liblz4's streaming (u32) table.

**Why.** Plain quantization at 16 levels is both the most faithful 16-level image under these metrics
and the one with the least texture, so LZ4 compresses it best. Dithering buys back quality (MS-SSIM rises
at the same level count) but spends bytes on texture. Dropping levels saves bytes but loses quality faster
than any dither restores it. Along every curve the two effects roughly cancel, so no curve passes
meaningfully above-left of today's point.

### Versus a developer who already dithers

With Floyd–Steinberg at 16 levels as the baseline instead, Bayer 2×2 matches its MS-SSIM with **17 % (ui),
25 % (chart), 41 % (game)** fewer bytes, and 10 % on maps. It reaches that quality on 3 of 5 images for
ui, chart and game, and 4 of 5 for maps. Practical advice, not a library: if you dither for the G2, use
Bayer 2×2, not error diffusion.

### Side experiment: folding the invisible levels

The simulator draws levels 9–15 identically, and g2-kit reports the same shape by eye on G2. Replacing
every level above 9 with 9 changes nothing on the simulator's display and saves **0.2–8.7 %** (photos
8.7 %, UI 7.0 %). It is real but small, and it rests on a panel curve that needs photometric confirmation
on hardware.

## Go / no-go

| Metric | Types with ≥ 20 % saving | Verdict |
|---|---|---|
| MS-SSIM (primary) | none | no-go |
| SSIM | none | no-go |
| SSIM, σ = 1 px blur | none | no-go |
| PSNR | none | no-go |

Per the plan, this phase ends with the negative result written up. The equal-quality encoder of Phase 2
(per-region choice of dither and levels under a quality floor) has little to choose from: picking the best
method *per image* already gains ≤ 1.2 % under the primary metric.

## What the data says about where time goes

- **Fixed cost per send** (~177 ms, 0.7 s per four-container frame) is 21–41 % of a frame for UI, chart,
  text, line-art and game content. Sending fewer or smaller containers, and
  only changed ones, is the larger lever for HUD content. [Glyph](https://github.com/gabrielevierti/glyph)
  and [g2-kit](https://github.com/RAZKOM/g2-kit) already do this.
- **Photos and maps** are where bytes dominate (~57 KB, ~10 s per full frame by extrapolation). Equal
  quality is not available cheaper. Speed there can only come from trading quality, for example a byte
  budget. For scale, on photos: Bayer 2×2 at 8 levels gives −16 % bytes at MS-SSIM 0.952 (vs. 0.980), and
  plain quantization at 12 levels gives a similar trade (−12 % at 0.954). That is a different product
  claim ("faster at a visible cost") and would need its own success criterion.

## Limits of this benchmark

- Quality is measured against the 8-bit source on a linear grey scale. The real panel's curve is unknown
  (Phase 4), and the blurred SSIM is only a crude viewing model.
- The corpus is synthetic for five of seven types. Real plugin screens may have more or less texture.
- LZ4 is modelled, not observed (Phase 0 timing fit supports it).
- Times for photo/map frames extrapolate the transport fit.
