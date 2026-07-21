"""앱 아이콘 생성 스크립트 (favicon + PWA 아이콘 + 데스크톱 바로가기용 .ico)

핵심 심볼은 큼직한 흰색 "A" 하나만 사용합니다 (16px에서도 뭉개지지 않도록).

이전 버전들의 문제:
1) "A" + 작은 "가" 배지 두 요소 -> 16px에서 서로 겹쳐 뭉개짐 (제거함)
2) 폰트(맑은 고딕)로 그린 "A"를 1024px에서 16~32px로 축소 -> 폰트 힌팅이
   빠져서 획이 흐릿함. 크기별로 직접 그려도 여전히 폰트 자체의 획 굵기가
   가늘어서 (한글 폰트라 라틴 알파벳 최적화가 아님) 작은 크기에서 또렷함이
   부족했습니다.
   -> 폰트를 아예 쓰지 않고, "A"를 두꺼운 다각형(삼각형 두 다리 + 가로줄)
   으로 직접 그리는 방식으로 바꿨습니다. 다각형은 폰트 힌팅과 무관하게
   벡터 형태 그대로이므로, 큰 해상도로 그려서 축소해도(슈퍼샘플링 안티
   앨리어싱) 항상 두껍고 또렷합니다.
3) Pillow의 Image.save(format="ICO", sizes=[...])는 넘겨준 이미지 "하나"를
   각 크기로 리사이즈할 뿐이라, 프레임마다 다른 원본을 쓸 수 없습니다.
   -> favicon.ico는 각 크기별로 직접 렌더링한 PNG들을 모아 ICO 파일
   포맷을 직접 조립합니다 (build_ico 함수).
"""
import io
import struct

from PIL import Image, ImageDraw

PRIMARY = (79, 70, 229)       # #4f46e5
PRIMARY_DARK = (67, 56, 202)  # #4338ca
WHITE = (255, 255, 255, 255)

SUPERSAMPLE = 1024  # 항상 이 해상도로 그린 뒤 목표 크기로 축소


def make_background(big):
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
    return img


def pt(u, v, big):
    return (u * big, v * big)


def draw_bold_a(draw, big):
    # 굵은 기하학적 "A": 왼쪽 다리 / 오른쪽 다리 / 가로줄, 세 다각형으로 구성
    apex = (0.50, 0.06)
    outer_bl = (0.08, 0.94)
    inner_bl = (0.29, 0.94)
    inner_apex = (0.50, 0.42)
    outer_br = (0.92, 0.94)
    inner_br = (0.71, 0.94)

    left_leg = [apex, outer_bl, inner_bl, inner_apex]
    right_leg = [apex, outer_br, inner_br, inner_apex]
    crossbar = [(0.17, 0.62), (0.83, 0.62), (0.83, 0.78), (0.17, 0.78)]

    for poly in (left_leg, right_leg, crossbar):
        draw.polygon([pt(u, v, big) for u, v in poly], fill=WHITE)


def render_icon(size):
    big = SUPERSAMPLE
    img = make_background(big)
    draw = ImageDraw.Draw(img)
    draw_bold_a(draw, big)
    return img.resize((size, size), Image.LANCZOS)


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
