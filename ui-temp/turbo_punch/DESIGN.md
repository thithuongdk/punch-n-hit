# Design System Strategy: The Kinetic Comic

## 1. Overview & Creative North Star
**Creative North Star: "The Living Panel"**
This design system rejects the static, clinical nature of traditional web interfaces in favor of a high-octane, "living" comic book experience. We are not just building a game UI; we are crafting an interactive graphic novel where every click feels like a "POW!" or a "WHAM!" 

To move beyond the "standard" casual game look, we utilize **Intentional Asymmetry** and **Dynamic Overlap**. Elements should never feel perfectly centered or trapped within rigid containers. Instead, components should "burst" through their bounding boxes, using the spacing scale to create rhythmic, high-energy layouts that guide the eye through action rather than just information.

## 2. Colors & Surface Philosophy
The palette is built on high-saturation comic-book foundations, but executed with editorial precision.

*   **The Primary Engine:** `primary` (#776300) and `primary_container` (#ffd709) form our "Action Yellow." Use the container token for large surfaces to radiate energy.
*   **The Combat Duo:** `tertiary` (#bf2b00) provides the "Punchy Red" for high-stakes action, while `secondary` (#0061cb) provides the "Energetic Blue" for secondary navigation and cool-down states.
*   **The "No-Line" Rule:** In this system, we prohibit 1px solid silver/grey borders. For sectioning, we rely on **Background Shifts**. A `surface_container_low` (#fffae1) section should sit on a `surface` (#fffbff) background to define space.
*   **Surface Hierarchy & Nesting:** Treat the UI as stacked cardstock. Use `surface_container` (#fef6a5) for the main play area, and nest `surface_container_highest` (#f3eb91) for pop-up modals or inventory slots. This creates a tactile, physical depth.
*   **Signature Textures:** Avoid flat fills for major CTAs. Apply a subtle linear gradient from `primary` (#776300) to `primary_fixed_dim` (#efc900) at a 15-degree angle to give buttons a "3D glossy vinyl" feel.

## 3. Typography: Action & Rhythm
Our typography isn't just for reading; it’s a visual sound effect.

*   **Display & Headlines (Plus Jakarta Sans):** These are your "Screamers." Use `display-lg` (3.5rem) for combo counters and level-ups. The rounded nature of Plus Jakarta Sans maintains the "Chibi" aesthetic while providing the weight necessary for high-impact moments.
*   **Body & Titles (Be Vietnam Pro):** Used for instructional text and stats. `title-lg` (1.375rem) provides a clean, legible contrast to the chaotic energy of the headlines, ensuring the player never loses track of the game logic.
*   **The Hierarchy Goal:** Use extreme scale shifts. A `display-lg` combo counter next to a `label-sm` stat creates a "Manga-style" focal point that directs the player's focus instantly.

## 4. Elevation & Depth
In a cartoon world, depth is exaggerated and playful.

*   **The Layering Principle:** Avoid shadows for structure. Use `surface_container_lowest` (#ffffff) cards on `surface_dim` (#eee686) backgrounds to create a "lifted" effect.
*   **Ambient Shadows:** When an element must "float" (like a Chibi character or a power-up), use a highly diffused shadow. Color the shadow with a 20% opacity of `on_surface` (#3d3905) to keep it feeling warm and integrated, rather than "muddy."
*   **The "Ghost Border" Fallback:** While we avoid standard lines, a "Ghost Border" using `outline_variant` (#c2bb7b) at 20% opacity can be used for inactive button states to maintain the "outline" aesthetic without cluttering the screen.
*   **Glassmorphism & Depth:** Use `surface_bright` (#fffbff) with a 60% opacity and a `20px` backdrop blur for "Pause" menus. This keeps the energetic game world visible but blurred, maintaining the immersion.

## 5. Components

### Buttons (The "Squash & Stretch" Rule)
*   **Primary:** `primary_container` (#ffd709) background with `on_primary_container` (#5b4b00) text. Use `xl` (3rem) roundedness. 
*   **Interaction:** On hover, the button should scale to 1.05x. On click, it should "squash" to 0.95x using a `cubic-bezier(0.68, -0.55, 0.27, 1.55)` transition.
*   **Visuals:** Add a 4px "hard shadow" (0% blur) using `primary` (#776300) to mimic comic book cell shading.

### Stylized Health Bars
*   **Track:** Use `surface_container_highest` (#f3eb91).
*   **Fill:** A gradient transition from `tertiary` (#bf2b00) for low health to `primary` (#776300) for full health.
*   **Rounding:** Always `full` (9999px) for the track and the fill to match the Chibi aesthetic.

### Cards & Lists
*   **Rule:** Forbid divider lines.
*   **Separation:** Use `spacing.4` (1.4rem) between list items. Use alternating background tints—`surface_container_low` (#fffae1) and `surface_container_lowest` (#ffffff)—to differentiate rows in an inventory.

### Combo Counters
*   **Style:** Use `display-lg` (Plus Jakarta Sans) with a `-2%` letter spacing to make it feel dense and heavy.
*   **Animation:** Use a "Pop-in" animation where the number starts at 200% size and scales down to 100% with a slight rotation (±5 degrees) to keep it feeling "hand-drawn."

## 6. Do's and Don'ts

### Do:
*   **Do** lean into asymmetry. Tilt UI panels by 1 or 2 degrees to create a sense of motion.
*   **Do** use the full range of the spacing scale. High-energy layouts need "breathing room" (use `spacing.16` or `spacing.20`) to avoid looking cluttered.
*   **Do** use `tertiary_container` (#ff9479) for warnings or alerts—it’s softer than pure red but maintains the comic-book urgency.

### Don't:
*   **Don't** use pure black (#000000) for outlines. Use `on_surface` (#3d3905) or `outline` (#878248) to keep the "warm" cartoon feel.
*   **Don't** use standard "Material" shadows. If it doesn't look like it was drawn with a marker, it doesn't belong in this system.
*   **Don't** use sharp corners. If an element isn't at least `md` (1.5rem) rounded, it’s too "corporate" for this experience.