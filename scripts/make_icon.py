"""앱 아이콘 생성 스크립트 (favicon + PWA 아이콘 + 데스크톱 바로가기용 .ico)

작은 크기(16~32px)에서도 또렷하게 보이도록, 핵심 심볼(큰 "A")을 하나로
단순화하고 고해상도(1024px)에서 그린 뒤 고품질로 축소하는 방식을 씁니다.
"가"는 작은 배지로만 곁들여서, 큰 아이콘에서는 한/영 컨셉이 보이고
작은 아이콘에서는 자연스럽게 사라지도록 했습니다.
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

    # 메인 심볼: 큼직한 흰색 "A" (작은 크기에서도 확실히 보이도록 크고 굵게)
    font_a = ImageFont.truetype(FONT_PATH, int(size * 0.60))
    centered_text(draw, "A", font_a, size * 0.5, size * 0.5, WHITE)

    # 보조 배지: 오른쪽 아래에 작은 흰 원 + 보라색 "가" (한/영 컨셉, 포인트 요소)
    badge_r = size * 0.205
    badge_cx = size * 0.755
    badge_cy = size * 0.755
    draw.ellipse(
        [badge_cx - badge_r, badge_cy - badge_r, badge_cx + badge_r, badge_cy + badge_r],
        fill=(255, 255, 255, 255),
    )
    font_kr = ImageFont.truetype(FONT_PATH, int(badge_r * 1.35))
    centered_text(draw, "가", font_kr, badge_cx, badge_cy * 1.01, PRIMARY_DARK)

    return img


def main():
    base = make_base(MASTER)
    icon = draw_wordmark(base.copy(), MASTER)
    icon.save("icons/icon-master.png")

    targets = {
        "icons/icon-512.png": 512,
        "icons/icon-192.png": 192,
        "icons/apple-touch-icon.png": 180,
        "icons/icon-32.png": 32,
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
