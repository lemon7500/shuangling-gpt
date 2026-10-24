# License supplements

Original license files remain in their bundled packages. Two published npm archives omit a separate license file:

- `standardwebhooks@1.1.1`: `standardwebhooks-MIT-LICENSE.txt` is the exact MIT license from the official repository at the package's published `gitHead`. Its original copyright notice is retained. The portable builder also installs this file as the package's `LICENSE`.
- `@electron-internal/extract-zip@1.0.5`: its official tag and npm metadata declare `BSD-2-Clause`, but contain no separate license or copyright notice. `BSD-2-Clause-standard-template.txt` supplies the unchanged SPDX standard terms for reference. **It is a template, not an upstream copyright notice.** Placeholder owner and year are deliberately left unchanged; no ownership statement is invented. The original package README and metadata remain bundled.

[sources.json](sources.json) records the official source URLs, exact revisions where available, Git blob identities and SHA256 hashes. The builder verifies these hashes before packaging. These supplements do not change the dependencies' declared licenses.
