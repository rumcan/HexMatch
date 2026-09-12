# Scenery source art

Ground-decal textures go here; `node tools/make-scenery-art.mjs` (or
`npm run scenery-art`) cuts them into the shipped decals.

Nothing in the scenery pipeline is drawn by the tool. It only cuts, fits and
optimises art that already exists — an earlier pass generated trees as vector
blobs and patches as noise fields, and both read as stickers on top of the
painted OpenGFX map.

| file | family | what it must be |
|------|--------|-----------------|
| `bare-patch.png` | `bare` | A large scrape of bare earth that fades out towards its rim. |
| `grass-dry.png` | `dry` | Pale, sun-bleached grass, same treatment. |
| `grass-rocky.png` | `rocky` | Turf broken up with stone and scree. |
| `grass-lush.png` | `lush` | Thicker, greener grass. |

Any family with no file simply ships nothing and the ground paints a plain
meadow there — missing art is never filled in with something invented.

Each source should be roughly oval with soft edges; the tool squashes it to
the 2:1 the isometric ground needs and cuts four rotated variants, so one
texture per family is enough. Bigger is fine — output is 1024×512 regardless.

Either alpha convention works: real transparency is used as-is, and art
flattened onto white has its alpha derived from how far each pixel is from
white, which keeps the soft rim instead of cutting it to a hard edge.

**Trees are not here.** They are cut from the OpenGFX temperate strips already
in the repo at `src/assets/sprites/png/trees/temperate/`. The meadow texture is
not here either: it lives at `tools/texture-src/grass-src.png`, because
`tools/make-ground-textures.mjs` reads it to build the seamless
`assets/ground/grass.png`.
