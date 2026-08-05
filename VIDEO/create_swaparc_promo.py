#!/usr/bin/env python3
"""
Swaparc 30-second promotional video.
Exports VIDEO/Swaparc_Elite_Promo.mp4 (1920x1080, 30fps).
"""

from __future__ import annotations

from pathlib import Path

from moviepy import (
    AudioFileClip,
    ColorClip,
    CompositeVideoClip,
    TextClip,
    afx,
    vfx,
)

ROOT = Path(__file__).resolve().parent
MUSIC_PATH = ROOT / "Burgundy - Flicker (freetouse.com).mp3"
OUT_PATH = ROOT / "Swaparc_Elite_Promo.mp4"

W, H = 1920, 1080
FPS = 30
DURATION = 30.0

# Swaparc dark navy / cyan palette
NAVY = (10, 22, 40)  # #0a1628
NAVY_DEEP = (5, 14, 30)
WHITE = "#F0F6FF"
CYAN = "#7CC5FF"
CYAN_BRIGHT = "#5EF0FF"
MUTED = "#A8C4E0"

FONT_BOLD = r"C:\Windows\Fonts\segoeuib.ttf"
FONT_REG = r"C:\Windows\Fonts\segoeui.ttf"


def ease_out_cubic(t: float, duration: float = 0.85) -> float:
    if duration <= 0:
        return 1.0
    x = max(0.0, min(1.0, t / duration))
    return 1.0 - (1.0 - x) ** 3


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
    )
    if stroke_color and stroke_width > 0:
        kwargs["stroke_color"] = stroke_color
        kwargs["stroke_width"] = stroke_width
    return TextClip(**kwargs)


def animated_line(
    text: str,
    *,
    start: float,
    hold: float,
    font: str,
    font_size: int,
    color: str,
    y_center: float,
    fade_in: float = 0.55,
    fade_out: float = 0.55,
    slide_px: float = 28,
    scale_from: float = 0.96,
    stroke_color: str | None = None,
    stroke_width: int = 0,
    glow: bool = False,
) -> list:
    """Title/subtitle with fade + slight scale + gentle upward slide."""
    duration = hold
    clips = []

    if glow:
        glow_clip = make_text(
            text,
            font=font,
            font_size=font_size + 2,
            color=CYAN_BRIGHT,
            stroke_color=CYAN,
            stroke_width=3,
        )
        glow_clip = (
            glow_clip.with_duration(duration)
            .with_start(start)
            .with_effects([vfx.FadeIn(fade_in), vfx.FadeOut(fade_out)])
        )

        def glow_pos(t, _yc=y_center, _slide=slide_px):
            e = ease_out_cubic(t, 0.9)
            return ("center", _yc + _slide * (1 - e))

        glow_clip = glow_clip.with_position(glow_pos)
        glow_clip = glow_clip.resized(
            lambda t: scale_from + (1.0 - scale_from) * ease_out_cubic(t, 0.9)
        )
        # Soften glow layer
        glow_clip = glow_clip.with_opacity(0.35)
        clips.append(glow_clip)

    main = make_text(
        text,
        font=font,
        font_size=font_size,
        color=color,
        stroke_color=stroke_color,
        stroke_width=stroke_width,
    )
    main = (
        main.with_duration(duration)
        .with_start(start)
        .with_effects([vfx.FadeIn(fade_in), vfx.FadeOut(fade_out)])
    )

    def pos(t, _yc=y_center, _slide=slide_px):
        e = ease_out_cubic(t, 0.9)
        return ("center", _yc + _slide * (1 - e))

    main = main.with_position(pos)
    main = main.resized(
        lambda t: scale_from + (1.0 - scale_from) * ease_out_cubic(t, 0.9)
    )
    clips.append(main)
    return clips


def build_video() -> CompositeVideoClip:
    if not MUSIC_PATH.exists():
        raise FileNotFoundError(f"Music file not found: {MUSIC_PATH}")

    # Soft vertical gradient feel via stacked navy plates
    bg = ColorClip(size=(W, H), color=NAVY).with_duration(DURATION)
    vignette_top = (
        ColorClip(size=(W, 220), color=NAVY_DEEP)
        .with_duration(DURATION)
        .with_position(("center", 0))
        .with_opacity(0.55)
    )
    vignette_bot = (
        ColorClip(size=(W, 220), color=NAVY_DEEP)
        .with_duration(DURATION)
        .with_position(("center", H - 220))
        .with_opacity(0.55)
    )

    layers = [bg, vignette_top, vignette_bot]

    # --- Scene 1: 0–6s ---
    layers += animated_line(
        "SWAPARC",
        start=0.0,
        hold=6.0,
        font=FONT_BOLD,
        font_size=132,
        color=WHITE,
        y_center=H * 0.42,
        fade_in=0.9,
        fade_out=0.7,
        slide_px=22,
        scale_from=0.94,
    )
    layers += animated_line(
        "Something new just landed",
        start=1.1,
        hold=4.9,
        font=FONT_REG,
        font_size=44,
        color=CYAN,
        y_center=H * 0.55,
        fade_in=0.8,
        fade_out=0.65,
        slide_px=18,
        scale_from=0.97,
    )

    # --- Scene 2: 6–13s ---
    layers += animated_line(
        "New Swap Pool is Live",
        start=6.0,
        hold=7.0,
        font=FONT_BOLD,
        font_size=78,
        color=WHITE,
        y_center=H * 0.42,
        fade_in=0.65,
        fade_out=0.6,
        slide_px=30,
    )
    layers += animated_line(
        "USDC  •  EURC  •  CircBTC  •  SWPRC",
        start=6.7,
        hold=6.3,
        font=FONT_REG,
        font_size=38,
        color=CYAN,
        y_center=H * 0.54,
        fade_in=0.7,
        fade_out=0.55,
        slide_px=20,
        scale_from=0.98,
    )

    # --- Scene 3: 13–20s ---
    layers += animated_line(
        "More Liquidity Pools",
        start=13.0,
        hold=7.0,
        font=FONT_BOLD,
        font_size=78,
        color=WHITE,
        y_center=H * 0.42,
        fade_in=0.65,
        fade_out=0.6,
        slide_px=30,
    )
    layers += animated_line(
        "Including new CircBTC pairs",
        start=13.7,
        hold=6.3,
        font=FONT_REG,
        font_size=40,
        color=CYAN,
        y_center=H * 0.54,
        fade_in=0.7,
        fade_out=0.55,
        slide_px=20,
        scale_from=0.98,
    )

    # --- Scene 4: 20–27s (special emphasis) ---
    layers += animated_line(
        "Elite Swaparcer Badge",
        start=20.0,
        hold=7.0,
        font=FONT_BOLD,
        font_size=76,
        color=WHITE,
        y_center=H * 0.42,
        fade_in=0.7,
        fade_out=0.55,
        slide_px=26,
        scale_from=0.93,
        glow=True,
        stroke_color=CYAN,
        stroke_width=1,
    )
    layers += animated_line(
        "Earn it. Keep it forever.",
        start=20.85,
        hold=6.15,
        font=FONT_REG,
        font_size=42,
        color=CYAN_BRIGHT,
        y_center=H * 0.54,
        fade_in=0.75,
        fade_out=0.55,
        slide_px=18,
        scale_from=0.97,
    )

    # --- Scene 5: 27–30s ---
    layers += animated_line(
        "swaparc.app",
        start=27.0,
        hold=3.0,
        font=FONT_BOLD,
        font_size=64,
        color=CYAN,
        y_center=H * 0.48,
        fade_in=0.55,
        fade_out=1.15,
        slide_px=14,
        scale_from=0.97,
    )

    video = CompositeVideoClip(layers, size=(W, H)).with_duration(DURATION)
    # Clean fade to black at the end
    video = video.with_effects([vfx.FadeOut(1.35)])

    audio = AudioFileClip(str(MUSIC_PATH)).subclipped(0, DURATION)
    audio = audio.with_effects(
        [afx.AudioFadeIn(1.2), afx.AudioFadeOut(2.0)]
    )
    video = video.with_audio(audio)
    return video


def main() -> None:
    print("Building Swaparc promo...")
    print(f"  Music : {MUSIC_PATH.name}")
    print(f"  Output: {OUT_PATH}")
    clip = build_video()
    try:
        clip.write_videofile(
            str(OUT_PATH),
            fps=FPS,
            codec="libx264",
            audio_codec="aac",
            bitrate="10000k",
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
    print(f"  File     : {OUT_PATH.resolve()}")
    print(f"  Duration : {DURATION:.1f}s")
    print(f"  Size     : {size_mb:.2f} MB")
    print(f"  Format   : 1920x1080 @ {FPS}fps")


if __name__ == "__main__":
    main()
