/**
 * Utility functions for enhancing embeds with player information
 */
const twemoji = require("twemoji");
const { loadImage } = require("canvas");
const StackBlur = require("stackblur-canvas");
const { draw } = require("patternomaly");
let sharp = null;
try {
	sharp = require("sharp");
}
catch (sharpError) {
	// Optional dependency not installed in this environment; WebP conversion will fallback.
	// console.warn("embedEnhancer: sharp not available, falling back to direct image load for avatars.");
}

function roundedRectPath(ctx, x, y, width, height, radius = 20) {
	const clampedRadius = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
	ctx.beginPath();
	ctx.moveTo(x + clampedRadius, y);
	ctx.lineTo(x + width - clampedRadius, y);
	ctx.quadraticCurveTo(x + width, y, x + width, y + clampedRadius);
	ctx.lineTo(x + width, y + height - clampedRadius);
	ctx.quadraticCurveTo(x + width, y + height, x + width - clampedRadius, y + height);
	ctx.lineTo(x + clampedRadius, y + height);
	ctx.quadraticCurveTo(x, y + height, x, y + height - clampedRadius);
	ctx.lineTo(x, y + clampedRadius);
	ctx.quadraticCurveTo(x, y, x + clampedRadius, y);
	ctx.closePath();
}

/**
 * Convert country code to flag emoji
 * @param {string} countryCode - Two-letter country code (e.g., 'US', 'CA', 'GB')
 * @returns {string} Flag emoji or empty string if invalid
 */
function getCountryFlag(countryCode) {
	if (!countryCode || countryCode.length !== 2) {
		return "";
	}

	// Convert country code to regional indicator symbols (flag emojis)
	const codePoints = countryCode
		.toUpperCase()
		.split("")
		.map(char => 127397 + char.charCodeAt(0));

	return String.fromCodePoint(...codePoints);
}

/**
 * Format player name with country flag
 * @param {string} playerName - Player's name
 * @param {string} countryCode - Player's country code
 * @returns {string} Formatted name with flag
 */
function formatPlayerNameWithFlag(playerName, countryCode) {
	const flag = getCountryFlag(countryCode);
	return flag ? `${flag} ${playerName}` : playerName;
}

/**
 * Get player avatar URL from Discord user
 * @param {Object} discordUser - Discord user object
 * @returns {string|null} Avatar URL or null if not available
 */
function getPlayerAvatarUrl(discordUser) {
	if (!discordUser) return null;

	// Get Discord avatar URL
	return discordUser.displayAvatarURL({ dynamic: true, size: 256 });
}

/**
 * Enhance embed with player information (avatar and country flag in title/author)
 * @param {EmbedBuilder} embed - Discord embed builder
 * @param {Object} loungeUser - Player data from lounge API
 * @param {string} originalTitle - Original embed title
 * @returns {EmbedBuilder} Enhanced embed
 */
function enhanceEmbedWithPlayerInfo(embed, loungeUser, originalTitle) {
	const flag = getCountryFlag(loungeUser?.countryCode);
	const avatarUrl = getPlayerAvatarUrl(loungeUser);

	// Add flag to title if available
	const enhancedTitle = flag ? `${flag} ${originalTitle}` : originalTitle;
	embed.setTitle(enhancedTitle);

	// Set thumbnail to player avatar if available
	if (avatarUrl) {
		embed.setThumbnail(avatarUrl);
	}

	return embed;
}

function drawRoundedImage(ctx, image, x, y, width, height, radius = 20) {
	ctx.save();
	roundedRectPath(ctx, x, y, width, height, radius);
	ctx.clip();
	ctx.drawImage(image, x, y, width, height);
	ctx.restore();
};

function drawRoundedPanel(ctx, frame, fillColor, radius = 20, options = {}) {
	if (!ctx || !frame) return;
	const width = frame.width ?? frame.w ?? 0;
	const height = frame.height ?? frame.h ?? 0;
	if (width <= 0 || height <= 0) return;

	const x = frame.left ?? frame.x ?? 0;
	const y = frame.top ?? frame.y ?? 0;
	const {
		strokeColor = null,
		strokeWidth = 0,
		shadowColor = null,
		shadowBlur = 0,
		shadowOffsetX = 0,
		shadowOffsetY = 0,
		highlightOpacity = 0.12,
	} = options;

	ctx.save();

	if (shadowColor && shadowBlur > 0) {
		ctx.shadowColor = shadowColor;
		ctx.shadowBlur = shadowBlur;
		ctx.shadowOffsetX = shadowOffsetX;
		ctx.shadowOffsetY = shadowOffsetY;
	}

	roundedRectPath(ctx, x, y, width, height, radius);
	ctx.fillStyle = fillColor;
	ctx.fill();

	if (strokeColor && strokeWidth > 0) {
		ctx.lineWidth = strokeWidth;
		ctx.strokeStyle = strokeColor;
		ctx.stroke();
	}

	if (highlightOpacity > 0) {
		const highlight = ctx.createLinearGradient(x, y, x, y + Math.min(height, 120));
		highlight.addColorStop(0, withOpacity("#ffffff", highlightOpacity));
		highlight.addColorStop(1, withOpacity("#ffffff", 0));
		ctx.fillStyle = highlight;
		roundedRectPath(ctx, x, y, width, height, radius);
		ctx.fill();
	}

	ctx.restore();
}

function drawBlurredImage(ctx, image, x, y, width, height, blur = 12) {

	ctx.drawImage(image, x, y, width, height);

	const imageData = ctx.getImageData(0, 0, width, height);
	StackBlur.imageDataRGBA(imageData, 0, 0, width, height, blur);
	ctx.putImageData(imageData, 0, 0);
}

function emojiToUrl(emoji) {
	const parsed = twemoji.convert.toCodePoint(emoji); // e.g. "1f1fa-1f1f8" for US flag
	return `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${parsed}.png`;
}

async function drawEmoji(ctx, emoji, x, y, size) {
	const url = emojiToUrl(emoji);
	const res = await fetch(url);
	if (!res.ok) throw new Error(`twemoji fetch failed: ${res.status}`);
	const arrayBuffer = await res.arrayBuffer();
	const img = await loadImage(Buffer.from(arrayBuffer));
	ctx.drawImage(img, x, y, size, size);
}

function drawInlineImage(ctx, image, x, baselineY, size, options = {}) {
	if (!ctx || !image || !Number.isFinite(x) || !Number.isFinite(baselineY) || !Number.isFinite(size) || size <= 0) {
		return 0;
	}
	const { descentRatio = 0.18 } = options;
	const clampedRatio = Math.min(Math.max(descentRatio, 0), 1);
	const descent = size * clampedRatio;
	const y = baselineY - size + descent;
	ctx.drawImage(image, x, y, size, size);
	return size;
}

const shapeNames = [
	"plus", "cross", "dash", "cross-dash", "dot", "dot-dash",
	"disc", "ring", "line", "line-vertical", "weave", "zigzag",
	"zigzag-vertical", "diagonal", "diagonal-right-left",
	"square", "box", "triangle", "triangle-inverted",
	"diamond", "diamond-box",
];

async function tryLoadImageResource(resourcePath) {
	if (!resourcePath) return null;
	try {
		return await loadImage(resourcePath);
	}
	catch (error) {
		return null;
	}
}

function normalizeWhitespace(value) {
	return value.replace(/\s+/g, " ").trim();
}

async function loadFavoriteCharacterImage(favorites) {
	const character = favorites?.character;
	if (!character?.name) {
		return null;
	}

	const baseName = character.name.toLowerCase();
	const costume = character.costume?.toLowerCase();
	const mainsRoot = "images/characters/mains";
	const npcRoot = "images/characters/npcs";
	const candidates = [];

	const sanitize = value => normalizeWhitespace(value).replace(/\s+/g, " ");

	if (costume && costume !== "default") {
		candidates.push(`${mainsRoot}/${sanitize(`${baseName} ${costume}`)}.png`);
	}

	if (!costume || costume === "default") {
		candidates.push(`${mainsRoot}/${sanitize(`${baseName} default`)}.png`);
	}

	candidates.push(`${mainsRoot}/${sanitize(baseName)}.png`);
	candidates.push(`${npcRoot}/${sanitize(baseName)}.png`);

	const visited = new Set();
	for (const candidate of candidates) {
		if (visited.has(candidate)) continue;
		visited.add(candidate);
		const image = await tryLoadImageResource(candidate);
		if (image) {
			return image;
		}
	}

	return null;
}

async function loadFavoriteVehicleImage(favorites) {
	const vehicle = favorites?.vehicle;
	if (!vehicle) {
		return null;
	}

	const baseName = normalizeWhitespace(vehicle.toLowerCase());
	const candidates = [
		`images/vehicles/${baseName}.png`,
		`images/vehicles/${baseName.replace(/\s+/g, "_")}.png`,
	];

	const tried = new Set();
	for (const candidate of candidates) {
		if (tried.has(candidate)) continue;
		tried.add(candidate);
		const image = await tryLoadImageResource(candidate);
		if (image) {
			return image;
		}
	}

	return null;
}

function withOpacity(color, opacity = 1) {
	const clamped = Math.max(0, Math.min(1, opacity));
	if (clamped >= 0.999) {
		return color;
	}

	if (typeof color !== "string") {
		return color;
	}

	const hexMatch = color.match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
	if (hexMatch) {
		let hex = hexMatch[1];
		if (hex.length === 3 || hex.length === 4) {
			hex = hex.split("").map(ch => ch + ch).join("");
		}
		const hasAlpha = hex.length === 8;
		const r = parseInt(hex.slice(0, 2), 16);
		const g = parseInt(hex.slice(2, 4), 16);
		const b = parseInt(hex.slice(4, 6), 16);
		const baseAlpha = hasAlpha ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
		const finalAlpha = Number((baseAlpha * clamped).toFixed(3));
		return `rgba(${r}, ${g}, ${b}, ${finalAlpha})`;
	}

	const rgbaMatch = color.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+)\s*)?\)$/i);
	if (rgbaMatch) {
		const r = Number(rgbaMatch[1]);
		const g = Number(rgbaMatch[2]);
		const b = Number(rgbaMatch[3]);
		const baseAlpha = rgbaMatch[4] === undefined ? 1 : Number(rgbaMatch[4]);
		const finalAlpha = Number((baseAlpha * clamped).toFixed(3));
		return `rgba(${r}, ${g}, ${b}, ${finalAlpha})`;
	}

	return color;
}

function randomPattern(background, stroke, size = 20, exclude = [], opacity = 1) {
	const available = shapeNames.filter(shape => !exclude.includes(shape));
	const shape = available[Math.floor(Math.random() * available.length)];
	const patternColor = withOpacity(stroke, opacity);
	return draw(shape, background, patternColor, size);
}

function formatNumber(value) {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	return "-";
}

function formatSignedNumber(value) {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return "+0";
	}
	const sign = value >= 0 ? "+" : "-";
	const magnitude = Math.abs(value);
	return `${sign}${magnitude}`;
}

// ---------------- Inline Emoji Text Rendering -----------------
// Renders a string containing arbitrary emoji + normal text by splitting into runs and drawing
// twemoji images for emoji code points while preserving a single baseline. Supports simple wrapping.
// We use a conservative emoji regex (covers standard pictographs, flags, keycaps, modifiers) and fall back
// to regular text for anything not matched.

// Simplified broad emoji regex: matches surrogate pairs & some symbols. Not exhaustive but avoids eslint char class issues.
const EMOJI_REGEX = /(?:[\u231A-\u231B]|[\u23E9-\u23F3]|[\u23F8-\u23FA]|[\u2600-\u27BF]|[\u2B05-\u2B55]|[\u2934-\u2935]|[\u3297\u3299]|[\u3030\u303D]|[\u24C2]|[\u00A9\u00AE\u2122\u2139]|[\uD83C][\uDF00-\uDFFF]|[\uD83D][\uDC00-\uDE4F]|[\uD83D][\uDE80-\uDEFF]|[\uD83E][\uDD00-\uDDFF])/g;

function splitRuns(text) {
	if (!text) return [];
	const runs = [];
	let lastIndex = 0;
	text.replace(EMOJI_REGEX, (match, offset) => {
		if (offset > lastIndex) {
			runs.push({ type: "text", value: text.slice(lastIndex, offset) });
		}
		runs.push({ type: "emoji", value: match });
		lastIndex = offset + match.length;
		return match;
	});
	if (lastIndex < text.length) {
		runs.push({ type: "text", value: text.slice(lastIndex) });
	}
	return runs.filter(r => r.value);
}

function tokenizeForEmojiTruncation(text) {
	const runs = splitRuns(text);
	const tokens = [];
	for (const run of runs) {
		if (run.type === "emoji") {
			tokens.push({ type: "emoji", value: run.value });
			continue;
		}
		if (run.type === "text") {
			for (const ch of [...run.value]) {
				tokens.push({ type: "char", value: ch });
			}
		}
	}
	return tokens;
}

function measureEmojiAwareWidth(ctx, tokens, emojiSize) {
	let w = 0;
	for (const t of tokens) {
		if (t.type === "emoji") w += emojiSize;
		else w += ctx.measureText(t.value).width;
	}
	return w;
}

function joinTokens(tokens) {
	return tokens.map(t => t.value).join("");
}

function parseFontPx(font) {
	const m = /([0-9]+)px/.exec(font || "");
	return m ? parseInt(m[1], 10) : 32;
}

// Truncate a single-line string with emoji-awareness so its width <= maxWidth. Returns fitted string.
function truncateTextWithEmojis(ctx, text, maxWidth, options = {}) {
	if (!text) return "";
	const { font = ctx.font, emojiSize = null, ellipsis = "\u2026" } = options;
	const prevFont = ctx.font;
	ctx.font = font;
	const size = emojiSize || parseFontPx(font) * 0.95;
	const tokens = tokenizeForEmojiTruncation(text);
	const ellipsisWidth = ctx.measureText(ellipsis).width;
	let width = measureEmojiAwareWidth(ctx, tokens, size);
	if (width <= maxWidth) {
		ctx.font = prevFont;
		return text;
	}
	const fitted = tokens.slice();
	while (fitted.length && width + ellipsisWidth > maxWidth) {
		const popped = fitted.pop();
		if (!popped) break;
		width -= popped.type === "emoji" ? size : ctx.measureText(popped.value).width;
	}
	const result = joinTokens(fitted) + (fitted.length < tokens.length ? ellipsis : "");
	ctx.font = prevFont;
	return result;
}

const emojiImageCache = new Map(); // codePoint -> Image
async function ensureEmojiImage(emoji) {
	const code = twemoji.convert.toCodePoint(emoji);
	if (emojiImageCache.has(code)) {
		return emojiImageCache.get(code);
	}
	const url = `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${code}.png`;
	const res = await fetch(url);
	if (!res.ok) throw new Error(`emoji fetch failed: ${res.status}`);
	const buf = Buffer.from(await res.arrayBuffer());
	const img = await loadImage(buf);
	emojiImageCache.set(code, img);
	return img;
}

// Draws text with emoji images. Returns total rendered width.
// Supports basic wrapping across lines when maxWidth provided.
async function drawTextWithEmojis(ctx, text, x, y, options = {}) {
	const {
		font = ctx.font,
		fillStyle = ctx.fillStyle,
		maxWidth = Infinity,
		lineHeight = null,
		emojiSize = null,
		baseline = "alphabetic",
		textAlign = "left",
		verticalCenter = false, // if true, treat y as vertical center for single-line render
		onMeasureLine = null, // callback(lineWidth, isEmojiRun)
	} = options;

	ctx.save();
	ctx.font = font;
	const userAlign = textAlign;
	ctx.textAlign = "left"; // draw left-to-right consistently; we manually adjust startX for alignment
	ctx.textBaseline = baseline;
	ctx.fillStyle = fillStyle;
	const runs = splitRuns(text);
	const fontPxMatch = /([0-9]+)px/.exec(font);
	const numericPx = fontPxMatch ? parseInt(fontPxMatch[1], 10) : 32;
	const measuredLineHeight = lineHeight || numericPx * 1.2;
	const size = emojiSize || numericPx;

	let cursorX = x;
	let cursorY = y;
	if (verticalCenter) {
		// Align baseline such that text block centers on provided y
		cursorY = y + numericPx * 0.35; // heuristic baseline shift
	}

	// If single-line rendering and non-left alignment, precompute total width and adjust start
	if (!Number.isFinite(maxWidth) || maxWidth === Infinity) {
		let totalWidth = 0;
		for (const run of runs) {
			if (run.type === "emoji") totalWidth += size;
			else totalWidth += ctx.measureText(run.value).width;
		}
		if (userAlign === "right") {
			cursorX = x - totalWidth;
		}
		else if (userAlign === "center") {
			cursorX = x - totalWidth / 2;
		}
	}

	const commitWrap = () => {
		cursorX = x;
		cursorY += measuredLineHeight;
	};


	const getDrawY = () => {
		// Calculate top-left y for emoji image based on baseline selection
		switch (baseline) {
		case "top":
			return cursorY;
		case "middle":
			return cursorY - size / 2;
		case "bottom":
			return cursorY - size;
		case "hanging":
			return cursorY - size * 0.2;
		case "ideographic":
			return cursorY - size * 0.9;
		case "alphabetic":
		default:
			return cursorY - size * 0.9;
		}
	};

	for (const run of runs) {
		if (run.type === "text") {
			const segments = run.value.split(/(\s+)/);
			for (const seg of segments) {
				if (!seg) continue;
				const segWidth = ctx.measureText(seg).width;
				if (cursorX + segWidth > x + maxWidth && seg.trim()) {
					commitWrap();
				}
				if (onMeasureLine) onMeasureLine(segWidth, false);
				ctx.fillText(seg, cursorX, cursorY);
				cursorX += segWidth;
			}
		}
		else if (run.type === "emoji") {
			if (cursorX + size > x + maxWidth) {
				commitWrap();
			}
			try {
				const img = await ensureEmojiImage(run.value);
				const drawY = getDrawY();
				ctx.drawImage(img, cursorX, drawY, size, size);
				if (onMeasureLine) onMeasureLine(size, true);
				cursorX += size;
			}
			catch (e) {
				// Fallback: draw as text if image fails
				const fallback = run.value;
				const w = ctx.measureText(fallback).width;
				if (cursorX + w > x + maxWidth) {
					commitWrap();
				}
				if (onMeasureLine) onMeasureLine(w, false);
				ctx.fillText(fallback, cursorX, cursorY);
				cursorX += w;
			}
		}
	}

	ctx.restore();
	return { width: cursorX - x, height: cursorY - y + measuredLineHeight };
}

// async function loadImageFromUrl(url) {
// 	const res = await fetch(url);
// 	if (!res.ok) {
// 		throw new Error(`Failed to fetch image (${res.status})`);
// 	}
// 	const arrayBuffer = await res.arrayBuffer();
// 	return loadImage(Buffer.from(arrayBuffer));
// }

async function loadWebPAsPng(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
	const webpBuffer = Buffer.from(await res.arrayBuffer());
	if (sharp) {
		try {
			const pngBuffer = await sharp(webpBuffer).png().toBuffer(); // WebP → PNG
			return loadImage(pngBuffer);
		}
		catch (conversionError) {
			// fall through to raw
		}
	}
	// Fallback: attempt direct load (may work if Canvas supports it or image isn't actually WebP)
	try {
		return loadImage(webpBuffer);
	}
	catch (rawError) {
		throw new Error("avatar image conversion failed and sharp unavailable");
	}
}


function formatWinLoss(record) {
	if (!record) return null;
	const wins = record.wins ?? 0;
	const losses = record.losses ?? 0;
	const ties = record.ties ?? 0;
	let text = `${wins}-${losses}`;
	if (ties) {
		text += `-${ties}`;
	}
	return text;
}

module.exports = {
	getCountryFlag,
	formatPlayerNameWithFlag,
	getPlayerAvatarUrl,
	enhanceEmbedWithPlayerInfo,
	drawRoundedImage,
	drawBlurredImage,
	drawEmoji,
	drawInlineImage,
	drawTextWithEmojis,
	truncateTextWithEmojis,
	randomPattern,
	// loadImageFromUrl,
	loadWebPAsPng,
	formatWinLoss,
	drawRoundedPanel,
	tryLoadImageResource,
	loadFavoriteCharacterImage,
	loadFavoriteVehicleImage,
	formatNumber,
	formatSignedNumber,
};