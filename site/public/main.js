const carouselStates = {};

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

function cycleCarousel(containerId, dotsId, direction = 1) {
	const container = document.getElementById(containerId);
	if (!container) return;

	const images = container.querySelectorAll("img");
	if (images.length === 0) return;

	if (carouselStates[containerId] === undefined) carouselStates[containerId] = 0;

	// Calculate next index
	let nextIndex = (carouselStates[containerId] + direction) % images.length;
	if (nextIndex < 0) nextIndex = images.length - 1;
	
	carouselStates[containerId] = nextIndex;

	// Update images
	images.forEach((img, index) => {
		if (index === nextIndex) {
			// Active image: relative, visible
			img.classList.remove("absolute", "top-1/2", "left-1/2", "-translate-x-1/2", "-translate-y-1/2", "opacity-0", "z-0");
			img.classList.add("relative", "opacity-100", "z-10");
		}
		else {
			// Inactive images: absolute, hidden/transparent
			img.classList.remove("relative", "opacity-100", "z-10");
			img.classList.add("absolute", "top-1/2", "left-1/2", "-translate-x-1/2", "-translate-y-1/2", "opacity-0", "z-0");
		}
	});

	updateDots(dotsId, nextIndex);
}

function enableSwipe(containerId, dotsId) {
	const container = document.getElementById(containerId);
	if (!container) return;

	let touchStartX = 0;
	let touchEndX = 0;

	container.addEventListener("touchstart", e => {
		touchStartX = e.changedTouches[0].screenX;
	}, { passive: true });

	container.addEventListener("touchend", e => {
		touchEndX = e.changedTouches[0].screenX;
		handleSwipe();
	}, { passive: true });

	function handleSwipe() {
		const threshold = 50;
		if (touchEndX < touchStartX - threshold) {
			// Swipe Left -> Next
			cycleCarousel(containerId, dotsId, 1);
		}
		if (touchEndX > touchStartX + threshold) {
			// Swipe Right -> Prev
			cycleCarousel(containerId, dotsId, -1);
		}
	}
}

function initSwipes() {
	const carousels = [
		{ container: "hero-mobile-carousel", dots: "hero-mobile-dots" },
		{ container: "stats-card-container", dots: "stats-dots" },
		{ container: "compare-card-container", dots: "compare-dots" },
		{ container: "customize-card-container", dots: "customize-dots" },
	];

	carousels.forEach(c => enableSwipe(c.container, c.dots));
}

function adjustCardHeights() {
	const containers = [
		"stats-card-container",
		"compare-card-container",
		"customize-header-container",
		"hero-mobile-carousel",
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

// Scroll-linked fade animation
document.addEventListener("DOMContentLoaded", () => {
	function handleScrollAnimations() {
		const sections = document.querySelectorAll(".fade-in-section");
		const windowHeight = window.innerHeight;
		const fadeDistance = windowHeight * 0.20; // Fade over 20% of the screen height

		sections.forEach(section => {
			const rect = section.getBoundingClientRect();
			// Calculate opacity: 0 at bottom of screen, 1 when it's moved up by fadeDistance
			let opacity = (windowHeight - rect.top) / fadeDistance;

			// Clamp between 0 and 1
			opacity = Math.max(0, Math.min(1, opacity));

			section.style.opacity = opacity;
		});
	}

	window.addEventListener("scroll", handleScrollAnimations);
	window.addEventListener("resize", handleScrollAnimations);
	handleScrollAnimations(); // Initial check

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
window.addEventListener("load", initSwipes);
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
