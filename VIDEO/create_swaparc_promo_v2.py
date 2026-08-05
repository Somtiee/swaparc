#!/usr/bin/env python3
"""
Swaparc promotional video v2 — premium cinematic cut.
Exports VIDEO/Swaparc_Elite_Promo_v2.mp4 (1920x1080, 30fps, ~30s).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps
from moviepy import (
    AudioFileClip,
    CompositeVideoClip,
    ImageClip,
    TextClip,
    afx,
    vfx,
)

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
MUSIC_PATH = ROOT / "Burgundy - Flicker (freetouse.com).mp3"
OUT_PATH = ROOT / "Swaparc_Elite_Promo_v2.mp4"

BADGE_PATH = REPO / "public" / "badges" / "elite-swaparcer.png"
SWAP_SHOT = REPO / "public" / "docs-images" / "swap-quote-panel.png"
POOLS_SHOT = REPO / "public" / "docs-images" / "pools-my-positions.png"

W, H = 1920, 1080
FPS = 30
DURATION = 30.0

# Safe margins (px) — text/images stay inside this box
SAFE_X = 120
SAFE_Y = 90

WHITE = "#F4F8FF"
CYAN = "#7CC5FF"
CYAN_BRIGHT = "#5EF0FF"

FONT_BOLD = r"C:\Windows\Fonts\segoeuib.ttf"
FONT_REG = r"C:\Windows\Fonts\segoeui.ttf"


def ease_out(t: float, d: float = 0.9) -> float:
    if d <= 0:
        return 1.0
    x = max(0.0, min(1.0, t / d))
    return 1.0 - (1.0 - x) ** 3


def make_gradient_bg(w: int = W, h: int = H) -> ImageClip:
    """Deep vertical navy gradient #050d1f → #0a1a35 → #071428."""
    top = np.array([5, 13, 31], dtype=np.float32)
    mid = np.array([10, 26, 53], dtype=np.float32)
    bot = np.array([7, 20, 40], dtype=np.float32)
    ys = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None]
    # Piecewise blend: top→mid (0–0.55), mid→bot (0.55–1)
    t1 = np.clip(ys / 0.55, 0.0, 1.0)
    t2 = np.clip((ys - 0.55) / 0.45, 0.0, 1.0)
    upper = top * (1 - t1) + mid * t1
    lower = mid * (1 - t2) + bot * t2
    colors = np.where(ys <= 0.55, upper, lower)
    frame = np.repeat(colors[:, None, :], w, axis=1).astype(np.uint8)

    # Soft vignette for depth
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = w / 2.0, h / 2.0
    rx, ry = w * 0.72, h * 0.78
    vignette = 1.0 - np.clip(
        (((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2) ** 0.85, 0.0, 0.42
    )
    frame = (frame.astype(np.float32) * vignette[..., None]).astype(np.uint8)

    # Subtle cyan ambient glow near center
    glow = np.exp(
        -(((xx - cx) / (w * 0.35)) ** 2 + ((yy - cy * 0.92) / (h * 0.45)) ** 2)
    )
    glow = (glow * 18.0)[..., None]
    tint = np.zeros_like(frame, dtype=np.float32)
    tint[..., 0] = glow[..., 0] * 0.25
    tint[..., 1] = glow[..., 0] * 0.55
    tint[..., 2] = glow[..., 0] * 1.0
    frame = np.clip(frame.astype(np.float32) + tint, 0, 255).astype(np.uint8)

    return ImageClip(frame).with_duration(DURATION)


def round_card(
    src_path: Path,
    *,
    max_w: int,
    max_h: int,
    radius: int = 28,
    border: int = 2,
    pad: int = 14,
) -> Image.Image:
    """Screenshot inside a dark glass card with cyan edge."""
    img = Image.open(src_path).convert("RGBA")
    img.thumbnail((max_w - pad * 2, max_h - pad * 2), Image.Resampling.LANCZOS)

    card_w = img.width + pad * 2
    card_h = img.height + pad * 2
    # Shadow layer
    canvas = Image.new("RGBA", (card_w + 40, card_h + 40), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.rounded_rectangle(
        [0, 0, card_w - 1, card_h - 1],
        radius=radius,
        fill=(0, 0, 0, 160),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(16))
    canvas.alpha_composite(shadow, (24, 28))

    # Card body
    body = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
    bd = ImageDraw.Draw(body)
    bd.rounded_rectangle(
        [0, 0, card_w - 1, card_h - 1],
        radius=radius,
        fill=(8, 20, 42, 230),
        outline=(124, 197, 255, 170),
        width=border,
    )
    # Inner image with rounded mask
    mask = Image.new("L", img.size, 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, img.width - 1, img.height - 1], radius=radius - 8, fill=255)
    body.paste(img, (pad, pad), mask)
    canvas.alpha_composite(body, (12, 10))
    return canvas


def badge_with_glow(src_path: Path, size: int = 380) -> Image.Image:
    """Elite badge with soft cyan glow halo."""
    badge = Image.open(src_path).convert("RGBA")
    # Crop black padding a bit if present
    bbox = badge.getbbox()
    if bbox:
        badge = badge.crop(bbox)
    badge = ImageOps.contain(badge, (size, size), Image.Resampling.LANCZOS)

    canvas_s = size + 120
    canvas = Image.new("RGBA", (canvas_s, canvas_s), (0, 0, 0, 0))

    # Glow disc
    glow = Image.new("RGBA", (canvas_s, canvas_s), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cx = cy = canvas_s // 2
    for r, a in ((size // 2 + 48, 40), (size // 2 + 28, 70), (size // 2 + 12, 90)):
        gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(94, 240, 255, a))
    glow = glow.filter(ImageFilter.GaussianBlur(28))
    canvas.alpha_composite(glow)

    ox = (canvas_s - badge.width) // 2
    oy = (canvas_s - badge.height) // 2
    canvas.alpha_composite(badge, (ox, oy))
    return canvas


def make_text(
    text: str,
    *,
    font: str,
    font_size: int,
    color: str,
    stroke_color: str | None = None,
    stroke_width: int = 0,
) -> TextClip:
    kwargs = dict(
        font=font,
        text=text,
        font_size=font_size,
        color=color,
        method="label",
        text_align="center",
        horizontal_align="center",
        vertical_align="center",
        transparent=True,
        # Extra padding so glyphs / stroke never clip
        margin=(28, 22),
    )
    if stroke_color and stroke_width > 0:
        kwargs["stroke_color"] = stroke_color
        kwargs["stroke_width"] = stroke_width
    return TextClip(**kwargs)


def animated_text(
    text: str,
    *,
    start: float,
    hold: float,
    font: str,
    font_size: int,
    color: str,
    y: float,
    fade_in: float = 0.6,
    fade_out: float = 0.55,
    slide: float = 26,
    scale_from: float = 0.97,
    stroke_color: str | None = None,
    stroke_width: int = 0,
) -> TextClip:
    """Fade + slight scale-up + gentle upward slide. y is absolute center."""
    clip = make_text(
        text,
        font=font,
        font_size=font_size,
        color=color,
        stroke_color=stroke_color,
        stroke_width=stroke_width,
    )
    clip = (
        clip.with_duration(hold)
        .with_start(start)
        .with_effects([vfx.FadeIn(fade_in), vfx.FadeOut(fade_out)])
    )

    def pos(t, _y=y, _slide=slide):
        e = ease_out(t, 0.95)
        return ("center", _y + _slide * (1.0 - e))

    clip = clip.with_position(pos)
    clip = clip.resized(lambda t: scale_from + (1.0 - scale_from) * ease_out(t, 0.95))
    return clip


def animated_image(
    pil_img: Image.Image,
    *,
    start: float,
    hold: float,
    y: float,
    fade_in: float = 0.7,
    fade_out: float = 0.55,
    slide: float = 36,
    scale_from: float = 0.94,
) -> ImageClip:
    arr = np.array(pil_img)
    clip = ImageClip(arr, transparent=True).with_duration(hold).with_start(start)
    clip = clip.with_effects([vfx.FadeIn(fade_in), vfx.FadeOut(fade_out)])

    def pos(t, _y=y, _slide=slide):
        e = ease_out(t, 1.0)
        return ("center", _y + _slide * (1.0 - e))

    clip = clip.with_position(pos)
    clip = clip.resized(lambda t: scale_from + (1.0 - scale_from) * ease_out(t, 1.0))
    return clip


def build_video() -> CompositeVideoClip:
    if not MUSIC_PATH.exists():
        raise FileNotFoundError(MUSIC_PATH)
    if not BADGE_PATH.exists():
        raise FileNotFoundError(BADGE_PATH)

    bg = make_gradient_bg()
    layers: list = [bg]

    # ---------- Scene 1: 0.0 – 5.5s ----------
    layers.append(
        animated_text(
            "SWAPARC",
            start=0.0,
            hold=5.5,
            font=FONT_BOLD,
            font_size=118,
            color=WHITE,
            y=H * 0.42,
            fade_in=1.0,
            fade_out=0.7,
            slide=20,
            scale_from=0.95,
        )
    )
    layers.append(
        animated_text(
            "New chapter unlocked",
            start=1.15,
            hold=4.35,
            font=FONT_REG,
            font_size=40,
            color=CYAN,
            y=H * 0.54,
            fade_in=0.85,
            fade_out=0.65,
            slide=16,
            scale_from=0.98,
        )
    )

    # ---------- Scene 2: 5.5 – 12s (Swap) ----------
    layers.append(
        animated_text(
            "New Swap Pool is Live",
            start=5.5,
            hold=6.5,
            font=FONT_BOLD,
            font_size=64,
            color=WHITE,
            y=SAFE_Y + 70,
            fade_in=0.65,
            fade_out=0.55,
            slide=28,
        )
    )
    layers.append(
        animated_text(
            "USDC  •  EURC  •  CircBTC  •  SWPRC",
            start=6.15,
            hold=5.85,
            font=FONT_REG,
            font_size=34,
            color=CYAN,
            y=SAFE_Y + 145,
            fade_in=0.7,
            fade_out=0.5,
            slide=18,
            scale_from=0.98,
        )
    )
    if SWAP_SHOT.exists():
        swap_card = round_card(SWAP_SHOT, max_w=520, max_h=520, radius=26)
        layers.append(
            animated_image(
                swap_card,
                start=5.9,
                hold=6.1,
                y=H * 0.62,
                fade_in=0.75,
                fade_out=0.55,
                slide=40,
                scale_from=0.93,
            )
        )

    # ---------- Scene 3: 12 – 19s (Pools) ----------
    layers.append(
        animated_text(
            "More Liquidity Pools",
            start=12.0,
            hold=7.0,
            font=FONT_BOLD,
            font_size=64,
            color=WHITE,
            y=SAFE_Y + 70,
            fade_in=0.65,
            fade_out=0.55,
            slide=28,
        )
    )
    layers.append(
        animated_text(
            "New CircBTC pairs now available",
            start=12.65,
            hold=6.35,
            font=FONT_REG,
            font_size=36,
            color=CYAN,
            y=SAFE_Y + 145,
            fade_in=0.7,
            fade_out=0.5,
            slide=18,
            scale_from=0.98,
        )
    )
    if POOLS_SHOT.exists():
        pools_card = round_card(POOLS_SHOT, max_w=780, max_h=460, radius=26)
        layers.append(
            animated_image(
                pools_card,
                start=12.4,
                hold=6.6,
                y=H * 0.64,
                fade_in=0.75,
                fade_out=0.55,
                slide=40,
                scale_from=0.93,
            )
        )

    # ---------- Scene 4: 19 – 26.5s (Elite badge) ----------
    layers.append(
        animated_text(
            "Elite Swaparcer Badge",
            start=19.0,
            hold=7.5,
            font=FONT_BOLD,
            font_size=60,
            color=WHITE,
            y=SAFE_Y + 58,
            fade_in=0.7,
            fade_out=0.55,
            slide=24,
            scale_from=0.95,
            stroke_color=CYAN,
            stroke_width=1,
        )
    )
    layers.append(
        animated_text(
            "Earn it. Keep it forever.",
            start=19.7,
            hold=6.8,
            font=FONT_REG,
            font_size=38,
            color=CYAN_BRIGHT,
            y=SAFE_Y + 130,
            fade_in=0.75,
            fade_out=0.5,
            slide=16,
            scale_from=0.98,
        )
    )
    badge_img = badge_with_glow(BADGE_PATH, size=360)
    layers.append(
        animated_image(
            badge_img,
            start=19.35,
            hold=7.15,
            y=H * 0.62,
            fade_in=0.85,
            fade_out=0.6,
            slide=30,
            scale_from=0.90,
        )
    )

    # ---------- Scene 5: 26.5 – 30s ----------
    layers.append(
        animated_text(
            "swaparc.app",
            start=26.5,
            hold=3.5,
            font=FONT_BOLD,
            font_size=58,
            color=CYAN,
            y=H * 0.48,
            fade_in=0.55,
            fade_out=1.2,
            slide=12,
            scale_from=0.97,
        )
    )

    video = CompositeVideoClip(layers, size=(W, H)).with_duration(DURATION)
    video = video.with_effects([vfx.FadeOut(1.4)])

    audio = AudioFileClip(str(MUSIC_PATH)).subclipped(0, DURATION)
    audio = audio.with_effects([afx.AudioFadeIn(1.5), afx.AudioFadeOut(2.0)])
    return video.with_audio(audio)


def main() -> None:
    print("Building Swaparc promo v2...")
    print(f"  Music : {MUSIC_PATH.name}")
    print(f"  Badge : {BADGE_PATH.name}")
    print(f"  Swap  : {SWAP_SHOT.name if SWAP_SHOT.exists() else 'missing'}")
    print(f"  Pools : {POOLS_SHOT.name if POOLS_SHOT.exists() else 'missing'}")
    print(f"  Output: {OUT_PATH}")

    clip = build_video()
    try:
        clip.write_videofile(
            str(OUT_PATH),
            fps=FPS,
            codec="libx264",
            audio_codec="aac",
            bitrate="12000k",
            audio_bitrate="192k",
            preset="medium",
            threads=4,
            logger="bar",
        )
    finally:
        clip.close()
        try:
            if clip.audio is not None:
                clip.audio.close()
        except Exception:
            pass

    size_mb = OUT_PATH.stat().st_size / (1024 * 1024)
    print("\nDone.")
    print(f"  File       : {OUT_PATH.resolve()}")
    print(f"  Duration   : {DURATION:.1f}s")
    print(f"  Resolution : {W}x{H} @ {FPS}fps")
    print(f"  Size       : {size_mb:.2f} MB")


if __name__ == "__main__":
    main()
