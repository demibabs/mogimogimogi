// Centralized font registration for canvas-based rendering.
// Registers Lexend weights needed and provides fallback family list.
// Usage: require('./utils/fonts').init(); then use getFont(weight, size) or FONT_FAMILY constant.

const path = require("path");
let registered = false;

const FONT_FAMILY_PRIMARY = "Lexend";
// Include Noto Color Emoji to improve emoji glyph coverage (if available on host).
// Order matters: we want Lexend first for regular text, then system-style fallbacks, then emoji.
const FONT_FAMILY_FALLBACKS = ["Arial", "sans-serif", "Noto Color Emoji"]; // Arial & Noto may need to exist on host
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
