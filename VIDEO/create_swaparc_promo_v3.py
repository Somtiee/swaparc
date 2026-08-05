#!/usr/bin/env python3
"""
Swaparc promotional video v3 — composition + content accuracy fix.
Exports VIDEO/Swaparc_Elite_Promo_v3.mp4 (1920x1080, 30fps, ~30s).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps
from moviepy import (
    AudioFileClip,
    CompositeVideoClip,
    ImageClip,
    afx,
    vfx,
)

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
ASSETS = ROOT / "promo_assets_v3"
MUSIC_PATH = ROOT / "Burgundy - Flicker (freetouse.com).mp3"
OUT_PATH = ROOT / "Swaparc_Elite_Promo_v4.mp4"

BADGE_PATH = REPO / "public" / "badges" / "elite-swaparcer.png"
LOGO_USDC = REPO / "src" / "assets" / "usdc.jpg"
LOGO_EURC = REPO / "src" / "assets" / "eurc.jpg"
LOGO_SWPRC = REPO / "src" / "assets" / "swprc.jpg"
LOGO_CIRCBTC = REPO / "src" / "assets" / "circbtc.png"

W, H = 1920, 1080
FPS = 30
DURATION = 30.0

WHITE = "#F4F8FF"
CYAN = "#7CC5FF"
CYAN_BRIGHT = "#5EF0FF"

FONT_BOLD = r"C:\Windows\Fonts\segoeuib.ttf"
FONT_REG = r"C:\Windows\Fonts\segoeui.ttf"


def ease_out(t: float, d: float = 0.85) -> float:
    if d <= 0:
        return 1.0
    x = max(0.0, min(1.0, t / d))
    return 1.0 - (1.0 - x) ** 3


def load_font(path: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.load_default()


def circle_logo(path: Path, size: int) -> Image.Image:
    img = Image.open(path).convert("RGBA")
    img = ImageOps.fit(img, (size, size), Image.Resampling.LANCZOS)
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def rounded_rect(draw, box, radius, fill, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def make_gradient_bg(w: int = W, h: int = H) -> ImageClip:
    top = np.array([5, 13, 31], dtype=np.float32)
    mid = np.array([10, 26, 53], dtype=np.float32)
    bot = np.array([7, 20, 40], dtype=np.float32)
    ys = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None]
    t1 = np.clip(ys / 0.55, 0.0, 1.0)
    t2 = np.clip((ys - 0.55) / 0.45, 0.0, 1.0)
    upper = top * (1 - t1) + mid * t1
    lower = mid * (1 - t2) + bot * t2
    colors = np.where(ys <= 0.55, upper, lower)
    frame = np.repeat(colors[:, None, :], w, axis=1).astype(np.uint8)

    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = w / 2.0, h / 2.0
    vignette = 1.0 - np.clip(
        (((xx - cx) / (w * 0.72)) ** 2 + ((yy - cy) / (h * 0.78)) ** 2) ** 0.85,
        0.0,
        0.38,
    )
    frame = (frame.astype(np.float32) * vignette[..., None]).astype(np.uint8)
    glow = np.exp(
        -(((xx - cx) / (w * 0.38)) ** 2 + ((yy - cy * 0.9) / (h * 0.48)) ** 2)
    )
    tint = np.zeros_like(frame, dtype=np.float32)
    tint[..., 1] = glow * 14
    tint[..., 2] = glow * 28
    frame = np.clip(frame.astype(np.float32) + tint, 0, 255).astype(np.uint8)
    return ImageClip(frame).with_duration(DURATION)


def build_swap_mockup() -> Path:
    """USDC → CircBTC swap card matching Swaparc UI language."""
    ASSETS.mkdir(parents=True, exist_ok=True)
    out = ASSETS / "swap_usdc_circbtc.png"
    w, h = 620, 560
    card = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(card)
    rounded_rect(
        d,
        [0, 0, w - 1, h - 1],
        28,
        fill=(8, 22, 48, 245),
        outline=(124, 197, 255, 160),
        width=2,
    )

    f_title = load_font(FONT_BOLD, 34)
    f_label = load_font(FONT_REG, 18)
    f_amt = load_font(FONT_BOLD, 42)
    f_small = load_font(FONT_REG, 16)
    f_btn = load_font(FONT_BOLD, 22)
    f_tok = load_font(FONT_BOLD, 18)

    d.text((28, 22), "Swap", font=f_title, fill=(244, 248, 255, 255))

    # Sell panel
    rounded_rect(d, [22, 78, w - 22, 210], 18, fill=(5, 14, 32, 255), outline=(70, 120, 180, 80))
    d.text((38, 90), "Sell", font=f_label, fill=(140, 170, 200, 255))
    d.text((38, 122), "250", font=f_amt, fill=(244, 248, 255, 255))
    usdc = circle_logo(LOGO_USDC, 36)
    rounded_rect(d, [w - 178, 112, w - 40, 160], 20, fill=(12, 28, 56, 255), outline=(90, 150, 210, 120))
    card.alpha_composite(usdc, (w - 168, 118))
    d.text((w - 124, 122), "USDC", font=f_tok, fill=(244, 248, 255, 255))
    d.text((w - 168, 168), "Balance 1,240.50", font=f_small, fill=(124, 197, 255, 220))

    # Percent row + arrow
    for i, label in enumerate(["25%", "50%", "75%", "Max"]):
        x0 = 40 + i * 90
        rounded_rect(d, [x0, 224, x0 + 78, 252], 12, fill=(14, 32, 62, 255), outline=(80, 130, 190, 90))
        tw = d.textlength(label, font=f_small)
        d.text((x0 + (78 - tw) / 2, 230), label, font=f_small, fill=(180, 205, 230, 255))
    d.ellipse([w // 2 - 18, 258, w // 2 + 18, 294], fill=(14, 36, 70, 255), outline=(124, 197, 255, 140))
    d.polygon(
        [(w // 2 - 8, 268), (w // 2 + 8, 268), (w // 2, 282)],
        fill=(244, 248, 255, 255),
    )

    # Buy panel — CircBTC
    rounded_rect(d, [22, 310, w - 22, 442], 18, fill=(5, 14, 32, 255), outline=(70, 120, 180, 80))
    d.text((38, 322), "Buy", font=f_label, fill=(140, 170, 200, 255))
    d.text((38, 354), "0.002658", font=f_amt, fill=(244, 248, 255, 255))
    btc = circle_logo(LOGO_CIRCBTC, 36)
    rounded_rect(d, [w - 198, 344, w - 40, 392], 20, fill=(12, 28, 56, 255), outline=(90, 150, 210, 120))
    card.alpha_composite(btc, (w - 188, 350))
    d.text((w - 144, 354), "CircBTC", font=f_tok, fill=(244, 248, 255, 255))
    d.text((w - 144, 400), "Balance 0.01042", font=f_small, fill=(124, 197, 255, 220))

    # Meta + CTA
    d.text((38, 456), "Expected Output", font=f_small, fill=(140, 170, 200, 255))
    d.text((w - 210, 456), "0.002658 CircBTC", font=f_small, fill=(124, 197, 255, 255))
    d.text((38, 480), "Price Impact", font=f_small, fill=(140, 170, 200, 255))
    d.text((w - 100, 480), "0.12%", font=f_small, fill=(94, 240, 255, 255))
    rounded_rect(d, [22, 508, w - 22, 548], 16, fill=(10, 40, 70, 255), outline=(94, 240, 255, 180), width=2)
    tw = d.textlength("Swap", font=f_btn)
    d.text(((w - tw) / 2, 516), "Swap", font=f_btn, fill=(244, 248, 255, 255))

    # Soft drop shadow canvas
    canvas = Image.new("RGBA", (w + 48, h + 48), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([0, 0, w - 1, h - 1], 28, fill=(0, 0, 0, 150))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    canvas.alpha_composite(shadow, (28, 30))
    canvas.alpha_composite(card, (16, 10))
    canvas.save(out)
    return out


def build_pools_mockup() -> Path:
    """All Pools grid highlighting CircBTC pairs (3-column new UI)."""
    ASSETS.mkdir(parents=True, exist_ok=True)
    out = ASSETS / "pools_circbtc_grid.png"

    pairs = [
        ("USDC", "CircBTC", LOGO_USDC, LOGO_CIRCBTC, "$184,220"),
        ("EURC", "CircBTC", LOGO_EURC, LOGO_CIRCBTC, "$96,410"),
        ("SWPRC", "CircBTC", LOGO_SWPRC, LOGO_CIRCBTC, "$52,780"),
    ]

    card_w, card_h = 300, 210
    gap = 18
    pad = 28
    header_h = 70
    w = pad * 2 + card_w * 3 + gap * 2
    h = pad + header_h + card_h + pad
    panel = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(panel)
    rounded_rect(
        d,
        [0, 0, w - 1, h - 1],
        26,
        fill=(8, 20, 44, 240),
        outline=(124, 197, 255, 140),
        width=2,
    )

    f_h = load_font(FONT_BOLD, 26)
    f_name = load_font(FONT_BOLD, 18)
    f_lab = load_font(FONT_REG, 13)
    f_val = load_font(FONT_BOLD, 22)
    f_btn = load_font(FONT_BOLD, 15)

    # Tabs
    rounded_rect(d, [pad, 18, pad + 130, 50], 14, fill=(14, 34, 68, 255), outline=(90, 140, 190, 100))
    d.text((pad + 22, 24), "My Positions", font=f_lab, fill=(160, 185, 210, 255))
    rounded_rect(d, [pad + 142, 18, pad + 270, 50], 14, fill=(46, 110, 246, 255))
    d.text((pad + 168, 24), "All Pools", font=f_lab, fill=(255, 255, 255, 255))

    for i, (a, b, la, lb, tvl) in enumerate(pairs):
        x = pad + i * (card_w + gap)
        y = header_h
        rounded_rect(
            d,
            [x, y, x + card_w, y + card_h],
            18,
            fill=(6, 16, 36, 255),
            outline=(100, 160, 220, 110),
        )
        # logos
        panel.alpha_composite(circle_logo(la, 28), (x + 16, y + 16))
        panel.alpha_composite(circle_logo(lb, 28), (x + 36, y + 16))
        d.text((x + 76, y + 20), f"{a} / {b}", font=f_name, fill=(244, 248, 255, 255))

        rounded_rect(d, [x + 14, y + 60, x + card_w - 14, y + 140], 12, fill=(4, 12, 28, 255))
        d.text((x + 26, y + 72), "TOTAL LIQUIDITY", font=f_lab, fill=(94, 240, 255, 230))
        d.text((x + 26, y + 96), tvl, font=f_val, fill=(244, 248, 255, 255))
        d.text((x + 26, y + 126), "Fee Tier  0.30%", font=f_lab, fill=(140, 170, 200, 255))

        rounded_rect(d, [x + 14, y + 156, x + card_w - 14, y + 192], 12, fill=(46, 110, 246, 255))
        tw = d.textlength("Deposit", font=f_btn)
        d.text((x + (card_w - tw) / 2, y + 164), "Deposit", font=f_btn, fill=(255, 255, 255, 255))

    canvas = Image.new("RGBA", (w + 48, h + 48), (0, 0, 0, 0))
    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle([0, 0, w - 1, h - 1], 26, fill=(0, 0, 0, 150))
    shadow = shadow.filter(ImageFilter.GaussianBlur(18))
    canvas.alpha_composite(shadow, (28, 30))
    canvas.alpha_composite(panel, (16, 10))
    canvas.save(out)
    return out


def build_badge_hero() -> Path:
    ASSETS.mkdir(parents=True, exist_ok=True)
    out = ASSETS / "elite_badge_hero.png"
    badge = Image.open(BADGE_PATH).convert("RGBA")
    bbox = badge.getbbox()
    if bbox:
        badge = badge.crop(bbox)
    size = 400
    badge = ImageOps.contain(badge, (size, size), Image.Resampling.LANCZOS)
    # Tight glow pad so badge sits close to titles (no huge empty halo)
    pad = 48
    canvas_s = size + pad * 2
    canvas = Image.new("RGBA", (canvas_s, canvas_s), (0, 0, 0, 0))
    glow = Image.new("RGBA", (canvas_s, canvas_s), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    cx = cy = canvas_s // 2
    for r, a in ((size // 2 + 28, 40), (size // 2 + 16, 78), (size // 2 + 6, 110)):
        gd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(94, 240, 255, a))
    glow = glow.filter(ImageFilter.GaussianBlur(18))
    canvas.alpha_composite(glow)
    canvas.alpha_composite(badge, ((canvas_s - badge.width) // 2, (canvas_s - badge.height) // 2))
    canvas.save(out)
    return out


def hex_to_rgba(color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    c = color.lstrip("#")
    r, g, b = int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)
    return (r, g, b, alpha)


def render_text_image(text: str, *, font: str, font_size: int, color: str) -> Image.Image:
    """Pillow text avoids MoviePy TextClip crop/half-cut bugs."""
    fnt = load_font(font, font_size)
    probe = ImageDraw.Draw(Image.new("RGBA", (8, 8), (0, 0, 0, 0)))
    bbox = probe.textbbox((0, 0), text, font=fnt)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    pad_x, pad_y = 20, 10
    img = Image.new("RGBA", (tw + pad_x * 2, th + pad_y * 2), (0, 0, 0, 0))
    ImageDraw.Draw(img).text(
        (pad_x - bbox[0], pad_y - bbox[1]),
        text,
        font=fnt,
        fill=hex_to_rgba(color),
    )
    return img


def center_pos(center_y: float, clip_h: float, t: float, slide: float, ease_d: float = 0.85):
    """MoviePy y is TOP-LEFT. Convert center_y → top, with soft slide-up entrance."""
    e = ease_out(t, ease_d)
    top = center_y - clip_h / 2.0 + slide * (1.0 - e)
    return ("center", top)


def anim_text(
    text: str,
    *,
    start: float,
    hold: float,
    font: str,
    font_size: int,
    color: str,
    center_y: float,
    fade_in: float = 0.55,
    fade_out: float = 0.5,
    slide: float = 16,
) -> ImageClip:
    img = render_text_image(text, font=font, font_size=font_size, color=color)
    clip = ImageClip(np.array(img), transparent=True).with_duration(hold).with_start(start)
    clip = clip.with_effects([vfx.FadeIn(fade_in), vfx.FadeOut(fade_out)])
    h = float(clip.h)

    def pos(t, _cy=center_y, _h=h, _s=slide):
        return center_pos(_cy, _h, t, _s)

    return clip.with_position(pos)


def load_scaled_image(path: Path, max_w: int | None = None, max_h: int | None = None) -> Image.Image:
    img = Image.open(path).convert("RGBA")
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    w, h = img.size
    scale = 1.0
    if max_w and w > max_w:
        scale = min(scale, max_w / w)
    if max_h and h > max_h:
        scale = min(scale, max_h / h)
    if scale < 1.0:
        img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.Resampling.LANCZOS)
    return img


def anim_image(
    path: Path,
    *,
    start: float,
    hold: float,
    center_y: float,
    max_w: int | None = None,
    max_h: int | None = None,
    fade_in: float = 0.7,
    fade_out: float = 0.55,
    slide: float = 22,
) -> ImageClip:
    img = load_scaled_image(path, max_w=max_w, max_h=max_h)
    clip = ImageClip(np.array(img), transparent=True).with_duration(hold).with_start(start)
    clip = clip.with_effects([vfx.FadeIn(fade_in), vfx.FadeOut(fade_out)])
    h = float(clip.h)

    def pos(t, _cy=center_y, _h=h, _s=slide):
        return center_pos(_cy, _h, t, _s, ease_d=0.95)

    return clip.with_position(pos)


def stack_centers(
    heights: list[float],
    *,
    gaps: list[float],
    frame_h: float = H,
    top_margin: float = 64,
    bottom_margin: float = 64,
) -> list[float]:
    """
    Vertically center a stack of elements with tight gaps.
    heights/gaps length: n heights, n-1 gaps.
    Returns center_y for each element.
    """
    assert len(gaps) == len(heights) - 1
    gaps = list(gaps)
    total = sum(heights) + sum(gaps)
    max_total = frame_h - top_margin - bottom_margin
    if total > max_total:
        # Prefer shrinking visual height budget via caller; here shrink gaps only
        overflow = total - max_total
        per = overflow / max(1, len(gaps))
        gaps = [max(6.0, g - per) for g in gaps]
        total = sum(heights) + sum(gaps)
    block_top = (frame_h - total) / 2.0
    block_top = max(top_margin, min(block_top, frame_h - bottom_margin - total))
    centers: list[float] = []
    y = block_top
    for i, h in enumerate(heights):
        centers.append(y + h / 2.0)
        y += h
        if i < len(gaps):
            y += gaps[i]
    return centers


def text_size(text: str, *, font: str, font_size: int) -> tuple[int, int]:
    img = render_text_image(text, font=font, font_size=font_size, color=WHITE)
    return img.size


def build_video() -> CompositeVideoClip:
    if not MUSIC_PATH.exists():
        raise FileNotFoundError(MUSIC_PATH)
    if not BADGE_PATH.exists():
        raise FileNotFoundError(BADGE_PATH)

    print("Generating mockup assets...")
    swap_path = build_swap_mockup()
    pools_path = build_pools_mockup()
    badge_path = build_badge_hero()
    print(f"  {swap_path.name}")
    print(f"  {pools_path.name}")
    print(f"  {badge_path.name}")

    # Pre-measure for tight centered stacks (small gaps between title → subtitle → visual)
    t1_w, t1_h = text_size("SWAPARC", font=FONT_BOLD, font_size=118)
    s1_w, s1_h = text_size("New chapter unlocked", font=FONT_REG, font_size=40)
    cy_title, cy_sub = stack_centers([t1_h, s1_h], gaps=[14])

    t2_w, t2_h = text_size("New Swap Pool is Live", font=FONT_BOLD, font_size=56)
    s2_w, s2_h = text_size("USDC  •  EURC  •  CircBTC  •  SWPRC", font=FONT_REG, font_size=32)
    swap_img = load_scaled_image(swap_path, max_w=500, max_h=470)
    cy_t2, cy_s2, cy_swap = stack_centers(
        [t2_h, s2_h, swap_img.height],
        gaps=[10, 18],
        top_margin=48,
        bottom_margin=48,
    )

    t3_w, t3_h = text_size("More Liquidity Pools", font=FONT_BOLD, font_size=56)
    s3_w, s3_h = text_size("New CircBTC pairs now available", font=FONT_REG, font_size=34)
    pools_img = load_scaled_image(pools_path, max_w=1000, max_h=400)
    cy_t3, cy_s3, cy_pools = stack_centers(
        [t3_h, s3_h, pools_img.height],
        gaps=[10, 18],
        top_margin=48,
        bottom_margin=48,
    )

    t4_w, t4_h = text_size("Elite Swaparcer Badge", font=FONT_BOLD, font_size=54)
    s4_w, s4_h = text_size("Earn it. Keep it forever.", font=FONT_REG, font_size=34)
    badge_img = load_scaled_image(badge_path, max_w=400, max_h=400)
    cy_t4, cy_s4, cy_badge = stack_centers(
        [t4_h, s4_h, badge_img.height],
        gaps=[10, 16],
        top_margin=48,
        bottom_margin=48,
    )

    print("Layout centers (y):")
    print(f"  title scene : {cy_title:.0f} / {cy_sub:.0f}")
    print(f"  swap scene  : {cy_t2:.0f} / {cy_s2:.0f} / {cy_swap:.0f}  (mock h={swap_img.height})")
    print(f"  pools scene : {cy_t3:.0f} / {cy_s3:.0f} / {cy_pools:.0f}  (mock h={pools_img.height})")
    print(f"  badge scene : {cy_t4:.0f} / {cy_s4:.0f} / {cy_badge:.0f}  (mock h={badge_img.height})")
    for name, cy, h in (
        ("swap", cy_swap, swap_img.height),
        ("pools", cy_pools, pools_img.height),
        ("badge", cy_badge, badge_img.height),
    ):
        top, bot = cy - h / 2, cy + h / 2
        print(f"  {name} bounds top={top:.0f} bot={bot:.0f} marginB={H - bot:.0f}")

    layers: list = [make_gradient_bg()]

    # ---- 0.0 – 5.0: title only (centered, fully visible) ----
    layers.append(
        anim_text(
            "SWAPARC",
            start=0.0,
            hold=5.0,
            font=FONT_BOLD,
            font_size=118,
            color=WHITE,
            center_y=cy_title,
            fade_in=0.9,
            fade_out=0.6,
            slide=12,
        )
    )
    layers.append(
        anim_text(
            "New chapter unlocked",
            start=0.85,
            hold=4.15,
            font=FONT_REG,
            font_size=40,
            color=CYAN,
            center_y=cy_sub,
            fade_in=0.75,
            fade_out=0.55,
            slide=8,
        )
    )

    # ---- 5.0 – 12.0: Swap (USDC → CircBTC), tight stack ----
    layers.append(
        anim_text(
            "New Swap Pool is Live",
            start=5.0,
            hold=7.0,
            font=FONT_BOLD,
            font_size=56,
            color=WHITE,
            center_y=cy_t2,
            fade_in=0.55,
            fade_out=0.45,
            slide=12,
        )
    )
    layers.append(
        anim_text(
            "USDC  •  EURC  •  CircBTC  •  SWPRC",
            start=5.35,
            hold=6.65,
            font=FONT_REG,
            font_size=32,
            color=CYAN,
            center_y=cy_s2,
            fade_in=0.55,
            fade_out=0.4,
            slide=8,
        )
    )
    layers.append(
        anim_image(
            swap_path,
            start=5.4,
            hold=6.6,
            center_y=cy_swap,
            max_w=500,
            max_h=470,
            fade_in=0.65,
            fade_out=0.45,
            slide=14,
        )
    )

    # ---- 12.0 – 19.5: CircBTC pools, tight stack ----
    layers.append(
        anim_text(
            "More Liquidity Pools",
            start=12.0,
            hold=7.5,
            font=FONT_BOLD,
            font_size=56,
            color=WHITE,
            center_y=cy_t3,
            fade_in=0.55,
            fade_out=0.45,
            slide=12,
        )
    )
    layers.append(
        anim_text(
            "New CircBTC pairs now available",
            start=12.35,
            hold=7.15,
            font=FONT_REG,
            font_size=34,
            color=CYAN,
            center_y=cy_s3,
            fade_in=0.55,
            fade_out=0.4,
            slide=8,
        )
    )
    layers.append(
        anim_image(
            pools_path,
            start=12.4,
            hold=7.1,
            center_y=cy_pools,
            max_w=1000,
            max_h=400,
            fade_in=0.65,
            fade_out=0.45,
            slide=14,
        )
    )

    # ---- 19.5 – 26.5: Elite badge hero, tight stack ----
    layers.append(
        anim_text(
            "Elite Swaparcer Badge",
            start=19.5,
            hold=7.0,
            font=FONT_BOLD,
            font_size=54,
            color=WHITE,
            center_y=cy_t4,
            fade_in=0.55,
            fade_out=0.45,
            slide=10,
        )
    )
    layers.append(
        anim_text(
            "Earn it. Keep it forever.",
            start=19.9,
            hold=6.6,
            font=FONT_REG,
            font_size=34,
            color=CYAN_BRIGHT,
            center_y=cy_s4,
            fade_in=0.6,
            fade_out=0.4,
            slide=8,
        )
    )
    layers.append(
        anim_image(
            badge_path,
            start=19.75,
            hold=6.75,
            center_y=cy_badge,
            max_w=400,
            max_h=400,
            fade_in=0.7,
            fade_out=0.5,
            slide=12,
        )
    )

    # ---- 26.5 – 30.0: final ----
    layers.append(
        anim_text(
            "swaparc.app",
            start=26.5,
            hold=3.5,
            font=FONT_BOLD,
            font_size=56,
            color=CYAN,
            center_y=H * 0.50,
            fade_in=0.45,
            fade_out=1.1,
            slide=6,
        )
    )

    video = CompositeVideoClip(layers, size=(W, H)).with_duration(DURATION)
    video = video.with_effects([vfx.FadeOut(1.2)])

    audio = AudioFileClip(str(MUSIC_PATH)).subclipped(0, DURATION)
    audio = audio.with_effects([afx.AudioFadeIn(1.4), afx.AudioFadeOut(2.0)])
    return video.with_audio(audio)


def export_preview_frames(clip: CompositeVideoClip, times: list[float]) -> None:
    preview_dir = ASSETS / "preview_v4"
    preview_dir.mkdir(parents=True, exist_ok=True)
    for t in times:
        frame = clip.get_frame(t)
        path = preview_dir / f"frame_{t:04.1f}s.png"
        Image.fromarray(frame).save(path)
        print(f"  preview {path.name}")


def main() -> None:
    print("Building Swaparc promo v4 (composition fix)...")
    print(f"  Music : {MUSIC_PATH.name}")
    print(f"  Output: {OUT_PATH}")
    clip = build_video()
    try:
        print("Exporting preview frames for QA...")
        export_preview_frames(clip, [2.5, 8.0, 15.5, 22.5, 28.0])
        clip.write_videofile(
            str(OUT_PATH),
            fps=FPS,
            codec="libx264",
            audio_codec="aac",
            bitrate="12000k",
            audio_bitrate="192k",
            preset="faster",
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
