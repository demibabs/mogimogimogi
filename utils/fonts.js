// Centralized font registration for canvas-based rendering.
// Registers Lexend weights needed and provides fallback family list.
// Usage: require('./utils/fonts').init(); then use getFont(weight, size) or FONT_FAMILY constant.

const path = require("path");
const fs = require("fs");
let registered = false;

const FONT_FAMILY_PRIMARY = "Lexend";
// Fallbacks: broaden coverage across common OSes without registering extra fonts.
// Order favors widely available system fonts; if a font isn't present, the system skips it harmlessly.
const FONT_FAMILY_FALLBACKS = [
	"Noto Sans", // Often present on cloud images
	"Noto Sans Symbols 2", // Extended symbols (registered below if present)
	"Noto Sans Symbols", // Misc symbols (registered below if present)
	"Noto Sans JP", // Japanese coverage (registered below if present)
	"Noto Sans Math", // Math symbols (registered below if present)
	"Noto Music", // Musical symbols (registered below if present)
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

	// Optionally register a coverage font if present (e.g., IPA, symbols, misc. Unicode).
	// This is optional: if the files are missing, we silently skip.
	try {
		const dejavuDir = path.join(__dirname, "..", "fonts", "dejavu-sans");
		const dejavuCandidates = [
			{ file: "DejaVuSans.ttf", family: "DejaVu Sans", weight: "400" },
			{ file: "DejaVuSans-Bold.ttf", family: "DejaVu Sans", weight: "700" },
			{ file: "DejaVuSans-Oblique.ttf", family: "DejaVu Sans", weight: "400", style: "italic" },
			{ file: "DejaVuSans-BoldOblique.ttf", family: "DejaVu Sans", weight: "700", style: "italic" },
		];
		for (const cand of dejavuCandidates) {
			const p = path.join(dejavuDir, cand.file);
			if (fs.existsSync(p)) {
				try {
					registerFont(p, { family: cand.family, weight: cand.weight, style: cand.style || "normal" });
				}
				catch (e) {
					console.warn(`Failed to register font ${cand.file}:`, e?.message || e);
				}
			}
		}

		// Register Noto Sans JP (CJK) if present for Japanese glyph coverage
		const notoJpStatic = path.join(__dirname, "..", "fonts", "Noto_Sans_JP", "static");
		const notoJpWeights = [
			{ file: "NotoSansJP-Thin.ttf", weight: "100" },
			{ file: "NotoSansJP-ExtraLight.ttf", weight: "200" },
			{ file: "NotoSansJP-Light.ttf", weight: "300" },
			{ file: "NotoSansJP-Regular.ttf", weight: "400" },
			{ file: "NotoSansJP-Medium.ttf", weight: "500" },
			{ file: "NotoSansJP-SemiBold.ttf", weight: "600" },
			{ file: "NotoSansJP-Bold.ttf", weight: "700" },
			{ file: "NotoSansJP-ExtraBold.ttf", weight: "800" },
			{ file: "NotoSansJP-Black.ttf", weight: "900" },
		];
		for (const w of notoJpWeights) {
			const p = path.join(notoJpStatic, w.file);
			if (fs.existsSync(p)) {
				try {
					registerFont(p, { family: "Noto Sans JP", weight: w.weight });
				}
				catch (e) {
					console.warn(`Failed to register font ${w.file}:`, e?.message || e);
				}
			}
		}

		// Register Noto Sans (broad Latin/Unicode) if present
		const notoSansStatic = path.join(__dirname, "..", "fonts", "Noto_Sans", "static");
		const notoSansWeights = [
			{ file: "NotoSans-Regular.ttf", weight: "400" },
			{ file: "NotoSans-Medium.ttf", weight: "500" },
			{ file: "NotoSans-SemiBold.ttf", weight: "600" },
			{ file: "NotoSans-Bold.ttf", weight: "700" },
		];
		const notoSansItalics = [
			{ file: "NotoSans-Italic.ttf", weight: "400" },
			{ file: "NotoSans-MediumItalic.ttf", weight: "500" },
			{ file: "NotoSans-SemiBoldItalic.ttf", weight: "600" },
			{ file: "NotoSans-BoldItalic.ttf", weight: "700" },
		];
		for (const w of notoSansWeights) {
			const p = path.join(notoSansStatic, w.file);
			if (fs.existsSync(p)) {
				try {
					registerFont(p, { family: "Noto Sans", weight: w.weight });
				}
				catch (e) {
					console.warn(`Failed to register font ${w.file}:`, e?.message || e);
				}
			}
		}
		for (const w of notoSansItalics) {
			const p = path.join(notoSansStatic, w.file);
			if (fs.existsSync(p)) {
				try {
					registerFont(p, { family: "Noto Sans", weight: w.weight, style: "italic" });
				}
				catch (e) {
					console.warn(`Failed to register font ${w.file}:`, e?.message || e);
				}
			}
		}
		// Register Noto Sans Symbols if present
		(() => {
			const dir = path.join(__dirname, "..", "fonts", "Noto_Sans_Symbols");
			const regular = path.join(dir, "static", "NotoSansSymbols-Regular.ttf");
			if (fs.existsSync(regular)) {
				try {
					registerFont(regular, { family: "Noto Sans Symbols", weight: "400" });
				}
				catch (e) {
					console.warn("Failed to register NotoSansSymbols-Regular:", e?.message || e);
				}
			}
		})();

		// Register Noto Sans Symbols 2 if present
		(() => {
			const dir = path.join(__dirname, "..", "fonts", "Noto_Sans_Symbols_2");
			const regular = path.join(dir, "NotoSansSymbols2-Regular.ttf");
			if (fs.existsSync(regular)) {
				try {
					registerFont(regular, { family: "Noto Sans Symbols 2", weight: "400" });
				}
				catch (e) {
					console.warn("Failed to register NotoSansSymbols2-Regular:", e?.message || e);
				}
			}
		})();

		// Register Noto Sans Math if present
		(() => {
			const dir = path.join(__dirname, "..", "fonts", "Noto_Sans_Math");
			const regular = path.join(dir, "NotoSansMath-Regular.ttf");
			if (fs.existsSync(regular)) {
				try {
					registerFont(regular, { family: "Noto Sans Math", weight: "400" });
				}
				catch (e) {
					console.warn("Failed to register NotoSansMath-Regular:", e?.message || e);
				}
			}
		})();

		// Register Noto Music if present
		(() => {
			const dir = path.join(__dirname, "..", "fonts", "Noto_Music");
			const regular = path.join(dir, "NotoMusic-Regular.ttf");
			if (fs.existsSync(regular)) {
				try {
					registerFont(regular, { family: "Noto Music", weight: "400" });
				}
				catch (e) {
					console.warn("Failed to register NotoMusic-Regular:", e?.message || e);
				}
			}
		})();
	}
	catch (e) {
		// ignore
	}

	// No emoji font registration. We rely on Twemoji images for emoji rendering and
	// allow system fallbacks (Arial, DejaVu Sans, etc.) for non-emoji glyphs.
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
