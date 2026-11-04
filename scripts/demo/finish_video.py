"""Turn the raw recording into the final MP4, speeding up the time spent waiting for the model.

Usage: python finish_video.py <raw.webm> <marks.json> <out.mp4>

record_web.js writes marks.json with the stretches where the app was waiting for the model, and
shows a "2x SPEED" tag in the video during them. This script plays those stretches at 2x and
everything else at normal speed. Needs ffmpeg.
"""
import json
import subprocess
import sys

SPEED = 2.0
TRIM_START = 0.6   # the first moments are a blank page
PAD = 0.35         # keep the tag's first/last moments at normal speed, to absorb timing error


def duration(path: str) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True, check=True).stdout
    return float(out.strip())


def main() -> None:
    raw, marks_file, out = sys.argv[1:4]
    marks = json.load(open(marks_file))
    end = duration(raw)
    segments, cursor = [], TRIM_START
    for start, stop in marks:
        a, b = start + PAD, stop - PAD
        if b - a < 1.0:
            continue
        segments += [(cursor, a, 1.0), (a, b, SPEED)]
        cursor = b
    segments.append((cursor, end, 1.0))

    parts = [f"[0:v]trim=start={s:.3f}:end={e:.3f},setpts=(PTS-STARTPTS)/{v}[v{i}]" for i, (s, e, v) in enumerate(segments)]
    chain = ";".join(parts) + ";" + "".join(f"[v{i}]" for i in range(len(segments))) + f"concat=n={len(segments)}:v=1:a=0[out]"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", raw, "-filter_complex", chain, "-map", "[out]", "-c:v", "libx264",
                    "-preset", "slow", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out], check=True)
    sped = sum(b - a for a, b, v in segments if v != 1.0)
    print(f"{out}: {duration(out):.1f} s (was {end - TRIM_START:.1f} s; {sped:.1f} s of waiting played at {SPEED:g}x)")


if __name__ == "__main__":
    main()
