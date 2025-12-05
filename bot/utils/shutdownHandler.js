const { MessageFlags } = require("discord.js");

class ShutdownHandler {
	constructor() {
		this.activeInteractions = new Map();
		this.isShuttingDown = false;
	}

	add(interaction) {
		if (this.isShuttingDown) return;

		// Monkey-patch reply methods to prevent command from overwriting shutdown message
		const originalEditReply = interaction.editReply.bind(interaction);
		interaction._originalEditReply = originalEditReply;
		interaction.editReply = async (...args) => {
			if (this.isShuttingDown) return { id: interaction.id };
			return originalEditReply(...args);
		};

		const originalReply = interaction.reply.bind(interaction);
		interaction._originalReply = originalReply;
		interaction.reply = async (...args) => {
			if (this.isShuttingDown) return { id: interaction.id };
			return originalReply(...args);
		};

		const originalFollowUp = interaction.followUp.bind(interaction);
		interaction._originalFollowUp = originalFollowUp;
		interaction.followUp = async (...args) => {
			if (this.isShuttingDown) return { id: interaction.id };
			return originalFollowUp(...args);
		};

		this.activeInteractions.set(interaction.id, interaction);
	}

	remove(interactionId) {
		this.activeInteractions.delete(interactionId);
	}

	async shutdown(client) {
		if (this.isShuttingDown) return;
		this.isShuttingDown = true;

		console.log(`\n[ShutdownHandler] Shutting down... notifying ${this.activeInteractions.size} active users.`);

		const promises = [];
		for (const interaction of this.activeInteractions.values()) {
			promises.push(this.notifyUser(interaction));
		}

		await Promise.allSettled(promises);

		console.log("[ShutdownHandler] Notifications sent. Destroying client.");
		await client.destroy();
		process.exit(0);
	}

	async notifyUser(interaction) {
		try {
			const message = {
				content: "**error:** the bot was updated and had to restart. try your command again.",
				components: [],
				files: [],
			};

			if (interaction.replied || interaction.deferred) {
				const editReply = interaction._originalEditReply || interaction.editReply;
				await editReply.call(interaction, message);
			}
			else {
				const reply = interaction._originalReply || interaction.reply;
				await reply.call(interaction, { ...message, flags: MessageFlags.Ephemeral });
			}
		}
		catch (error) {
			console.error("Failed to notify user:", error);
		}
	}
}

module.exports = new ShutdownHandler();
