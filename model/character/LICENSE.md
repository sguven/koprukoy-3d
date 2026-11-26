# villager.glb

The walking character of the third-person Walk mode (v1.17, `src/avatar.js`). Built with `tools/build_character.mjs`.

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

# bots.glb

The people the game mode's bots are (v1.18, `src/botchar.js`), built with the same tool from the same CC0 kits by
**Quaternius**, plus two colourways as separate textures (`T_Noble_2_BaseColor.webp`, `T_Noble_3_BaseColor.webp`):

| Part | Kit |
|---|---|
| Head, eyes; hairstyles Buzzed, SimpleParted, SlickBack, Balding; Beard, Moustache, MuttonChops | Universal Base Characters |
| Peasant, Ranger (with the hood) and Noble outfits; the Noble's second and third colourways | Modular Character Outfits – Fantasy (`Male_Peasant_*`, `Male_Ranger_*`, `Male_Noble_*`) |
| Idle, walk, jog, sprint, crouch idle and walk, pistol aim and idle stances, death, hit | Universal Animation Library (`UAL1_Standard`) |

Built with:

    ANIMS=Idle_Loop,Walk_Loop,Jog_Fwd_Loop,Sprint_Loop,Crouch_Idle_Loop,Crouch_Fwd_Loop,Pistol_Aim_Neutral,Pistol_Idle_Loop,Death01,Hit_Chest \
    TEX=512 ANIMSRC=<ual>/UAL1_Standard.glb node tools/build_character.mjs model/character/bots.glb <ubc>/Regular_Male_OnlyHead.gltf \
      <ubc>/Hair_{Buzzed,SimpleParted,SlickBack,Balding,Beard,Moustache,MuttonChops}.gltf \
      <outfits>/Male_Peasant_{Arms,Body,Legs,Feet}.gltf <outfits>/Male_Ranger_{Arms,Body,Legs,Feet_Boots,Head_Hood}.gltf \
      <outfits>/Male_Noble_{Arms,Body,Legs,Feet}.gltf

Changes: as for villager.glb, with ten clips and 512² textures; the colourway textures are scaled to 512² WebP. Each bot
shows one outfit, hairstyle and beard and tints its own copies of the materials at run time.
