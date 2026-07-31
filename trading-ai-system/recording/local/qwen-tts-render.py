import argparse
import json
import os
import time
from pathlib import Path

import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel


def parse_args():
    parser = argparse.ArgumentParser(
        description="使用本地 Qwen3-TTS 批量生成演示视频旁白"
    )
    parser.add_argument("manifest", type=Path)
    return parser.parse_args()


def main():
    args = parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    dtype = torch.float16 if device == "mps" else torch.float32

    started_at = time.monotonic()
    model = Qwen3TTSModel.from_pretrained(
        manifest["modelDirectory"],
        device_map=device,
        dtype=dtype,
        attn_implementation="sdpa",
    )
    print(
        json.dumps(
            {
                "event": "model_loaded",
                "device": device,
                "seconds": round(time.monotonic() - started_at, 2),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )

    # 全片固定同一随机种子，保证各段声线/情绪一致（避免 index 偏移种子）
    base_seed = int(manifest.get("seed", 20260731))
    for index, segment in enumerate(manifest["segments"]):
        output = Path(segment["output"])
        if os.environ.get("QWEN_TTS_REUSE_EXISTING") == "1" and output.is_file():
            print(
                json.dumps(
                    {
                        "event": "segment_reused",
                        "id": segment["id"],
                        "output": str(output),
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
            continue
        torch.manual_seed(base_seed)
        if hasattr(torch, "mps") and torch.backends.mps.is_available():
            try:
                torch.mps.manual_seed(base_seed)
            except Exception:
                pass
        segment_started_at = time.monotonic()
        wavs, sample_rate = model.generate_custom_voice(
            text=segment["text"],
            language=manifest["language"],
            speaker=manifest["speaker"],
            instruct=manifest.get(
                "instruct",
                "同一女声主播连续讲解，语气专业稳定，语速一致。",
            ),
            max_new_tokens=1024,
        )
        output.parent.mkdir(parents=True, exist_ok=True)
        sf.write(output, wavs[0], sample_rate)
        print(
            json.dumps(
                {
                    "event": "segment_rendered",
                    "id": segment["id"],
                    "output": str(output),
                    "sampleRate": sample_rate,
                    "samples": len(wavs[0]),
                    "seconds": round(time.monotonic() - segment_started_at, 2),
                },
                ensure_ascii=False,
            ),
            flush=True,
        )
        if device == "mps":
            torch.mps.empty_cache()


if __name__ == "__main__":
    main()
