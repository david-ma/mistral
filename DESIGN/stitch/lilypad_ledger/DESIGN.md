# Design System Document

## 1. Overview & Creative North Star
The Creative North Star for this design system is **"The Digital Zine."** 

This is not a traditional corporate interface; it is an organic, breathing ecosystem that rejects the clinical precision of modern SaaS in favor of "Backyard Brutalism." We are building a high-end editorial experience that feels like a hand-crafted festival poster or a beloved community zine. By utilizing intentional asymmetry, heavy-weighted strokes, and playful overlaps, we create a tactile sensation that feels human, approachable, and delightfully unpolished. The visual language is defined by its "bouncy" energy—high-contrast typography scales and extreme corner radii ensure that every element feels like a soft, floating lilypad.

## 2. Colors
Our palette is a vibrant, saturated ecosystem. We avoid the "safe" grays of traditional UI, instead grounding our experience in warm, paper-like neutrals and punchy, expressive accents.

*   **Primary (`#006a3c` / `#86efac`):** The vibrant lifeblood of the system. Use the `primary_fixed_dim` (#86efac) for large decorative surfaces and the deep `primary` for high-contrast action items.
*   **Secondary (`#735166` / `#fdd0ea`):** A soft rose pink used to provide a "blush" of warmth and to break up the dominance of the greens.
*   **Tertiary (`#6a5b00` / `#fde047`):** Sunny yellow highlights used for "pop" moments, badges, and attention-grabbing accents.

### The "No-Line" Rule
Traditional 1px solid borders are strictly prohibited for structural sectioning. To separate content, you must use **Background Color Shifts**. For example, a `surface_container_low` section should sit directly on a `surface` background. If you need to define a boundary, use a shift in tonal value or a heavy, hand-drawn 3px+ outline (the "Ghost Border" fallback below).

### Surface Hierarchy & Nesting
Treat the UI as a physical stack of paper or lilypads.
*   **Base:** `surface` (#f7f7f3) – The desk or the pond.
*   **Container Low:** Use for subtle grouping of secondary content.
*   **Container Highest:** Reserved for interactive, "floating" elements like primary cards or menus.
Each nested container should move up the hierarchy (Lowest to Highest) to indicate it is "closer" to the user.

### Signature Textures & Glass
To elevate the "cutesy" aesthetic into a premium editorial feel:
*   **Organic Glassmorphism:** For floating menus, use semi-transparent `surface` colors with a heavy `backdrop-blur`. This creates a "frosted paper" effect that softens the vibrant greens underneath.
*   **Solid Boldness:** While gradients are forbidden in standard components, use the `on_primary_container` tokens to create high-contrast, chunky silhouettes that mimic zine-style block printing.

## 3. Typography
The typography is the voice of the zine: loud, playful, and incredibly expressive.

*   **Display & Headline (Plus Jakarta Sans):** These are our "Poster" fonts. Use the `display-lg` (3.5rem) with tight letter-spacing for hero sections. These should feel heavy and impactful.
*   **Title & Body (Be Vietnam Pro):** A slightly more legible, rounded sans-serif that maintains the "friendly" personality while ensuring high readability for transactional data.
*   **Label (Plus Jakarta Sans):** Used for tiny, high-contrast metadata.

The hierarchy relies on **extreme scale**. A `display-lg` headline should tower over `body-md` text to create a sense of intentional, editorial hierarchy common in festival posters.

## 4. Elevation & Depth
In this system, depth is a result of **Tonal Layering**, not artificial lighting.

*   **The Layering Principle:** Avoid shadows for basic cards. Instead, place a `surface_container_lowest` card on a `surface_container_low` background. The contrast in value provides all the "lift" required.
*   **Ambient Shadows:** If an element must float (e.g., a modal), use a diffused, low-opacity shadow (4-8%) tinted with the `on_surface` color. It should feel like a soft glow rather than a dark drop-shadow.
*   **The "Ghost Border" Fallback:** When high contrast is required (accessibility or complex inputs), use the `outline_variant` at 20% opacity. For the "Zine" look, use a solid 2px or 3px stroke in `on_surface` to mimic felt-tip pen marks.
*   **Corner Radii:** Use the `xl` (3rem) or `md` (1.5rem) scale for almost everything. Sharp corners do not exist in the backyard.

## 5. Components

### Buttons
*   **Primary:** Solid `primary` fill, `on_primary` text. Use `rounded-xl` (3rem) for a pill-like shape. Apply a 2px `on_surface` outline to give it a "sticker" feel.
*   **Secondary:** `secondary_container` fill with `on_secondary_container` text.
*   **Interaction:** On hover, the button should "wiggle" (3-degree rotation) rather than just changing color.

### Input Fields
*   **Style:** No 1px borders. Use a `surface_container_highest` background with a thick, 2px "hand-drawn" outline in `outline`. 
*   **States:** On focus, use a thick `primary` outline. Error states must use `error_container` as a highlight color, never just a thin red line.

### Cards & Lists
*   **Forbid Dividers:** Do not use horizontal lines to separate list items. Use vertical spacing (Scale `6` or `8`) or alternating background tints (`surface_container_low` vs `surface_container_lowest`).
*   **Sticker Chips:** Selection chips should look like physical stickers—saturated colors (`tertiary_fixed`) with thick `on_surface` borders.

### Additional Components: "The Scrapbook Header"
A specific component for this system: A header where the title overlaps a decorative `primary_container` shape (like a lilypad) at a slight -2 degree tilt. This breaks the grid and reinforces the zine aesthetic.

## 6. Do's and Don'ts

### Do:
*   **Embrace Asymmetry:** Tilt headers or images by 1-2 degrees to make them feel "placed" rather than "rendered."
*   **Use Generous White Space:** Use the Spacing Scale `12` (4rem) and `16` (5.5rem) to let the playful typography breathe.
*   **Color as Information:** Use the vibrant `tertiary` (Yellow) for all "New" or "Pending" alerts to mimic a highlighter pen.

### Don't:
*   **No 1px Lines:** Never use thin, gray dividers. They feel clinical and destroy the "hand-drawn" immersion.
*   **No Sharp Corners:** Anything under 12px radius is a bug. The world is soft; the UI should be too.
*   **No Pure Grays:** Always use the tinted neutrals (`surface` scale) to maintain the warm, organic atmosphere.
*   **No Complex Gradients:** Stick to the bold, solid colors of the zine inspiration. Visual interest comes from layering, not color fades.