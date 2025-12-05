const { SlashCommandBuilder, AttachmentBuilder } = require("discord.js");
const { createCanvas, loadImage } = require("canvas");

module.exports = {
	data: new SlashCommandBuilder()
		.setName("test-image")
		.setDescription("test"),

	async execute(interaction) {
		await interaction.deferReply();
		const canvas = createCanvas(1080, 1080);
		const ctx = canvas.getContext("2d");
		ctx.fillStyle = "#ffffff";
		ctx.fillRect(0, 0, canvas.width, canvas.height);

		// Write "Awesome!"
		ctx.font = "30px Impact";
		ctx.fillText("Awesome!", 50, 100);

		// Draw line under text
		const text = ctx.measureText("Awesome!");
		ctx.strokeStyle = "rgba(0,0,0,0.5)";
		ctx.beginPath();
		ctx.lineTo(50, 102);
		ctx.lineTo(50 + text.width, 102);
		ctx.stroke();

		// Draw cat with lime helmet
		await loadImage("commands/misc/lime-cat.jpg").then((image) => {
			ctx.drawImage(image, 0, 0, 1080, 1080);
		});
		const pngBuffer = canvas.toBuffer("image/png");

		// Build an attachment and send
		const attachment = new AttachmentBuilder(pngBuffer, { name: "image.png" });

		await interaction.editReply({
			content: "",
			files: [attachment],
		});
	},
};