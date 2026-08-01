#!/usr/bin/env python3
"""把 SRT 自动绘制为透明 PNG 字幕清单，供 FFmpeg overlay 使用。"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


FONT_PATH = "/System/Library/Fonts/STHeiti Medium.ttc"
HIGHLIGHT = re.compile(r"(AI|人工复核|2\.4万元|52\.8万元|633\.6万元|九十六|96|节约|成本)")


def timestamp_ms(value: str) -> int:
    hours, minutes, rest = value.split(":")
    seconds, millis = rest.split(",")
    return (
        int(hours) * 3_600_000
        + int(minutes) * 60_000
        + int(seconds) * 1_000
        + int(millis)
    )


def parse_srt(text: str) -> list[dict]:
    cues = []
    blocks = re.split(r"\n\s*\n", text.strip())
    for block in blocks:
        lines = block.splitlines()
        if len(lines) < 3 or " --> " not in lines[1]:
            continue
        start, end = lines[1].split(" --> ", 1)
        cues.append(
            {
                "startMs": timestamp_ms(start.strip()),
                "endMs": timestamp_ms(end.strip()),
                "lines": lines[2:4],
            }
        )
    return cues


def text_width(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.FreeTypeFont) -> float:
    box = draw.textbbox((0, 0), text, font=font)
    return float(box[2] - box[0])


def draw_centered_runs(draw: ImageDraw.ImageDraw, y: int, line: str, font: ImageFont.FreeTypeFont) -> None:
    runs = [value for value in HIGHLIGHT.split(line) if value]
    widths = [text_width(draw, value, font) for value in runs]
    x = (1600 - sum(widths)) / 2
    for value, width in zip(runs, widths):
        color = (120, 235, 216, 255) if HIGHLIGHT.fullmatch(value) else (255, 255, 255, 255)
        draw.text((x, y), value, font=font, fill=color, stroke_width=1, stroke_fill=(5, 24, 43, 180))
        x += width


def render_cue(cue: dict, output: Path, index: int) -> Path:
    image = Image.new("RGBA", (1600, 176), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle(
        (0, 0, 1599, 175),
        radius=24,
        fill=(7, 25, 48, 235),
        outline=(112, 196, 255, 92),
        width=2,
    )
    font = ImageFont.truetype(FONT_PATH, 42)
    lines = cue["lines"][:2]
    line_height = 58
    top = (176 - len(lines) * line_height) // 2 - 2
    for line_index, line in enumerate(lines):
        draw_centered_runs(draw, top + line_index * line_height, line, font)
    file = output / f"caption-{index:03d}.png"
    image.save(file, optimize=True)
    return file


def main() -> None:
    if len(sys.argv) != 4:
        raise SystemExit("用法：render-caption-overlays.py subtitles.srt output_dir manifest.json")
    srt_file = Path(sys.argv[1])
    output = Path(sys.argv[2])
    manifest_file = Path(sys.argv[3])
    output.mkdir(parents=True, exist_ok=True)
    cues = parse_srt(srt_file.read_text(encoding="utf-8"))
    manifest = []
    for index, cue in enumerate(cues, start=1):
        file = render_cue(cue, output, index)
        manifest.append({"file": str(file.resolve()), "startMs": cue["startMs"], "endMs": cue["endMs"]})
    manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "captions": len(manifest), "manifest": str(manifest_file)}))


if __name__ == "__main__":
    main()
