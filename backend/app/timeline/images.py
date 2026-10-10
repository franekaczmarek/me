"""Photo processing: every upload is re-encoded as two WebP files (display + thumbnail).

Re-encoding saves free-tier storage and strips metadata such as GPS location.
"""

from dataclasses import dataclass
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

DISPLAY_SIZE = 1600
THUMB_SIZE = 400
ACCEPTED_FORMATS = {"JPEG", "PNG", "WEBP", "GIF"}
# Refuse huge images before decoding them (decompression bombs).
MAX_PIXELS = 50_000_000


class InvalidImage(ValueError):
    pass


@dataclass(frozen=True)
class ProcessedImage:
    display: bytes
    thumb: bytes
    # Size of the display version.
    width: int
    height: int


def process_image(data: bytes) -> ProcessedImage:
    image = _open(data)
    # Phones store rotation in EXIF; apply it before EXIF is dropped.
    image = ImageOps.exif_transpose(image)
    image = image.convert("RGBA" if _has_alpha(image) else "RGB")

    display = _fit(image, DISPLAY_SIZE)
    thumb = _fit(image, THUMB_SIZE)
    return ProcessedImage(
        display=_webp(display, quality=82),
        thumb=_webp(thumb, quality=75),
        width=display.width,
        height=display.height,
    )


def _open(data: bytes) -> Image.Image:
    try:
        image = Image.open(BytesIO(data))
        if image.format not in ACCEPTED_FORMATS:
            raise InvalidImage("Unsupported image format; use JPEG, PNG, WebP or GIF")
        if image.width * image.height > MAX_PIXELS:
            raise InvalidImage("Image is too large")
        image.load()
    except InvalidImage:
        raise
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise InvalidImage("Not a valid image") from exc
    return image


def _has_alpha(image: Image.Image) -> bool:
    return image.mode in ("RGBA", "LA", "PA") or (image.mode == "P" and "transparency" in image.info)


def _fit(image: Image.Image, size: int) -> Image.Image:
    """Scale down to fit in a size x size box; never upscale."""
    copy = image.copy()
    copy.thumbnail((size, size), Image.Resampling.LANCZOS)
    return copy


def _webp(image: Image.Image, quality: int) -> bytes:
    out = BytesIO()
    image.save(out, "WEBP", quality=quality, method=6)
    return out.getvalue()
