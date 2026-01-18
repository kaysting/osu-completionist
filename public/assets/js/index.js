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
    audioPlayer.volume = parseFloat(localStorage.getItem('mapPreview')) || 0.5;
    audioPlayer.src = audioUrl;
    audioPlayer.play();
};
const audioVolumeSet = volume => {
    volume = Math.min(1, Math.max(0, volume));
    localStorage.setItem('mapPreview', volume.toString());
    audioPlayer.volume = volume;
};
const audioVolumeDown = () => {
    let volume = parseFloat(localStorage.getItem('mapPreview')) || 0.5;
    audioVolumeSet(volume - 0.1);
};
const audioVolumeUp = () => {
    let volume = parseFloat(localStorage.getItem('mapPreview')) || 0.5;
    audioVolumeSet(volume + 0.1);
};