# PDF Editor

A simple, modern PDF editor built with **React**, **PDF.js**, **Fabric.js**, **pdf-lib** and **Node.js**.

## Run it

```bash
npm install
npm run dev        # web on http://localhost:5173, API on :3001
```

The app is fully client-side: PDFs are opened, edited and saved in the browser and never uploaded.
`npm run build` produces static files in `dist/`, which is what gets deployed (Vercel config in `vercel.json`).

`npm start` (after a build) runs the optional Express server. It serves `dist/` and also exposes the
same PDF builder as an API, `POST /api/export`, for scripts or self-hosting.

## Features

- **Edit existing text** (`X`): click any line of the PDF's own text to change or delete it. Size,
  position, rotation and color are kept; the font is matched to the closest standard font.
- **Add text**: added as real PDF text, so it stays selectable and searchable. Font, size, bold/italic, alignment, colour.
- **Highlight, draw (signatures), rectangle, ellipse, line, arrow, eraser**
- **Images**: insert, paste (⌘V) or drag in a PNG/JPG/SVG, for logos or a scanned signature.
- **Pages**: reorder by dragging, rotate, delete (with undo).
- **Undo/redo** across the whole document, keyboard shortcuts (press `?`), pinch/⌘-scroll zoom.
- **Document panel**: file size, paper size (A4/Letter…), metadata, and a summary of your changes.

## How it works

```
client/src
  App.jsx                 state, shortcuts, page operations
  components/PageView.jsx PDF.js canvas (bottom) + Fabric.js canvas (top) per page
  lib/exportPdf.js        turns Fabric objects into an export spec
  lib/buildPdf.js         pdf-lib: copies pages, applies rotation, draws edits (browser + Node)
  lib/history.js          document-wide undo/redo (per-page JSON snapshots)
server
  index.js                optional Express server: static files + POST /api/export
```

Fabric works in unscaled PDF points, and zoom is applied through Fabric's viewport, so edits never
need converting when you zoom. On export, the client inverts the PDF.js viewport transform to get
a matrix from screen space to PDF user space. That one matrix handles pages with built-in rotation
and offset crop boxes. `buildPdf` applies it with a single `cm` operator, then draws:

1. highlights as vector rectangles (multiply blend),
2. one transparent PNG per page with ink, shapes and images,
3. text as real Helvetica/Times/Courier text.

Original pages are copied with `copyPages`, so their content and links are preserved.

### Editing existing text

PDF.js `getTextContent()` gives positioned text runs. `lib/textEdit.js` merges them into lines, using
direction, baseline, size and gaps. It detects family, weight and style from the embedded font's name.
On click, it samples the rendered page under the line to get the background and text colors. It then
places a background-colored **cover** rectangle over the original, and an editable `IText` positioned
so that Fabric's baseline lands exactly on the original baseline. Opening a line and changing nothing
reverts automatically.

## Limitations

- **Edited text is covered, not removed.** The old text remains in the file underneath and can still
  be copied or extracted, so this is *not* redaction. True removal would mean rewriting the page's
  content stream.
- Edits work line by line. Paragraphs don't reflow, and mixed styles within a line become one style.
- Replacement text uses the closest standard font (Helvetica/Times/Courier), not the embedded one.
- Added text uses the standard PDF fonts (WinAnsi). Characters outside that set are saved as `?`.
- Form fields aren't fillable as fields. Use the Text tool to type on top of them.
# pdf-editor
