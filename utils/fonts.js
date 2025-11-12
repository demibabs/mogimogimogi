// Centralized font registration for canvas-based rendering.
// Registers Lexend weights needed and provides fallback family list.
// Usage: require('./utils/fonts').init(); then use getFont(weight, size) or FONT_FAMILY constant.

const path = require("path");
let registered = false;

const FONT_FAMILY_PRIMARY = "Lexend";
// Fallbacks: broaden coverage across common OSes without registering extra fonts.
// Order favors widely available system fonts; if a font isn't present, the system skips it harmlessly.
const FONT_FAMILY_FALLBACKS = [
	"Arial", // Windows/macOS common
	"Segoe UI Symbol", // Windows symbol coverage
	"DejaVu Sans", // Most Linux images (good Unicode coverage)
	"Liberation Sans", // Many Linux distros
	"Noto Sans", // Often present on cloud images
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

	// No emoji font registration. We rely on Twemoji images for emoji rendering and
	// allow system fallbacks (Arial, sans-serif) for non-emoji glyphs.
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
