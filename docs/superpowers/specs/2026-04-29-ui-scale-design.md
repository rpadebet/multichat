# UI Scale — Design Spec

**Date:** 2026-04-29 | **Status:** Approved
**Branch:** `feature/opencode-searxng-enhancements`

## Feature: UI Scale (1x–1.5x) with separate desktop/mobile memory

### Implementation

**CSS:** Single line on `<html>`:
```css
html { zoom: var(--ui-scale, 1); }
```

**Slider:** Range input in a new "Display" settings section, step 0.05, min 1.0, max 1.5. Follows existing `.sp-label` + `.sp-range` pattern.

**Storage:**
| Key | Default | Applies when |
|-----|---------|-------------|
| `mc_ui_scale_desktop` | `1.0` | viewport > 700px |
| `mc_ui_scale_mobile` | `1.1` | viewport ≤ 700px |

**Functions:**
- `setUiScale(v)` — sets `--ui-scale` custom property on `:root`, persists to device-specific key, updates label
- `loadUiScale()` — reads current device's scale from localStorage, applies, syncs slider

**Resize:** `window.addEventListener('resize', ...)` switches scale when crossing 700px breakpoint.

**Reset:** `resetSettings()` resets both scale keys to defaults.
