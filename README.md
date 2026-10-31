# Lodestone — an experimental spatial desktop

A browser prototype of a desktop that is organised by **attention and relationships** rather than workspaces, tiling or free floating. Windows attract and fuse into persistent **Assemblies**; a moving **field of attention** decides what is prominent; objects **morph** into simpler forms as they drift into the periphery; and everything stays on **one bounded screen**.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build into dist/
```

Requires Node 18+. The workspace persists to `localStorage`; **Reset** in the top bar (click twice) restores the starting desk.

## Things to try

1. **Fuse:** drag Music by its title bar toward the bottom edge of Notes. Within ~90px a pinched "neck" shows attraction; within ~18px it locks (thick seam) and edges align flush. Let go: they become one object with a shared silhouette and an ink tab.
2. **Move the assembly:** drag its ink tab, or grab the rim just outside its outline.
3. **Separate:** pull a member's title bar. It resists elastically and the neck stretches; past ~72px it tears free and stays under your hand.
4. **Move attention:** click any distant window, the collapsed teal *orbit* card, or empty desk. The field travels there and the windows stay where they are.
5. **Watch the periphery:** far objects become compact views, then widgets (now playing, build status, unread count). Widget buttons (play, run build, quick reply) work *without* pulling attention.
6. **Assembly summary:** move attention away from *orbit*: its members shrink to compact, then the silhouette condenses into one card showing name, apps and the latest build status. Click it to expand.
7. **Reload:** membership, arrangement, names and app state come back.
8. **Tune** (or press `T`): falloff curve and radius, thresholds, magnetism, make-room distance, springs. `[` / `]` move attention between objects; `Esc` releases focus.

## How it is built

```
src/model/      types, pure geometry, zustand store (persisted), tuning, seed
src/engine/     attention.ts  falloff curves, presentation thresholds, size/scale per state
                magnet.ts     snap search, alignment, neck + seam shapes
                engine.ts     rAF loop: focus spring → attention → targets → make-room →
                              clamp → magnetism → springs → direct DOM writes
src/apps/       app metadata (sizes per state, summaries), views (3 presentations each), local sim
src/ui/         WindowFrame, AssemblyOverlay (silhouette, tab, card), Desktop, TopBar, DebugPanel
```

- **Separation of concerns.** The store holds only durable facts: windows (app, full size, anchor), assemblies (members' positions in full-size units, ink, optional name, collapsed), focus, stacking order, and an empty typed `relations` list for future context clipboards and associated files. Everything visual is derived each frame by the engine. React renders structure and semantic state; the engine writes geometry straight to DOM nodes, so motion never re-renders app content.
- **Anchors are normalised** (0–1 of the desk), so the workspace re-flows to any viewport size, and every rendered body is clamped inside the screen. Nothing can end up off-screen.
- **Silhouettes** are computed as the union outline of the member rectangles (coordinate compression), inset so the stroke sits on the outer pixels. Members carry only a soft internal hairline. When collapsing, every member rect springs toward the card rect, so the union *is* the morph.
- **Springs** are per-window rectangles with identical linear dynamics. Because member targets are affine in the assembly's centre and scale, fused members stay exactly edge-to-edge while they animate.
- **Resizing a member** re-derives the attachment tree (who hangs off whom, on which edge, at what offset) and re-applies it, so neighbours follow.
- **Detaching** recomputes connected components: if a removed window was the bridge, the assembly splits physically into separate assemblies or free windows.

## Key design decisions

- **The field moves; windows don't.** Focus animates a point, not windows. Objects scale around their own anchor. The only displacement is a bounded "make room" nudge (≤180px by default, off while dragging) so a blooming window doesn't bury its neighbours.
- **Attention = distance falloff × neighbour factor.** The focused object gets full weight and everything else a tunable 0.86, so there is one clear centre. The field also tightens as the desk fills and as the focused object gets larger.
- **Semantic states with hysteresis, continuous size within a state.** Each app has hand-composed *full*, *compact* and *widget* layouts at real pixel sizes, never CSS-scaled thumbnails. The frame springs between state sizes while content cross-fades, and it breathes slightly within a state as the field moves.
- **Assemblies scale uniformly.** Focusing one member keeps its siblings equally prominent, as the brief asks, and keeps the silhouette intact. Assemblies go *full → compact → collapsed card*.
- **Ink means relationship.** Following the personal design system (paper, ink, square corners, hairline rules, Familjen Grotesk / Source Serif / JetBrains Mono), free windows are monochrome and only Assemblies carry a section ink: the tab and the whole collapsed card. State is drawn (2px rules, status marks) rather than coloured.
- **Gestures by part.** Title bar = this window (move it, or pull it out of an assembly). Tab or rim = the whole assembly. No modes, no modifier keys.

## Compromises

- Snapping is edge-to-edge between axis-aligned rectangles. The liquid feel comes from the neck and seam, not from deforming window shapes.
- Merging two objects at different current scales aligns via ratios, so a free-aligned join can land a few px off from what you saw. Flush (start/centre/end) joins are exact.
- "Make room" is a greedy pairwise push with a cap, not a real layout solver. Very crowded desks can still overlap at the periphery.
- Resizing an assembly member can, in unusual layouts, make two branches of the attachment tree overlap; nothing resolves that yet.
- A one-window assembly dissolves back into a window, so its name is lost.
- Mock apps are shallow by design: terminal commands, builds and messages are simulated locally.

## Questions to test with users

1. Without being told, do people discover that the **tab/rim moves the assembly** while the **title bar pulls a window out**? Is the elastic resistance enough of a hint, or does it feel like a bug?
2. Does the desk feel **spatially stable** when attention moves, or do the make-room nudges and size changes read as things "jumping around"? Which falloff curve feels most natural?
3. Is a **widget** enough to stay oriented, e.g. can people find their music player or their project build again without expanding everything?
4. Do people want to **pin** something at full size outside the field, such as a video call? That would be a new mode, and we have avoided adding one so far.
5. Should focusing a member make it **more** prominent than its siblings, or is uniform assembly scale right?
6. Is the collapsed card's summary (name, apps, one headline status, two secondary lines) **too much or too little** to recognise a project at a glance?
7. When the desk is full, does the tightening field feel like **calm simplification** or like **losing things**?
8. Does dragging something past other objects (the field follows your hand, so nearby windows wake up) **help** targeting or distract?
