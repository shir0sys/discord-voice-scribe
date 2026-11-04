# discord-voice-scribe

Bot Discord qui enregistre un salon vocal **piste par piste** (un fichier WAV par intervenant) et transcrit chaque piste en local avec [whisper.cpp](https://github.com/ggml-org/whisper.cpp).

Construit sur [`discordbot.js`](https://github.com/shir0sys/discordbot.js), en particulier sa réception vocale (`audioPacket`) — jamais vérifiée contre un vrai appel multi-membres avant ce projet.

## Fonctionnement

- `/record` — rejoint ton salon vocal actuel, commence à capturer chaque personne qui parle.
- `/stoprecord` — arrête, quitte le vocal, transcrit chaque piste, et écrit un transcript chronologique fusionné.

Chaque piste WAV est silence-paddée sur l'horloge murale de la session (pas sur la parole des autres), donc même sans transcription les fichiers restent alignés temporellement entre eux.

Résultat dans `recordings/<guildId>-<timestamp>/` :
- `<userId>.wav` par intervenant
- `transcript.txt` — toutes les répliques triées chronologiquement, format `[mm:ss] Pseudo#0000: texte`

## Prérequis

- Node.js >= 22
- `ffmpeg` installé et dans le PATH (resampling 48kHz→16kHz avant whisper)
- Pour la transcription (optionnelle) : [whisper.cpp](https://github.com/ggml-org/whisper.cpp) compilé, + un modèle ggml téléchargé (ex: `ggml-base.bin`)

Sans `WHISPER_MODEL` configuré, le bot enregistre quand même l'audio — juste pas de transcription.

## Installation

```bash
npm install
cp .env.example .env
# remplir DISCORD_TOKEN, et WHISPER_MODEL si tu veux la transcription
npm start
```

## Limites connues

- Pas de VAD : chaque frame Opus reçue est écrite telle quelle, y compris le bruit de fond si le micro de quelqu'un reste chaud.
- La transcription tourne séquentiellement, piste par piste, après l'arrêt — pas de sous-titres en direct pendant l'enregistrement.
- Jamais testé avec DAVE actif sur un salon à beaucoup de participants simultanés — le cas à un ou deux locuteurs a été la priorité.
