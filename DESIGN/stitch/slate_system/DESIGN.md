# Design System Document

## 1. Overview & Creative North Star: "The Technical Ledger"
This design system is anchored by the concept of **"The Technical Ledger."** It rejects the fluffy, over-spaced trends of modern consumer SaaS in favor of a high-density, high-utility aesthetic reminiscent of precision engineering tools and dark-mode IDEs. 

The North Star is **Subtle Authority.** We achieve this by moving away from "floating cards" and "pill-shaped buttons." Instead, we use a rigorous grid, intentional asymmetry, and a monochromatic foundation punctuated by a single, high-energy cyan. This system doesn't scream for attention; it provides a sophisticated, low-fatigue environment for deep work and complex data manipulation.

---

## 2. Colors & Tonal Architecture
The palette is built on a mid-tone "Slate" foundation. We prioritize optical comfort over pure black (#000) to reduce eye strain during long-duration utility tasks.

### The Palette
*   **Background (`#0b1326`):** The structural base. Deep, but retains enough blue to feel "ink-like" rather than hollow.
*   **Surface (`#0b1326`) / Surface Bright (`#31394d`):** Used for primary work areas and high-level containers.
*   **Primary (`#8ed5ff`) / Primary Container (`#38bdf8`):** The "Action" color. Reserved strictly for interactive triggers and critical status indicators.
*   **Tertiary (`#ffc176`):** Used sparingly for "Attention" states that are not errors, such as warnings or active search highlights.

### The "No-Line" Rule
Traditional 1px solid borders are strictly prohibited for structural sectioning. To separate a sidebar from a main content area, use a background shift from `surface-container-low` (`#131b2e`) to `surface` (`#0b1326`). Boundaries are felt through value changes, not drawn with lines.

### Surface Hierarchy & Nesting
Treat the UI as a series of recessed or extruded plates. 
*   **Level 0 (Base):** `surface-container-lowest` (#060e20) for the absolute background.
*   **Level 1 (Panels):** `surface-container` (#171f33) for main utility panels.
*   **Level 2 (Active Elements):** `surface-container-highest` (#2d3449) for focused items or popovers.

### The "Glass & Gradient" Rule
While we avoid "corporate gradients," we use **Functional Gradients.** For primary CTAs, a subtle linear gradient from `primary` to `primary-container` adds a machined, metallic sheen that feels like a physical button. For floating toolbars, use `surface-bright` at 80% opacity with a `backdrop-blur` of 12px to maintain context of the data underneath.

---

## 3. Typography: Precision Sans
We utilize a System Sans stack (Inter/San Francisco) to ensure the interface feels native to the machine. The typography is built for scanning, not reading a novel.

*   **Display & Headlines:** Use `headline-sm` (1.5rem) for major module titles. Keep them "Regular" or "Medium" weight—never "Bold." Boldness in this system is reserved for data points, not labels.
*   **The Utility Label:** `label-md` (0.75rem) and `label-sm` (0.6875rem) are the workhorses. Use `on-surface-variant` (`#bdc8d1`) for these to create a clear hierarchy between the "Label" and the "Value."
*   **Data Density:** Body text defaults to `body-md` (0.875rem). In high-density tables, drop to `body-sm` (0.75rem) with a tighter line-height to maximize information per square inch.

---

## 4. Elevation & Depth: Tonal Layering
We eschew the "heavy shadow" look of the 2020s. Depth is a whisper, not a shout.

*   **The Layering Principle:** Instead of a shadow, a "raised" element like a modal is defined by being `surface-container-highest` against a `surface-dim` backdrop.
*   **Ambient Shadows:** For floating toolbars or context menus, use a 2px blur shadow: `0 2px 4px rgba(0, 0, 0, 0.4)`. The shadow must be tight and dark, mimicking a piece of slate sitting millimetres above a desk.
*   **The "Ghost Border" Fallback:** In rare cases where data elements must be separated (like table headers), use a "Ghost Border": `outline-variant` (#3e484f) at **15% opacity**. It should be barely visible, felt only as a slight sharpening of the edge.

---

## 5. Components: Built for the Toolbar
All components follow a maximum **10px (0.625rem)** border radius. Use `md` (0.375rem) for most small components.

### Buttons
*   **Primary:** Solid `primary-container`. Square-ish corners (`sm` or `md` radius). No icons unless they provide immediate clarity.
*   **Tertiary (Ghost):** No background or border. Text color is `on-surface-variant`. On hover, a subtle `surface-container-high` background appears.

### Input Fields
*   **Architecture:** Use a "filled" style rather than outlined. `surface-container-high` background with a 1px `outline-variant` bottom border only. This creates a "ledger" look that aligns with high-density data entry.
*   **Error State:** Use `error` (#ffb4ab) for the bottom border and helper text. Do not change the entire background of the input.

### Toolbars & Data Tables
*   **Toolbars:** Keep toolbars pinned to the top of their respective containers. Use `surface-bright` and clear, icon-only buttons for repetitive actions.
*   **Lists/Cards:** Forbid divider lines. Use `spacing-4` (0.9rem) of vertical whitespace or a subtle background toggle (zebra-striping) using `surface-container-low` and `surface-container-lowest`.

### Added Component: The "Utility Blade"
A vertical, narrow sidebar (approx. 48px-64px) for high-frequency switching. It should use `surface-container-lowest` to "recess" into the screen, making the main `surface` work area feel prominent.

---

## 6. Do’s and Don’ts

### Do:
*   **Use Mono-spacing for numbers:** Ensure all data tables use tabular numerical alignment for easy vertical scanning.
*   **Tighten Spacing:** Use `spacing-2` (0.4rem) and `spacing-3` (0.6rem) for internal component padding to maintain density.
*   **Intentional Asymmetry:** If a dashboard has three widgets, let one take 60% width and the others 20% each. Avoid the "perfect grid" which looks like a template.

### Don’t:
*   **No "Pill" Buttons:** Buttons should be rectangular or slightly rounded. Never use `full` (9999px) radius for buttons or tags.
*   **No Hero Sections:** Dashboards start immediately with data or navigation. We do not "welcome" the user with empty space or large marketing headers.
*   **No Pure Greys:** Always use the Slate-tinted tokens. Pure `#888888` or `#ffffff` will break the atmospheric depth of the system.
*   **No "Soft" Gradients:** If a gradient is used, it should be high-contrast and directional, simulating light hitting a hard surface, not a sunset.