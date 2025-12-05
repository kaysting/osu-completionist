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
const copyText = async text => {
    if (navigator.clipboard) {
        try {
            await navigator.clipboard.writeText(text);
        } catch (err) {
            console.error('Error copying to clipboard:', err);
        }
    } else {
        alert('Clipboard API is not supported in this browser.');
    }
};