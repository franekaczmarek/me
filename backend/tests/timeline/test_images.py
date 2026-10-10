from io import BytesIO

import pytest
from PIL import Image

from app.timeline.images import DISPLAY_SIZE, THUMB_SIZE, InvalidImage, process_image


def make_image(
    size: tuple[int, int],
    fmt: str = "JPEG",
    mode: str = "RGB",
    color: str | tuple = "red",
    exif: Image.Exif | None = None,
) -> bytes:
    out = BytesIO()
    image = Image.new(mode, size, color)
    kwargs = {"exif": exif} if exif is not None else {}
    image.save(out, fmt, **kwargs)
    return out.getvalue()


def open_webp(data: bytes) -> Image.Image:
    image = Image.open(BytesIO(data))
    assert image.format == "WEBP"
    return image


def test_large_image_is_scaled_down_keeping_aspect_ratio() -> None:
    result = process_image(make_image((4000, 3000)))
    assert (result.width, result.height) == (DISPLAY_SIZE, 1200)
    assert open_webp(result.display).size == (DISPLAY_SIZE, 1200)
    assert open_webp(result.thumb).size == (THUMB_SIZE, 300)


def test_portrait_image_fits_by_height() -> None:
    result = process_image(make_image((1000, 4000)))
    assert (result.width, result.height) == (400, DISPLAY_SIZE)


def test_small_image_is_not_upscaled() -> None:
    result = process_image(make_image((200, 100)))
    assert (result.width, result.height) == (200, 100)
    assert open_webp(result.thumb).size == (200, 100)


@pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP", "GIF"])
def test_accepted_formats(fmt: str) -> None:
    result = process_image(make_image((50, 50), fmt))
    assert open_webp(result.display).size == (50, 50)


def test_png_transparency_is_kept() -> None:
    result = process_image(make_image((50, 50), "PNG", mode="RGBA", color=(255, 0, 0, 128)))
    image = open_webp(result.display)
    assert image.mode == "RGBA"
    assert image.getpixel((0, 0))[3] < 255


def test_exif_rotation_is_applied_and_metadata_dropped() -> None:
    exif = Image.Exif()
    exif[0x0112] = 6  # Orientation: rotate 90° clockwise
    exif[0x010F] = "Camera maker"
    result = process_image(make_image((300, 100), exif=exif))
    assert (result.width, result.height) == (100, 300)
    assert not open_webp(result.display).getexif()


@pytest.mark.parametrize("data", [b"", b"not an image", make_image((10, 10))[:50]])
def test_invalid_data_is_rejected(data: bytes) -> None:
    with pytest.raises(InvalidImage):
        process_image(data)


def test_unsupported_format_is_rejected() -> None:
    with pytest.raises(InvalidImage, match="Unsupported"):
        process_image(make_image((10, 10), "BMP"))


def test_huge_dimensions_are_rejected_before_decoding(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.timeline.images.MAX_PIXELS", 99)
    with pytest.raises(InvalidImage, match="too large"):
        process_image(make_image((10, 10)))
