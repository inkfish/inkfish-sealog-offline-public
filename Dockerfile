FROM nginx:1.30.5-alpine

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Per docs/INSTALLATION.md ("Install the static app files"): the runtime
# bundle is this curated file set, never the full repository checkout —
# tests, dev dependencies, Git metadata, and certificate inputs are excluded
# by construction here, not just by .dockerignore.
COPY index.html landing.html app.js update-banner.js sw.js manifest.webmanifest favicon.ico LICENSE THIRD_PARTY_NOTICES.md /srv/sealog-offline/
COPY src/ /srv/sealog-offline/src/
COPY icons/ /srv/sealog-offline/icons/
COPY licenses/ /srv/sealog-offline/licenses/

EXPOSE 80
