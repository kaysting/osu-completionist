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

const showPopup = (title, body, actions, closedby = 'none') => {
    // Build base dialog element
    const dialog = document.createElement('dialog');
    dialog.classList.add('popup');
    dialog.innerHTML = /*html*/`
        <div class="title"></div>
        <div class="body"></div>
        <div class="actions"></div>
    `;
    dialog.closedby = closedby;
    // Populate dialog
    dialog.querySelector('.title').innerText = title;
    // Populate body
    if (typeof body === 'string') {
        dialog.querySelector('.body').innerHTML = body;
    } else {
        dialog.querySelector('.body').appendChild(body);
    }
    // Populate actions
    const actionsContainer = dialog.querySelector('.actions');
    for (const action of actions) {
        const btn = document.createElement(action.href ? 'a' : 'button');
        btn.classList = `btn medium ${action.class}`;
        if (action.class == 'primary')
            btn.autofocus = true;
        btn.innerText = action.label;
        if (action.href) {
            btn.href = action.href;
            if (action.newTab) {
                btn.target = '_blank';
            }
        }
        btn.addEventListener('click', event => {
            if (action.onClick) action.onClick(dialog);
            if (action.noClose) return;
            dialog.close(event);
        });
        actionsContainer.appendChild(btn);
    }
    // Show dialog
    document.body.appendChild(dialog);
    dialog.showModal();
    // Delete on close
    dialog.addEventListener('close', () => {
        document.body.removeChild(dialog);
    });
    // Return
    return dialog;
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