"""Turn the raw recording into the final MP4: trim the blank first moments and encode for the web.

Usage: python finish_video.py <raw.webm> <out.mp4>
Needs ffmpeg. The video is padded by at most one pixel if a dimension is odd (H.264 needs even sizes).
"""
import subprocess
import sys

TRIM_START = 0.6   # the first moments are a blank page


def main() -> None:
    raw, out = sys.argv[1:3]
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(TRIM_START), "-i", raw,
                    "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libx264", "-preset", "slow", "-crf", "26",
                    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", out], check=True)
    seconds = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out],
                             capture_output=True, text=True, check=True).stdout.strip()
    print(f"{out}: {float(seconds):.1f} s")


if __name__ == "__main__":
    main()
