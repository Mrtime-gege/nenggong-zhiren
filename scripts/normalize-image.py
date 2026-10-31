#!/usr/bin/env python3
"""Isolated raster image normalization worker.

Reads one image path, writes one re-encoded image path. No network and no
attachment metadata is accepted from the input. The parent process enforces
the wall-clock timeout and output size.
"""
import json
import resource
import sys

try:
    resource.setrlimit(resource.RLIMIT_CPU, (3, 3))
    resource.setrlimit(resource.RLIMIT_AS, (512 * 1024 * 1024, 512 * 1024 * 1024))
except (ValueError, OSError):
    pass

from PIL import Image, ImageOps  # noqa: E402

Image.MAX_IMAGE_PIXELS = 40_000_000
MAX_DIMENSION = 4096

def main():
    src, dst, max_bytes_text = sys.argv[1], sys.argv[2], sys.argv[3]
    max_bytes = max(1024, int(max_bytes_text))
    max_dimension = max(256, int(sys.argv[4])) if len(sys.argv) > 4 else MAX_DIMENSION
    image = Image.open(src)
    try:
        image.seek(0)
        image.load()
        image = ImageOps.exif_transpose(image)
        if image.width * image.height > 40_000_000:
            raise ValueError("image_too_large")
        image.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
        has_alpha = image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)
        if has_alpha:
            out = image.convert("RGBA")
            out.save(dst, format="PNG", optimize=True)
            mime = "image/png"
            width, height = out.size
        else:
            out = image.convert("RGB")
            # Prefer JPEG so re-encoded photos do not grow into huge PNGs.
            saved = False
            for quality in (88, 80, 72):
                out.save(dst, format="JPEG", quality=quality, optimize=True)
                if __import__("os").path.getsize(dst) <= max_bytes:
                    saved = True
                    break
            if not saved:
                raise ValueError("image_too_large")
            mime = "image/jpeg"
            width, height = out.size
        if __import__("os").path.getsize(dst) > max_bytes:
            raise ValueError("image_too_large")
        print(json.dumps({"mime": mime, "width": width, "height": height}))
    finally:
        image.close()

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
