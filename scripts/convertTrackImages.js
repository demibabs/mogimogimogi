const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");

const TRACK_IMAGES_DIR = path.resolve(__dirname, "../images/tracks");

function isJpegFile(filename) {
	return /\.jpe?g$/i.test(filename);
}

async function convertImage(filePath) {
	const dirname = path.dirname(filePath);
	const basename = path.basename(filePath, path.extname(filePath));
	const outputPath = path.join(dirname, `${basename}.png`);
	const inputBuffer = await fs.readFile(filePath);

	await sharp(inputBuffer)
		.png({ compressionLevel: 9, adaptiveFiltering: true })
		.toFile(outputPath);

	await fs.unlink(filePath);
	return outputPath;
}

async function convertTrackImages(directory) {
	const entries = await fs.readdir(directory, { withFileTypes: true });
	const conversions = [];
	for (const entry of entries) {
		if (!entry.isFile()) {
			continue;
		}
		if (!isJpegFile(entry.name)) {
			continue;
		}
		const absolutePath = path.join(directory, entry.name);
		const outputPath = await convertImage(absolutePath);
		conversions.push({ input: absolutePath, output: outputPath });
	}
	return conversions;
}

async function main() {
	try {
		await fs.access(TRACK_IMAGES_DIR);
	}
	catch (error) {
		console.error("track images directory not found", TRACK_IMAGES_DIR);
		process.exitCode = 1;
		return;
	}

	try {
		const conversions = await convertTrackImages(TRACK_IMAGES_DIR);
		if (!conversions.length) {
			console.log("no jpeg images found in", TRACK_IMAGES_DIR);
			return;
		}
		conversions.forEach(({ input, output }) => {
			console.log(`converted ${path.basename(input)} -> ${path.basename(output)}`);
		});
		console.log(`converted ${conversions.length} image(s).`);
	}
	catch (error) {
		console.error("failed to convert track images", error);
		process.exitCode = 1;
	}
}

if (require.main === module) {
	main();
}
