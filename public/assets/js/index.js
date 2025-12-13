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
    // Change icon of previous button to play
    if (lastAudioButtonElement) {
        lastAudioButtonElement.querySelector('.icon').innerText = 'play_arrow';
    }
    // If the this button is the same as the last one, handle play/pause
    if (elBtn === lastAudioButtonElement) {
        if (elBtn.dataset.playing === "true") {
            audioPlayer.pause();
        } else {
            audioPlayer.play();
        }
        return;
    }
    // Update previous button variable
    lastAudioButtonElement = elBtn;
    // Play audio
    audioPlayer.volume = 0.5;
    audioPlayer.src = audioUrl;
    audioPlayer.play();
};