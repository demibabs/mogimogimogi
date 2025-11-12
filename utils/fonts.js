// Centralized font registration for canvas-based rendering.
// Registers Lexend weights needed and provides fallback family list.
// Usage: require('./utils/fonts').init(); then use getFont(weight, size) or FONT_FAMILY constant.

const path = require("path");
let registered = false;

const FONT_FAMILY_PRIMARY = "Lexend";
// Include emoji-capable families to improve glyph coverage.
// Order matters and is per-glyph: keep Lexend first (primary), then emoji families so emoji are found early,
// then general-purpose fallbacks. Families that aren't present on the host are harmless.
const FONT_FAMILY_FALLBACKS = [
	"Noto Emoji", // vendored/registered if available (monochrome)
	"Segoe UI Emoji", // Windows
	"Apple Color Emoji", // macOS
	"Arial",
	"sans-serif",
];
const FONT_FAMILY_STACK = `${FONT_FAMILY_PRIMARY}, ${FONT_FAMILY_FALLBACKS.join(", ")}`;

function init() {
	if (registered) return;
	let registerFont;
	try {
		({ registerFont } = require("canvas"));
	}
	catch (e) {
		console.warn("canvas not available; skipping font registration", e?.message || e);
		return;
	}
	const staticDir = path.join(__dirname, "..", "fonts", "Lexend", "static");
	const notoEmojiDir = path.join(__dirname, "..", "fonts", "Noto_Emoji", "static");
	const weights = [
		{ file: "Lexend-Regular.ttf", weight: "400" },
		{ file: "Lexend-Medium.ttf", weight: "500" },
		{ file: "Lexend-SemiBold.ttf", weight: "600" },
		{ file: "Lexend-Bold.ttf", weight: "700" },
	];
	for (const w of weights) {
		try {
			registerFont(path.join(staticDir, w.file), { family: FONT_FAMILY_PRIMARY, weight: w.weight });
		}
		catch (e) {
			console.warn(`Failed to register font ${w.file}:`, e?.message || e);
		}
	}

	// Register Noto Emoji (monochrome) as an emoji-capable fallback.
	// Attempt multiple weights if present; silently continue if a file is missing.
	const emojiWeights = [
		{ file: "NotoEmoji-Regular.ttf", weight: "400" },
		{ file: "NotoEmoji-Medium.ttf", weight: "500" },
		{ file: "NotoEmoji-SemiBold.ttf", weight: "600" },
		{ file: "NotoEmoji-Bold.ttf", weight: "700" },
	];
	for (const w of emojiWeights) {
		try {
			registerFont(path.join(notoEmojiDir, w.file), { family: "Noto Emoji", weight: w.weight });
		}
		catch (e) {
			// fine if this weight isn't present
		}
	}
	registered = true;
}

function font(weight, sizePx) {
	const weightPart = weight ? `${weight} ` : "";
	return `${weightPart}${sizePx}px ${FONT_FAMILY_STACK}`;
}

module.exports = {
	init,
	font,
	FONT_FAMILY_STACK,
	FONT_FAMILY_PRIMARY,
	FONT_FAMILY_FALLBACKS,
};
