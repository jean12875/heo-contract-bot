const { AttachmentBuilder } = require("discord.js");
const discordTranscripts = require("discord-html-transcripts");
const { getConfig } = require("./config");
const { findContractEntryByChannel } = require("./contractSystem");
const { logInfo, logWarn } = require("./logger");

async function buildTranscriptAttachment(channel) {
  const buffer = await discordTranscripts.createTranscript(channel, {
    limit: -1,
    returnType: "buffer",
    saveImages: true
  }).catch(() => null);

  if (!buffer) {
    return null;
  }

  return {
    buffer,
    name: `transcript-${channel.name}.html`
  };
}

function parseChannelMetadata(channel) {
  if (!channel?.topic) {
    return null;
  }

  try {
    const parsed = JSON.parse(channel.topic);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function resolveCreatorIdFromOverwrites(channel) {
  const config = getConfig();
  const excludedRoleIds = new Set([
    channel.guild.id,
    config.roles.owner,
    config.roles.admin,
    config.roles.gestionTicket,
    config.roles.gestionBoutique,
    config.roles.accesVocEntretien,
    config.roles.secretaire
  ].filter(Boolean).map(String));

  for (const overwrite of channel.permissionOverwrites.cache.values()) {
    if (excludedRoleIds.has(String(overwrite.id))) {
      continue;
    }

    const member = channel.guild.members.cache.get(overwrite.id) || (await channel.guild.members.fetch(overwrite.id).catch(() => null));
    if (member) {
      return member.id;
    }
  }

  return null;
}

async function resolveTranscriptRecipientIds(channel) {
  const contractEntry = await findContractEntryByChannel(channel.id);
  if (contractEntry?.contract?.client) {
    return [String(contractEntry.contract.client)];
  }

  const metadata = parseChannelMetadata(channel);
  if (metadata?.creatorId) {
    return [String(metadata.creatorId)];
  }

  const fallbackCreatorId = await resolveCreatorIdFromOverwrites(channel);
  return fallbackCreatorId ? [String(fallbackCreatorId)] : [];
}

async function resolveTranscriptChannels(channel) {
  const contractEntry = await findContractEntryByChannel(channel.id);
  if (!contractEntry?.contract) {
    return [channel];
  }

  const contract = contractEntry.contract;
  const candidateIds = [...new Set([contract.clientChan, contract.devChan, contract.secChan].filter(Boolean).map(String))];
  const channels = [];

  for (const channelId of candidateIds) {
    const current = channel.guild.channels.cache.get(channelId) || (await channel.guild.channels.fetch(channelId).catch(() => null));
    if (current?.isTextBased?.()) {
      channels.push(current);
    }
  }

  return channels.length ? channels : [channel];
}

async function sendTranscriptToUser(client, userId, transcriptFile) {
  const user = client.users.cache.get(userId) || (await client.users.fetch(userId).catch(() => null));
  if (!user) {
    return false;
  }

  const attachment = new AttachmentBuilder(transcriptFile.buffer, { name: transcriptFile.name });
  await user.send({ files: [attachment] }).catch(() => null);
  return true;
}

async function sendTranscriptToLogs(channel, transcriptFile, creatorIds, actorId) {
  const config = getConfig();
  const logChannelId = config.channels?.logs;
  if (!logChannelId) {
    return false;
  }

  const logChannel = channel.client.channels.cache.get(logChannelId) || (await channel.client.channels.fetch(logChannelId).catch(() => null));
  if (!logChannel?.isTextBased?.()) {
    return false;
  }

  const attachment = new AttachmentBuilder(transcriptFile.buffer, { name: transcriptFile.name });
  const creatorText = creatorIds.length ? creatorIds.map((id) => `<@${id}>`).join(", ") : "Inconnu";
  const closedByText = actorId ? `<@${actorId}>` : "Inconnu";
  await logChannel.send({
    content: [
      "📄 Transcript ticket",
      `Salon: ${channel.name}`,
      `Créateur: ${creatorText}`,
      `Fermé par: ${closedByText}`
    ].join("\n"),
    files: [attachment]
  }).catch(() => null);

  return true;
}

async function sendTranscriptCopies(channel, actorId) {
  const transcriptChannels = await resolveTranscriptChannels(channel);
  const recipientIds = await resolveTranscriptRecipientIds(channel);
  const sentTo = new Set();
  let success = false;
  let logSent = false;

  for (const transcriptChannel of transcriptChannels) {
    const transcriptFile = await buildTranscriptAttachment(transcriptChannel);
    if (!transcriptFile) {
      continue;
    }

    for (const recipientId of recipientIds) {
      const delivered = await sendTranscriptToUser(channel.client, recipientId, transcriptFile);
      if (delivered) {
        sentTo.add(recipientId);
      }
    }

    const currentLogSent = await sendTranscriptToLogs(transcriptChannel, transcriptFile, recipientIds, actorId);
    logSent = logSent || currentLogSent;
    success = true;
  }

  if (sentTo.size) {
    logInfo("TRANSCRIPT", "Transcript envoyé", {
      channelId: channel.id,
      recipients: [...sentTo],
      logSent
    });
  } else {
    logWarn("TRANSCRIPT", "Transcript non distribué", {
      channelId: channel.id,
      recipients: recipientIds,
      logSent
    });
  }

  return {
    success: success && (sentTo.size > 0 || logSent),
    recipients: [...sentTo],
    logSent
  };
}

module.exports = {
  sendTranscriptCopies
};
