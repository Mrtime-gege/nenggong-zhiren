#!/usr/bin/env python3
"""Render one PDF page to PNG in an isolated process. No network."""
import json
import resource
import sys

try:
    resource.setrlimit(resource.RLIMIT_CPU, (5, 5))
    resource.setrlimit(resource.RLIMIT_AS, (768 * 1024 * 1024, 768 * 1024 * 1024))
except (ValueError, OSError):
    pass

import pypdfium2 as pdfium  # noqa: E402

MAX_PIXELS = 20_000_000
MAX_DIMENSION = 1600


def main():
    src, dst, page_text, max_bytes_text = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
    page_number = int(page_text)
    max_bytes = max(4096, int(max_bytes_text))
    pdf = pdfium.PdfDocument(src)
    try:
        if page_number < 1 or page_number > len(pdf):
            raise ValueError("page_out_of_range")
        page = pdf[page_number - 1]
        width, height = page.get_size()
        if width * height > MAX_PIXELS or width <= 0 or height <= 0:
            raise ValueError("page_too_large")
        scale = min(1.5, (MAX_PIXELS / (width * height)) ** 0.5)
        bitmap = page.render(scale=max(0.2, scale))
        image = bitmap.to_pil()
        try:
            image.thumbnail((MAX_DIMENSION, MAX_DIMENSION))
            image.save(dst, format="PNG", optimize=True)
            if __import__("os").path.getsize(dst) > max_bytes:
                raise ValueError("page_image_too_large")
            print(json.dumps({"mime": "image/png", "width": image.width, "height": image.height}))
        finally:
            image.close()
    finally:
        pdf.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
