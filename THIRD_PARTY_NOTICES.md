# Third-party notices

The project code is licensed under the [MIT license](LICENSE). Upstream
material keeps the notices below. Include this file and the corresponding license
files when redistributing the repository or static app.

## Phosphor Icons — UI glyphs and app icons

- Project: [Phosphor Icons](https://phosphoricons.com)
- Source: [`phosphor-icons/core`](https://github.com/phosphor-icons/core/tree/2b75f3ad12b420c9504ef05df8d2564a28f8500e)
- Package: `@phosphor-icons/core` 2.1.1, regular weight
- Revision: `2b75f3ad12b420c9504ef05df8d2564a28f8500e`
- License: MIT; copyright 2023 Phosphor Icons
- Original SVGs: `icons/phosphor/regular/`; hashes: `icons/phosphor/source.json`
- Distributed UI assets: `icons/phosphor-sprite.svg` and
  `icons/phosphor-caret-down-{light,dark}.svg`, plus the
  `icons/phosphor-caret-right.svg` and `icons/phosphor-warning-circle.svg` CSS masks
- App icon assets: `icons/app-icon.svg`, app/touch-icon and favicon PNGs, and
  `favicon.ico`, generated from the `list` glyph

The eleven glyphs are `arrows-clockwise`, `caret-down`, `caret-right`, `check`,
`check-circle`, `download-simple`, `hourglass-high`, `list`, `pencil-simple`,
`warning-circle`, and `x`.

The source SVGs and [upstream license](icons/phosphor/LICENSE) are unmodified.
An identical license copy is included in
[licenses/phosphor-icons-MIT.txt](licenses/phosphor-icons-MIT.txt).
`scripts/sync-phosphor-icons.mjs` wraps their unchanged path data in SVG symbols,
adds the full notice, and makes two fixed-color copies of `caret-down` for native
select backgrounds. The `caret-right` and `warning-circle` copies are CSS masks
for status buttons and warning text. HTML controls and event icons share this sprite. CSS sizes and
colors the glyphs; it does not redraw them. Repeated uses and the two select copies
come from the same licensed source, not separate icon collections.

`scripts/sync-app-icons.mjs` uses the same `list` glyph to generate
`icons/app-icon.svg`, five PNGs (16px and 32px favicons, a 180px touch icon, and
192px and 512px app icons), and a three-size ICO favicon. The SVG
includes the full Phosphor license; retain this notice and `icons/phosphor/LICENSE`
with the generated PNG and ICO files.

```text
MIT License

Copyright (c) 2023 Phosphor Icons

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Understand-Anything — theme palettes

Theme palettes and their accent colors are adapted from
[Understand-Anything](https://github.com/Egonex-AI/Understand-Anything), particularly
its [dashboard theme presets](https://github.com/Egonex-AI/Understand-Anything/blob/0566ea8b6b0f5e301ea125736e89568047105dd1/understand-anything-plugin/packages/dashboard/src/themes/presets.ts),
under the MIT License. Light, Honey, and Ocean adapt its Light Minimal, Dark Gold,
and Dark Ocean palettes. The app uses those three fixed palettes with its own theme controls and layout.

The reference source is revision `0566ea8b6b0f5e301ea125736e89568047105dd1`. The
[license at that reference revision](https://github.com/Egonex-AI/Understand-Anything/blob/0566ea8b6b0f5e301ea125736e89568047105dd1/LICENSE)
is included as [licenses/understand-anything-MIT.txt](licenses/understand-anything-MIT.txt)
and reproduced below.

```text
MIT License

Copyright (c) 2026 Yuxiang Lin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## External service and development acknowledgments

- [Sealog Server](https://github.com/OceanDataTools/sealog-server) by Ocean Data
  Tools is the external backend this application interoperates with. Its
  [MIT license](https://github.com/OceanDataTools/sealog-server/blob/2.x/LICENSE)
  applies to the server. Server code is not bundled here. API references are listed
  in `docs/SPECIFICATION.md` in the source repository.
- Development/test dependencies are declared in `package.json` and pinned in
  `package-lock.json`. They are not shipped as browser runtime libraries.
  Redistributing their code, `node_modules`, a development container, or generated
  tool bundles requires preserving the applicable upstream licenses and notices.
  The app's MIT license does not replace those terms.
