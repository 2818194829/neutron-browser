# -*- coding: utf-8 -*-
"""
生成 Neutron Browser NSIS 安装向导的 Modern 风格界面资源。

产出：
  assets/installer/installerSidebar.bmp   164x314  欢迎/完成页左侧侧边栏（深海军蓝 + 品牌渐变 + 图标）
  assets/installer/installerHeader.bmp    150x57   内页页眉（浅色 + 品牌渐变发丝线 + 小图标）

品牌色与官网（03 Neutron浏览器官网/css/style.css）保持一致：
  #4f8bff / #7c5cff / #2dd4bf，深海军蓝 #16203c -> #0f1730

NSIS MUI2 要求：位图为 24 位无压缩 BMP（无 alpha 通道），故最终以 RGB 保存。
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ICON_PATH = ROOT / "assets" / "icons" / "icon.png"
OUT_DIR = ROOT / "assets" / "installer"

# ---- 品牌色 ----
ACCENT_1 = (79, 139, 255)    # #4f8bff
ACCENT_2 = (124, 92, 255)    # #7c5cff
ACCENT_3 = (45, 212, 191)    # #2dd4bf
NAVY_TOP = (22, 32, 60)      # #16203c
NAVY_BOTTOM = (15, 23, 48)   # #0f1730
INK = (232, 237, 248)        # 侧边栏文字

SIDEBAR_SIZE = (164, 314)
HEADER_SIZE = (150, 57)


def font(size, name="segoeui.ttf", semibold=False, light=False):
    base = Path("C:/Windows/Fonts")
    if semibold:
        candidates = [base / "seguisb.ttf", base / name]
    elif light:
        candidates = [base / "segoeuil.ttf", base / name]
    else:
        candidates = [base / name]
    for c in candidates:
        if c.exists():
            return ImageFont.truetype(str(c), size)
    return ImageFont.load_default()


def v_gradient(size, top, bottom):
    """垂直渐变底图"""
    w, h = size
    img = Image.new("RGB", size)
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        for x in range(w):
            px[x, y] = c
    return img


def h_gradient_line(width, height, stops):
    """水平渐变条（用于品牌渐变装饰线）"""
    img = Image.new("RGB", (width, height))
    px = img.load()
    seg = len(stops) - 1
    seg_w = width / seg
    for x in range(width):
        i = min(int(x // seg_w), seg - 1)
        t = (x - i * seg_w) / seg_w
        c = tuple(round(stops[i][k] + (stops[i + 1][k] - stops[i][k]) * t) for k in range(3))
        for y in range(height):
            px[x, y] = c
    return img


def mix(c1, c2, t=0.5):
    return tuple(round(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))


def dot_grid(draw, w, h, step=12, r=1, alpha=12):
    """现代点阵纹理"""
    color = (255, 255, 255, alpha)
    for y in range(0, h + step, step):
        for x in range(0, w + step, step):
            draw.ellipse((x - r, y - r, x + r, y + r), fill=color)


def corner_glow(base, cx, cy, radius, color, alpha):
    """角落柔光（多次同心椭圆叠加模拟径向渐变）"""
    glow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    rings = 60
    for i in range(rings, 0, -1):
        r = radius * i / rings
        a = int(alpha * (1 - i / rings) ** 2)
        if a <= 0:
            continue
        gd.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(*color, a))
    glow = glow.filter(ImageFilter.GaussianBlur(6))
    return Image.alpha_composite(base.convert("RGBA"), glow)


def build_sidebar():
    w, h = SIDEBAR_SIZE
    base = v_gradient(SIDEBAR_SIZE, NAVY_TOP, NAVY_BOTTOM)

    img = base.convert("RGBA")
    draw = ImageDraw.Draw(img)

    # 1. 点阵纹理
    dot_grid(draw, w, h, step=12, r=1, alpha=12)

    # 2. 右上角品牌蓝柔光
    img = corner_glow(img, cx=w + 20, cy=-30, radius=170, color=ACCENT_1, alpha=60)
    # 左下角青色柔光
    img = corner_glow(img, cx=-30, cy=h + 40, radius=150, color=ACCENT_3, alpha=34)
    draw = ImageDraw.Draw(img)

    # 3. 中央磨砂圆 + 图标
    cx, cy, r = w // 2, 106, 47
    draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(255, 255, 255, 18))
    ring = 2
    draw.ellipse(
        (cx - r - ring, cy - r - ring, cx + r + ring, cy + r + ring),
        outline=(*mix(ACCENT_1, ACCENT_2), 150), width=ring,
    )
    icon = Image.open(ICON_PATH).convert("RGBA")
    icon = icon.resize((62, 62), Image.LANCZOS)
    img.alpha_composite(icon, (cx - 31, cy - 31))

    # 4. 品牌字标
    f = font(15, semibold=True)
    text = "NEUTRON"
    box = draw.textbbox((0, 0), text, font=f)
    tw = box[2] - box[0]
    draw.text(((w - tw) / 2, 190), text, font=f, fill=INK)

    f2 = font(9, light=True)
    text2 = "BROWSER"
    # 手动字距
    letter_w = draw.textlength("W", font=f2)
    total = sum(draw.textlength(ch, font=f2) + 3 for ch in text2) - 3
    x = (w - total) / 2
    for ch in text2:
        draw.text((x, 214), ch, font=f2, fill=(148, 160, 190))
        x += draw.textlength(ch, font=f2) + 3

    # 5. 底部品牌渐变条
    strip = h_gradient_line(w, 6, [ACCENT_1, ACCENT_2, ACCENT_3]).convert("RGBA")
    img.alpha_composite(strip, (0, h - 6))

    return img.convert("RGB")


def build_header():
    w, h = HEADER_SIZE
    # 浅色底（与 MUI2 白色页面衔接）
    img = Image.new("RGB", HEADER_SIZE, (248, 249, 251))
    img = img.convert("RGBA")
    draw = ImageDraw.Draw(img)

    # 右侧极淡品牌光晕（圆心固定在右边缘上方）
    gx, gy = w - 10, 8
    for i in range(50, 0, -1):
        r = 90 * i / 50
        a = int(16 * (1 - i / 50) ** 2)
        if a <= 0:
            continue
        draw.ellipse((gx - r, gy - r, gx + r, gy + r), fill=(*ACCENT_2, a))

    # 底部品牌渐变发丝线
    strip = h_gradient_line(w, 3, [ACCENT_1, ACCENT_2, ACCENT_3]).convert("RGBA")
    img.alpha_composite(strip, (0, h - 3))

    # 右侧小图标
    icon = Image.open(ICON_PATH).convert("RGBA")
    icon = icon.resize((30, 30), Image.LANCZOS)
    img.alpha_composite(icon, (w - 44, (h - 30) // 2))

    return img.convert("RGB")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sidebar = build_sidebar()
    header = build_header()

    sidebar_path = OUT_DIR / "installerSidebar.bmp"
    header_path = OUT_DIR / "installerHeader.bmp"
    sidebar.save(sidebar_path, format="BMP")
    header.save(header_path, format="BMP")
    print(f"[Artwork] saved {sidebar_path} ({sidebar.size})")
    print(f"[Artwork] saved {header_path} ({header.size})")


if __name__ == "__main__":
    main()
