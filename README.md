# Aeneis

La *Eneida* de Virgilio en latín, con aspecto de códice iluminado y recitación en audio. App web instalable (PWA) pensada para tablet.

- **Texto**: [The Latin Library](https://www.thelatinlibrary.com/verg.html), procesado con `fuentes/parse.py` → `data/aeneis.json`.
- **Audio**: [LibriVox, *Aeneidis Libri XII*](https://librivox.org/aeneidis-libri-xii-by-publius-vergilius-maro/), leído por Malone (dominio público), transmitido desde archive.org. Cada libro puede guardarse para escucharlo sin conexión (~36 MB).
- El verso resaltado es una **sincronía aproximada** (interpolación por tiempo). Toca un verso → «Este verso es el que suena ahora» para ajustarla; queda guardado en el dispositivo.

Al publicar cambios, sube `CACHE` en `sw.js`.
