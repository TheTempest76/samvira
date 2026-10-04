Put archive files here (PDF, TXT, MD, or scanned images PNG/JPG/TIFF) and run:  npm run ingest
PDFs need the `pdftotext` and `pdftoppm` tools (sudo apt install poppler-utils).
Scanned pages (no text layer) and images are read with OCR (Tesseract, English + Hindi + Marathi by default;
set OCR_LANGS, e.g. eng+hin+mar+kan). The Tesseract copy in ../tools/ocr needs no install.
Each file becomes one document; its title is the file name.
