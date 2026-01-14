# Codi Branding Assets

This directory contains the official branding assets for Codi.

## Logo Files

| File | Description | Use Case |
|------|-------------|----------|
| `logo.svg` | Full logo with icon and text | Light backgrounds |
| `logo-dark.svg` | Full logo for dark mode | Dark backgrounds |
| `icon.svg` | Icon only (64x64) | App icons, small displays |
| `favicon.svg` | Small icon (32x32) | Browser favicon |
| `banner.svg` | Wide banner with tagline | README header, marketing |
| `social-preview.svg` | Social card (1280x640) | GitHub social preview |

## Colors

| Color | Hex | Usage |
|-------|-----|-------|
| Primary Purple | `#8B5CF6` | Main brand color |
| Primary Blue | `#3B82F6` | Secondary brand color |
| Gradient | `#8B5CF6 → #3B82F6` | Logo, buttons, accents |
| Dark Background | `#0a0a14` | Page backgrounds |
| Card Background | `#1a1a2e` | Card/section backgrounds |

## Converting to PNG

To create PNG versions of the SVG files (for GitHub social preview, etc.):

```bash
# Using Inkscape
inkscape -w 1280 -h 640 social-preview.svg -o social-preview.png

# Using ImageMagick
convert -background none social-preview.svg social-preview.png

# Using rsvg-convert (librsvg)
rsvg-convert -w 1280 social-preview.svg > social-preview.png
```

## Usage Guidelines

- Always maintain the aspect ratio when resizing
- Use the dark variant on dark backgrounds
- Minimum clear space around logo: 20% of logo height
- Don't modify the colors or distort the logo

## License

These assets are part of the Codi project and are licensed under Apache 2.0.
