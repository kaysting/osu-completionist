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