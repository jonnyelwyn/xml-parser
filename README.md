# XML Parser

A free, offline desktop app for post-production turnovers. Parses Premiere Pro XMEML files and generates CSV reports and DaVinci Resolve EDL marker files — everything an artist needs to conform a project.

100% local. No account, no internet, no data leaves your machine.

---

## What it does

Drop in an XML file exported from Premiere Pro and get back 9 files:

**CSV Reports**
- `_master_shot_list.csv` — every clip on the timeline with Shot #, timecodes, track, speed, scale, rotation, position, keyframes
- `_transforms.csv` — clips with non-default transforms (scale / rotation / position / keyframes)
- `_speed_changes.csv` — clips with speed changes (slow motion, fast motion, reverse)
- `_effects_inventory.csv` — applied effects per clip (Lumetri excluded)

**DaVinci Resolve EDL Markers** (import via Timelines → Import → Markers from EDL)
- `_markers_transforms.edl` — Red / Yellow
- `_markers_speed.edl` — Cyan
- `_markers_crops.edl` — Green
- `_markers_effects.edl` — Blue
- `_markers_combined.edl` — all categories, colour-coded

Each marker note contains a Shot # (e.g. `#42: Scale 115% Pos 1893,941`) that cross-references the master shot list CSV. Artists can scrub through the timeline and look up any flagged clip instantly.

---

## How to export from Premiere Pro

**File → Export → Final Cut Pro XML**

This generates an XMEML file. Drop that into XML Parser.

---

## Prerequisites

- [Node.js](https://nodejs.org) 18+
- [Rust](https://rustup.rs) (stable)

---

## Build from source

```bash
git clone https://github.com/YOUR_USERNAME/xml-parser
cd xml-parser
npm install
npm run build
```

The built `.app` and `.dmg` appear at:
```
src-tauri/target/release/bundle/macos/XML Parser.app
src-tauri/target/release/bundle/dmg/XML Parser_1.0.0_aarch64.dmg
```

---

## Development

Run the Next.js frontend in a browser (file system access unavailable outside Tauri):

```bash
npm run dev
```

---

## Project structure

```
src/
  app/page.tsx              ← Main UI
  lib/parser/
    xmeml-parser.ts         ← XMEML parser
    csv-exporter.ts         ← CSV generation
    edl-exporter.ts         ← Resolve EDL marker generation
    types.ts                ← ClipData, EffectData types
    utils.ts                ← Shared helpers

src-tauri/
  src/main.rs               ← Tauri shell (minimal)
  tauri.conf.json           ← App config
  Cargo.toml                ← Rust dependencies
```

---

## EDL marker format

Markers use Resolve's `|C:ResolveColor* |M: |D:` pipe syntax — the only format Resolve's "Import Markers from EDL" actually parses. The `* LOC:` format is Avid-only and ignored by Resolve.

```
001  001      V     C        00:03:39:04 00:03:39:05 00:03:39:04 00:03:39:05
 #15: 75% Slow |C:ResolveColorCyan |M:Speed |D:1
```

---

## Built with

- [Tauri v2](https://tauri.app) — Rust desktop shell
- [Next.js 16](https://nextjs.org) — UI (static export)
- [fast-xml-parser](https://github.com/NaturalIntelligence/fast-xml-parser) — XMEML parsing
- [Tailwind CSS](https://tailwindcss.com)
