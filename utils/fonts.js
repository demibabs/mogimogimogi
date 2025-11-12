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
	"Noto Color Emoji", // vendored/registered if available
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
	const emojiDir = path.join(__dirname, "..", "fonts", "Noto_Color_Emoji");
	const notoEmojiDir = path.join(__dirname, "..", "fonts", "Noto_Emoji");
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

	// Attempt to register Noto Color Emoji for emoji glyph fallback (color rendering depends on host support).
	try {
		registerFont(path.join(emojiDir, "NotoColorEmoji-Regular.ttf"), { family: "Noto Color Emoji" });
	}
	catch (e) {
		console.warn("Noto Color Emoji not registered (optional):", e?.message || e);
	}

	// Optional: register non-color Noto Emoji as a fallback for hosts without color emoji rendering.
	try {
		registerFont(path.join(notoEmojiDir, "NotoEmoji-Regular.ttf"), { family: "Noto Emoji" });
	}
	catch (e) {
		// safe to ignore
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
