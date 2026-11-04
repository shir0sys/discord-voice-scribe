const path = require("node:path");
const fs = require("node:fs");
const { Client, IntentBits, SlashCommandBuilder, DiscordAPIError } = require("discordbot.js");
const { RecordingSession } = require("./src/recorder");
const { transcribeFile } = require("./src/transcribe");

const client = new Client({ intents: [IntentBits.Guilds, IntentBits.GuildVoiceStates] });

// guildId -> RecordingSession
const sessions = new Map();

const commands = [
  new SlashCommandBuilder().setName("record").setDescription("Rejoint ton salon vocal et démarre l'enregistrement"),
  new SlashCommandBuilder()
    .setName("stoprecord")
    .setDescription("Arrête l'enregistrement, transcrit chaque intervenant, et quitte le vocal"),
];

function formatTime(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

client.on("ready", async () => {
  console.log(`Connecté en tant que ${client.user.tag}`);
  await client.application.set(commands);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;
  if (!interaction.guildId) return;

  try {
    if (interaction.commandName === "record") {
      if (sessions.has(interaction.guildId)) {
        await interaction.reply({ content: "Un enregistrement est déjà en cours sur ce serveur.", flags: 64 });
        return;
      }

      const guild = await client.guilds.fetch(interaction.guildId);
      const voiceState = guild.voiceStates.get(interaction.user.id);
      if (!voiceState?.channelId) {
        await interaction.reply({ content: "Rejoins un salon vocal d'abord.", flags: 64 });
        return;
      }

      await interaction.deferReply();

      const connection = await client.joinVoiceChannel({
        guildId: guild.id,
        channelId: voiceState.channelId,
        selfMute: true,
        selfDeaf: false,
      });

      const outDir = path.join(__dirname, "recordings", `${guild.id}-${Date.now()}`);
      fs.mkdirSync(outDir, { recursive: true });

      sessions.set(interaction.guildId, new RecordingSession(connection, outDir));
      await interaction.editReply(
        `Enregistrement démarré dans <#${voiceState.channelId}>. Utilise /stoprecord pour arrêter.`,
      );
      return;
    }

    if (interaction.commandName === "stoprecord") {
      const session = sessions.get(interaction.guildId);
      if (!session) {
        await interaction.reply({ content: "Aucun enregistrement en cours.", flags: 64 });
        return;
      }
      sessions.delete(interaction.guildId);

      await interaction.deferReply();
      const files = session.finish();
      client.leaveVoiceChannel(interaction.guildId);

      if (files.length === 0) {
        await interaction.editReply("Enregistrement terminé — personne n'a parlé, rien à sauvegarder.");
        return;
      }

      await interaction.editReply(`Enregistrement terminé (${files.length} personne(s)). Transcription en cours...`);

      const canTranscribe = Boolean(process.env.WHISPER_MODEL);
      const perSpeaker = [];
      for (const file of files) {
        let name = file.userId;
        try {
          const user = await client.users.fetch(file.userId);
          name = user.tag;
        } catch {
          // garde l'id brut si le fetch échoue
        }

        if (!canTranscribe) {
          perSpeaker.push({ name, segments: [] });
          continue;
        }

        try {
          const segments = await transcribeFile(file.filePath);
          perSpeaker.push({ name, segments });
        } catch (error) {
          console.error(`Transcription échouée pour ${name}:`, error.message);
          perSpeaker.push({ name, segments: [] });
        }
      }

      const merged = perSpeaker
        .flatMap(({ name, segments }) => segments.map((segment) => ({ ...segment, name })))
        .sort((a, b) => a.start - b.start);

      const lines = merged.map((segment) => `[${formatTime(segment.start)}] ${segment.name}: ${segment.text}`);
      const transcriptPath = path.join(session.outDir, "transcript.txt");
      fs.writeFileSync(transcriptPath, lines.length > 0 ? lines.join("\n") : "(aucune parole détectée)");

      const note = canTranscribe
        ? ""
        : "\n(WHISPER_MODEL non configuré dans .env — seul l'audio a été sauvegardé, pas de transcription)";
      await interaction.editReply(`Terminé. Fichiers dans : ${session.outDir}${note}`);
    }
  } catch (error) {
    if (error instanceof DiscordAPIError) {
      console.error(`Discord a refusé la requête (${error.status}):`, error.payload);
    } else {
      console.error(error);
    }
  }
});

client.on("error", (error) => console.error(`[gateway error, close code ${error.closeCode}]`, error.message));
client.on("debug", (message) => console.debug("[gateway]", message));

if (!process.env.DISCORD_TOKEN) {
  console.error("DISCORD_TOKEN n'est pas défini. Lance avec : npm start (charge .env automatiquement)");
  process.exit(1);
}

client.login(process.env.DISCORD_TOKEN);
