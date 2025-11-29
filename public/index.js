document.addEventListener('DOMContentLoaded', () => {

    const topbar = document.getElementById('topbar');

    document.addEventListener('scroll', () => {
        if (window.scrollY > 20) {
            topbar.classList.add('scrolled');
        } else {
            topbar.classList.remove('scrolled');
        }
    });

});

// Use the sharing api or clipboard write to share text
const shareCopy = async text => {
    if (navigator.share) {
        try {
            await navigator.share({ text });
        } catch (err) {
            console.error('Error sharing:', err);
        }
    } else if (navigator.clipboard) {
        try {
            await navigator.clipboard.writeText(text);
            alert('Stats copied to clipboard!');
        } catch (err) {
            console.error('Error copying to clipboard:', err);
        }
    } else {
        alert('Sharing and clipboard APIs are not supported in this browser.');
    }
};