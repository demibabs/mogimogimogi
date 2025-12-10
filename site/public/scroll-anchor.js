
// Scroll Anchoring for Layout Shifts
(function() {
    let currentAnchor = null;
    const headerOffset = 140; // Approximate height of sticky header + padding

    // Identify the section currently in view
    function updateAnchor() {
        const sections = document.querySelectorAll('[id^="cmd-"]');
        if (sections.length === 0) return;

        let closest = null;
        let closestDist = Infinity;

        sections.forEach(section => {
            const rect = section.getBoundingClientRect();
            // We care about the top of the section relative to the viewport top (plus offset)
            const dist = Math.abs(rect.top - headerOffset);
            
            if (dist < closestDist) {
                closestDist = dist;
                closest = section;
            }
        });

        currentAnchor = closest;
    }

    // Listen for scroll to update our anchor
    let isResizing = false;
    window.addEventListener('scroll', () => {
        if (!isResizing) {
            updateAnchor();
        }
    }, { passive: true });

    // Handle Resize
    let resizeTimer = null;

    window.addEventListener('resize', () => {
        isResizing = true;
        
        // If we have an anchor, keep it in view
        if (currentAnchor) {
            const rect = currentAnchor.getBoundingClientRect();
            // If it's drifted significantly from the offset, correct it
            if (Math.abs(rect.top - headerOffset) > 50) {
                 const targetY = window.scrollY + rect.top - headerOffset;
                 window.scrollTo({ top: targetY, behavior: 'auto' });
            }
        }

        // Debounce the end of resizing
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            isResizing = false;
            // One final correction
            if (currentAnchor) {
                 const rect = currentAnchor.getBoundingClientRect();
                 const targetY = window.scrollY + rect.top - headerOffset;
                 window.scrollTo({ top: targetY, behavior: 'auto' });
            }
        }, 150);
    });
    
    // Initial anchor set
    updateAnchor();
})();
