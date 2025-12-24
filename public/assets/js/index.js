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

let lastAudioButtonElement;
let audioPlayer = new Audio();
// Update button state on audio events
audioPlayer.addEventListener('ended', () => {
    const elBtn = lastAudioButtonElement;
    const elIcon = lastAudioButtonElement.querySelector('.icon');
    elIcon.innerText = 'play_arrow';
    elBtn.dataset.playing = false;
});
audioPlayer.addEventListener('pause', () => {
    const elBtn = lastAudioButtonElement;
    const elIcon = lastAudioButtonElement.querySelector('.icon');
    elIcon.innerText = 'play_arrow';
    elBtn.dataset.playing = false;
});
audioPlayer.addEventListener('play', () => {
    const elBtn = lastAudioButtonElement;
    const elIcon = lastAudioButtonElement.querySelector('.icon');
    elIcon.innerText = 'pause';
    elBtn.dataset.playing = true;
});
const audioButtonClick = (event, audioUrl) => {
    // Get clicked button
    const elBtn = event.currentTarget;
    // If the this button is the same as the last one, handle play/pause
    if (elBtn === lastAudioButtonElement) {
        if (elBtn.dataset.playing === "true") {
            audioPlayer.pause();
        } else {
            audioPlayer.play();
        }
        return;
    } else if (lastAudioButtonElement) {
        // Reset previous button if it differs from the current one
        lastAudioButtonElement.querySelector('.icon').innerText = 'play_arrow';
        lastAudioButtonElement.dataset.playing = false;
    }
    // Update previous button variable
    lastAudioButtonElement = elBtn;
    // Play audio
    audioPlayer.volume = 0.5;
    audioPlayer.src = audioUrl;
    audioPlayer.play();
};

// Handle image load states
const images = document.querySelectorAll('img');
images.forEach(img => {
    if (img.complete) {
        img.classList.add('loaded');
    } else {
        img.addEventListener('load', () => {
            img.classList.add('loaded');
        });
    }
});

const topbar = document.getElementById('topbar');
const btnToggleMenu = document.getElementById('navToggleMenu');

// Handle topbar scrolled state
document.addEventListener('scroll', () => {
    if (window.scrollY > 20) {
        topbar.classList.add('scrolled');
    } else {
        topbar.classList.remove('scrolled');
    }
});

// Handle topbar overflowing state
const topbarResizeObserver = new ResizeObserver(() => {
    topbar.classList.remove('overflowing');
    if (topbar.scrollWidth > topbar.clientWidth) {
        topbar.classList.add('overflowing');
    } else {
        topbar.classList.remove('open');
        topbar.style.height = '';
    }
});
topbarResizeObserver.observe(topbar);

// Handle menu toggling
btnToggleMenu.addEventListener('click', () => {
    if (topbar.classList.contains('open')) {
        topbar.classList.remove('open');
        topbar.style.height = '';
    } else {
        topbar.classList.add('open');
        topbar.style.height = 'auto';
    }
});

// Show notice if not seen
const devMsgVersion = 1;
const seenVersion = parseInt(localStorage.getItem('devNoticeVersion') || '0');
const devNoticePopup = document.getElementById('devNoticePopup');
const devNoticeClose = document.getElementById('devNoticeClose');
if (seenVersion < devMsgVersion) {
    devNoticePopup.showModal();
}

// Close notice
devNoticeClose.addEventListener('click', () => {
    devNoticePopup.close();
    localStorage.setItem('devNoticeVersion', devMsgVersion.toString());
});