# Lodestone — an experimental spatial desktop

> **New: the Library.** An experimental file library lives in `src/library/` and opens by default at
> `http://localhost:5173/` (the desk moved to `/#desk`). See [Library](#library) below.

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
8. **Focus modes (for comparison testing):** the button in the top bar (or `M`) cycles between
   - *Field moves to window* (the concept): attention travels; windows stay home.
   - *Window to centre · overlap*: the lens is fixed at the centre and the focused window travels there; nothing else moves, so it covers whatever is underneath.
   - *Window to centre · push aside*: as above, but anything overlapping the centred window takes the shortest on-screen escape (left/right/up/down). Pushed windows are judged where they land: further from the centre means less attention, so they shrink (e.g. full → compact), which in turn needs less push.

   In both centre modes the window's home position is untouched. It returns when attention leaves (click elsewhere or press `Esc`).
9. **Tune** (or press `T`): falloff curve and radius, thresholds, magnetism, make-room distance, springs. `[` / `]` move attention between objects; `Esc` releases focus.

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


---

# Library

An experimental file library for Lodestone. The question it is built to answer:

> Can we make files so easy to recognise, find and use that people rarely need to think about where they are stored?

Its premise is that **finding shouldn't require organising first**. The default is a stable chronological list
with real thumbnails and an instant, non-disruptive Quick Look. Above it sits a shelf of files that are likely
relevant to the current Assembly and application, each with a plain-language reason. Organising (tags,
collections, folders) is available and never required.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173/        Library, full screen, simulated context
                     # http://localhost:5173/#desk   Lodestone desk with the Library as a window
npm run build        # typecheck + production build
```

User state persists in `localStorage` (`lodestone:library:v1`). **Settings → Reset library state** clears it.

## Things to try

1. **Browse.** Arrow through *Everything* (about 220 items). It is grouped by day and sorted by last use; new
   downloads count as activity, so they appear at the top marked **New**.
2. **Quick Look.** Press **Space**. The preview floats over the right of the list; the list doesn't move. Use
   **↑/↓** to step through files while the preview follows, **←/→** for PDF pages and slides, and **1–5** for the
   views (Preview, Info, Tags, Activity, Related). **Enter** opens the file, **Esc** or **Space** closes the preview.
3. **Folders.** Select `orbit` or `Lantern` and press **Space**. You can search inside the folder, open
   subfolders with **Enter/→**, go back up with **←/Backspace** or the breadcrumbs, and see aggregate size,
   activity, apps and Assemblies. *Work in this folder* turns it into a dedicated library view.
4. **Context.** In the shelf, switch the Assembly from *Desktop Research* to *orbit*. The shelf changes, and the
   list below stays put. Turn on **Why these?** to see the reasons behind each suggestion. Hover a tile to **pin**
   it or hide it from this context.
5. **Dynamic collection.** The dashed *Related to …* tile is generated from context. Open it and choose
   **Pin as collection** to save a snapshot.
6. **Tags.** Press **T**. Personal tags are solid. Suggestions from content are dashed and marked **◇**, labelled
   *Simulated*, and can be approved (✓) or rejected (×). New tags reuse existing labels where they match.
7. **Created.** Press **N**. A note exists immediately, already saved, with no folder chosen. Its first line becomes
   its name; versions accumulate in *Info*. It is attached to the active Assembly.
8. **Received.** Open *Received*. Press **K** to keep a download (no folder needed); **O** to organise, which is a
   separate action.
9. **Collections across providers.** Shift+↓ to select a PDF from Downloads, a Nextcloud image and a git file,
   then press **C**.
10. **Availability.** Field Drive files are dashed and can't be opened. Online-only Nextcloud files download on
    preview. Use the sidebar to simulate plugging the drive in or taking Nextcloud offline.
11. **Scale.** Settings → *Scale test* adds 5,000 archived items, and the list stays fast (it is virtualised).
12. **On the desk.** Open `/#desk` and click **Library** in the top bar. Focus the *orbit* assembly, and the
    Library's shelf follows the desk. Move attention away and the Library becomes a compact list of relevant files,
    then a one-line widget. Clicking a compact entry opens it without moving attention. Code and notes open as real
    editor and notes windows.

## Architecture

```
src/library/
  model/types.ts        identities: LibItem (file|folder), Provider, Tag, Relation, UsageEvent, Collection, LibAssembly
  model/seed.ts         deterministic sample library (relative to a persisted epoch)
  model/providers.ts    ProviderAdapter per storage provider + honest availability
  model/store.ts        persisted *user overlay* only (tags, keeps, collections, pins, created docs, usage)
  model/library.ts      derived index: seed + overlay → items, children, usage stats, co-usage, relations
  model/relevance.ts    contextual ranking with tiered, explained signals
  model/query.ts        scope / search / sort / day grouping with a frozen activity order
  model/ai.ts           MetadataAnalyzer interface: simulated analyser + optional local Ollama; EmbeddingIndex stub
  model/actions.ts      user operations (open, keep, create, tag, collect, attach, move); desk opener hook
  deskBridge.ts         desk focus → library context; open files as desk windows
  ui/                   LibraryApp, FileList (virtualised list + grid), Shelf, QuickLook, previews/, Panels, Sidebar
src/apps/LibraryView.tsx  the Library as a Lodestone app: full / compact (contextual files) / widget
```

- **The seed is never mutated.** It is regenerated from a persisted epoch, and the store holds only what the user
  changed. This gives a clean boundary for a later real index (SQLite/FTS, or tracker): replace `seed.ts` and
  `providers.ts`, and the overlay becomes the user's metadata database.
- **Spatial stability is enforced in the model.** Rows have fixed heights. The *recent* order is computed from
  activity up to `orderAt`, so opening a file doesn't reshuffle the list while you work. A quiet "N new
  activities · update order" link (or **R**) applies the new order when you ask, and so does a reload.
- **Ranking is tiered** so explicit associations always win over inferred ones: pinned 1000, attached 300,
  Assembly collection 220, used in the Assembly ≤120, focused app ≤70, references ≤45, co-usage ≤35, topic ≤30,
  compatibility 6. Each contribution carries its own sentence, and the strongest one is shown.
- **Inferred and observed information are kept apart.** Personal tags, AI suggestions (◇, dashed, labelled with
  their engine) and observed usage (the *Activity* view) are separate in both data and UI.
- **Provider abstraction.** `ProviderAdapter.read()` is async and can fail with a reason. Online-only files
  simulate a fetch, and a disconnected drive returns a refusal that the preview shows as it is.

## What is simulated

- All files, contents, thumbnails (procedural SVG), providers, sync and availability.
- "Open" logs a usage event and shows a toast; on the desk, code and Markdown open in real editor and notes windows.
- Keep, move and version history are library state only. **Nothing is read from or written to a disk**, and the
  UI says so whenever it might be ambiguous.
- AI metadata: seeded topic tags and summaries, plus a deterministic keyword analyser. The **optional Ollama**
  engine (Settings) calls only `http://localhost:11434`, only on request, and only for files whose contents are
  local.

## Limitations

- Browser-only: no real filesystem access. Search is a substring match over names, paths, tags and contents,
  with `kind:pdf` and `in:nextcloud` filters. There is no fuzzy matching or embeddings yet.
- The desk can't host every app type yet: PDFs, images and documents opened from the desk only log usage.
- Files can't be dragged between the library and desk windows.
- The scale test reaches about 5,200 items. Index rebuilds are synchronous, which would need to move to a worker
  at around 50k items.

## What to test with people

1. Without explanation, do people use **Space/arrows** to scan, and does the list feeling *fixed* help them recall
   where something was ("it was just below the invoices")?
2. Can people find a target file faster through **the shelf**, **chronology plus thumbnails** or **search**? Which
   do they try first, and does that change after a week?
3. Are the **reasons** under suggestions believed and understood? Does "Used 12× with this Assembly" earn more
   trust than "Related by topic"?
4. Do people grasp **Keep vs. Organise**, and do they trust that an unkept download won't vanish?
5. Is the **folder vs. collection** distinction clear (solid folder versus double-square collection; "moves" versus
   "references")?
6. Does the **frozen order** feel stable or stale? Does anyone notice or use "update order"?
7. Do people accept, ignore or remove **suggested tags**? Does the ◇ marking matter to them?
8. On the desk: is the **compact Library** useful enough at the edge of attention to open files from it directly?
