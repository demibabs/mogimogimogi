const HEX_COLOR_PATTERN = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;
const RANK_STATS_CHART_VARIATION = 0.07;

function clampChannel(value) {
	if (!Number.isFinite(value)) {
		return 0;
	}
	return Math.min(255, Math.max(0, Math.round(value)));
}

function parseHexColor(hexColor) {
	if (typeof hexColor !== "string") {
		return null;
	}
	const match = HEX_COLOR_PATTERN.exec(hexColor.trim());
	if (!match) {
		return null;
	}
	const [, rgb, alpha] = match;
	const r = parseInt(rgb.slice(0, 2), 16);
	const g = parseInt(rgb.slice(2, 4), 16);
	const b = parseInt(rgb.slice(4, 6), 16);
	return {
		r,
		g,
		b,
		alphaHex: (alpha || "").toLowerCase(),
	};
}

function formatHexColor({ r, g, b, alphaHex }) {
	const components = [r, g, b]
		.map(value => clampChannel(value).toString(16).padStart(2, "0"))
		.join("");
	return `#${components}${alphaHex ?? ""}`;
}

function adjustColor(hexColor, factor, mode) {
	const parsed = parseHexColor(hexColor);
	if (!parsed) {
		return null;
	}
	const { r, g, b, alphaHex } = parsed;
	const ratio = Number.isFinite(factor) ? Math.min(Math.max(factor, 0), 1) : 0;
	const transform = value => {
		if (mode === "lighten") {
			return value + (255 - value) * ratio;
		}
		return value * (1 - ratio);
	};
	return formatHexColor({
		r: transform(r),
		g: transform(g),
		b: transform(b),
		alphaHex,
	});
}

function applyRankStatsChartColors(trackMap) {
	if (!trackMap) {
		return;
	}
	for (const palette of Object.values(trackMap)) {
		const rankStats = palette?.rankStats;
		if (!rankStats?.baseColor) {
			continue;
		}
		const lighter = adjustColor(rankStats.baseColor, RANK_STATS_CHART_VARIATION, "lighten");
		const darker = adjustColor(rankStats.baseColor, RANK_STATS_CHART_VARIATION, "darken");
		if (lighter) {
			rankStats.chartColor1 = lighter;
		}
		if (darker) {
			rankStats.chartColor2 = darker;
		}
	}
}

const trackColors = {
	MBC: {
		stats: {
			baseColor: "#fdf2d999",
			headerColor: "#16161a",
			statsTextColor: "#424242",
			chartTextColor: "#666666",
			yGridColor: "#e5e5e5",
			youColor: "#000000ff",
		},
		notables: {
			baseColor: "#fff5ddee",
			headerColor: "#16161a",
			statsTextColor: "#1e1e1eff",
		},
		rankStats: {
			baseColor: "#382222ee",
			headerColor: "#ffe8e8ff",
			statsTextColor: "#f3f3f3ff",
		},
	},
	CC: {
		stats: {
			baseColor: "#d9f0fdba",
			headerColor: "#16161a",
			statsTextColor: "#424242",
			chartTextColor: "#666666",
			yGridColor: "#e5e5e5",
			youColor: "#000000ff",
		},
		notables: {
			baseColor: "#e3f5ffdc",
			headerColor: "#16161a",
			statsTextColor: "#181818ff",
		},
		rankStats: {
			baseColor: "#ffffe3dc",
			headerColor: "#211410ff",
			statsTextColor: "#181818ff",
		},
	},
	WS: {
		stats: {
			baseColor: "#ded9fdaf",
			headerColor: "#16161a",
			statsTextColor: "#373737ff",
			chartTextColor: "#666666",
			yGridColor: "#e5e5e5",
			youColor: "#000000ff",
		},
		notables: {
			baseColor: "#fff3ddd5",
			headerColor: "#16161a",
			statsTextColor: "#131313ff",
		},
		rankStats: {
			baseColor: "#43251aee",
			headerColor: "#ffe8d9ff",
			statsTextColor: "#f3f3f3ff",
		},
	},
	DKS: {
		stats: {
			baseColor: "#2c3b5ad3",
			headerColor: "#d6d6e8ff",
			statsTextColor: "#dde4f4ff",
			chartTextColor: "#c0c7d4ff",
			yGridColor: "#72747cff",
			youColor: "#d5d9f5ff",
		},
		notables: {
			baseColor: "#e3f5ffdc",
			headerColor: "#16161a",
			statsTextColor: "#181818ff",
		},
		rankStats: {
			baseColor: "#1a2b43ee",
			headerColor: "#d9e8ffff",
			statsTextColor: "#f3f3f3ff",
		},
	},
	rDH: {
		stats: {
			baseColor: "#f6f8ddc4",
			headerColor: "#16161a",
			statsTextColor: "#3a3a3aff",
			chartTextColor: "#666666",
			yGridColor: "#e5e5e5",
			youColor: "#666666",
		},
		notables: {
			baseColor: "#f6f8ddd9",
			headerColor: "#16161a",
			statsTextColor: "#202020ff",
		},
		rankStats: {
			baseColor: "#f9ebd7d9",
			headerColor: "#16161a",
			statsTextColor: "#202020ff",
		},
	},
	rSGB: {
		stats: {
			baseColor: "#f8f3dd99",
			headerColor: "#16161a",
			statsTextColor: "#424242",
			chartTextColor: "#666666",
			yGridColor: "#e5e5e5",
			youColor: "#666666",
		},
		notables: {
			baseColor: "#f8f3ddd9",
			headerColor: "#16161a",
			statsTextColor: "#242424ff",
		},
		rankStats: {
			baseColor: "#ffe9cdd9",
			headerColor: "#16161a",
			statsTextColor: "#242424ff",
		},
	},
	rWS: {
		stats: {
			baseColor: "#f8ddddb2",
			headerColor: "#16161a",
			statsTextColor: "#313131ff",
			chartTextColor: "#666666",
			yGridColor: "#e5e5e5",
			youColor: "#161616ff",
		},
		notables: {
			baseColor: "#f8ddddda",
			headerColor: "#16161a",
			statsTextColor: "#313131ff",
		},
		rankStats: {
			baseColor: "#462c24ee",
			headerColor: "#ffe3d9ff",
			statsTextColor: "#ffffffff",
		},
	},
	rAF: {
		stats: {
			baseColor: "#8c6a7bd1",
			headerColor: "#f1dce8ff",
			statsTextColor: "#ffe6fdff",
			chartTextColor: "#d6bed2ff",
			yGridColor: "#af8fa3ff",
			youColor: "#fadff0ff",
		},
		notables: {
			baseColor: "#8c6a7bdf",
			headerColor: "#f1dce8ff",
			statsTextColor: "#fff0feff",
		},
		rankStats: {
			baseColor: "#462c24ee",
			headerColor: "#ffe3d9ff",
			statsTextColor: "#ffffffff",
		},
	},
	rDKP: {
		stats: {
			baseColor: "#d9dafdc8",
			headerColor: "#16161a",
			statsTextColor: "#424242",
			chartTextColor: "#666666",
			yGridColor: "#e5e5e5",
			youColor: "#000000ff",
		},
		notables: {
			baseColor: "#d9dafdf8",
			headerColor: "#16161a",
			statsTextColor: "#1b1b1bff",
		},
		rankStats: {
			baseColor: "#333946ee",
			headerColor: "#d9e8ffff",
			statsTextColor: "#f3f3f3ff",
		},
	},
	SP: {
		stats: {
			baseColor: "#3d4f68e5",
			headerColor: "#d6d6e8ff",
			statsTextColor: "#dde4f4ff",
			chartTextColor: "#c0c7d4ff",
			yGridColor: "#72747cff",
			youColor: "#d5d9f5ff",
		},
		notables: {
			baseColor: "#3d4f68ee",
			headerColor: "#d6d6e8ff",
			statsTextColor: "#e8eefcff",
		},
		rankStats: {
			baseColor: "#1a2b43ee",
			headerColor: "#d9e8ffff",
			statsTextColor: "#f3f3f3ff",
		},
	},
	rSHS: {
		stats: {
			baseColor: "#fccdffc5",
			headerColor: "#200620ff",
			statsTextColor: "#2f092aff",
			chartTextColor: "#4b224fff",
			yGridColor: "#e5e5e5ff",
			youColor: "#3c1a47ff",
		},
		notables: {
			baseColor: "#fccdffee",
			headerColor: "#200620ff",
			statsTextColor: "#23071fff",
		},
		rankStats: {
			baseColor: "#1a3143ee",
			headerColor: "#d9eeffff",
			statsTextColor: "#f3f3f3ff",
		},
	},
	rWSh: {
		stats: {
			baseColor: "#3d6868c0",
			headerColor: "#d6e5e8ff",
			statsTextColor: "#ddf4f4ff",
			chartTextColor: "#c0d1d4ff",
			yGridColor: "#727c7bff",
			youColor: "#d5f5f0ff",
		},
		notables: {
			baseColor: "#315151ec",
			headerColor: "#d6e5e8ff",
			statsTextColor: "#ddf4f4ff",
		},
		rankStats: {
			baseColor: "#1a3443ee",
			headerColor: "#d9f5ffff",
			statsTextColor: "#f3f3f3ff",
		},
	},
	rKTB: {
		stats: {
			baseColor: "#d9f0fdbc",
			headerColor: "#16161a",
			statsTextColor: "#262a45ff",
			chartTextColor: "#666666",
			yGridColor: "#e5e5e5",
			youColor: "#000000ff",
		},
		notables: {
			baseColor: "#d9f0fde3",
			headerColor: "#16161a",
			statsTextColor: "#1a1d2fff",
		},
		rankStats: {
			baseColor: "#18383cee",
			headerColor: "#d9fffcff",
			statsTextColor: "#ffffffff",
		},
	},
	FO: {
		stats: {
			baseColor: "#aa846ca6",
			headerColor: "#f6d8c7ff",
			statsTextColor: "#fdebdbff",
			chartTextColor: "#dfd1c6ff",
			yGridColor: "#bfb5acff",
			youColor: "#eddfd2ff",
		},
		notables: {
			baseColor: "#aa6d6ce1",
			headerColor: "#ffe5d9ff",
			statsTextColor: "#fff7f1ff",
		},
		rankStats: {
			baseColor: "#333946ee",
			headerColor: "#e8eaffff",
			statsTextColor: "#f3f3f3ff",
		},
	},
	PS: {
		stats: {
			baseColor: "#d9f0fdbc",
			headerColor: "#16161a",
			statsTextColor: "#3a4864ff",
			chartTextColor: "#666666",
			yGridColor: "#e5e5e5",
			youColor: "#000000ff",
		},
		notables: {
			baseColor: "#ffe7e4e7",
			headerColor: "#1a1716ff",
			statsTextColor: "#231b1bff",
		},
		rankStats: {
			baseColor: "#fff7f5e7",
			headerColor: "#1a1716ff",
			statsTextColor: "#231b1bff",
		},
	},
	rPB: {
		stats: {
			baseColor: "#ebddf899",
			headerColor: "#16161a",
			statsTextColor: "#2b2236ff",
			chartTextColor: "#666666",
			yGridColor: "#e0cbdfff",
			youColor: "#30223aff",
		},
		notables: {
			baseColor: "#ebddf8d9",
			headerColor: "#16161a",
			statsTextColor: "#2b2236ff",
		},
		rankStats: {
			baseColor: "#633421ee",
			headerColor: "#ffe3d9ff",
			statsTextColor: "#ffffffff",
		},
	},
	SSS: {
		stats: {
			baseColor: "#f8f3ddbd",
			headerColor: "#16161a",
			statsTextColor: "#393939ff",
			chartTextColor: "#666666",
			yGridColor: "#e5e5e5",
			youColor: "#0e0e0eff",
		},
		notables: {
			baseColor: "#424b69e1",
			headerColor: "#d9e9ffff",
			statsTextColor: "#f1fbffff",
		},
		rankStats: {
			baseColor: "#e2f4ffe7",
			headerColor: "#1a1716ff",
			statsTextColor: "#231b1bff",
		},
	},
	rDDJ: {
		stats: {
			baseColor: "#e2f8ddb1",
			headerColor: "#1f241eff",
			statsTextColor: "#2b342bff",
			chartTextColor: "#666666",
			yGridColor: "#e5e5e5",
			youColor: "#203426ff",
		},
		notables: {
			baseColor: "#e6ffe1e3",
			headerColor: "#1f241eff",
			statsTextColor: "#2b342bff",
		},
		rankStats: {
			baseColor: "#633421ee",
			headerColor: "#ffe3d9ff",
			statsTextColor: "#ffffffff",
		},
	},
	GBR: {
		stats: {
			baseColor: "#e2f8ddc4",
			headerColor: "#16161a",
			statsTextColor: "#3a3a3aff",
			chartTextColor: "#666666",
			yGridColor: "#e5e5e5",
			youColor: "#666666",
		},
		notables: {
			baseColor: "#e8f8dde4",
			headerColor: "#16161a",
			statsTextColor: "#242424ff",
		},
		rankStats: {
			baseColor: "#333946ee",
			headerColor: "#e8eaffff",
			statsTextColor: "#f3f3f3ff",
		},
	},
	CCF: {
		stats: {
			baseColor: "#f7ece1c7",
			headerColor: "#16161a",
			statsTextColor: "#212121ff",
			chartTextColor: "#666666",
			yGridColor: "#e5e5e5",
			youColor: "#404040ff",
		},
		notables: {
			baseColor: "#f7ece1e6",
			headerColor: "#16161a",
			statsTextColor: "#212121ff",
		},
		rankStats: {
			baseColor: "#fff3ebe6",
			headerColor: "#16161a",
			statsTextColor: "#212121ff",
		},
	},
	DD: {
		stats: {
			baseColor: "#fde7d999",
			headerColor: "#16161a",
			statsTextColor: "#424242",
			chartTextColor: "#666666",
			yGridColor: "#e5e5e5",
			youColor: "#000000ff",
		},
		notables: {
			baseColor: "#d9f1fde8",
			headerColor: "#16161a",
			statsTextColor: "#252525ff",
		},
		rankStats: {
			baseColor: "#fdf0d9e8",
			headerColor: "#16161a",
			statsTextColor: "#161616ff",
		},
	},
	BCi: {
		stats: {
			baseColor: "#47514899",
			headerColor: "#c4d5cbff",
			statsTextColor: "#b6c7b9",
			chartTextColor: "#aec0aa",
			yGridColor: "#393e3a",
			youColor: "#aec0aa",
		},
		notables: {
			baseColor: "#47514bee",
			headerColor: "#cce0d4ff",
			statsTextColor: "#e8ffecff",
		},
		rankStats: {
			baseColor: "#462518ee",
			headerColor: "#ffe3d9ff",
			statsTextColor: "#ffffffff",
		},
	},
	DBB: {
		stats: {
			baseColor: "#ffcecead",
			headerColor: "#261b1bff",
			statsTextColor: "#351616ff",
			chartTextColor: "#725454ff",
			yGridColor: "#b28989ff",
			youColor: "#602525ff",
		},
		notables: {
			baseColor: "#512929ea",
			headerColor: "#ffe1e1ff",
			statsTextColor: "#fff3f3ff",
		},
		rankStats: {
			baseColor: "#512929ea",
			headerColor: "#ffe1e1ff",
			statsTextColor: "#fff3f3ff",
		},
	},
	rMMM: {
		stats: {
			baseColor: "#e2f8ddda",
			headerColor: "#1f241eff",
			statsTextColor: "#2b342bff",
			chartTextColor: "#666666",
			yGridColor: "#e5e5e5",
			youColor: "#203426ff",
		},
		notables: {
			baseColor: "#4a5147ee",
			headerColor: "#d2e0ccff",
			statsTextColor: "#f2ffe8ff",
		},
		rankStats: {
			baseColor: "#d9f7fde8",
			headerColor: "#16161a",
			statsTextColor: "#161616ff",
		},
	},
	rCM: {
		stats: {
			baseColor: "#d0ceffbd",
			headerColor: "#1b1d26ff",
			statsTextColor: "#162235ff",
			chartTextColor: "#545972ff",
			yGridColor: "#8c89b2ff",
			youColor: "#252560ff",
		},
		notables: {
			baseColor: "#feffcee2",
			headerColor: "#171717ff",
			statsTextColor: "#171717ff",
		},
		rankStats: {
			baseColor: "#fff4dce2",
			headerColor: "#171717ff",
			statsTextColor: "#171717ff",
		},
	},
	rTF: {
		stats: {
			baseColor: "#ddeff8c4",
			headerColor: "#16161a",
			statsTextColor: "#3a3a3aff",
			chartTextColor: "#666666",
			yGridColor: "#9fc0d4ff",
			youColor: "#2d2d2dff",
		},
		notables: {
			baseColor: "#2d3b2bee",
			headerColor: "#ffffffff",
			statsTextColor: "#f2fff0ff",
		},
		rankStats: {
			baseColor: "#2e4051ee",
			headerColor: "#e8eaffff",
			statsTextColor: "#f3f3f3ff",
		},
	},
	BC: {
		stats: {
			baseColor: "#935b59cc",
			headerColor: "#ffe7e5ff",
			statsTextColor: "#ffe4e4ff",
			chartTextColor: "#d6c0beff",
			yGridColor: "#b67e76ff",
			youColor: "#fae3dfff",
		},
		notables: {
			baseColor: "#5b3b36e7",
			headerColor: "#fff1f0ff",
			statsTextColor: "#ffeaeaff",
		},
		rankStats: {
			baseColor: "#333e46ee",
			headerColor: "#d9f0ffff",
			statsTextColor: "#f3f3f3ff",
		},
	},
	AH: {
		stats: {
			baseColor: "#ccf5c390",
			headerColor: "#1f241eff",
			statsTextColor: "#2b342bff",
			chartTextColor: "#333b31ff",
			yGridColor: "#a9bfa5ff",
			youColor: "#203426ff",
		},
		notables: {
			baseColor: "#c3f5dae1",
			headerColor: "#1f241eff",
			statsTextColor: "#191b19ff",
		},
		rankStats: {
			baseColor: "#2b392fee",
			headerColor: "#efffe7ff",
			statsTextColor: "#ffffffff",
		},
	},
	rMC: {
		stats: {
			baseColor: "#ddeff8b9",
			headerColor: "#16161a",
			statsTextColor: "#3a3a3aff",
			chartTextColor: "#666666",
			yGridColor: "#9fc0d4ff",
			youColor: "#1d1d1dff",
		},
		notables: {
			baseColor: "#424b69e1",
			headerColor: "#d9e9ffff",
			statsTextColor: "#f1fbffff",
		},
		rankStats: {
			baseColor: "#e2f4ffe7",
			headerColor: "#1a1716ff",
			statsTextColor: "#231b1bff",
		},
	},
	RR: {
		stats: {
			baseColor: "#2f3f5ec8",
			headerColor: "#d6d6e8ff",
			statsTextColor: "#e9f0ffff",
			chartTextColor: "#d6deecff",
			yGridColor: "#72747cff",
			youColor: "#f0f2ffff",
		},
		notables: {
			baseColor: "#2f3f5eea",
			headerColor: "#d6d6e8ff",
			statsTextColor: "#e9f0ffff",
		},
		rankStats: {
			baseColor: "#462218ee",
			headerColor: "#ffddd9ff",
			statsTextColor: "#ffffffff",
		},
	},
};

applyRankStatsChartColors(trackColors);

const statsTrackColors = Object.fromEntries(
	Object.entries(trackColors).map(([track, palette]) => [track, palette.stats]),
);

const notablesTrackColors = Object.fromEntries(
	Object.entries(trackColors).map(([track, palette]) => [track, palette.notables]),
);

const rankStatsTrackColors = Object.fromEntries(
	Object.entries(trackColors).map(([track, palette]) => [track, palette.rankStats]),
);

const currentTrackName = "RR";

const leaderboardPalette = {
	baseColor: "#feedffbf",
	headerColor: "#000000",
	leaderboardTextColor: "#000000",
	valuePositiveColor: "#1f7a3f",
	valueNegativeColor: "#b6403b",
};

const headToHeadPalette = {
	backgroundColor: "#0b0b0b",
	highlightPanelColor: "#fbecffd9",
	textColor: "#050505ff",
	headerColor: "#000000ff",
	baseColor: "#feedff9d",
	valuePositiveColor: "#1f7a3f",
	valueNegativeColor: "#b6403b",
};

const rankColorMap = {
	Grandmaster: "#a3022c",
	Master: "#9370db",
	Diamond: "#b9f2ff",
	Ruby: "#d51c5e",
	Sapphire: "#286cd3",
	Platinum: "#3fabb8",
	Gold: "#f1c232",
	Silver: "#cccccc",
	Bronze: "#b45f06",
	Iron: "#817876",
};

module.exports = {
	trackColors,
	statsTrackColors,
	notablesTrackColors,
	rankStatsTrackColors,
	currentTrackName,
	leaderboardPalette,
	headToHeadPalette,
	rankColorMap,
};