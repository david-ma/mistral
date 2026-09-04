# Design System: High-End Editorial Platform

## 1. Overview & Creative North Star

### Creative North Star: "The Neon Curator"
The objective of this design system is to transform a scavenger hunt platform from a simple utility into a high-stakes, premium digital event. We move away from the "grid-and-tile" aesthetics of generic apps toward an **Editorial High-Contrast** experience. 

By utilizing **intentional asymmetry**, deep tonal layering, and sophisticated typography scales, we create an environment that feels both professional and kinetic. The interface should feel like a high-end photography magazine met a futuristic dashboard—clean, breathable, yet punctuated by bursts of neon energy. We avoid "standard" patterns by prioritizing depth through color shifts rather than structural lines, ensuring the focus remains on the "Hunt."

---

## 2. Colors

The color strategy is built on a "Dark Matter" foundation with high-visibility kinetic accents. 

### The "No-Line" Rule
**Explicit Instruction:** Designers are prohibited from using 1px solid borders for sectioning content. To define boundaries, use background color shifts (e.g., a `surface-container-low` section placed on a `surface` background) or vertical negative space using the Spacing Scale.

### Surface Hierarchy & Nesting
Treat the UI as a series of physical layers. Use the Material `surface-container` tiers to create depth:
- **Base Layer:** `surface` (#131313) for the primary application background.
- **Sectioning:** `surface-container-low` (#1C1B1B) for large content areas.
- **Elevated Items:** `surface-container-high` (#2A2A2A) for interactive cards or floating moderation items.
- **Nesting:** An inner container inside a card should use `surface-container-highest` (#353535) to indicate a "pressed" or focused state.

### The "Glass & Gradient" Rule
To elevate the platform beyond a flat dark mode, use **Glassmorphism** for floating elements (like mobile navigation or success modals). 
- Use semi-transparent versions of `surface-variant` with a `backdrop-blur` of 12px–20px.
- **Signature Texture:** Primary CTAs should utilize a subtle linear gradient from `primary` (#FFE4AF) to `primary-container` (#FFC107) at 135 degrees. This provides a "soul" to the buttons that flat color cannot achieve.

---

## 3. Typography

The typography strategy leverages **Space Grotesk** for brand impact and **Inter** for high-performance readability.

*   **Display & Headlines (Space Grotesk):** Use for "Event Titles" and "Success States." The wide apertures and geometric forms provide a modern, energetic feel.
*   **Body & Labels (Inter):** Used for all moderation data and user instructions. Inter’s tall x-height ensures clarity on mobile screens during active hunts.
*   **The Editorial Scale:** Use `display-lg` (3.5rem) for major milestones and `headline-sm` (1.5rem) for card titles. This massive contrast between display and body text creates the "Signature" look.

---

## 4. Elevation & Depth

We achieve hierarchy through **Tonal Layering** rather than traditional drop shadows.

*   **The Layering Principle:** Place `surface-container-lowest` cards on a `surface-container-low` section. This creates a soft, "recessed" natural lift.
*   **Ambient Shadows:** For floating primary actions, use extra-diffused shadows.
    *   *Values:* 0px 20px 40px, Opacity 6%, Color: Tinted with `surface-tint` (#FABD00).
*   **The "Ghost Border" Fallback:** If a boundary is strictly required for accessibility, use the `outline-variant` token (#4F4632) at **15% opacity**. 100% opaque borders are strictly forbidden.
*   **Glassmorphism:** Apply to the Mobile Nav Bar. Use `surface-container` at 80% opacity with a blur to allow event photography to bleed through the UI edges, making the hunt feel immersive.

---

## 5. Components

### Navigation Bars
*   **Desktop:** Asymmetric layout. Left-aligned logo, right-aligned utility actions, with the navigation links floating in a `surface-container-high` pill-shaped container in the center-top.
*   **Mobile:** A fixed bottom "Dock" using Glassmorphism. Large icon targets (`24px` icons within `48px` tap zones).

### Buttons
*   **Primary:** Gradient of `primary` to `primary-container`. `rounded-full` corner radius. 
    *   *Hover State:* Scale 1.02x with an increased `surface-tint` outer glow.
*   **Secondary:** `surface-container-highest` background with `on-surface` text. No border.

### Progress Indicators
*   **Style:** Avoid standard horizontal bars. Use a "Kinetic Step" approach: `title-lg` text (e.g., "03") in `tertiary` (#98FE94) paired with a `label-sm` ("OF 10") in `on-surface-variant`.
*   **Success State:** Full-screen takeover using `surface` background with a massive `display-lg` headline and a `tertiary` glow effect.

### Cards (Events & Moderation)
*   **Rules:** No dividers. Use `spacing-6` (1.5rem) to separate internal text elements.
*   **Moderation Cards:** Use `surface-container-low` for the card and `surface-container-highest` for the "Approve/Reject" action area to create a "nested tray" look.

### Form Elements (Event Settings)
*   **Inputs:** `surface-container-highest` background, no border, `rounded-md` (0.75rem).
*   **Focus State:** A 2px "Ghost Border" using `primary` at 40% opacity.

---

## 6. Do's and Don'ts

### Do
*   **Do** use extreme white space (Spacing 12 and 16) to separate major sections.
*   **Do** use `tertiary` (#98FE94) exclusively for "Success," "Completed," and "Active Hunt" states to maintain high-energy signaling.
*   **Do** lean into asymmetry. If a dashboard has three columns, make the moderation feed 60% width and the stats 40%.

### Don't
*   **Don't** use 1px solid borders to separate list items. Use background alternating tones or white space.
*   **Don't** use standard "Grey" shadows. Shadows must always be tinted with the `surface-tint` or `on-surface` color.
*   **Don't** use grids that feel like a bingo board. If photos are displayed, use a masonry or staggered "editorial" layout to emphasize the "Hunt" aspect.
*   **Don't** use a flat black (#000000) for backgrounds. Always use the `surface` token (#131313) to allow for "depth-down" (lowest) surfaces.