# Design System Document

## 1. Overview & Creative North Star: "The Clinical Arctic"
The Creative North Star for this design system is **"The Clinical Arctic."** It is a high-precision, editorial framework that rejects the "fuzzy" aesthetics of modern SaaS in favor of cold, sharp, and honest functionalism. 

Inspired by the precision of archival Swiss design and the starkness of a glacial landscape, the system breaks the "template" look by using extreme whitespace as a structural element rather than a padding value. We achieve depth not through shadows or gradients, but through a rigorous adherence to 1px containment and tonal shifts. This is a system for information density and intellectual clarity—it is honest, devoid of "eyebrow" decoration, and treats every pixel as a deliberate editorial choice.

---

## 2. Colors & Tonal Architecture
The palette is rooted in a cold, high-latitude light mode. We use blue-tinted neutrals to maintain a cohesive atmospheric temperature.

### Palette Highlights
*   **Primary (`#006194`):** A deep, functional blue used for primary actions and focused states.
*   **Surface (`#f7f9fb`):** The foundational plane. 
*   **Surface-Container-Lowest (`#ffffff`):** Reserved for the highest level of content importance (e.g., the active document or main article body).
*   **Outline-Variant (`#bfc7d2`):** The workhorse for the 1px architectural lines.

### The "Precision Border" Rule
In this system, we explicitly prohibit the use of shadows to define depth. Hierarchy is established through two methods:
1.  **1px Solid Outlines:** Use `outline-variant` (`#bfc7d2`) for all structural containers.
2.  **Tonal Step-Down:** Nesting a `surface-container-low` (`#f2f4f6`) inside a `surface` (`#f7f9fb`) to denote a change in functional context without adding a new border.

### Signature Textures
While the system is "flat," we avoid a "dead" look by using **Surface Tinting**. Interactive elements in a "hover" state should transition slightly toward `primary-fixed-dim` (`#93ccff`) rather than just getting darker. This creates a "glow" that feels like light hitting ice.

---

## 3. Typography: The Editorial Voice
We utilize **Inter** (as a high-performance proxy for Helvetica) to deliver a neutral, authoritative voice. The hierarchy is driven by dramatic scale shifts rather than decorative flourishes.

*   **Display & Headline:** Use `display-lg` (3.5rem) and `headline-lg` (2rem) to anchor pages. These should be set with tight letter-spacing (-0.02em) to mimic high-end print editorial.
*   **Title & Body:** `title-lg` (1.375rem) serves as the primary entry point for sections. `body-lg` (1rem) is the workhorse for long-form reading, optimized with a generous line-height (1.6) to ensure the "Arctic" whitespace extends into the text blocks themselves.
*   **Label Absence:** In accordance with the "no eyebrow labels" rule, use `label-md` only for functional metadata (timestamps, counts). Do not use small-caps or labels to "introduce" a section; let the typography scale speak for itself.

---

## 4. Elevation & Depth: Structural Honesty
We reject the illusion of the Z-axis. The UI is a flat, physical sheet of glass and paper.

*   **The Layering Principle:** Depth is achieved by "stacking" through contrast. A `surface-container-lowest` (#ffffff) card sitting on a `surface-container-high` (#e6e8ea) background provides enough visual separation to denote a "floating" state without needing a shadow.
*   **The Ghost Border:** For secondary elements, use the `outline` token at 20% opacity. This creates a "hint" of a container that only becomes visible upon closer inspection, maintaining the high-whitespace feel.
*   **Zero Shadows:** This is a hard rule. If a component feels "lost," increase its border contrast or adjust the background tone of the section beneath it.

---

## 5. Components

### Buttons
*   **Primary:** Solid `primary` (`#006194`) with `on-primary` (`#ffffff`) text. 4px radius. No gradient.
*   **Secondary:** 1px solid `outline` border. No fill.
*   **Tertiary:** Text only, using `primary` color. Underline only on hover to maintain a "clean" resting state.

### Input Fields
*   **Resting:** 1px solid `outline-variant`. `surface-container-lowest` fill.
*   **Focus:** 2px solid `primary`. The label should remain as part of the placeholder or sit clearly above in `title-sm`, never as a tiny "eyebrow."
*   **Error:** 1px solid `error` (`#ba1a1a`) with a `error-container` light tint fill.

### Cards & Lists
*   **The "No Divider" Rule:** In lists, do not use horizontal lines between every item. Instead, use `spacing-4` (1.4rem) of vertical whitespace. If separation is required, use a subtle background shift on hover.
*   **Editorial Cards:** Cards must have a 1px `outline-variant` border and a 4px radius. Ensure internal padding follows the `spacing-6` (2rem) scale to maintain the "Arctic" breathability.

### Signature Component: The "Data Sheet"
A custom list variant for this system. It uses `surface-container-low` for every second item to create a rhythmic, striped effect without lines, perfect for dense editorial metadata or technical specifications.

---

## 6. Do's and Don'ts

### Do:
*   **Embrace Asymmetry:** Align text-heavy blocks to the left while leaving the right 30% of the viewport empty to create editorial tension.
*   **Use Precise Radius:** Ensure every corner is exactly `0.25rem` (4px). This consistency is what creates the "Clinical" feel.
*   **Trust the Whitespace:** If a layout feels "crowded," double the spacing rather than adding a border or a divider.

### Don't:
*   **No Decorative Icons:** Only use icons for functional actions (Close, Search, Download). Never use an icon just to "beautify" a headline.
*   **No Shadows:** Even for modals or dropdowns. Use a high-contrast 1px border (`outline`) and a slightly darker background overlay to provide focus.
*   **No "Eyebrows":** Do not put small, all-caps text above headlines. The headline should be strong enough to define the section's purpose on its own.