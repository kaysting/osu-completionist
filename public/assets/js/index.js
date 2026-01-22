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

const renderGraph = (canvasElement, opts) => {
    const ctx = canvasElement.getContext('2d');
    const datasets = [];
    for (const dataset of opts.datasets) {
        const hue = dataset.hue || 150;
        const gradient = ctx.createLinearGradient(0, 0, 0, 100);
        gradient.addColorStop(0, `hsla(${hue}, 90%, 60%, 20%)`);
        gradient.addColorStop(1, `hsla(${hue}, 90%, 60%, 0%)`);
        datasets.push({
            data: dataset.values,
            backgroundColor: gradient,
            borderColor: `hsl(${hue}, 90%, 60%)`,
            borderWidth: 2,
            pointRadius: 0,
            fill: true,
            tension: 0.3
        });
    }
    const chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: opts.labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            // Disable the load animation but keep tooltip animations
            animation: {
                duration: 0
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    displayColors: false,
                    cornerRadius: 8,
                    padding: 8,
                    titleMarginBottom: 2,
                    backgroundColor: 'hsl(220, 20%, 8%)',
                    titleFont: {
                        size: 12,
                        weight: 600,
                        family: 'Torus'
                    },
                    bodyFont: {
                        size: 16,
                        weight: 'normal',
                        family: 'Torus'
                    },
                    titleColor: `hsl(220, 20%, 65%)`,
                    bodyColor: `hsl(220, 20%, 90%)`,
                    callbacks: {
                        label: opts.tooltipCallbacks.label || (context => context.parsed.y.toString()),
                        title: opts.tooltipCallbacks.title || (context => `${context[0].label}`)
                    }
                }
            },
            scales: {
                x: { display: false },
                y: { display: false }
            },
            layout: {
                padding: 0
            }
        }
    });
    return chart;
};