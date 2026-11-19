# Third-party software in this folder

The hub's own code is MIT (see LICENSE). The Retro Deck also ships files written by other people, under their own licences.

## Emulator cores (`public/retro/cores/`)

RetroArch cores compiled to WebAssembly, taken unmodified from
[arianrhodsandlot/retroarch-emscripten-build](https://github.com/arianrhodsandlot/retroarch-emscripten-build) v1.22.2.

| Core | Plays | Licence | Source |
| --- | --- | --- | --- |
| fceumm | NES | GPL-2.0 | https://github.com/libretro/libretro-fceumm |
| gambatte | Game Boy, Game Boy Color | GPL-2.0 | https://github.com/libretro/gambatte-libretro |
| mgba | Game Boy Advance | MPL-2.0 | https://github.com/libretro/mgba |
| snes9x | Super NES | Snes9x licence (**non-commercial use only**) | https://github.com/libretro/snes9x |
| genesis_plus_gx | Mega Drive / Genesis | Genesis Plus GX licence (**non-commercial use only**) | https://github.com/libretro/Genesis-Plus-GX |

RetroArch itself is GPL-3.0 (https://github.com/libretro/RetroArch). Because two cores are non-commercial only,
do not use this deck in anything that is sold or carries advertising without removing them.

[Nostalgist.js](https://github.com/arianrhodsandlot/nostalgist) (MIT) drives the cores.

## Homebrew games (`public/retro/homebrew/`)

Free software games, included unmodified. Each card on the shelf links to its source code.

| Game | Console | Author | Licence | Source |
| --- | --- | --- | --- | --- |
| Nova the Squirrel | NES | NovaSquirrel | GPL-3.0 | https://github.com/NovaSquirrel/NovaTheSquirrel |
| Thwaite | NES | Damian Yerrick | GPL-3.0-or-later | https://github.com/pinobatch/thwaite-nes |
| Concentration Room | NES | Damian Yerrick | GPL-3.0-or-later | https://github.com/pinobatch/croom-nes |
| µCity | Game Boy Color | Antonio Niño Díaz | GPL-3.0-or-later | https://github.com/AntonioND/ucity |
| Miniplanets (REMIX) | Mega Drive | Javier Degirolmo (Sik) | Zlib | https://github.com/sikthehedgehog/miniplanets |
| Dragon's Castle | Mega Drive | Javier Degirolmo (Sik) | Zlib | https://github.com/sikthehedgehog/dragon |
| Colour Maths Demo | Super NES | Doug Fraker | MIT | https://github.com/nesdoug/SNES_12 |
| Attack on Voxelburg | Game Boy Advance | Mutant Stargoat (nuclear) | GPL-3.0-or-later | https://github.com/MutantStargoat/voxelburg |
| Galactic Quest | Game Boy Advance | origamiscienceguy | GPL-3.0-only | https://github.com/origamiscienceguy/Galactic_Quest |

The NES and Game Boy Color files came from the [retrobrews](https://github.com/retrobrews) collections, the Mega Drive and
Super NES files from their authors' own repositories, and the Game Boy Advance files from the
[Homebrew Hub](https://hh3.gbdev.io) database.

## Font

Space Grotesk, SIL Open Font License 1.1, via @fontsource.

## Libraries

| Library | Used for | Licence | Source |
| --- | --- | --- | --- |
| chess.js 1.4.0 | The rules of chess in CHESS (move generation, check, draws). The computer's search also calls three of its internal methods for speed; the version is pinned in `package-lock.json`. | BSD-2-Clause | https://github.com/jhlywa/chess.js |
| ws, tsx (dev only) | The local copy of the room relay for development and browser tests; not part of the built site | MIT | https://github.com/websockets/ws, https://github.com/privatenumber/tsx |
