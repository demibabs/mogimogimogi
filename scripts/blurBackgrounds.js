#!/usr/bin/env node
const fs = require("fs/promises");
const path = require("path");
const { createCanvas, loadImage } = require("canvas");
const StackBlur = require("stackblur-canvas");

const BLUR_RADIUS = 8;
const VALID_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);
const ROOT_DIR = path.resolve(__dirname, "..", "images");
const DIRECTORY_PAIRS = [
	{
		source: path.join(ROOT_DIR, "tracks unblurred"),
		target: path.join(ROOT_DIR, "tracks blurred"),
	},
	{
		source: path.join(ROOT_DIR, "other backgrounds unblurred"),
		target: path.join(ROOT_DIR, "other backgrounds blurred"),
	},
];

async function fileExists(filePath) {
	try {
		await fs.access(filePath);
		return true;
	}
	catch {
		return false;
	}
}

function isImageFile(filename) {
	const ext = path.extname(filename || "").toLowerCase();
	return VALID_EXTENSIONS.has(ext);
}

async function blurImage(sourcePath, targetPath) {
	const image = await loadImage(sourcePath);
	const canvas = createCanvas(image.width, image.height);
	const ctx = canvas.getContext("2d");
	ctx.drawImage(image, 0, 0);
	const imageData = ctx.getImageData(0, 0, image.width, image.height);
	StackBlur.imageDataRGBA(imageData, 0, 0, image.width, image.height, BLUR_RADIUS);
	ctx.putImageData(imageData, 0, 0);
	const buffer = canvas.toBuffer("image/png");
	await fs.writeFile(targetPath, buffer);
}

async function blurDirectory({ source, target }) {
	const sourceExists = await fileExists(source);
	if (!sourceExists) {
		console.warn(`skip missing source directory: ${source}`);
		return;
	}
	await fs.mkdir(target, { recursive: true });
	const entries = await fs.readdir(source, { withFileTypes: true });
	for (const entry of entries) {
		if (!entry.isFile()) {
			continue;
		}
		if (!isImageFile(entry.name)) {
			continue;
		}
		const sourcePath = path.join(source, entry.name);
		const targetPath = path.join(target, entry.name);
		console.log(`blurring ${sourcePath} -> ${targetPath}`);
		await blurImage(sourcePath, targetPath);
	}
}

async function main() {
	for (const pair of DIRECTORY_PAIRS) {
		await blurDirectory(pair);
	}
	console.log("blur complete");
}

main().catch(error => {
	console.error("blur script failed:", error);
	process.exitCode = 1;
});
