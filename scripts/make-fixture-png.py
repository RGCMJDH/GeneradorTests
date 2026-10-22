"""Genera tests/fixtures/foto-apuntes.png (texto impreso negro sobre blanco). Uso: python scripts/make-fixture-png.py"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

out = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "foto-apuntes.png"
font = ImageFont.truetype("C:/Windows/Fonts/arial.ttf", 48)
text = "La mitocondria produce energia"
img = Image.new("L", (900, 160), 255)
draw = ImageDraw.Draw(img)
w = draw.textlength(text, font=font)
draw.text(((900 - w) / 2, 50), text, font=font, fill=0)
img.save(out, optimize=True)
print(out, out.stat().st_size)
