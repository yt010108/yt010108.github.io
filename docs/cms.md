# Public Sveltia CMS

This repository serves Sveltia CMS at `https://yt010108.github.io/admin/` after GitHub Pages deploys. The page is public, but publishing requires GitHub repository write permission.

## Sign in

1. Create a **fine-grained personal access token** at GitHub Settings → Developer settings → Personal access tokens.
2. Restrict the token to `yt010108/yt010108.github.io` and grant **Contents: Read and write**. Do not grant broader repository permissions unless required for an additional feature.
3. Visit `/admin/` on a trusted device and select **Sign in with access token**.
4. Manage posts under `content/posts/`. Saving writes a Git commit to `main`, which triggers the existing Hugo GitHub Actions deployment.

Do not commit a token, embed it in the HTML/config, or share it. Sveltia stores the login token in the browser's local storage; use a trusted browser and sign out or clear site data when finished.

## Content compatibility

- This CMS initially manages **Posts only**. Notes and Projects remain unchanged.
- Posts use Markdown with **TOML front matter** (`+++`).
- Uploaded images are stored in `static/images` and referenced under `/images`.
- The `extra.sample` field is included for the existing sample posts. If adding new front matter fields, add them to the CMS schema before editing affected posts to avoid metadata loss.
- Image insertion and rich-text Markdown serialization can alter formatting; inspect a test post's diff before editing important content.
- `draft: true` is a Hugo content flag, not a server-side access control. Do not put secrets in posts or the public repository.

## Verification after merging

1. Check that GitHub Actions succeeds and `/admin/` loads.
2. Sign in with the restricted token and create a **test post**, checking that it starts with `+++` front matter.
3. Upload a test image, check that the Markdown points to `/images/...`, and ensure it renders on the deployed page.
4. Confirm existing posts, their dates/tags, and the Hugo build are unaffected.
5. Remove the test post and media through Git if no longer needed.

Official docs: https://sveltiacms.app/en/docs/start and https://sveltiacms.app/en/docs/backends/github

The table of contents field uses `showToc`, as expected by PaperMod. Existing example posts are retained as drafts.
