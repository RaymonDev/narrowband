# g2-kit hardware timings

Input to the Phase 0 transport fit (`npm run calibrate`, see `docs/phase0-pipeline.md`).

- **Timings**: median and p95 `updateImageRawData` round trips measured by
  [g2-kit](https://github.com/RAZKOM/g2-kit) on G2 glasses with an iPhone, 30 sends per case,
  2026-09-30. Copied from its `STATUS.md`, sections H1b and H1c.
- **Tiles**: g2-kit's `examples/hub-bench/frame.ts` re-rendered at commit `02f22707`.
  `bench.json` holds, per case and frame, the LZ4 size of the packed Gray4 tile (both liblz4 table
  variants), the LZ4 size of Gray8, the PNG bytes g2-kit handed to the SDK, and the lit-pixel count.
  The re-rendered PNG byte counts match g2-kit's reported "bytes sent" exactly.
  `tiles/` has frame 15 of each case. `render.ts` regenerates everything from a g2-kit checkout.

g2-kit is MIT licensed (`LICENSE.g2-kit`).
