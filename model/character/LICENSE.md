# villager.glb

The walking character of the third-person Walk mode (v1.18, `src/avatar.js`). Built with `tools/build_character.mjs`.

All parts are by **Quaternius** (https://quaternius.com) and dedicated to the public domain under
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/): free for any use, commercial included,
with modification and redistribution, no attribution required (credited here anyway).

| Part | Kit |
|---|---|
| Head, eyes, parted hair, moustache | Universal Base Characters (`Regular_Male_OnlyHead`, `Hair_SimpleParted`, `Hair_Moustache`) |
| Shirt, sleeves and hands, trousers, boots | Modular Character Outfits – Fantasy (`Male_Peasant_*`) |
| Idle, walk, jog, sprint, jump (in the air) | Universal Animation Library (`UAL1_Standard`) |

Changes: the parts are merged onto one skeleton, only five animation clips (idle, walk, jog, sprint, jump) are kept, textures are scaled to 1024²
WebP, meshes are meshopt-compressed, and the hair is tinted dark brown at run time.
