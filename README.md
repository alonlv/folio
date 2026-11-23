# Folio PDF workspace

Folio is a local web app for combining documents, rearranging pages, editing text, and converting files.

## Run locally with Docker

Run these commands from the project directory.

```sh
docker build -t folio-pdf:local .
docker run --rm --name folio-pdf-local -p 127.0.0.1:3080:3080 folio-pdf:local
```

Open [http://localhost:3080](http://localhost:3080). **Try a sample** adds a three-page PDF to the workspace. The port mapping makes the site available only on this machine.

Without Docker, use Node.js 22.13 or newer and run `npm ci`, `npm run build`, and `npm start`. Install Ghostscript (`gs`) for compression and LibreOffice Writer (`soffice`) for layout-preserving DOCX conversion. For scan OCR, install Poppler (`pdfinfo` and `pdftoppm`) and Tesseract with the Hebrew and English language models. The Docker image includes all of these. For frontend development, run `npm start` for the API on port 3080, then `npm run dev` for Vite in a second terminal.

## What you can do

- Open **Settings** to choose English or Hebrew and Light, Dark, or System appearance. Folio remembers these preferences in your browser. Hebrew also mirrors navigation and page controls right to left.
- Add multiple PDFs, PNGs, and JPGs by dropping them into the workspace or browsing for files.
- Drag pages to reorder them or use the arrow controls. Rotate, select, copy, cut, paste, duplicate, extract, and delete pages. You can also insert blank pages and undo or redo page edits.
- Choose a filename and download the assembled PDF. Split a range of pages, add a watermark or page numbers, extract text, or download page images in a ZIP.
- Open a page to place new text on top of its original contents. To revise existing wording, import selectable PDF text or DOCX text into the document editor, then export the new text as Word or PDF. Text imports use a plain layout. The editor detects each paragraph’s direction automatically, or you can choose a direction for the whole document. PDF and Word exports support Hebrew and mixed Hebrew/English text. When importing PDF text, check the reading order and punctuation on lines that mix directions.
- Use **Scan to text (OCR)** to convert scanned PDFs to editable text. Choose Hebrew, English, or both. You can also add JPG or PNG scans to the workspace and run OCR on those pages. Review recognized text before exporting. OCR accuracy depends on the scan quality and layout.
- Convert a DOCX to PDF with LibreOffice. Layout depends on the fonts available in the container. Compress PDFs with three quality presets. Compression keeps the original bytes if the preset produces a larger file.

The workspace supports up to 300 pages, 60 MB per input file, and 120 MB in active source files. PDF-to-PNG export supports up to 100 pages. OCR supports up to 12 pages and 20 MB per request. Page assembly preserves page content but can omit document-level features such as bookmarks, interactive form structure, and signatures. An unchanged individual PDF downloads as its original bytes.

Most tools run entirely in the browser. Compression, Word-to-PDF conversion, and OCR run on the Folio server and clean up temporary files after processing. There is no database. Download your work before reloading or closing the tab.

## Railway configuration

The root Dockerfile and `railway.toml` prepare the app for a future Railway deployment. The image listens on `0.0.0.0`, uses Railway's injected `PORT`, and serves `/health` for deployment health checks. No volume or credentials are required. See [Railway's Dockerfile guide](https://docs.railway.com/builds/dockerfiles) and [health check documentation](https://docs.railway.com/deployments/healthchecks).
