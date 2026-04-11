function getDiscordErrorCode(error) {
  return error?.code ?? error?.rawError?.code ?? null;
}

function isUnknownInteractionError(error) {
  const code = getDiscordErrorCode(error);
  return code === 10062 || code === 10015;
}

function isUnknownReplyMessageError(error) {
  return getDiscordErrorCode(error) === 10008;
}

function isInteractionAlreadyAcknowledgedError(error) {
  return getDiscordErrorCode(error) === 40060;
}

function isSafeInteractionFailure(error) {
  return isUnknownInteractionError(error) || isUnknownReplyMessageError(error) || isInteractionAlreadyAcknowledgedError(error);
}

function normalizeReplyOptions(options, isEdit = false) {
  const payload = typeof options === "string" ? { content: options } : { ...options };
  if (isEdit) {
    delete payload.flags;
  }
  return payload;
}

async function safeShowModal(interaction, modal) {
  try {
    await interaction.showModal(modal);
    return true;
  } catch (error) {
    if (isSafeInteractionFailure(error)) {
      return false;
    }
    throw error;
  }
}

async function safeDeferReply(interaction, options = { flags: 64 }) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply(options);
    }
    return true;
  } catch (error) {
    if (isSafeInteractionFailure(error)) {
      return false;
    }
    throw error;
  }
}

async function safeReply(interaction, options) {
  try {
    if (interaction.deferred || interaction.replied) {
      try {
        await interaction.editReply(normalizeReplyOptions(options, true));
      } catch (error) {
        if (isUnknownReplyMessageError(error)) {
          await interaction.followUp(normalizeReplyOptions(options, false));
        } else {
          throw error;
        }
      }
    } else {
      await interaction.reply(normalizeReplyOptions(options, false));
    }
    return true;
  } catch (error) {
    if (isSafeInteractionFailure(error)) {
      return false;
    }
    throw error;
  }
}

async function safeFollowUp(interaction, options) {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(normalizeReplyOptions(options, false));
      return true;
    }
    return safeReply(interaction, options);
  } catch (error) {
    if (isSafeInteractionFailure(error)) {
      return false;
    }
    throw error;
  }
}

module.exports = {
  getDiscordErrorCode,
  isUnknownInteractionError,
  isUnknownReplyMessageError,
  isInteractionAlreadyAcknowledgedError,
  isSafeInteractionFailure,
  safeShowModal,
  safeDeferReply,
  safeReply,
  safeFollowUp
};
