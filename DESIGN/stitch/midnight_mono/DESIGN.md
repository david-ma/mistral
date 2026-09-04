# The Design System: Operational Excellence

## 1. Overview & Creative North Star: "The Kinetic Console"
This design system is a rejection of the decorative. It is built for speed, density, and precision. We move away from the "web-as-a-document" metaphor and toward "software-as-an-instrument." The Creative North Star is **The Kinetic Console**: a high-performance environment where every pixel serves a functional purpose. 

Drawing inspiration from developer tools and command-line interfaces, we prioritize high-contrast legibility and a strict, immutable layout. There are no "floating" elements; every component is anchored to the grid, creating a sense of structural permanence. We achieve sophistication not through fluff, but through the rigorous application of mathematical spacing and tonal discipline.

---

### 2. Colors: Tonal Architecture
The palette is rooted in deep obsidian tones, utilizing high-contrast primary accents to guide the eye to interactive focal points.

*   **Core Tones:**
    *   **Background:** `#0a0e14` (The base foundation)
    *   **Surface:** `#161b22` (Primary workspace containers)
    *   **Primary:** `#a2c9ff` (Actionable intent and focus states)
    *   **Outline:** `#6a768a` (Structural definition)

*   **The "No-Line" Rule (Refined):** In this system, we do not use 1px borders to separate major layout sections (e.g., Sidebar from Main Content). Instead, boundaries are defined by the shift from `surface_container_low` to `surface`. Borders are reserved exclusively for **interactive components** (inputs, buttons) to signal affordance.
*   **Surface Hierarchy:** Depth is created through value shifts, not shadows. 
    *   **Sidebar/Navigation:** `surface_container_low` (`#0e141c`)
    *   **Main Workspace:** `surface` (`#0a0e14`)
    *   **Active Modals/Overlays:** `surface_container_high` (`#16202e`)
*   **Functional Contrast:** Use `on_surface_variant` (`#9facc1`) for secondary metadata to ensure the `primary` and `on_surface` content remains the undisputed hero of the hierarchy.

---

### 3. Typography: The Editorial Grid
We utilize **Inter** for its neutral, neo-grotesque clarity. The typography is designed to be "scannable," treating text as data.

*   **Display & Headlines:** Use `display-sm` (2.25rem) for major dashboard headings. Keep letter-spacing at -0.02em to maintain a tight, "engineered" look.
*   **The Data Row:** `body-md` (0.875rem) is our workhorse. Most interface text should live here.
*   **Labels:** `label-sm` (0.6875rem) in All Caps with +0.05em tracking is used for category headers and table columns to distinguish metadata from user data.
*   **Intentional Asymmetry:** Align headlines to the far left of the container while keeping action buttons pinned to the far right. This extreme "tension" in the layout creates a professional, editorial feel.

---

### 4. Elevation & Depth: Tonal Stacking
We explicitly forbid shadows and gradients. Elevation is communicated through **Tonal Layering**.

*   **The Layering Principle:** 
    *   Level 0: `background` (The void)
    *   Level 1: `surface_container` (The layout blocks)
    *   Level 2: `surface_container_highest` (The active state or focused element)
*   **The "Ghost Border":** For state changes (e.g., hovering over a list item), do not change the background color drastically. Instead, apply a 1px solid stroke using `outline_variant` at 20% opacity. It should feel like a "hint" of a container, not a heavy box.
*   **Hard Edges:** Border radius is capped at `0.25rem` (4px) for most components, with a strict maximum of `0.5rem` (8px) for large containers. This maintains the "monolithic" and "mono" aesthetic.

---

### 5. Components: Tools of the Trade

*   **Buttons:**
    *   **Primary:** Solid `primary` background with `on_primary` text. No rounded-full corners; use `md` (0.375rem).
    *   **Secondary:** `outline` stroke (1px) with no background. 
    *   **Tertiary:** Text only, shifting to `primary` on hover.
*   **Inputs:** Use `surface_container_highest` for the background. The bottom border should be 2px `outline` to provide a "ledge" for the text. On focus, the border transitions to `primary`.
*   **Sidebar:** Fixed at `240px`. Use `surface_container_low`. Items within the sidebar use `body-sm`. Active states are indicated by a 2px vertical `primary` line on the left edge.
*   **Cards & Lists:** **Strictly forbid dividers.** Use `spacing-5` (1.1rem) of vertical whitespace to separate items. If separation is required, use a subtle background shift to `surface_container_low`.
*   **Command Palette:** Inspired by Raycast. A centered modal using `surface_container_highest`, 8px radius, and a 1px `outline` border. No shadow.

---

### 6. Do’s and Don’ts

#### Do:
*   **Do** embrace density. High-end functional tools provide more information, not less.
*   **Do** use `primary` sparingly. It is a "laser pointer," not a "paint bucket."
*   **Do** align everything to the 8px grid. If an element is off by 1px, the "engineered" feel is lost.
*   **Do** use `secondary_fixed_dim` for disabled states to maintain legibility while signaling inactivity.

#### Don’t:
*   **Don’t** use shadows. If an element needs to stand out, change its background tone.
*   **Don’t** use "Marketing Speak." Labels should be nouns (e.g., "Commit," not "Send your brilliant code").
*   **Don’t** use icons without labels unless they are universal (e.g., Settings, Search).
*   **Don’t** add animations that take longer than 150ms. Transitions should be "snappy" or non-existent.