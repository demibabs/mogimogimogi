(function() {
	const container = document.getElementById("customize-table");
	if (!container) return;

	const placeholder = container.querySelector("[data-placeholder]");

	function createColumn(items, label) {
		const col = document.createElement("div");
		col.className = "space-y-2";

		const heading = document.createElement("p");
		heading.className = "text-xs text-zinc-300 font-medium";
		heading.textContent = label;
		col.appendChild(heading);

		const list = document.createElement("div");
		list.className = "grid grid-cols-5 sm:grid-cols-1 gap-2";

		items.slice(0, 5).forEach((item, index) => {
			const itemContainer = document.createElement("div");
			itemContainer.className = "flex flex-col gap-1";

			const mobileNumber = document.createElement("span");
			mobileNumber.className = "text-[10px] text-zinc-500 font-bold sm:hidden pl-1";
			mobileNumber.textContent = `#${index + 1}`;
			itemContainer.appendChild(mobileNumber);

			const wrap = document.createElement("div");
			const aspectClass = label === "tracks" ? "aspect-video" : "aspect-square";
			wrap.className = `relative ${aspectClass} sm:aspect-auto sm:h-20 rounded-xl overflow-hidden bg-zinc-800/80 border border-white/5`;

			if (item.image) {
				const img = document.createElement("img");
				img.src = item.image;
				img.alt = item.name || label;
				img.className = label === "characters"
					? "absolute inset-0 w-full h-full object-contain p-1.5 sm:p-2"
					: label === "vehicles"
						? "absolute inset-0 w-full h-full object-contain p-1 sm:p-[0.8rem]"
						: "absolute inset-0 w-full h-full object-cover";
				wrap.appendChild(img);
			}

			const badge = document.createElement("div");
			badge.className = "hidden sm:block absolute top-2 left-2 bg-black/70 text-white text-xs font-bold px-2 py-1 rounded-full";
			badge.textContent = `#${index + 1}`;
			wrap.appendChild(badge);

			itemContainer.appendChild(wrap);
			list.appendChild(itemContainer);
		});

		col.appendChild(list);
		return col;
	}

	function renderFavorites(data) {
		const tracks = Array.isArray(data?.tracks) ? data.tracks : [];
		const characters = Array.isArray(data?.characters) ? data.characters : [];
		const vehicles = Array.isArray(data?.vehicles) ? data.vehicles : [];

		if (placeholder) {
			placeholder.remove();
		}

		const shell = document.createElement("div");
		shell.className = "bg-white/5 border border-white/5 rounded-2xl p-4 shadow-inner space-y-3";

		const title = document.createElement("p");
		title.className = "text-sm text-zinc-200 font-medium";
		title.textContent = `most popular (${data.totalUsers || 0} customized players)`;
		shell.appendChild(title);

		const grid = document.createElement("div");
		grid.className = "grid grid-cols-1 sm:grid-cols-3 gap-3";

		grid.appendChild(createColumn(tracks, "tracks"));
		grid.appendChild(createColumn(characters, "characters"));
		grid.appendChild(createColumn(vehicles, "vehicles"));

		shell.appendChild(grid);

		container.appendChild(shell);
	}

	fetch("/api/global-favorites")
		.then(res => res.ok ? res.json() : Promise.reject(new Error("bad response")))
		.then(renderFavorites)
		.catch(() => {
			if (placeholder) {
				placeholder.textContent = "unable to load favorites";
			}
		});
})();

(function() {
	const preview = document.getElementById("stats-preview");
	const loading = document.getElementById("stats-loading");
	const placeholder = document.getElementById("stats-placeholder");
	const rows = {
		time: document.getElementById("stats-time-row"),
		queue: document.getElementById("stats-queue-row"),
		players: document.getElementById("stats-players-row"),
	};

	if (!preview || !rows.time || !rows.queue || !rows.players) return;

	const state = {
		time: "alltime",
		queue: "both",
		players: "both",
	};
	let hasImageLoaded = false;
	let currentFetchId = 0;

	const btnClasses = "text-xs sm:text-sm font-semibold px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all";
	const activeClasses = "bg-indigo-600 text-white border-indigo-400 shadow-lg shadow-indigo-500/20";

	const groups = {
		time: [
			{ value: "alltime", label: "all time" },
			{ value: "weekly", label: "past week" },
			{ value: "season", label: "this season" },
		],
		queue: [
			{ value: "soloq", label: "soloq" },
			{ value: "squads", label: "squads" },
			{ value: "both", label: "both" },
		],
		players: [
			{ value: "12p", label: "12p" },
			{ value: "24p", label: "24p" },
			{ value: "both", label: "both" },
		],
	};

	function setLoading(isLoading, message = "loading…") {
		if (loading) loading.classList.toggle("hidden", !isLoading);
		if (placeholder) {
			if (!hasImageLoaded) {
				placeholder.textContent = message;
				placeholder.classList.toggle("hidden", !isLoading);
			}
			else {
				placeholder.classList.add("hidden");
			}
		}
	}

	function showError(message) {
		if (loading) loading.classList.add("hidden");
		if (placeholder) {
			placeholder.textContent = message || "unable to render stats";
			placeholder.classList.remove("hidden");
		}
		if (preview) {
			preview.classList.add("hidden");
		}
	}

	function refreshButtons() {
		Object.entries(groups).forEach(([groupKey, options]) => {
			const row = rows[groupKey];
			row.innerHTML = "";
			options.forEach(option => {
				const btn = document.createElement("button");
				btn.type = "button";
				btn.textContent = option.label;
				btn.dataset.group = groupKey;
				btn.dataset.value = option.value;
				btn.className = `${btnClasses} ${state[groupKey] === option.value ? activeClasses : "text-zinc-200"}`;
				btn.disabled = state[groupKey] === option.value;
				btn.addEventListener("click", () => {
					state[groupKey] = option.value;
					refreshButtons();
					refreshImage();
				});
				row.appendChild(btn);
			});
		});
	}

	function refreshImage() {
		if (!preview) return;
		const fetchId = ++currentFetchId;
		setLoading(true, "loading…");
		const cacheBust = `t=${Date.now()}`;
		const url = `/api/command-stats?time=${state.time}&queue=${state.queue}&players=${state.players}&${cacheBust}`;

		fetch(url)
			.then(async res => {
				if (fetchId !== currentFetchId) return null;
				if (!res.ok) {
					let message = "unable to render stats";
					try {
						const data = await res.json();
						if (data?.error) message = data.error;
					}
					catch (error) {
						console.warn("stats preview error parse failed", error);
					}
					showError(message);
					return null;
				}
				return res.blob();
			})
			.then(blob => {
				if (fetchId !== currentFetchId) return;
				if (!blob) return;
				const objectUrl = URL.createObjectURL(blob);
				const nextImage = new Image();
				nextImage.onload = () => {
					if (fetchId !== currentFetchId) return;
					if (preview.dataset.objectUrl) {
						URL.revokeObjectURL(preview.dataset.objectUrl);
					}
					preview.dataset.objectUrl = objectUrl;
					preview.src = objectUrl;
				};
				nextImage.onerror = () => {
					if (fetchId !== currentFetchId) return;
					URL.revokeObjectURL(objectUrl);
					showError("failed to load stats preview");
				};
				nextImage.src = objectUrl;
			})
			.catch(error => {
				if (fetchId !== currentFetchId) return;
				console.warn("stats preview fetch failed", error);
				showError("failed to load stats preview");
			});
	}

	preview.addEventListener("load", () => {
		setLoading(false);
		preview.classList.remove("hidden");
		hasImageLoaded = true;
		preview.style.visibility = "visible";
		if (placeholder) placeholder.classList.add("hidden");
	});
	preview.addEventListener("error", () => {
		showError("failed to load stats preview");
	});

	refreshButtons();
	refreshImage();
})();

(function() {
	const preview = document.getElementById("notables-preview");
	const loading = document.getElementById("notables-loading");
	const placeholder = document.getElementById("notables-placeholder");
	const rows = {
		time: document.getElementById("notables-time-row"),
		queue: document.getElementById("notables-queue-row"),
		players: document.getElementById("notables-players-row"),
	};

	if (!preview || !rows.time || !rows.queue || !rows.players) return;

	const state = {
		time: "alltime",
		queue: "both",
		players: "both",
	};
	let hasImageLoaded = false;
	let currentFetchId = 0;

	const btnClasses = "text-xs sm:text-sm font-semibold px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all";
	const activeClasses = "bg-indigo-600 text-white border-indigo-400 shadow-lg shadow-indigo-500/20";

	const groups = {
		time: [
			{ value: "alltime", label: "all time" },
			{ value: "weekly", label: "past week" },
			{ value: "season", label: "this season" },
		],
		queue: [
			{ value: "soloq", label: "soloq" },
			{ value: "squads", label: "squads" },
			{ value: "both", label: "both" },
		],
		players: [
			{ value: "12p", label: "12p" },
			{ value: "24p", label: "24p" },
			{ value: "both", label: "both" },
		],
	};

	function setLoading(isLoading, message = "loading…") {
		if (loading) loading.classList.toggle("hidden", !isLoading);
		if (placeholder) {
			if (!hasImageLoaded) {
				placeholder.textContent = message;
				placeholder.classList.toggle("hidden", !isLoading);
			}
			else {
				placeholder.classList.add("hidden");
			}
		}
	}

	function showError(message) {
		if (loading) loading.classList.add("hidden");
		if (placeholder) {
			placeholder.textContent = message || "unable to render notables";
			placeholder.classList.remove("hidden");
		}
		if (preview) {
			preview.classList.add("hidden");
		}
	}

	function refreshButtons() {
		Object.entries(groups).forEach(([groupKey, options]) => {
			const row = rows[groupKey];
			row.innerHTML = "";
			options.forEach(option => {
				const btn = document.createElement("button");
				btn.type = "button";
				btn.textContent = option.label;
				btn.dataset.group = groupKey;
				btn.dataset.value = option.value;
				btn.className = `${btnClasses} ${state[groupKey] === option.value ? activeClasses : "text-zinc-200"}`;
				btn.disabled = state[groupKey] === option.value;
				btn.addEventListener("click", () => {
					state[groupKey] = option.value;
					refreshButtons();
					refreshImage();
				});
				row.appendChild(btn);
			});
		});
	}

	function refreshImage() {
		if (!preview) return;
		const fetchId = ++currentFetchId;
		setLoading(true, "loading…");
		const cacheBust = `t=${Date.now()}`;
		const url = `/api/command-notables?time=${state.time}&queue=${state.queue}&players=${state.players}&${cacheBust}`;

		fetch(url)
			.then(async res => {
				if (fetchId !== currentFetchId) return null;
				if (!res.ok) {
					let message = "unable to render notables";
					try {
						const data = await res.json();
						if (data?.error) message = data.error;
					}
					catch (error) {
						console.warn("notables preview error parse failed", error);
					}
					showError(message);
					return null;
				}
				return res.blob();
			})
			.then(blob => {
				if (fetchId !== currentFetchId) return;
				if (!blob) return;
				const objectUrl = URL.createObjectURL(blob);
				const nextImage = new Image();
				nextImage.onload = () => {
					if (fetchId !== currentFetchId) return;
					if (preview.dataset.objectUrl) {
						URL.revokeObjectURL(preview.dataset.objectUrl);
					}
					preview.dataset.objectUrl = objectUrl;
					preview.src = objectUrl;
				};
				nextImage.onerror = () => {
					if (fetchId !== currentFetchId) return;
					URL.revokeObjectURL(objectUrl);
					showError("failed to load notables preview");
				};
				nextImage.src = objectUrl;
			})
			.catch(error => {
				if (fetchId !== currentFetchId) return;
				console.warn("notables preview fetch failed", error);
				showError("failed to load notables preview");
			});
	}

	preview.addEventListener("load", () => {
		setLoading(false);
		preview.classList.remove("hidden");
		hasImageLoaded = true;
		preview.style.visibility = "visible";
		if (placeholder) placeholder.classList.add("hidden");
	});
	preview.addEventListener("error", () => {
		showError("failed to load notables preview");
	});

	refreshButtons();
	refreshImage();
})();

(function() {
	const preview = document.getElementById("rank-stats-preview");
	const loading = document.getElementById("rank-stats-loading");
	const placeholder = document.getElementById("rank-stats-placeholder");
	const rows = {
		time: document.getElementById("rank-stats-time-row"),
		queue: document.getElementById("rank-stats-queue-row"),
		players: document.getElementById("rank-stats-players-row"),
	};

	if (!preview || !rows.time || !rows.queue || !rows.players) return;

	const state = {
		time: "alltime",
		queue: "both",
		players: "both",
	};
	let hasImageLoaded = false;
	let currentFetchId = 0;

	const btnClasses = "text-xs sm:text-sm font-semibold px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all";
	const activeClasses = "bg-indigo-600 text-white border-indigo-400 shadow-lg shadow-indigo-500/20";

	const groups = {
		time: [
			{ value: "alltime", label: "all time" },
			{ value: "weekly", label: "past week" },
			{ value: "season", label: "this season" },
		],
		queue: [
			{ value: "soloq", label: "soloq" },
			{ value: "squads", label: "squads" },
			{ value: "both", label: "both" },
		],
		players: [
			{ value: "12p", label: "12p" },
			{ value: "24p", label: "24p" },
			{ value: "both", label: "both" },
		],
	};

	function setLoading(isLoading, message = "loading…") {
		if (loading) loading.classList.toggle("hidden", !isLoading);
		if (placeholder) {
			if (!hasImageLoaded) {
				placeholder.textContent = message;
				placeholder.classList.toggle("hidden", !isLoading);
			}
			else {
				placeholder.classList.add("hidden");
			}
		}
	}

	function showError(message) {
		if (loading) loading.classList.add("hidden");
		if (placeholder) {
			placeholder.textContent = message || "unable to render rank-stats";
			placeholder.classList.remove("hidden");
		}
		if (preview) {
			preview.classList.add("hidden");
		}
	}

	function refreshButtons() {
		Object.entries(groups).forEach(([groupKey, options]) => {
			const row = rows[groupKey];
			row.innerHTML = "";
			options.forEach(option => {
				const btn = document.createElement("button");
				btn.type = "button";
				btn.textContent = option.label;
				btn.dataset.group = groupKey;
				btn.dataset.value = option.value;
				btn.className = `${btnClasses} ${state[groupKey] === option.value ? activeClasses : "text-zinc-200"}`;
				btn.disabled = state[groupKey] === option.value;
				btn.addEventListener("click", () => {
					state[groupKey] = option.value;
					refreshButtons();
					refreshImage();
				});
				row.appendChild(btn);
			});
		});
	}

	function refreshImage() {
		if (!preview) return;
		const fetchId = ++currentFetchId;
		setLoading(true, "loading…");
		const cacheBust = `t=${Date.now()}`;
		const url = `/api/command-rank-stats?time=${state.time}&queue=${state.queue}&players=${state.players}&${cacheBust}`;

		fetch(url)
			.then(async res => {
				if (fetchId !== currentFetchId) return null;
				if (!res.ok) {
					let message = "unable to render rank-stats";
					try {
						const data = await res.json();
						if (data?.error) message = data.error;
					}
					catch (error) {
						console.warn("rank-stats preview error parse failed", error);
					}
					showError(message);
					return null;
				}
				return res.blob();
			})
			.then(blob => {
				if (fetchId !== currentFetchId) return;
				if (!blob) return;
				const objectUrl = URL.createObjectURL(blob);
				const nextImage = new Image();
				nextImage.onload = () => {
					if (fetchId !== currentFetchId) return;
					if (preview.dataset.objectUrl) {
						URL.revokeObjectURL(preview.dataset.objectUrl);
					}
					preview.dataset.objectUrl = objectUrl;
					preview.src = objectUrl;
				};
				nextImage.onerror = () => {
					if (fetchId !== currentFetchId) return;
					URL.revokeObjectURL(objectUrl);
					showError("failed to load rank-stats preview");
				};
				nextImage.src = objectUrl;
			})
			.catch(error => {
				if (fetchId !== currentFetchId) return;
				console.warn("rank-stats preview fetch failed", error);
				showError("failed to load rank-stats preview");
			});
	}

	preview.addEventListener("load", () => {
		setLoading(false);
		preview.classList.remove("hidden");
		hasImageLoaded = true;
		preview.style.visibility = "visible";
		if (placeholder) placeholder.classList.add("hidden");
	});
	preview.addEventListener("error", () => {
		showError("failed to load rank-stats preview");
	});

	refreshButtons();
	refreshImage();
})();

(function() {
	const preview = document.getElementById("head-to-head-preview");
	const loading = document.getElementById("head-to-head-loading");
	const placeholder = document.getElementById("head-to-head-placeholder");
	const rows = {
		time: document.getElementById("head-to-head-time-row"),
		queue: document.getElementById("head-to-head-queue-row"),
		players: document.getElementById("head-to-head-players-row"),
	};

	if (!preview || !rows.time || !rows.queue || !rows.players) return;

	const state = {
		time: "alltime",
		queue: "both",
		players: "both",
	};
	let hasImageLoaded = false;
	let currentFetchId = 0;

	const btnClasses = "text-xs sm:text-sm font-semibold px-3 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all";
	const activeClasses = "bg-indigo-600 text-white border-indigo-400 shadow-lg shadow-indigo-500/20";

	const groups = {
		time: [
			{ value: "alltime", label: "all time" },
			{ value: "weekly", label: "past week" },
			{ value: "season", label: "this season" },
		],
		queue: [
			{ value: "soloq", label: "soloq" },
			{ value: "squads", label: "squads" },
			{ value: "both", label: "both" },
		],
		players: [
			{ value: "12p", label: "12p" },
			{ value: "24p", label: "24p" },
			{ value: "both", label: "both" },
		],
	};

	function setLoading(isLoading, message = "loading…") {
		if (loading) loading.classList.toggle("hidden", !isLoading);
		if (placeholder) {
			if (!hasImageLoaded) {
				placeholder.textContent = message;
				placeholder.classList.toggle("hidden", !isLoading);
			}
			else {
				placeholder.classList.add("hidden");
			}
		}
	}

	function showError(message) {
		if (loading) loading.classList.add("hidden");
		if (placeholder) {
			placeholder.textContent = message || "unable to render head-to-head";
			placeholder.classList.remove("hidden");
		}
		if (preview) {
			preview.classList.add("hidden");
		}
	}

	function refreshButtons() {
		Object.entries(groups).forEach(([groupKey, options]) => {
			const row = rows[groupKey];
			row.innerHTML = "";
			options.forEach(option => {
				const btn = document.createElement("button");
				btn.type = "button";
				btn.textContent = option.label;
				btn.dataset.group = groupKey;
				btn.dataset.value = option.value;
				btn.className = `${btnClasses} ${state[groupKey] === option.value ? activeClasses : "text-zinc-200"}`;
				btn.disabled = state[groupKey] === option.value;
				btn.addEventListener("click", () => {
					state[groupKey] = option.value;
					refreshButtons();
					refreshImage();
				});
				row.appendChild(btn);
			});
		});
	}

	function refreshImage() {
		if (!preview) return;
		const fetchId = ++currentFetchId;
		setLoading(true, "loading…");
		const cacheBust = `t=${Date.now()}`;
		const url = `/api/command-head-to-head?time=${state.time}&queue=${state.queue}&players=${state.players}&${cacheBust}`;

		fetch(url)
			.then(async res => {
				if (fetchId !== currentFetchId) return null;
				if (!res.ok) {
					let message = "unable to render head-to-head";
					try {
						const data = await res.json();
						if (data?.error) message = data.error;
					}
					catch (error) {
						console.warn("head-to-head preview error parse failed", error);
					}
					showError(message);
					return null;
				}
				return res.blob();
			})
			.then(blob => {
				if (fetchId !== currentFetchId) return;
				if (!blob) return;
				const objectUrl = URL.createObjectURL(blob);
				const nextImage = new Image();
				nextImage.onload = () => {
					if (fetchId !== currentFetchId) return;
					if (preview.dataset.objectUrl) {
						URL.revokeObjectURL(preview.dataset.objectUrl);
					}
					preview.dataset.objectUrl = objectUrl;
					preview.src = objectUrl;
				};
				nextImage.onerror = () => {
					if (fetchId !== currentFetchId) return;
					URL.revokeObjectURL(objectUrl);
					showError("failed to load head-to-head preview");
				};
				nextImage.src = objectUrl;
			})
			.catch(error => {
				if (fetchId !== currentFetchId) return;
				console.warn("head-to-head preview fetch failed", error);
				showError("failed to load head-to-head preview");
			});
	}

	preview.addEventListener("load", () => {
		setLoading(false);
		preview.classList.remove("hidden");
		hasImageLoaded = true;
		preview.style.visibility = "visible";
		if (placeholder) placeholder.classList.add("hidden");
	});
	preview.addEventListener("error", () => {
		showError("failed to load head-to-head preview");
	});

	refreshButtons();
	refreshImage();
})();
