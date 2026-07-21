"""앱 아이콘 생성 스크립트 (favicon + PWA 아이콘 + 데스크톱 바로가기용 .ico)"""
from PIL import Image, ImageDraw, ImageFont
import math

SIZE = 512
PRIMARY = (79, 70, 229)       # #4f46e5
PRIMARY_DARK = (67, 56, 202)  # #4338ca
WHITE = (255, 255, 255, 255)

FONT_PATH = r"C:\Windows\Fonts\malgunbd.ttf"


def make_base(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * size)  # 0..1 diagonal gradient
            r = int(PRIMARY[0] + (PRIMARY_DARK[0] - PRIMARY[0]) * t)
            g = int(PRIMARY[1] + (PRIMARY_DARK[1] - PRIMARY[1]) * t)
            b = int(PRIMARY[2] + (PRIMARY_DARK[2] - PRIMARY[2]) * t)
            px[x, y] = (r, g, b, 255)

    mask = Image.new("L", (size, size), 0)
    mdraw = ImageDraw.Draw(mask)
    radius = int(size * 0.225)
    mdraw.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    img.putalpha(mask)
    return img


def draw_wordmark(img, size):
    draw = ImageDraw.Draw(img)

    # 위쪽: 영어 "A"
    font_en = ImageFont.truetype(FONT_PATH, int(size * 0.30))
    en_text = "A"
    bbox = draw.textbbox((0, 0), en_text, font=font_en)
    ew, eh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    ex = (size - ew) / 2 - bbox[0]
    ey = size * 0.14 - bbox[1]
    draw.text((ex, ey), en_text, font=font_en, fill=WHITE)

    # 구분선 (얇은 흰 선, 카드 느낌)
    line_y = size * 0.52
    draw.line(
        [(size * 0.30, line_y), (size * 0.70, line_y)],
        fill=(255, 255, 255, 190),
        width=max(2, int(size * 0.012)),
    )

    # 아래쪽: 한글 "가"
    font_kr = ImageFont.truetype(FONT_PATH, int(size * 0.26))
    kr_text = "가"
    bbox2 = draw.textbbox((0, 0), kr_text, font=font_kr)
    kw, kh = bbox2[2] - bbox2[0], bbox2[3] - bbox2[1]
    kx = (size - kw) / 2 - bbox2[0]
    ky = size * 0.58 - bbox2[1]
    draw.text((kx, ky), kr_text, font=font_kr, fill=(255, 255, 255, 235))

    return img


def main():
    base = make_base(SIZE)
    icon = draw_wordmark(base.copy(), SIZE)

    icon.save("icons/icon-512.png")
    icon.resize((192, 192), Image.LANCZOS).save("icons/icon-192.png")
    icon.resize((180, 180), Image.LANCZOS).save("icons/apple-touch-icon.png")
    icon.resize((32, 32), Image.LANCZOS).save("icons/icon-32.png")

    # 파비콘/바로가기용 .ico (여러 해상도 포함)
    sizes = [16, 32, 48, 64, 128, 256]
    imgs = [icon.resize((s, s), Image.LANCZOS) for s in sizes]
    imgs[0].save(
        "icons/favicon.ico",
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=imgs[1:],
    )

    print("done")


if __name__ == "__main__":
    main()
