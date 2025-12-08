const swapStates = {};

function updateDots(dotsId, activeIndex) {
	const dotsContainer = document.getElementById(dotsId);
	if (!dotsContainer) return;

	const dots = dotsContainer.children;
	for (let i = 0; i < dots.length; i++) {
		if (i === activeIndex) {
			dots[i].classList.remove("bg-zinc-600");
			dots[i].classList.add("bg-white");
		}
		else {
			dots[i].classList.remove("bg-white");
			dots[i].classList.add("bg-zinc-600");
		}
	}
}

function swapCards(id1, id2, dotsId, isMirrored) {
	const card1 = document.getElementById(id1);
	const card2 = document.getElementById(id2);
	const pairId = id1 + id2;

	if (swapStates[pairId] === undefined) swapStates[pairId] = false;

	const frontState = ["z-20", "translate-x-0", "translate-y-0", "scale-100", "opacity-100"];

	const backState = [
		"z-10",
		"translate-y-8",
		"scale-95",
		"opacity-40",
		"group-hover:opacity-60",
		"group-hover:translate-y-10",
	];

	if (isMirrored) {
		backState.push("-translate-x-8", "group-hover:-translate-x-10");
	}
	else {
		backState.push("translate-x-8", "group-hover:translate-x-10");
	}

	swapStates[pairId] = !swapStates[pairId];

	if (swapStates[pairId]) {
		card1.classList.remove(...frontState);
		card1.classList.add(...backState);

		card2.classList.remove(...backState);
		card2.classList.add(...frontState);

		updateDots(dotsId, 1);
	}
	else {
		card1.classList.remove(...backState);
		card1.classList.add(...frontState);

		card2.classList.remove(...frontState);
		card2.classList.add(...backState);

		updateDots(dotsId, 0);
	}
}

function cycleCards(id1, id2, id3, dotsId) {
	const cards = [document.getElementById(id1), document.getElementById(id2), document.getElementById(id3)];
	const pairId = id1 + id2 + id3;

	if (swapStates[pairId] === undefined) swapStates[pairId] = 0;
	swapStates[pairId] = (swapStates[pairId] + 1) % 3;
	const state = swapStates[pairId];

	updateDots(dotsId, state);

	let states;
	if (dotsId === "customize-dots") {
		states = [
			["z-30", "translate-x-0", "translate-y-0", "scale-100", "opacity-100"],
			["z-20", "translate-x-8", "translate-y-8", "scale-95", "opacity-25", "group-hover:translate-x-10", "group-hover:translate-y-10"],
			["z-10", "translate-x-16", "translate-y-16", "scale-90", "opacity-10", "group-hover:translate-x-20", "group-hover:translate-y-20"],
		];
	}
	else {
		states = [
			["z-30", "translate-x-0", "translate-y-0", "scale-100", "opacity-100"],
			["z-20", "translate-x-8", "translate-y-8", "scale-95", "opacity-70", "group-hover:translate-x-10", "group-hover:translate-y-10"],
			["z-10", "translate-x-16", "translate-y-16", "scale-90", "opacity-40", "group-hover:translate-x-20", "group-hover:translate-y-20"],
		];
	}

	const allStateClasses = [
		"z-30", "z-20", "z-10",
		"translate-x-0", "translate-y-0", "translate-x-8", "translate-y-8", "translate-x-16", "translate-y-16",
		"scale-100", "scale-95", "scale-90",
		"opacity-100", "opacity-70", "opacity-60", "opacity-40", "opacity-25", "opacity-10",
		"group-hover:translate-x-10", "group-hover:translate-y-10", "group-hover:translate-x-20", "group-hover:translate-y-20",
	];
	const clean = (el) => el.classList.remove(...allStateClasses);

	cards.forEach((card, index) => {
		clean(card);
		const stateIndex = (index + state) % 3;
		card.classList.add(...states[stateIndex]);
	});
}

function adjustCardHeights() {
	const containers = [
		"stats-card-container",
		"compare-card-container",
		"customize-card-container",
		"customize-header-container",
	];

	containers.forEach(containerId => {
		const container = document.getElementById(containerId);
		if (!container) return;

		const images = container.querySelectorAll("img");
		let minAspectRatio = Infinity;

		images.forEach(img => {
			if (img.naturalWidth && img.naturalHeight) {
				const ratio = img.naturalWidth / img.naturalHeight;
				if (ratio < minAspectRatio) {
					minAspectRatio = ratio;
				}
			}
		});

		if (minAspectRatio !== Infinity) {
			container.style.aspectRatio = `${minAspectRatio}`;
		}
	});
}

// Intersection Observer for fade-in animations
document.addEventListener("DOMContentLoaded", () => {
	const observerOptions = {
		root: null,
		rootMargin: "0px",
		threshold: 0.1,
	};

	const observer = new IntersectionObserver((entries) => {
		entries.forEach(entry => {
			if (entry.isIntersecting) {
				entry.target.classList.add("is-visible");
			}
			else {
				entry.target.classList.remove("is-visible");
			}
		});
	}, observerOptions);

	const sections = document.querySelectorAll(".fade-in-section");
	sections.forEach(section => {
		observer.observe(section);
	});

	const heroButtonSentinel = document.getElementById("hero-add-button-sentinel");
	const navButton = document.getElementById("nav-add-button");

	if (navButton) {
		if (heroButtonSentinel) {
			const navObserver = new IntersectionObserver((entries) => {
				entries.forEach(entry => {
					if (!entry.isIntersecting && entry.boundingClientRect.top < 0) {
						navButton.classList.remove("opacity-0", "pointer-events-none", "translate-y-2");
					}
					else {
						navButton.classList.add("opacity-0", "pointer-events-none", "translate-y-2");
					}
				});
			}, {
				root: null,
				threshold: 0,
			});

			navObserver.observe(heroButtonSentinel);
		}
		else {
			navButton.classList.remove("opacity-0", "pointer-events-none", "translate-y-2");
		}
	}

	const headerTitle = document.getElementById("header-title");
	const navTitle = document.getElementById("nav-title");

	if (navTitle) {
		if (headerTitle) {
			const titleObserver = new IntersectionObserver((entries) => {
				entries.forEach(entry => {
					if (!entry.isIntersecting && entry.boundingClientRect.top < 0) {
						navTitle.classList.remove("opacity-0");
					}
					else {
						navTitle.classList.add("opacity-0");
					}
				});
			}, {
				root: null,
				threshold: 0,
			});

			titleObserver.observe(headerTitle);
		}
		else {
			navTitle.classList.remove("opacity-0");
		}
	}
});

window.addEventListener("load", adjustCardHeights);
window.addEventListener("resize", adjustCardHeights);
setInterval(adjustCardHeights, 1000);

fetch("/api/stats")
	.then(response => response.json())
	.then(data => {
		const animateValue = (obj, start, end, duration) => {
			if (!obj) return;
			let startTimestamp = null;
			const step = (timestamp) => {
				if (!startTimestamp) startTimestamp = timestamp;
				const progress = Math.min((timestamp - startTimestamp) / duration, 1);
				obj.innerHTML = Math.floor(progress * (end - start) + start).toLocaleString();
				if (progress < 1) {
					window.requestAnimationFrame(step);
				}
			};
			window.requestAnimationFrame(step);
		};

		const serverEl = document.getElementById("server-count");
		const userEl = document.getElementById("user-count");
		const tableEl = document.getElementById("table-count");

		if (data.servers && serverEl) animateValue(serverEl, 0, data.servers, 1000);
		if (data.users && userEl) animateValue(userEl, 0, data.users, 1500);
		if (data.tables && tableEl) animateValue(tableEl, 0, data.tables, 2000);
	})
	.catch(console.error);
