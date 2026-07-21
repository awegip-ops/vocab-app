"""앱 아이콘 생성 스크립트 (favicon + PWA 아이콘 + 데스크톱 바로가기용 .ico)

작은 크기(16px)에서도 또렷하게 보이도록, 심볼을 큼직한 흰색 "A" 하나만
쓰고 고해상도(1024px)에서 그린 뒤 고품질로 축소하는 방식을 씁니다.

이전 버전은 "A" + 작은 "가" 배지 두 요소를 같이 그렸는데, 16px처럼 아주
작은 크기로 축소하면 두 요소가 뭉개져서 하나로 뭉치는 문제가 있었습니다
(Chrome 앱 창의 taskbar 아이콘이 정확히 이 16px 프레임을 사용해서 뭉개진
채로 보였던 게 실제 원인이었습니다). 요소를 하나로 줄이면 모든 크기에서
같은 모양이 그대로 축소되므로 이 문제 자체가 생기지 않습니다.
"""
from PIL import Image, ImageDraw, ImageFont

MASTER = 1024
PRIMARY = (79, 70, 229)       # #4f46e5
PRIMARY_DARK = (67, 56, 202)  # #4338ca
WHITE = (255, 255, 255, 255)

FONT_PATH = r"C:\Windows\Fonts\malgunbd.ttf"


def make_base(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    for y in range(size):
        t_row = y / size
        for x in range(size):
            t = (x / size * 0.35) + (t_row * 0.65)  # 대각선에 가까운 세로 위주 그라데이션
            t = max(0.0, min(1.0, t))
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


def centered_text(draw, text, font, cx, cy, fill):
    bbox = draw.textbbox((0, 0), text, font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = cx - w / 2 - bbox[0]
    y = cy - h / 2 - bbox[1]
    draw.text((x, y), text, font=font, fill=fill)


def draw_wordmark(img, size):
    draw = ImageDraw.Draw(img)

    # 심볼은 큼직한 흰색 "A" 하나만 사용 (16px까지도 뭉개지지 않도록 단순화)
    font_a = ImageFont.truetype(FONT_PATH, int(size * 0.62))
    centered_text(draw, "A", font_a, size * 0.5, size * 0.5, WHITE)

    return img


def main():
    base = make_base(MASTER)
    icon = draw_wordmark(base.copy(), MASTER)
    icon.save("icons/icon-master.png")

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
        icon.resize((s, s), Image.LANCZOS).save(path)

    # 파비콘/바로가기용 .ico - 윈도우 화면 배율(100~250%)별로 실제 요청되는
    # 모든 크기를 다 포함시켜서, 딱 맞는 크기가 없어 억지로 확대되는 일이 없게 함
    #
    # 중요: Pillow의 ICO 저장은 "고해상도 원본 이미지 하나"에 sizes 목록을
    # 넘겨야 각 크기를 원본에서 축소해서 만들어줍니다. (작게 미리 축소한
    # 이미지를 append_images로 넘기면 그 작은 크기보다 큰 항목은 전부
    # 조용히 무시되어버립니다 - 이게 지금까지 흐릿했던 진짜 원인이었습니다.)
    sizes = [16, 20, 24, 28, 32, 40, 48, 56, 60, 64, 72, 80, 96, 128, 256]
    icon.save(
        "icons/favicon.ico",
        format="ICO",
        sizes=[(s, s) for s in sizes],
    )

    print("done")


if __name__ == "__main__":
    main()
