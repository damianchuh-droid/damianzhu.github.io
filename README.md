# DIZZYWORKZ

Personal engineering and experimental design portfolio for `dizzyworkz.com`. The site uses static HTML, CSS, and JavaScript with no build step or external dependencies.

## Preview locally

Open `index.html` directly in a browser, or run this command from the repository root for an HTTP preview:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000/) in a browser. Stop the preview with Ctrl+C.

## Edit the portfolio

- `index.html` contains the image hero, About, and Contact sections. The hero image lives in `assets/images/`.
- `projects/` contains the gallery and the individual case studies. Copy a case study, update its title and content, and add a gallery entry in `projects/index.html`. Use each stage to add CAD exports, analysis assumptions and results, prototype photos, or test data as available.
- `assets/css/site.css` defines the layout, typography, and color variables.
- `assets/js/diagrams.js` renders the example isometric drawings. Replace a canvas with an image and descriptive alt text when you have project media.

## GitHub Pages

The site files are ready to serve from the repository root. When approved for publication, configure GitHub Pages to serve from the chosen branch and root folder. `CNAME` specifies `dizzyworkz.com`, and `.nojekyll` lets Pages serve the static files as provided. This local setup does not change GitHub Pages settings or DNS.
