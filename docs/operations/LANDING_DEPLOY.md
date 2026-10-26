# Landing (leaf.app.br)

`landing-page/` is the exact content of the Cloudflare Pages project `leaf-app` (production branch `main`). Deploy the folder as is:

```bash
npx wrangler@4 pages deploy landing-page --project-name leaf-app --branch main \
  --commit-hash "$(git rev-parse HEAD)" --commit-message "<what changed>"
```

- Pages has no build step. Every file in the folder is published, so do not put notes, scripts or Markdown inside `landing-page/`.
- Deploy only from a clean `main` checkout, after the PR is merged.
- Cloudflare rewrites e-mail addresses in the served HTML (email obfuscation). Ignore that difference when comparing the live site with the repository.
- `.well-known/` holds the iOS and Android app-link files. The backend reads the same folder in `leaf-websocket-backend/routes/app-link-association.js`.

History: on 2026-10-22 the new visual identity was published from a temporary folder outside the repository, and on 2026-10-26 the #438 changes (SAC 24h, Rio protocol) were applied on top of it. This folder was replaced with that published content on 2026-10-26.
