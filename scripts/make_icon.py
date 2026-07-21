"""앱 아이콘 생성 스크립트 (favicon + PWA 아이콘 + 데스크톱 바로가기용 .ico)

핵심 심볼은 큼직한 흰색 "A" 하나만 사용합니다 (16px에서도 뭉개지지 않도록).

이전 버전들의 문제:
1) "A" + 작은 "가" 배지 두 요소 -> 16px에서 서로 겹쳐 뭉개짐 (제거함)
2) 1024px 마스터 이미지 하나를 모든 크기로 축소 -> 글자를 큰 해상도로
   그린 뒤 16~32px처럼 아주 작은 크기로 한 번에 축소(64배 축소)하면,
   트루타입 폰트의 "힌팅"(작은 크기에서 획을 픽셀 격자에 맞춰주는 보정)이
   전혀 적용되지 않아 획이 흐릿하고 지저분해 보였습니다.
   -> 각 크기를 "그 크기 그대로" 직접 렌더링하도록 바꿔서, 폰트 힌팅이
   해당 크기에 맞게 정상적으로 적용되게 했습니다. 배경(둥근 사각형)만
   경계선이 매끈하도록 4배 슈퍼샘플링 후 축소합니다.
3) Pillow의 Image.save(format="ICO", sizes=[...])는 넘겨준 이미지 "하나"를
   각 크기로 리사이즈할 뿐이라, 프레임마다 다른 원본을 쓸 수 없습니다.
   -> favicon.ico는 각 크기별로 직접 렌더링한 PNG들을 모아 ICO 파일
   포맷을 직접 조립합니다 (build_ico 함수).
"""
import io
import struct

from PIL import Image, ImageDraw, ImageFont

PRIMARY = (79, 70, 229)       # #4f46e5
PRIMARY_DARK = (67, 56, 202)  # #4338ca
WHITE = (255, 255, 255, 255)

FONT_PATH = r"C:\Windows\Fonts\malgunbd.ttf"


def make_background(size, supersample=4):
    big = size * supersample
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    px = img.load()
    for y in range(big):
        t_row = y / big
        for x in range(big):
            t = (x / big * 0.35) + (t_row * 0.65)
            t = max(0.0, min(1.0, t))
            r = int(PRIMARY[0] + (PRIMARY_DARK[0] - PRIMARY[0]) * t)
            g = int(PRIMARY[1] + (PRIMARY_DARK[1] - PRIMARY[1]) * t)
            b = int(PRIMARY[2] + (PRIMARY_DARK[2] - PRIMARY[2]) * t)
            px[x, y] = (r, g, b, 255)

    mask = Image.new("L", (big, big), 0)
    mdraw = ImageDraw.Draw(mask)
    radius = int(big * 0.225)
    mdraw.rounded_rectangle([0, 0, big - 1, big - 1], radius=radius, fill=255)
    img.putalpha(mask)

    return img.resize((size, size), Image.LANCZOS)


def centered_text(draw, text, font, cx, cy, fill):
    bbox = draw.textbbox((0, 0), text, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = cx - w / 2 - bbox[0]
    y = cy - h / 2 - bbox[1]
    draw.text((x, y), text, font=font, fill=fill)


def render_icon(size):
    img = make_background(size)
    draw = ImageDraw.Draw(img)
    # 폰트를 이 크기 그대로 로드해서 그려야 작은 크기용 힌팅이 적용됨
    font_a = ImageFont.truetype(FONT_PATH, max(1, int(size * 0.62)))
    centered_text(draw, "A", font_a, size * 0.5, size * 0.5, WHITE)
    return img


def build_ico(path, sizes):
    images = [(s, render_icon(s)) for s in sizes]
    entries = []
    blob = b""
    offset = 6 + 16 * len(images)
    for size, img in images:
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        png_bytes = buf.getvalue()
        wh = size if size < 256 else 0
        entries.append(
            struct.pack("<BBBBHHII", wh, wh, 0, 0, 1, 32, len(png_bytes), offset)
        )
        blob += png_bytes
        offset += len(png_bytes)

    with open(path, "wb") as f:
        f.write(struct.pack("<HHH", 0, 1, len(images)))
        for e in entries:
            f.write(e)
        f.write(blob)


def main():
    render_icon(1024).save("icons/icon-master.png")

    targets = {
        "icons/icon-512.png": 512,
        "icons/icon-192.png": 192,
        "icons/icon-128.png": 128,
        "icons/apple-touch-icon.png": 180,
        "icons/icon-64.png": 64,
        "icons/icon-48.png": 48,
        "icons/icon-32.png": 32,
        "icons/icon-16.png": 16,
    }
    for path, s in targets.items():
        render_icon(s).save(path)

    # 윈도우가 화면 배율(100~250%)에 따라 실제로 요청하는 모든 크기를 포함
    sizes = [16, 20, 24, 28, 32, 40, 48, 56, 60, 64, 72, 80, 96, 128, 256]
    build_ico("icons/favicon.ico", sizes)

    print("done")


if __name__ == "__main__":
    main()
