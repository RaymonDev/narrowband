# narrowband: original plan

This was the project README before Phases 0 and 1 ran (moved here on 2026-10-02). Results:
[Phase 0](phase0-pipeline.md) (pipeline model, done) and [Phase 1](phase1-benchmark.md) (benchmark,
**no-go**: no strategy saves more than ~1 % of bytes at equal quality).

## The problem

Every pixel an Even Hub plugin draws as an image travels from the phone to the
glasses over Bluetooth LE, and that link is narrow:

- Even's own FAQ puts image bandwidth at roughly **10–30 KB/s**.
- An image container is at most **288 × 144 px**, 4-bit greyscale, with up to
  **4 image containers per page**.
- Back-of-the-envelope: one container is ~20.7 KB raw, a full 576 × 288 screen
  is ~83 KB, i.e. **roughly 3–8 seconds per full frame** before compression.
- Since SDK `0.0.12`, image payloads are LZ4-compressed in transit. Even chose
  LZ4 for its tiny memory footprint on the glasses, **not for compression ratio**.

So maps, charts, photos, games and anything animated feel slow, and community
developers have gone as far as custom firmware to work around it.

## The idea

We can't change the decoder: LZ4 lives in the firmware. But we fully control
what goes *into* it.

This is a source-coding problem: **get the best perceived quality per byte
*after LZ4*.** LZ4 only wins on repeated byte sequences, so the encoder should
produce images that are both good-looking and repetitive at the byte level.

Levers, roughly in order of expected impact:

1. **Dithering choice.** Error-diffusion dithering (e.g. Floyd–Steinberg) looks
   great but produces high-entropy noise that LZ4 can't compress. Ordered,
   blue-noise or run-aware dithering may compress far better at similar quality.
2. **Adaptive level reduction.** Not every image needs all 16 grey levels.
   Fewer levels means longer runs.
3. **Byte-aligned structure.** With packed 4-bit pixels, two pixels share a byte.
   Patterns that repeat on byte boundaries compress better than ones that don't.
4. **Send only what changed.** A full screen is exactly 4 containers. Diff
   frames and resend only containers that changed.
5. **Progressive refinement.** Send a cheap coarse frame first, refine later.

## What we know about the pipeline (and what we don't)

From the docs and the published SDK package (`@evenrealities/even_hub_sdk@0.0.16`):

- The plugin calls `updateImageRawData()` with greyscale bytes. The host app
  converts to 4-bit (`imageToGray4Failed` is a possible result), so **LZ4 most
  likely runs in the native host app**, not in the plugin's JavaScript.
- The simulator (`0.9.2+`) accepts raw Gray8, packed Gray4 and encoded images,
  and (`0.9.3+`) matches the glasses' greyscale conversion.
- The simulator **does not decompress LZ4**, so the compressed path can only be
  validated on real hardware.
- Image sends are paced at 100 ms minimum; a frame takes much longer than that.

Open questions Phase 0 has to answer:

- Does the host apply its own dithering when converting to Gray4, or just
  quantize? If it dithers, pre-quantized input must survive it unchanged.
- Does packed Gray4 input skip the conversion entirely? What's the nibble order?
- Which LZ4 variant/settings run on the host? (Assume standard LZ4 block format
  until proven otherwise; relative rankings between strategies should hold.)

All three are answered in [phase0-pipeline.md](phase0-pipeline.md): no dithering; packed Gray4 is
used as is, high nibble first, rows padded; the LZ4 variant is inferred, not observed.

---

## Plan

### Phase 0: Pin down the pipeline · done

- Send test patterns (grey ramps, checkerboards, single-level fields) through the
  simulator in Gray8 and packed Gray4, and screenshot the result.
- Infer the host's Gray4 mapping and whether it dithers.
- **Exit:** a documented model of "bytes in → pixels out" we can simulate offline.

### Phase 1: Offline benchmark · done, no-go

- **Corpus:** UI screens, map tiles, line charts, photos, line art, text rendered
  as images, game frames.
- **Strategies:** plain quantization, Floyd–Steinberg, Atkinson, Bayer ordered,
  blue noise, 16/8/4/2-level variants.
- **Metrics:** LZ4 bytes, estimated transfer time at 10/20/30 KB/s, SSIM / MS-SSIM
  against the source.
- **Go / no-go:** if the best strategy saves **less than ~20% of bytes at equal
  quality** on at least two content types, stop and write up the negative result.
  Otherwise continue.

### Phase 2: LZ4-aware encoder

- Rate–distortion optimisation: per region, pick the quantisation and dither that
  minimise bytes under a quality floor (or maximise quality under a byte budget).
- Frame differencing across the 4 containers.
- Progressive refinement mode.
- Stretch: a small learned model that predicts the best per-tile settings, to
  replace brute-force search.

### Phase 3: Library and demos

- npm package `narrowband` with a small API, roughly:
  - `encode(pixels, { width, height, quality | byteBudget })` → payload bytes
  - `sendFrame(bridge, frame)` → handles container split, diffing, pacing
- Simulator demos: map viewer, live chart, photo viewer, simple animation.
- Public benchmark tables, reproducible with one command.

### Phase 4: Hardware validation (needs an Even G2)

- Measure real per-frame latency against the offline predictions.
- Validate the LZ4 path end to end (impossible in the simulator).
- Check legibility of reduced grey levels on the real micro-LED display.
- Measure battery impact of image-heavy apps before and after.

> I don't have G2 hardware yet, so this phase is blocked. Everything before it
> runs on the simulator and offline.

### Phase 5: Write-up (optional)

A short paper on rate–distortion-optimised image transport for low-bandwidth HUD
glasses, with the benchmark as the artifact.

---

## Non-goals

- No firmware modifications and no reverse-engineered Bluetooth protocol. Only the
  public Even Hub SDK, so plugins using `narrowband` pass Even Hub review.
- Not a UI framework. It does one job: get pixels to the glasses in fewer bytes.
