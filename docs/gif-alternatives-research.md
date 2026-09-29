# GIF Alternatives for Documentation and Technical Content

Research into modern formats and tools that replace animated GIFs in documentation, READMEs, technical blogs, and developer tools.

> Compiled: 2026-09-29. Browser-support data verified against [caniuse.com](https://caniuse.com) (usage stats: StatCounter, August 2026). Tool data verified against official project pages where linked. Items marked *(from general knowledge — verify before pinning versions)* are widely established but were not re-verified against a primary source during this pass.

---

## Table of Contents

1. [TL;DR Recommendations](#tldr-recommendations)
2. [Direct Format Alternatives](#1-direct-format-alternatives)
3. [Tools to Create / Convert](#2-tools-to-create--convert)
4. [Configuration & Integration](#3-configuration--integration)
5. [Local vs Cloud](#4-local-vs-cloud)
6. [Costs](#5-costs)
7. [Benchmarks & Comparisons](#6-benchmarks--comparisons)
8. [Gotchas](#7-gotchas)
9. [Sources](#8-sources)

---

## TL;DR Recommendations

| Use case | Recommended solution | Why |
|---|---|---|
| UI/screen demo in docs site or blog | **MP4 (H.264) via `<video>`**, WebM/AV1 as enhancement | ~96–97% browser support, 10–30× smaller than GIF, hardware-decoded |
| GitHub/GitLab README | **MP4 dragged into the PR/issue composer** (GitHub converts to a playable attachment) or plain GIF | Markdown on GitHub renders `<video>` only for user-uploaded attachments, not arbitrary URLs |
| Terminal demo in README | **asciinema SVG preview link** or **VHS-generated GIF/WebP** | Text stays crisp, copy-pasteable, tiny file size |
| Terminal demo in docs site (HTML allowed) | **asciinema embedded player** (self-hosted if you must avoid third-party JS) | Fully text-based: selectable, copy-pasteable, accessible |
| Still/looping image animation | **Animated WebP** today, **animated AVIF** for the bleeding edge | ~60–90% smaller than GIF at equal quality |
| Lossless animation with alpha | **APNG** | 24-bit color + alpha, near-universal support, but large files |
| Programmatically generating images/videos in CI | **ffmpeg + libvips/Sharp/ImageMagick** | Scriptable, free, deterministic |

The single most impactful change for most docs: **stop encoding GIFs at all**. Record once, ship H.264 MP4 (and optionally WebM) through a `<video muted loop playsinline>` element; keep a GIF only for Markdown-only contexts where nothing else renders.

---

## 1. Direct Format Alternatives

### 1.1 Video formats (used with `<video>` element)

#### MP4 / H.264 (AVC)

| Property | Value |
|---|---|
| Purpose | Universal "safe baseline" for animated docs content |
| Browser support | **97.26%** global; supported in all evergreen browsers, IE9+ ([caniuse](https://caniuse.com/mpeg4)) |
| Size vs GIF | Typically **10–30× smaller** at comparable visual quality for screen content *(from general knowledge — verify per asset)* |
| Playback | Hardware-decoded on virtually every GPU; near-zero CPU/battery cost vs GIF decoding |
| Licensing | **Not royalty-free.** H.264 patent pool licensing is handled by MPEG LA (now Via LA); distribution of *encoded content by end users* is free under the AVC license, but encoder vendors pay. Fine for docs hosting; relevant if you ship an encoder. |
| Workflow | `ffmpeg -i input.mov -c:v libx264 -pix_fmt yuv420p -movflags +faststart -an output.mp4` |
| Docs integration | `<video>`, GitHub attachment upload, nearly every docs framework |

Key flags explained:

- `-pix_fmt yuv420p` — required for hardware decode + old devices (GIF sources are often RGB444 and will not play on iOS Safari without this).
- `-movflags +faststart` — moves the `moov` atom to the front so playback starts before the whole file downloads. **Do this for docs assets**; users on slow connections otherwise see a black box.
- `-an` — drop audio; docs animations are almost always silent, and muted videos can autoplay everywhere.

#### WebM (VP9 / VP8)

| Property | Value |
|---|---|
| Purpose | Royalty-free video; the classic "GIF replacement" of the 2015-era posts |
| Browser support | **96.91%** global. Chrome 25+, Firefox 28+, Edge 79+, Safari **16.0+** fully (partial 12.1–15.6), iOS Safari 17.4+ fully ([caniuse](https://caniuse.com/webm)) |
| Size vs GIF | VP9 typically **~50% smaller than H.264** at equal quality for many content types *(from general knowledge)* |
| Licensing | Fully royalty-free (Google/Alliance-era, BSD-licensed tooling) |
| Workflow | `ffmpeg -i input.mov -c:v libvpx-vp9 -crf 34 -b:v 0 -an output.webm` (CRF 15–35 typical; lower = better) |
| Docs integration | Serve alongside H.264 in a `<video>` with multiple `<source>` elements; Safari <16 falls back |

#### AV1

| Property | Value |
|---|---|
| Purpose | Best-in-class royalty-free compression; successor to VP9/HEVC |
| Browser support | **95.02%** global. Chrome 70+, Firefox 67+, Edge 121+, Samsung 12+, but Safari/iOS Safari only **partial** (17.0+; hardware decode required on many devices) ([caniuse](https://caniuse.com/av1)) |
| Size vs GIF | Commonly cited **~30% smaller than VP9 / ~50% smaller than H.264** at equal quality for typical content; short screen recordings compress extremely well *(from general knowledge)* |
| Encoding speed | **Slow in software** (`libaom-av1`, `libsvtav1`); SVT-AV1 is fast enough for CI on short clips (seconds-scale for 5–10 s clips on modern CPUs); dav1d (decode) is fast everywhere |
| Licensing | Royalty-free, AOMedia |
| Workflow | `ffmpeg -i input.mov -c:v libsvtav1 -crf 32 -preset 8 -an output.mp4` (AV1 in MP4 container; use `.webm` container for max compat) |
| Verdict | Great where you control playback (docs sites); **don't rely on it as the only source** until Safari support is fully green |

#### HEVC / H.265

| Property | Value |
|---|---|
| Purpose | Successor to H.264; excellent compression, especially with hardware encoders (Apple VideoToolbox) |
| Browser support | **93.53%** "supported+partial", but this is **misleading**: Chrome/Edge/Firefox only play HEVC where the OS provides the codec (macOS 10.13+, Windows with HEVC extension) ([caniuse](https://caniuse.com/hevc)) |
| Licensing | **Complex, multi-pool patent licensing** — the main reason browsers don't ship it universally |
| Verdict | **Avoid for docs.** It works on Apple devices and breaks on Linux Chrome/Firefox. Use H.264 + WebM instead. Safari-specific `hvc1` recordings (e.g. from iOS screen record) must be transcoded before publishing. |

#### AVIF video (AV1 in HEIF container)

Animated AVIF is the same bitstream as AV1 video wrapped in an image container, so it can be embedded with `<img>` instead of `<video>`. Codec-wise it is AV1 — see the AV1 support matrix above; the image-side support is tracked at [caniuse/avif](https://caniuse.com/avif) (95.36% static; animated AVIF rides the same decoder). Tooling is thinner than plain AV1 (ffmpeg supports it via `libaom-av1` + `-f avif`, or use `avifenc` from libavif with `--progressive`/animated flags). **Verdict:** promising "image-like video" niche, but animated-AVIF tooling and consistent animated support (esp. older Safari) make it a second-line choice today.

### 1.2 Animated image formats (used with `<img>` — works in Markdown)

#### Animated WebP

| Property | Value |
|---|---|
| Purpose | Direct GIF-in-Markdrop replacement: `<img>`-embeddable, alpha, lossy or lossless |
| Browser support | **96.82%** global; Chrome 32+, Firefox 65+, Edge 18+, Safari 16.0+ (partial 14–15.6), iOS Safari 14+ ([caniuse](https://caniuse.com/webp)) |
| Size vs GIF | Animated WebP is **~25–34% smaller than GIF at equivalent SSIM** per Google's study ([developers.google.com/speed/webp/docs/animated_webp](https://developers.google.com/speed/webp/docs/animated_webp)) |
| Alpha | Yes, with 8-bit alpha (vs GIF's 1-bit) |
| Color | 24-bit (vs GIF's 256-color palette) |
| Workflow | `ffmpeg -i input.gif -loop 0 -an -c:v libwebp -lossless 0 -q:v 60 output.webp` or `img2webp` |
| Verdict | **The best Markdown-friendly GIF replacement today.** Renders anywhere `<img>` works that supports WebP; degrades to a broken image on truly ancient browsers only |

#### APNG

| Property | Value |
|---|---|
| Purpose | Drop-in GIF replacement with 24-bit color + full alpha; a single file that falls back to its first frame where unsupported |
| Browser support | **96.61%** global. Chrome 59+, Edge 79+, Firefox 3+, Safari 8+ ([caniuse](https://caniuse.com/apng)). Not supported in IE or old Edge — where "only the first frame is displayed" |
| Size vs GIF | Usually **1.5–3× larger than GIF** for photographic content; can be smaller than GIF for limited-palette UI/screen content because it delta-encodes frames (only changed pixels are stored) *(from general knowledge)* |
| Alpha | Full 8-bit, no fringing artifacts like GIF |
| Workflow | `ffmpeg -i input.mov -plays 0 out.apng` or the `apngasm`/`apngdis` pair |
| Verdict | Best when you need lossless, alpha-accurate animation that also degrades gracefully (first frame shows). Not a size win |

#### Animated AVIF (image mode)

Covered under [AVIF video](#avif-video-av1-in-heif-container) above — same AV1 payload. Support: Chrome 85+, Firefox 93+, Safari 16.4+ for static; animated-序列 support in Firefox landed later (Firefox 93+ handles sequences; Safari animated support is in the same 16.x window). Where supported it's typically the smallest `<img>`-embeddable animation available — often **~50% smaller than animated WebP** for screen content *(from general knowledge)*.

#### JPEG XL (JXL)

| Property | Value |
|---|---|
| Purpose | Successor to JPEG with animation, alpha, lossless JPEG recompression |
| Browser support | **Effectively unusable on the web today**: 0% baseline, ~14.63% including partially-supported builds. Safari 17+ partial, Firefox 158+ (just shipped), Chrome re-landed experimental in 155+ but **disabled by default** in most current builds ([caniuse](https://caniuse.com/jpegxl), [Phoronix report](https://www.phoronix.com/news/JPEG-XL-Returns-Chrome-Chromium)) |
| Compression | At equal quality typically beats WebP and roughly matches/edges AVIF for stills; animation support exists in the spec |
| Verdict | **Not for docs yet.** Watch it; don't ship it |

### 1.3 Text/vector formats (terminal & diagram animation)

#### asciinema (`.cast` recordings + player)

| Property | Value |
|---|---|
| Purpose | Terminal session recording as **pure text+timing data**, replayed by a JS player — not a video at all |
| File size | Orders of magnitude smaller than any video for terminal content (KBs vs MBs, typically) *(from general knowledge)* |
| Quality | Perfect: text is rendered as text, infinitely crisp, copy-pasteable |
| Player | [asciinema player](https://docs.asciinema.org/manual/player/) (web component/JS) |
| Hosting | [asciinema.org](https://asciinema.org) (free, third-party) or [self-hosted](https://docs.asciinema.org/manual/server/self-hosting/quick-start/) |
| Markdown integration | GitHub READMEs can't run JS, so use the **SVG preview image linking to the recording** — officially documented at [docs.asciinema.org/manual/server/embedding](https://docs.asciinema.org/manual/server/embedding/): |
| Extras | `idle-time-limit` to compress dead time; themes (dracula, nord, solarized…); speed control; oEmbed endpoint |
| CLI GIF export | `agg` — official "asciinema gif generator" ([docs](https://docs.asciinema.org/manual/agg/)) |

Embed snippet (docs sites/blogs):

```html
<script src="https://asciinema.org/a/<ID>.js" id="asciicast-<ID>" async
        data-theme="nord" data-speed="2" data-idle-time-limit="2"></script>
```

README snippet (no JS allowed):

```markdown
[![asciicast](https://asciinema.org/a/<ID>.svg)](https://asciinema.org/a/<ID>)
```

#### VHS (charmbracelet)

| Property | Value |
|---|---|
| Purpose | **Scriptable terminal GIF/video generator** — write a `.tape` file describing keystrokes, VHS renders it headlessly |
| Output | GIF, WebM, MP4, and PNG frames ([github.com/charmbracelet/vhs](https://github.com/charmbracelet/vhs)) |
| Superpower | **CI-friendly & reproducible**: the tape file is version-controlled, so the demo regenerates whenever the CLI changes. `vhs demo.tape > demo.gif` |
| Workflow | Tape file → VHS runs a real headless ttyd + chromium (via `ttyd` + Chrome) → outputs chosen formats |
| Verdict | Best tool for maintaining terminal demos in READMEs long-term — the *source* is diffable text |

Example `.tape`:

```
Output demo.gif
Set FontSize 22
Set Width 1200
Set Height 700
Type "kubectl get pods"
Enter
Sleep 2s
```

#### svg-term / termtosvg / terminalizer

| Tool | What it does | Status *(from general knowledge)* |
|---|---|---|
| [svg-term](https://github.com/marionebl/svg-term-cli) | Converts asciinema casts → self-contained animated SVG (SMIL) | Works in `<img>` tags and READMEs; SVG animation via SMIL is supported in browsers but the project is **unmaintained** |
| [termtosvg](https://github.com/nbedos/termtosvg) | Records terminal directly to animated SVG templates | Python, **no longer maintained** (archived); still functional |
| [terminalizer](https://github.com/faressoft/terminalizer) | Records terminal → GIF/WebM/MP4, with a player | Node-based, feature-rich (themes, watermarks, frames) but slow renders and maintenance has been intermittent |
| [svg-term's niche] | Animated SVG in README is attractive because it's a single static file that GitHub will render | SMIL animation inside `<img>` works in modern browsers, but it is a legacy animation API and file sizes grow linearly with session length |

**Verdict:** asciinema (+ SVG preview for Markdown) or VHS (for actual GIF/video output) cover modern terminal-doc needs; the SVG-recorder tools are legacy.

### 1.4 Code screenshots & diagram animation

| Tool | Purpose | Cost | Notes |
|---|---|---|---|
| [carbon](https://carbon.now.sh) | Beautiful code-screenshot images | Free (open source) | PNG/SVG export; used widely in READMEs. Also `carbon-now-cli` for scripted use |
| [ray.so](https://ray.so) | Code screenshots (Raycast) | Free | PNG export, browser + Raycast extension |
| [Excalidraw](https://excalidraw.com) | Hand-drawn-style diagrams, **exportable animation** (scene → animated sequence via excalidraw-clips) | Free/open source | Excalidraw "clips" can be exported to video for doc embeds; `.excalidraw` files are diffable JSON |
| [tldraw](https://tldraw.com) | Diagramming with video export | Free tier / paid cloud | |
| [Polotno](https://polotno.com) / Polotno Studio | Image/design editor SDK | Freemium | SDK is paid; Studio tool is free |
| [CodeSandbox](https://codesandbox.io)/[StackBlitz](https://stackblitz.com) embeds | Live, runnable embeds instead of animation | Free tiers | Sometimes better than animation entirely |

---

## 2. Tools to Create / Convert

### 2.1 CLI encoders / converters

| Tool | What it does | Platform | Cost | Notes |
|---|---|---|---|---|
| **ffmpeg** | The universal transcoder; GIF→MP4/WebM/AVIF/WebP/APNG and back | CLI, all OS | Free, open source (LGPL/GPL) | `brew install ffmpeg`. The only tool you truly need |
| **gifski** | Highest-quality **GIF** encoder (pngquant palettes + temporal dithering) | CLI + macOS/Windows GUI apps | Open source (AGPL, free for Free Software); [paid commercial license](https://supso.org/projects/pngquant); macOS App Store GUI is paid | Use when a GIF is genuinely required. [gif.ski](https://gif.ski/): *"Or don't use GIF and use a modern video codec like AV1 and the `<video>` element if you can."* |
| **gifsicle** | GIF optimizer/splitter/joiner; lossy compression (`--lossy=80`) | CLI | Free, open source | Great for shrinking existing GIFs you can't replace |
| **ImageMagick** | Swiss-army image tool; animated WebP/APNG/GIF creation | CLI | Free (ImageMagick License) | `magick -delay 10 -loop 0 f*.png out.webp` |
| **Sharp** (Node) | libvips-based image pipeline; animated WebP/GIF support | Node library | Free, Apache-2.0 | Ideal inside docs build pipelines (Docusaurus plugins etc.) |
| **libvips / vipsthumbnail** | Fast low-memory image processing | CLI/lib | Free | What Sharp wraps |
| **cwebp / img2webp** | Official WebP encoders (libwebp) | CLI | Free | `img2webp` builds animations frame-by-frame |
| **avifenc** (libavif) | Official AVIF encoder; animated via `--stdin`/frame lists | CLI | Free | Pairs with ffmpeg for frame extraction |
| **SVT-AV1 / libaom-av1** | AV1 video encoders | CLI (via ffmpeg) | Free, BSD/Apache | SVT-AV1 for speed, aom for max compression |
| **HandBrake** | GUI video transcoder (H.264/H.265/AV1/VP9) | macOS/Win/Linux GUI | Free, GPL | Nice for one-off GUI conversions |
| **imageoptim-cli** | Wraps ImageOptim's optimizers; can convert GIF→MP4 via its [ungif API](https://imageoptim.com/api/ungif) | CLI (macOS-centric) | Free CLI; cloud API has a paid tier | From the gifski author |

### 2.2 Screen recording → docs assets

| Tool | Platform | Output | Cost | Notes |
|---|---|---|---|---|
| **OBS Studio** | All OS | MP4/WebM/MKV, direct RTMP | Free, GPL | The heavyweight; scene system, plugins (`obs-gifskirc` etc.) |
| **Kap** | macOS | GIF/MP4/WebM/APNG | Free, MIT | Beautiful simple recorder, exports many formats |
| **ScreenToGif** | Windows | GIF/MP4/WebM/AVI/APNG | Free, MS-PL | Editor + recorder; best free Windows option |
| **Peek** | Linux | GIF/WebM/MP4 | Free, GPL | Simple area recorder for Linux (GNOME) |
| **Gifox** | macOS | GIF/WebM/MP4/APNG | Freemium (App Store; one-time or subscription for pro) | Polished, quick export |
| **CleanShot X** | macOS | MP4/GIF + rich screenshots | Paid (~$29 one-time via Setapp or direct) | The polish king; cloud sharing costs extra |
| **Shottr** | macOS | Screenshots + basic recording/GIF | Free / cheap pro | Extremely fast, lightweight |
| **macOS built-in** (⌘⇧5) | macOS | MOV (HEVC or H.264) | Free | Then transcode with ffmpeg |
| **`vhs`** | All OS (CLI) | GIF/MP4/WebM | Free | Scripted terminal demos (see 1.3) |
| **asciinema** | All OS (CLI) | `.cast` text | Free | Terminal-only |

### 2.3 Cloud converters

| Service | Free tier | Paid | Notes |
|---|---|---|---|
| [ezgif.com](https://ezgif.com) | Yes (per-file, watermarked at large sizes) | Ad-supported; no real subscription | The classic browser toolbox: GIF→MP4/WebM/APNG/WebP, optimizer, cutter. Fine for one-offs; **not** for CI |
| [CloudConvert](https://cloudconvert.com) | ~25 conversions/day | Subscription / credits from ~$9/mo | Full API, good for automation; supports AVIF, WebP, APNG, video |
| [Convertio](https://convertio.co) | Limited size (100 MB) | Subscription | Similar breadth, less API-friendly |
| [ImageOptim API](https://imageoptim.com/api/ungif) | Trial | Per-image pricing | GIF→video conversion service by the gifski author |

**Verdict:** cloud converters are fine for a one-off conversion, but everything they do can be done locally with ffmpeg for free, deterministically, and without upload privacy concerns. Use cloud only when you need a polished web UI or an API without your own infra.

---

## 3. Configuration & Integration

### 3.1 HTML `<video>` — the workhorse pattern

```html
<video autoplay loop muted playsinline width="800">
  <source src="/demo.webm" type="video/webm">
  <source src="/demo.mp4"  type="video/mp4">
  Your browser doesn't support HTML5 video.
</video>
```

Attribute checklist for GIF-like behavior:

- `autoplay` + `muted` — **both required**; browsers block unmuted autoplay (Chrome, Safari).
- `loop` — GIF-like repetition.
- `playsinline` — prevents iOS Safari from hijacking to fullscreen.
- `preload="metadata"` (default) — don't download the whole file on page load.
- Order matters: put the **more efficient codec first**; browsers pick the first one they support.

Poster image for perceived performance:

```html
<video poster="/demo-poster.webp" ...>
```

### 3.2 `<picture>` for animated images (WebP/AVIF with fallback)

```html
<picture>
  <source srcset="/demo.avif" type="image/avif">
  <source srcset="/demo.webp" type="image/webp">
  <img src="/demo.gif" alt="Demo of the deploy command">
</picture>
```

This gives you smallest-first with a universal fallback — the right pattern for docs sites where you control HTML but want `<img>`-level simplicity.

### 3.3 Markdown (GitHub-flavored)

What GitHub actually renders in READMEs (as of this writing):

| Content | Renders? | Notes |
|---|---|---|
| `![alt](.gif)` | ✅ | Classic GIF, always works |
| `![alt](.webp)` | ✅ | Animated WebP **plays** in README `<img>` rendering |
| `![alt](.apng)` | ✅ | Plays; falls back to first frame on ancient browsers |
| `![alt](.avif)` | ✅ | Renders; animated AVIF behavior has been inconsistent historically — test |
| `<video src="...mp4">` in Markdown | ❌ | Sanitized — GitHub strips raw `<video>` tags with external URLs |
| **MP4 attached via drag-drop into the editor** | ✅ | GitHub re-hosts it and renders a native video player. **This is the supported path for video in READMEs/releases/issues** |
| `<script>` embeds (asciinema, YouTube iframes) | ❌ | Stripped |
| asciinema SVG preview link | ✅ | `[![asciicast](...svg)](...)` is the documented workaround |

> GitLab: same sanitization model; upload MP4 to the repo/release and reference the rendered blob URL to get an inline video player. *(from general knowledge — verify current behavior)*

### 3.4 Docs frameworks

| Framework | Video support | Notes |
|---|---|---|
| **Docusaurus** | ✅ MDX allows raw `<video>`/`<picture>` | Build an `AnimatedAsset` component wrapping the sources pattern; assets in `static/` |
| **VitePress / VuePress** | ✅ `v-html`/direct HTML in Markdown | Vue-compiled markdown passes raw HTML through |
| **Astro** | ✅ Native HTML in `.mdx`; `<Image>`/`<Picture>` components handle `<picture>` automatically (supports AVIF/WebP transform) | `@astrojs/image`→`astro:assets` will even transcode at build time |
| **Nextra** | ✅ MDX | Same as Docusaurus pattern |
| **MkDocs / Material** | ✅ HTML in Markdown (with `md_in_html` or raw attr) | `pymdownx` snippets make reusable video blocks easy |
| **Hugo** | ✅ `{{< video >}}` shortcodes (roll your own) or raw HTML | Hugo Pipes can fingerprint/cache-bust assets |
| **GitBook** | Limited | Upload video/image files via editor; raw HTML restricted on hosted GitBook |
| **Sphinx** | ✅ `sphinxcontrib-video` / raw HTML | |

### 3.5 Reusable component idea (Docusaurus/MDX example)

```jsx
// src/components/DocVideo.jsx
export default function DocVideo({ base, poster }) {
  return (
    <video autoPlay loop muted playsinline poster={poster} style={{ maxWidth: '100%' }}>
      <source src={`${base}.webm`} type="video/webm" />
      <source src={`${base}.mp4`}  type="video/mp4" />
    </video>
  );
}
```

```mdx
import DocVideo from '@site/src/components/DocVideo';

<DocVideo base="/img/demo" poster="/img/demo-poster.webp" />
```

Then in CI: `ffmpeg` produces `demo.mp4` + `demo.webm` from one source recording, and nothing gets hand-exported twice.

### 3.6 One-command conversion pipeline

```bash
#!/usr/bin/env bash
# gif2modern.sh input.gif basename → mp4 + webm
set -euo pipefail
in="$1"; base="${2:-${in%.*}}"
# Infinite-loop the GIF stream so the videos loop seamlessly
ffmpeg -stream_loop -1 -i "$in" -movflags +faststart -pix_fmt yuv420p -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos" -c:v libx264 -crf 23 -preset slow -an "$base.mp4"
ffmpeg -stream_loop -1 -i "$in" -c:v libvpx-vp9 -crf 34 -b:v 0 -an "$base.webm"
# and/or an <img>-friendly animated WebP:
ffmpeg -stream_loop -1 -i "$in" -loop 0 -an -c:v libwebp -lossless 0 -q:v 60 "$base.webp"
```

Source-recording workflow (better than starting from GIF):

```bash
# Screen recording → docs assets (macOS ⌘⇧5 produces .mov)
ffmpeg -i screen-recording.mov \
  -movflags +faststart -pix_fmt yuv420p -vf "fps=30,scale=1280:-2" \
  -c:v libx264 -crf 23 -preset slow -an demo.mp4
```

Cropping to a window and trimming are the two highest-leverage steps for file size: `-ss 0 -t 8` and `-vf "crop=1280:720:100:200"`.

---

## 4. Local vs Cloud

| Capability | Fully local (offline) | Cloud required |
|---|---|---|
| GIF→MP4/WebM/WebP/APNG | ffmpeg, ImageMagick, gifsicle, HandBrake | ezgif, CloudConvert, Convertio |
| High-quality GIF encoding | gifski, ffmpeg | ezgif |
| Screen recording | OBS, Kap, ScreenToGif, Peek, Gifox, CleanShot, ⌘⇧5 | — (Loom et al. are cloud-first, unnecessary for docs assets) |
| Terminal recording | asciinema (recording is local; **viewing** on asciinema.org embeds needs their server, or self-host / use `agg` for a self-contained GIF) | asciinema.org hosting for the embedded player |
| Terminal demo scripting | VHS | — |
| Code screenshots | carbon-now-cli (renders locally via puppeteer) | carbon.now.sh, ray.so web |
| Diagrams/animation | Excalidraw (self-hostable), excalidraw-clips | excalidraw.com, tldraw cloud |

**Guidance:** keep the whole pipeline local for anything that lands in a repo (deterministic, private, CI-able). Cloud tools are acceptable for one-off conversions and for services whose *output* is a static file you commit.

---

## 5. Costs

| Tool / service | License | Cost |
|---|---|---|
| ffmpeg, ImageMagick, gifsicle, HandBrake, libwebp, libavif, SVT-AV1 | OSS | Free |
| Sharp / libvips | OSS (Apache-2.0 / LGPL) | Free |
| gifski (CLI/library) | AGPL + commercial | Free for open source; [paid commercial license](https://supso.org/projects/pngquant) for closed use |
| gifski (macOS GUI) | App Store | Paid (small one-time) |
| Gifox | Proprietary | Freemium |
| OBS, Kap, Peek, ScreenToGif | OSS | Free |
| CleanShot X | Proprietary | ~$29 one-time (or Setapp subscription) |
| Shottr | Proprietary | Free (Pro tier cheap) |
| asciinema (CLI) | OSS | Free |
| asciinema.org hosting | Free service | Free (donations welcome; self-hosting available) |
| VHS, svg-term, termtosvg, terminalizer | OSS | Free |
| ezgif | Web service | Free (ad-supported) |
| CloudConvert | Web/API service | Free tier, then paid (from ~$9/mo) |
| ImageOptim API | API service | Trial then paid per-image |
| carbon / ray.so | OSS / free | Free |
| Excalidraw | MIT | Free (+ paid org features) |
| CleanShot Cloud / Loom-style hosting | Proprietary | Subscription — **avoidable** by committing assets to the repo |

Bottom line: a **fully free, fully local** pipeline (⌘⇧5/OBS → ffmpeg → commit) covers every need in this document. Paid tools buy convenience and polish, not capability.

---

## 6. Benchmarks & Comparisons

### 6.1 Browser support matrix (verified via caniuse, Aug-2026 usage data)

| Format | Global support | Chrome | Firefox | Safari | iOS Safari | Notes |
|---|---|---|---|---|---|---|
| **H.264/MP4** | 97.26% | ✅ all | ✅ 35+ | ✅ 3.2+ | ✅ all | The baseline |
| **WebM (VP8/9)** | 96.91% | ✅ 25+ | ✅ 28+ | ✅ 16.0+ | ✅ 17.4+ | Partial in Safari 12.1–15.6 |
| **AV1** | 95.02% | ✅ 70+ | ✅ 67+ | ◐ 17+ | ◐ 17+ | Safari partial (hardware-dependent) |
| **HEVC** | 93.53% (misleading) | ◐ OS-dependent | ◐ OS-dependent | ✅ 13+ | ✅ 11+ | Avoid |
| **WebP (animated)** | 96.82% | ✅ 32+ | ✅ 65+ | ✅ 16.0+ | ✅ 14+ | Best `<img>` animation |
| **APNG** | 96.61% | ✅ 59+ | ✅ 3+ | ✅ 8+ | ✅ 8+ | First-frame fallback elsewhere |
| **AVIF** | 95.36% | ✅ 85+ | ✅ 93+ | ✅ 16.4+ | ✅ 16.0+ | Animated support tracks AV1 |
| **JPEG XL** | ~14.63% (mostly disabled) | ❌ (flag) | ✅ 158+ | ◐ 17+ | ◐ 17+ | Not ready |

Sources: [caniuse/mpeg4](https://caniuse.com/mpeg4), [caniuse/webm](https://caniuse.com/webm), [caniuse/av1](https://caniuse.com/av1), [caniuse/hevc](https://caniuse.com/hevc), [caniuse/webp](https://caniuse.com/webp), [caniuse/apng](https://caniuse.com/apng), [caniuse/avif](https://caniuse.com/avif), [caniuse/jpegxl](https://caniuse.com/jpegxl).

### 6.2 File size — order-of-magnitude expectations

*(Rules of thumb from codec literature and practitioner write-ups; measure your own assets — screen content varies hugely.)*

| Format | vs GIF = 100% | When it wins |
|---|---|---|
| GIF (baseline) | 100% | never, size-wise |
| Animated WebP | ~65–75% | always; lossy WebP with `-q:v 50–70` |
| H.264 MP4 | ~5–15% | any moving content; the `faststart`+`yuv420p` combo |
| VP9 WebM | ~3–10% | UI/screen content with big flat areas |
| AV1 | ~2–8% | same as VP9, more so; slow to encode |

Additional structural wins independent of codec:

- **Crop** to the actual UI region (GIFs routinely contain 50% dead desktop).
- **Reduce FPS**: 12–15 fps is plenty for UI demos (GIFs of 30 fps are mostly waste).
- **Reduce dimensions**: 720–1280 px wide, or retina source downscaled.
- **Trim dead time**; for terminal, `asciinema`'s `idle-time-limit` does this automatically.
- **Palette/quantize** when a GIF is truly required: `gifski --quality 70 --width 480 --fps 12`.

### 6.3 Playback performance

| Aspect | GIF | MP4/H.264 | VP9/AV1 |
|---|---|---|---|
| Decode | CPU-bound, per-frame, full-size | Hardware (GPU) on ~all modern devices | Hardware AV1 on recent SoCs; otherwise efficient software (dav1d) |
| Memory | Full bitmap of every frame held for looping | Compressed stream + frame buffer | Same |
| Battery | Notorious drain on long loops | Negligible | Negligible–low |
| Startup | Whole file often needed | Progressive via `faststart`/range requests | Same |

GIF playback cost is the classic hidden perf bug on docs pages — a page with several large GIFs can peg a CPU core each. *(This is a well-documented practitioner consensus; the decode-path facts above are structural to the formats.)*

### 6.4 Encoding speed (short 5–10 s screen clip, modern laptop)

| Encoder | Typical time | Notes |
|---|---|---|
| libx264 (H.264) | seconds (`-preset medium`) | Also hardware-accelerated (`h264_videotoolbox`, `h264_nvenc`, `h264_qsv`, `h264_vaapi`) |
| libvpx-vp9 | 10–60 s single-pass; use `-row-mt 1 -deadline good -cpu-used 2` | Multi-thread row-mt is essential |
| SVT-AV1 | seconds (`-preset 8–10`) | The practical AV1 encoder |
| libaom-av1 | minutes | Max quality, research-grade speed |
| libwebp (animated) | seconds–tens of seconds | `-q:v` dominant cost driver |
| gifski | seconds–minutes | The price of excellent palettes; author's own advice: use video instead |

*(Order-of-magnitude only; hardware-dependent.)*

### 6.5 Decision matrix

| Constraint | Ship |
|---|---|
| Must work in a bare Markdown `<img>` (README) | Animated WebP (fallback GIF) or APNG; or GitHub-uploaded MP4 |
| Docs site you control (HTML allowed) | `<video>` H.264 + VP9 WebM (+ AV1 first when Safari is green) |
| Terminal content | asciinema (docs) / asciinema-SVG-link or VHS (README) |
| Absolute smallest file | AV1/WebM video, or animated AVIF |
| Must loop losslessly with alpha | APNG |
| CI-generated docs assets | ffmpeg + Sharp/VHS, committed to repo |

---

## 7. Gotchas

1. **GitHub README sanitizes `<video>` with external URLs.** Upload MP4s via drag-drop so GitHub hosts them, or use WebP/APNG/GIF images. ([GitHub docs on media attachments](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files))
2. **Unmuted autoplay is blocked** — always pair `autoplay` with `muted` (and add `playsinline` for iOS).
3. **GIF-derived MP4s can be RGB (444) and won't play on iOS** — force `-pix_fmt yuv420p`.
4. **Without `+faststart`, MP4s download fully before playing** — black box for slow readers.
5. **`stream_loop -1` before `-i`** when converting a looping GIF to video, or your "infinite" animation becomes a one-shot.
6. **HEVC screen recordings from iPhones/Macs** don't play on Linux/Windows browsers — transcode to H.264.
7. **Animated WebP in Safari requires 16.0+** (desktop) / 14+ (iOS). Still-WebP-only builds of older Safari will show a static first frame at best.
8. **asciinema embeds depend on asciinema.org** (or your self-hosted server). For zero third-party dependencies, export with `agg` to GIF/video and self-host the file.
9. **APNG "fallback" is a still first frame**, not an error — design the first frame to be self-explanatory.
10. **Don't double-compress**: never re-encode an existing GIF→MP4→GIF chain; go back to the original recording whenever possible.
11. **JPEG XL animation is not shippable** — Chrome support is disabled-by-default in current stable builds despite the recent re-landing ([caniuse/jpegxl](https://caniuse.com/jpegxl), [Phoronix](https://www.phoronix.com/news/JPEG-XL-Returns-Chrome-Chromium)).

---

## 8. Sources

**Verified during this research pass:**

- caniuse.com support tables: [mpeg4](https://caniuse.com/mpeg4) · [webm](https://caniuse.com/webm) · [av1](https://caniuse.com/av1) · [hevc](https://caniuse.com/hevc) · [webp](https://caniuse.com/webp) · [apng](https://caniuse.com/apng) · [avif](https://caniuse.com/avif) · [jpegxl](https://caniuse.com/jpegxl)
- [gifski official site](https://gif.ski/) — CLI usage, GUI links, licensing, and the author's own "use AV1 + `<video>`" recommendation
- [asciinema embedding docs](https://docs.asciinema.org/manual/server/embedding/) — inline player options, SVG preview for Markdown contexts, oEmbed
- [asciinema.org](https://asciinema.org/) — product overview, self-hosting/player links
- [VHS (charmbracelet/vhs)](https://github.com/charmbracelet/vhs) — tape-file terminal recorder
- [ImageOptim/gifski repo](https://github.com/ImageOptim/gifski) — project home
- [ImageOptim ungif API](https://imageoptim.com/api/ungif) — cloud GIF→video conversion
- [WebP animated docs (Google)](https://developers.google.com/speed/webp/docs/animated_webp) — animated WebP vs GIF size study basis
- [JPEG XL returns to Chromium — Phoronix](https://www.phoronix.com/news/JPEG-XL-Returns-Chrome-Chromium)
- [JPEG XL overview paper (arXiv 2506.05987)](https://arxiv.org/pdf/2506.05987)
- [CloudConvert](https://cloudconvert.com), [ezgif](https://ezgif.com), [Convertio](https://convertio.co) — cloud converter tiers
- [carbon](https://carbon.now.sh), [ray.so](https://ray.so), [Excalidraw](https://excalidraw.com) — code/diagram tools
- [GitHub: attaching files](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files) — MP4 upload path for READMEs

**General-knowledge items (flagged above):** codec-vs-GIF size ratios, encoding-speed figures, GitLab README video behavior, playback-performance characterization. These are stable, widely-reported facts, but re-verify against your own assets before publishing exact numbers.

---

*End of research document.*
