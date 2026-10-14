"""Pre-generate listen-mode audio (one mp3 per part) so it keeps playing in the
background on phones.

Why: phone browsers go silent for speechSynthesis (the browser's built-in
text-to-speech) as soon as the app is no longer on screen - e.g. while a
navigation app is in front. A real <audio> file is treated like music and keeps
playing, so listen mode uses these files when they exist and falls back to
speechSynthesis for anything that has no file.

Each part (100 words, same grouping/order as the app: level + category, sorted
by freq then id) becomes audio/L<level>_<category>_<part>.mp3 following the
pattern word, meaning, example, example translation, each once. (The speech
version repeats each twice, but that doubles the file size - 8,000 words would
not fit comfortably in a GitHub Pages repo - so the audio version relies on the
app's "repeat" option to loop the whole part instead.) audio/manifest.json records
each part's word ids and the start time of every word so the app can show the
current word and skip between words.

Needs the third-party `edge-tts` package (Microsoft Edge's online neural voices,
no API key). Generated clips are cached in --cache so re-runs only fetch what is
missing, and parts that already exist are skipped unless --force is given.

    pip install edge-tts
    python scripts/make_audio.py                 # everything
    python scripts/make_audio.py --levels 0      # only Level 0
    python scripts/make_audio.py --only 0:life:0 # a single part
"""
import argparse
import asyncio
import hashlib
import json
import re
import sys
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent.parent
PART_SIZE = 100

VOICE_EN = "en-US-AriaNeural"
VOICE_KO = "ko-KR-SunHiNeural"
RATE_WORD = "-5%"  # matches the 0.95 speed listen mode used for words
RATE_EXAMPLE = "-8%"  # matches 0.92 for example sentences
RATE_KO = "+0%"

# edge-tts always returns 48 kbps / 24 kHz / mono MPEG-2 Layer III. Every frame is
# 144 bytes and 576 samples (0.024 s), which lets us concatenate clips as plain
# bytes and compute exact timings without decoding anything.
FRAME_BYTES = 144
FRAME_SECONDS = 576 / 24000
SILENT_FRAME = bytes([0xFF, 0xF3, 0x64, 0xC4]) + bytes(FRAME_BYTES - 4)


def silence(seconds):
    return SILENT_FRAME * max(1, round(seconds / FRAME_SECONDS))


# pause (seconds) that follows each step of a word. Kept short on purpose: silence
# costs as many bytes as speech in a constant-bitrate mp3.
GAPS = [0.45, 0.9, 0.6, 1.3]


def clean_clip(data):
    """Drop the encoder's leading info frame and trim to whole frames."""
    if data[13:17] == b"LAME" or data[13:17] in (b"Info", b"Xing"):
        data = data[FRAME_BYTES:]
    return data[: len(data) // FRAME_BYTES * FRAME_BYTES]


def short_meaning(word):
    return re.split(r"[;,]", word.get("meaning_kr") or "")[0].strip()


def word_steps(word):
    meaning = short_meaning(word)
    return [
        (word["headword"], VOICE_EN, RATE_WORD),
        (meaning, VOICE_KO, RATE_KO),
        (word.get("example_en") or "", VOICE_EN, RATE_EXAMPLE),
        (word.get("example_kr") or "", VOICE_KO, RATE_KO),
    ]


def build_parts(words):
    groups = {}
    for w in words:
        groups.setdefault((w["level"], w["category"]), []).append(w)
    parts = []
    for (level, category), group in sorted(groups.items()):
        group.sort(key=lambda w: (w.get("freq") or 3, w["id"]))
        for i in range(0, len(group), PART_SIZE):
            parts.append((level, category, i // PART_SIZE, group[i : i + PART_SIZE]))
    return parts


class ClipFactory:
    def __init__(self, cache_dir, concurrency):
        self.cache_dir = cache_dir
        self.sem = asyncio.Semaphore(concurrency)
        self.pending = {}

    def _path(self, text, voice, rate):
        key = hashlib.sha1(f"{voice}|{rate}|{text}".encode("utf-8")).hexdigest()
        return self.cache_dir / key[:2] / f"{key}.mp3"

    async def get(self, text, voice, rate):
        path = self._path(text, voice, rate)
        if path.exists():
            return clean_clip(path.read_bytes())
        if path not in self.pending:
            self.pending[path] = asyncio.ensure_future(self._fetch(text, voice, rate, path))
        await self.pending[path]
        return clean_clip(path.read_bytes())

    async def _fetch(self, text, voice, rate, path):
        async with self.sem:
            for attempt in range(6):
                try:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    tmp = path.with_suffix(".part")
                    await edge_tts.Communicate(text, voice, rate=rate).save(str(tmp))
                    if tmp.stat().st_size < FRAME_BYTES * 3:
                        raise RuntimeError("empty audio")
                    tmp.replace(path)
                    return
                except Exception as exc:  # network hiccup / rate limit - back off and retry
                    if attempt == 5:
                        raise RuntimeError(f"TTS failed for {text!r}: {exc}") from exc
                    await asyncio.sleep(1.5 * (attempt + 1))


async def render_part(factory, words):
    """Return (mp3 bytes, per-word start times in seconds)."""
    all_steps = [word_steps(w) for w in words]
    clips = await asyncio.gather(
        *[
            factory.get(text, voice, rate) if text else _empty()
            for steps in all_steps
            for text, voice, rate in steps
        ]
    )
    out = bytearray()
    starts = []
    it = iter(clips)
    for steps in all_steps:
        starts.append(round(len(out) / FRAME_BYTES * FRAME_SECONDS, 3))
        for gap in GAPS[: len(steps)]:
            clip = next(it)
            out += clip
            out += silence(gap)
    return bytes(out), starts


async def _empty():
    return b""


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--levels", nargs="*", type=int, help="only these levels")
    ap.add_argument("--only", nargs="*", help="only these parts, e.g. 0:life:0")
    ap.add_argument("--limit", type=int, help="only the first N words of each part (testing)")
    ap.add_argument("--out", default=str(ROOT / "audio"))
    ap.add_argument("--cache", default=str(ROOT / ".audio-cache"))
    ap.add_argument("--concurrency", type=int, default=6)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    words = json.loads((ROOT / "data" / "words.json").read_text(encoding="utf-8"))
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.json"
    manifest = {"version": 1, "parts": {}}
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    factory = ClipFactory(Path(args.cache), args.concurrency)
    todo = []
    for level, category, part, group in build_parts(words):
        chapter_id = f"{level}:{category}:{part}"
        if args.levels is not None and level not in args.levels:
            continue
        if args.only and chapter_id not in args.only:
            continue
        todo.append((chapter_id, level, category, part, group))

    for n, (chapter_id, level, category, part, group) in enumerate(todo, 1):
        filename = f"L{level}_{category}_{part}.mp3"
        if not args.force and chapter_id in manifest["parts"] and (out_dir / filename).exists():
            print(f"[{n}/{len(todo)}] {chapter_id} already done, skipping")
            continue
        if args.limit:
            group = group[: args.limit]
        data, starts = await render_part(factory, group)
        (out_dir / filename).write_bytes(data)
        manifest["parts"][chapter_id] = {
            "file": filename,
            "ids": [w["id"] for w in group],
            "starts": starts,
            "duration": round(len(data) / FRAME_BYTES * FRAME_SECONDS, 2),
        }
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        print(f"[{n}/{len(todo)}] {chapter_id} -> {filename} ({len(data) / 1e6:.1f} MB, {len(group)} words)", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
