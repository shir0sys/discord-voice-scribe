# discord-voice-scribe

Bot Discord qui enregistre un salon vocal **piste par piste** (un fichier WAV par intervenant) et transcrit chaque piste en local avec [whisper.cpp](https://github.com/ggml-org/whisper.cpp) — rien n'est envoyé à un service externe.

Construit sur [`discordbot.js`](https://github.com/shir0sys/discordbot.js), en particulier sa réception vocale (`audioPacket`). Ce projet est ce qui a servi à vérifier cette fonctionnalité contre un vrai appel Discord pour la première fois, et a fait remonter plusieurs corrections dans la lib elle-même (déchiffrement RTP avec extension d'en-tête, filtrage du trafic RTCP).

## Fonctionnement

- `/record` — rejoint ton salon vocal actuel, commence à capturer chaque personne qui parle.
- `/stoprecord` — arrête, quitte le vocal, transcrit chaque piste, et écrit un transcript chronologique fusionné.

Chaque piste WAV est silence-paddée sur l'horloge murale de la session (pas sur la parole des autres), donc même sans transcription les fichiers restent alignés temporellement entre eux — pratique pour les resynchroniser dans un éditeur audio si besoin.

Résultat dans `recordings/<guildId>-<timestamp>/` :
- `<userId>.wav` par intervenant (48kHz, stéréo, 16-bit)
- `transcript.txt` — toutes les répliques de tous les intervenants triées chronologiquement, format `[mm:ss] Pseudo#0000: texte`

## Prérequis

- **Node.js >= 22**
- **`ffmpeg`** installé et accessible dans le PATH (resampling 48kHz→16kHz avant transcription)
- **[whisper.cpp](https://github.com/ggml-org/whisper.cpp)** — optionnel, seulement si tu veux la transcription (sans ça, l'audio est quand même enregistré)

Sans transcription configurée, le bot fonctionne quand même : il enregistre juste l'audio sans produire de `transcript.txt`.

## Installation

```bash
git clone https://github.com/shir0sys/discord-voice-scribe.git
cd discord-voice-scribe
npm install
cp .env.example .env
```

Remplis `DISCORD_TOKEN` dans `.env` avec le token de ton application Discord (créée sur https://discord.com/developers/applications, avec les scopes `bot` + `applications.commands`, permission `Connect` minimum sur le salon vocal).

```bash
npm start
```

Dans Discord, lance `/record` dans un salon vocal, parle, puis `/stoprecord`.

## Activer la transcription (whisper.cpp)

Contrairement à beaucoup d'intégrations whisper.cpp qui relancent le binaire `whisper-cli` à chaque fichier (ce qui recharge tout le modèle en mémoire — plusieurs secondes de perdues avant même de commencer à transcrire), ce bot parle en HTTP à un **`whisper-server`** qui reste lancé en arrière-plan avec le modèle déjà chargé. Un `/stoprecord` ne paie alors que le vrai temps de calcul.

### 1. Récupérer whisper.cpp

Télécharge un build précompilé depuis les [releases](https://github.com/ggml-org/whisper.cpp/releases) (cherche les assets nommés `whisper-bin-*`) :

- **CPU uniquement** : `whisper-bin-win-x64.zip` (ou l'équivalent Linux/macOS)
- **GPU NVIDIA (recommandé si tu en as une)** : `whisper-bin-win-cuda-12.4.0-x64.zip` — nettement plus rapide, le vrai moyen d'approcher une transcription quasi-instantanée

Dézippe-le où tu veux, par exemple `C:\whisper\`.

### 2. Télécharger un modèle

```bash
curl -L -o ggml-large-v3-turbo.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
```

`large-v3-turbo` est le meilleur compromis précision/vitesse actuellement (encodeur complet, décodeur allégé). Pour une machine plus modeste : `ggml-small.bin` ou `ggml-medium.bin` (plus petits, moins précis sur l'argot/la parole rapide, mais plus rapides en CPU-only).

### 3. Lancer whisper-server

```bash
# Windows, exemple avec le build CUDA :
C:\whisper\Release\whisper-server.exe -m C:\whisper\ggml-large-v3-turbo.bin -l fr -t 8 --port 8080
```

Laisse-le tourner dans son propre terminal — il doit rester actif pendant que le bot fonctionne. `-l fr` force la langue (sans ça, whisper.cpp utilise l'anglais par défaut, **pas** l'auto-détection, contrairement à ce qu'on pourrait croire). `-t` est le nombre de threads CPU ; augmente-le si tu as beaucoup de cœurs et pas de GPU.

### 4. Configurer `.env`

```
WHISPER_SERVER_URL=http://127.0.0.1:8080
WHISPER_LANGUAGE=fr
```

C'est tout — relance `npm start`, `/stoprecord` transcrira automatiquement.

## Limites connues

- **Pas de VAD** : chaque frame Opus reçue est écrite telle quelle, y compris le bruit de fond si le micro de quelqu'un reste ouvert.
- **Whisper invente parfois du texte** sur du silence ou de l'argot/des phrases très courtes et rapides — comportement connu des modèles Whisper, pas un bug de ce bot. Un modèle plus gros (`medium` → `large-v3-turbo`) réduit le problème sans l'éliminer.
- **Transcription après coup, pas en direct** : chaque piste est transcrite une fois l'enregistrement arrêté, pas de sous-titres live pendant que les gens parlent.
- **DAVE (chiffrement de bout en bout) avec beaucoup de participants simultanés** : testé et fonctionnel à un ou deux locuteurs ; le comportement avec un salon très actif (beaucoup de join/leave, rotations de clé fréquentes) est moins exercé.

## Dépannage

- **"Rejoins un salon vocal d'abord"** → tu dois être dans un salon vocal du serveur avant de lancer `/record`.
- **Transcript vide ou "WHISPER_SERVER_URL non configuré"** → vérifie que `whisper-server` tourne bien et que `.env` pointe sur la bonne URL/port.
- **`ffmpeg`/`whisper-server` introuvable** → donne le chemin complet dans la commande de lancement si le binaire n'est pas dans le PATH.
