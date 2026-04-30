# Mobile Layout Redesign — Approach A: Minimal Bottom Bar + Sticky Input

**Date:** 2026-04-30  
**Status:** Approved for implementation  
**Objective:** Maximize chat message readability on mobile (portrait mode) while keeping essential controls accessible and dynamically sized input that only takes space when needed.

---

## Problem Statement

On mobile portrait mode, even at default UI scale (1x), the current layout is cramped:
- Top bar elements (model dropdown, settings, chat info) consume excessive space
- Bottom input area takes up ~20% of screen height
- Chat message area squeezed to ~60% of screen
- Increasing UI scale to 1.5x makes the layout even more unusable

**Priority:** Maximize space for viewing chat output.

---

## Design Goals

1. **Chat message area takes 75-80% of screen** (up from ~60%)
2. **Dynamic input** that expands only when typing, stays minimal otherwise
3. **Model dropdown accessible at conversation start**, then hides when scrolling
4. **Settings always accessible** (pinned in top bar)
5. **Chat info moved to optional popup** (triggered by info button, doesn't disrupt layout)
6. **Touch-friendly** — minimum 44px touch targets, adequate spacing for UI scale increases

---

## Layout Architecture

### Top Bar (44px, pinned)

**Elements:**
- **Settings toggle** (always visible, top-right corner) — icon button
- **Model dropdown** (visible at conversation start, scrolls away with chat) — select or button+dropdown

**Behavior:**
- Settings button: 8px padding, ~32px icon size
- Model dropdown: full width on <500px, ~150px on >500px
- When chat scrolls, model dropdown scrolls out of view with content (normal document flow)
- Settings button remains pinned

**Rationale:** Settings is critical for configuration. Model selection is only needed at conversation start (once chat begins, switching models resets conversation). Hiding it reclaims ~40px.

---

### Chat Message Area (dynamic height)

**Behavior:**
- Flex child that grows to fill available space between top bar and bottom bar
- Uses `overflow-y: auto` for scrolling
- Message padding reduced on mobile: 8px horizontal, 4px vertical (vs 12px/8px on desktop)

**On message render:**
- Remove/minimize avatar images on <500px
- Reduce font size slightly (1rem instead of 1.125rem for user messages)
- Condense code blocks and pre-formatted text

**Rationale:** Every pixel matters on small screens. Messages are the content; everything else is chrome.

---

### Bottom Bar (base 52-56px, expands to ~150px max)

**Elements:**
- **Message input textarea** (auto-growing, max-height: 150px)
- **Send button** (icon-only on <500px, icon + "Send" text on >500px)
- **Info button** (ⓘ icon, triggers chat details popup)

**Layout:**
- **<500px:** Input stacks vertically above buttons, buttons row below
  ```
  [Input field (full width, grows)]
  [Info] [Model] [Send]
  ```
- **500-700px:** Input + send button side-by-side, info button below
  ```
  [Input field (grows)] [Send]
  [Info]
  ```

**Textarea auto-grow:**
- Min height: 36px (1 line)
- Max height: 150px (auto-scroll after ~4-5 lines)
- Padding: 8px
- Grows as user types, shrinks when text is deleted

**Rationale:** Input only consumes space when needed. Most messages are single-line, so default 36px takes minimal space. Multi-line inputs expand without covering the chat area thanks to flexbox layout.

---

### Info Popup

**Trigger:** Info button (ⓘ) in bottom bar

**Content:**
- Chat name / conversation title
- Model(s) used
- Token count / estimated cost
- Timestamp (creation date)
- Optional: system prompt preview (truncated)

**Behavior:**
- Overlay/modal that appears on top of chat
- Click outside or press close (X) button to dismiss
- Does not push input/chat area up (unlike a drawer)

**Rationale:** Chat details are useful but not needed during normal reading/typing. Popup keeps them optional and out of the main flow.

---

## Responsive Breakpoints

### Breakpoint 1: < 500px width (small phones)

**Changes:**
- Top bar: Settings button only (model moved to a settings panel or inline with input)
- Chat messages: Remove avatars, reduce margins to 4px
- Font sizes: -1 size step
- Bottom bar: Vertical stack (input above buttons)
- Input buttons: Icon-only
- Touch targets: Strict 44px minimum (already met, verify)

### Breakpoint 2: 500-700px width (larger phones / tablets)

**Changes:**
- Top bar: Settings + model dropdown side-by-side (compact layout)
- Chat messages: Full layout with avatars
- Font sizes: Normal
- Bottom bar: Input + send side-by-side
- Input buttons: Icon + label on send button

### Breakpoint 3: > 700px width (desktop)

**No changes — existing desktop layout applies.**

---

## State Management

### View States

1. **Conversation not started:**
   - Top bar shows model dropdown + settings
   - Input area shows "Start typing or select a model"
   - Chat area empty

2. **Conversation active (reading):**
   - Top bar shows settings only (model dropdown scrolled away)
   - Chat area filled with messages
   - Bottom bar minimal (36px input + send)

3. **User composing message:**
   - Input expands as text grows
   - Chat area shrinks proportionally
   - Send button remains accessible

4. **Info popup open:**
   - Full-screen overlay
   - Chat and input still visible behind (dimmed/blurred background)
   - Close button visible

---

## CSS and Implementation Notes

### Viewport & Scaling

- Maintain `viewport-fit=cover` for notch/safe area support
- Use `env(safe-area-inset-*)` for padding around notches/home bars
- Test at UI scale 1.0x and 1.5x (localStorage key: `mc_ui_scale_mobile`)

### Flexbox Layout

```
#main {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

#header { flex: 0 0 44px; /* pinned top bar */ }
#chat-area { flex: 1 1 auto; /* grows to fill */ }
#input-footer { flex: 0 1 auto; /* shrinks if needed, expands with input */ }
```

### Textarea Auto-Grow

Use existing JavaScript `auto-grow` behavior or library (e.g., `textarea-autosize`). Ensure:
- Min height: 36px
- Max height: 150px
- Smooth transition on resize

### Safe Area Insets

```css
@media (max-width: 500px) {
  #header {
    padding-top: calc(8px + env(safe-area-inset-top));
    padding-bottom: calc(8px + env(safe-area-inset-bottom));
  }
  #input-footer {
    padding-bottom: calc(8px + env(safe-area-inset-bottom));
  }
}
```

---

## Testing Checklist

- [ ] Layout renders correctly on iPhone SE (375px), iPhone 12 (390px), iPhone Pro Max (430px)
- [ ] Layout renders on Android small (320px), medium (412px), large (480px)
- [ ] Input expands/shrinks smoothly on 3-5 line messages
- [ ] Settings button always visible when scrolling
- [ ] Model dropdown scrolls away naturally
- [ ] Info popup closes on dismiss
- [ ] UI scale 1.0x and 1.5x don't cause layout breaks
- [ ] Landscape mode (if supported) doesn't have conflicts
- [ ] Safe area insets respected on notched devices
- [ ] Touch targets all ≥ 44px

---

## Edge Cases & Open Questions

1. **Long model names:** Truncate with ellipsis or wrap to 2 lines?
2. **Landscape mode:** Hide model dropdown? Reduce font sizes further?
3. **Model switching mid-conversation:** Keep current model visible in bottom bar as a micro-selector, or require scrolling to top?
4. **Very long chat histories:** Pagination or virtual scrolling for performance?

---

## Success Criteria

✅ Chat message area takes ≥ 75% of screen on mobile portrait  
✅ Input only takes 52px when not typing, expands on demand  
✅ Settings always accessible  
✅ Model dropdown available at conversation start  
✅ UI scale 1.5x does not break layout  
✅ All touch targets ≥ 44px  
✅ Info popup is optional and doesn't disrupt input flow
