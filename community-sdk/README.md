# SCSP Community SDK

The community SDK is a deployable static web application and an embeddable web component that lets developers add a capability browser to any app.

## Contents

```
community-sdk/
├── index.html          # Full community browsing page (GitHub Pages target)
├── styles.css          # Extracted stylesheet (CSS custom properties, dark mode)
├── widget.js           # <scsp-community> web component (Shadow DOM)
├── embed-example.html  # Demo: widget embedded inside a mock SaaS settings page
└── README.md           # This file
```

---

## 1. Deploy the community page (GitHub Pages)

The community page is a static site — no build step required.

### Automatic deployment

A GitHub Actions workflow is included at `.github/workflows/deploy-community.yml`. It runs on every push to `main` that touches `community-sdk/**` or `registry/**`.

To enable it:

1. Go to your repository **Settings → Pages**.
2. Under **Source**, select **GitHub Actions**.
3. Push any change to `community-sdk/` on `main`.
4. The workflow will build and deploy automatically. The URL will be:
   ```
   https://{your-username}.github.io/{your-repo}/
   ```

### Manual deployment (any static host)

Copy the contents of `community-sdk/` and `registry/` to your web server:

```bash
# Example: deploy with rsync
rsync -av community-sdk/ user@host:/var/www/html/
rsync -av registry/ user@host:/var/www/html/registry/

# Example: serve locally for development
npx serve .
# Then open http://localhost:3000/community-sdk/
```

The page works by opening `index.html` directly in a browser — no server required for local testing.

---

## 2. Embed the widget in your own app

The `<scsp-community>` web component works in any HTML page. It uses Shadow DOM so its styles are completely isolated from your app.

### Step 1 — Load the script

```html
<script src="https://scsp.dev/sdk/widget.js"></script>
```

Or host `widget.js` yourself:

```html
<script src="/path/to/widget.js"></script>
```

### Step 2 — Add the element

```html
<scsp-community
  registry="https://raw.githubusercontent.com/scsp-community/registry/main/registry/index.json"
  theme="auto"
  max-height="600px"
></scsp-community>
```

That's it. The widget fetches capabilities, renders a searchable list, and lets users copy the `scsp install <id>` command with one click.

### See the full demo

Open `embed-example.html` in your browser to see the widget embedded inside a realistic "Acme" settings page with a sidebar, installed capability list, and the live widget in the sidebar column.

---

## 3. Widget attributes

| Attribute       | Values                          | Default     | Description |
|---|---|---|---|
| `registry`      | Any URL to a `index.json`       | Community registry | URL of the registry to load capabilities from |
| `theme`         | `light` \| `dark` \| `auto`    | `auto`      | Color scheme. `auto` follows `prefers-color-scheme` |
| `max-height`    | Any CSS length (`px`, `vh`, etc.) | `500px`   | Max height of the scrollable capability list |
| `community-url` | Any URL                         | `https://scsp.dev/community` | URL for the "Open in browser" link |

### Observing attribute changes

The component reacts to live attribute changes via `attributeChangedCallback`:

```js
const widget = document.querySelector('scsp-community');
widget.setAttribute('theme', 'dark');          // switches to dark mode immediately
widget.setAttribute('registry', '/my-reg/index.json'); // re-fetches capabilities
```

---

## 4. Customize the registry URL

### Point at your own registry

```html
<scsp-community
  registry="https://registry.mycompany.com/capabilities/index.json"
></scsp-community>
```

The registry must serve a JSON file with this shape (V0.1 git-based registry format):

```json
{
  "scsp_registry": "0.1",
  "updated_at": "2026-04-19T08:00:00Z",
  "capabilities": [
    {
      "id": "my-capability-v1",
      "name": "My Capability",
      "version": "1.0.0",
      "layer": "module",
      "description": "What it does.",
      "tags": ["tag1", "tag2"],
      "active_installs": 10,
      "compatibility_score": 0.95
    }
  ]
}
```

### Private registries (CORS)

If your registry is on a different domain, add the appropriate CORS headers:

```
Access-Control-Allow-Origin: *
Content-Type: application/json
```

For a GitHub raw file registry, CORS is already handled by GitHub's CDN.

---

## 5. Theming

### Main page (index.html + styles.css)

All colors are driven by CSS custom properties defined in `:root`. Override any token:

```css
:root {
  --color-primary:        #7c3aed;   /* purple → violet */
  --color-primary-hover:  #6d28d9;
  --color-primary-light:  #ede9fe;
}
```

Dark mode tokens live inside `@media (prefers-color-scheme: dark)` in `styles.css`.

### Widget (widget.js)

The widget builds its styles programmatically inside the Shadow DOM. To customize colors, fork `widget.js` and edit the `buildStyles(dark)` function — specifically the `c` object near the top of that function.

Alternatively, expose CSS custom properties through the Shadow DOM pierce:

```css
scsp-community {
  /* host-level layout overrides */
  display: block;
  width: 100%;
}
```

---

## 6. How it works

- **No build step** — pure HTML, CSS, and vanilla JS. Open `index.html` directly.
- **Registry fetch** — `index.html` tries multiple URLs (`../registry/index.json`, then a raw GitHub URL). If all fail, it falls back to hardcoded example data so the page is never empty.
- **Install copy** — clicking "Install" calls `navigator.clipboard.writeText('scsp install <id>')`. Falls back to `execCommand('copy')` for non-secure contexts.
- **Filtering** — layer chips and surface chips filter in memory. Search debounces at 200 ms.
- **Modal** — clicking a card opens a detail panel with auto-review badges, stats, surfaces, and component blast-radius indicators.
- **Web component** — `widget.js` registers `<scsp-community>` using the Custom Elements v1 API. Shadow DOM isolates styles. `AbortController` cancels in-flight fetches on disconnect or attribute change.

---

## 7. Protocol reference

- [PROTOCOL.md](../docs/PROTOCOL.md) — Complete SCSP protocol specification
- [REGISTRY-API.draft.md](../docs/REGISTRY-API.draft.md) — Registry HTTP API (V0.2 design)
- [registry/index.json](../registry/index.json) — Live community registry index

---

MIT License — see [../LICENSE](../LICENSE)
