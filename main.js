import QRCode from 'qrcode';
import { createClient } from '@supabase/supabase-js';

// Supabase Configuration
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// State Management
let currentStep = 1;
const state = {
    isDownloaded: false,
    entries: [],
    hasRegistered: false
};

// UI Elements
const steps = document.querySelectorAll('.step');
const downloadBtn = document.getElementById('download-btn');
const registrationForm = document.getElementById('registration-form');
const rouletteList = document.getElementById('roulette-list');
const entryCountDisplay = document.getElementById('entry-count');
const winnerModal = document.getElementById('winner-modal');
const winnerDisplay = document.getElementById('winner-display');

// Roulette Elements
const canvas = document.getElementById('wheel-canvas');
const ctx = canvas?.getContext('2d');
const soundTick = document.getElementById('sound-tick');
const soundWin = document.getElementById('sound-win');
const rouletteStatus = document.getElementById('roulette-status');

// Roulette State
let names = ["Join the Contest!"];
let isSpinning = false;
let rotation = 0;
let spinSpeed = 0;
let targetAngle = 0;

// Initialize
init();

async function init() {
    console.log("Initializing BisayaFlix Giveaway...");
    if (!supabaseUrl || !supabaseAnonKey) {
        console.error("Supabase config missing! Check Environment Variables.");
        return;
    }
    
    generateQRCode();
    try {
        await fetchInitialEntries();
        subscribeToChanges();
        
        if (canvas) {
            drawWheel();
            animate();
        }
    } catch (e) {
        console.error("Initialization failed:", e);
    }
}

function generateQRCode() {
    const qrContainer = document.getElementById('qrcode');
    if (!qrContainer) return;
    
    QRCode.toCanvas(window.location.href, {
        width: 150,
        margin: 2,
        color: { dark: '#08090b', light: '#ffffff' }
    }, (error, canvas) => {
        if (error) console.error(error);
        qrContainer.appendChild(canvas);
    });
}

// Logic: Fetch and Real-time Sync
async function fetchInitialEntries() {
    const { data, error } = await supabase
        .from('registrations')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching entries:', error);
        return;
    }

    state.entries = data;
    names = data.length > 0 ? data.map(r => r.full_name) : ["Join the Contest!"];
    updateEntryCount();
    renderEntries();
}

function subscribeToChanges() {
    // 1. Listen for new registrations
    supabase
        .channel('registrations-channel')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'registrations' }, payload => {
            const newEntry = payload.new;
            state.entries.unshift(newEntry);
            names.unshift(newEntry.full_name);
            addEntryToRoulette(newEntry);
            updateEntryCount();
        })
        .subscribe();

    // 2. Listen for Admin "Spin" triggers
    supabase
        .channel('roulette-room')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'giveaway_state' }, payload => {
            const status = payload.new;
            if (status.is_spinning && !isSpinning) {
                startSpin(status.current_prize, status.winner_name);
            }
        })
        .subscribe();
}

// Logic: Step Transitions
function showStep(stepNumber) {
    steps.forEach((step, index) => {
        const stepIndex = index + 1;
        if (stepIndex === stepNumber) {
            step.classList.add('active');
        } else if (stepNumber === 2 && stepIndex === 1) {
            // Keep Step 1 visible when Step 2 (modal) is active
            step.classList.add('active');
        } else {
            step.classList.remove('active');
        }
    });
    currentStep = stepNumber;
}

// Step 1: Download
downloadBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const storeLink = downloadBtn.href;
    state.isDownloaded = true;
    showStep(2);
    downloadBtn.textContent = "🚀 Opening Google Play...";
    downloadBtn.classList.add('btn-outline');

    setTimeout(() => {
        window.open(storeLink, '_blank');
        setTimeout(() => {
            downloadBtn.textContent = "👉 Open Store & Take Screenshot";
        }, 3000);
    }, 1000);
});

// Step 2: Registration (No Screenshot Upload)
registrationForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = registrationForm.querySelector('button');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Joining Live Draw...';

    try {
        const name = document.getElementById('full-name').value;
        const email = document.getElementById('email').value;
        const phone = document.getElementById('phone').value;

        // 1. Insert Record into Database
        const { error: insertError } = await supabase
            .from('registrations')
            .insert([{ 
                full_name: name, 
                email: email, 
                phone: phone
            }]);

        if (insertError) throw insertError;

        // 2. Sync to Google Sheets
        const sheetsUrl = import.meta.env.VITE_GOOGLE_SHEETS_URL;
        if (sheetsUrl) {
            fetch(sheetsUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ full_name: name, email: email, phone: phone })
            }).catch(e => console.error("Sheets Sync Error:", e));
        }

        showStep(3);
        
        setTimeout(() => {
            alert("✅ Successfully Registered! Remember: Save the screenshot that you downloaded the app for proof to show us when you win!!");
        }, 500);

        confetti({
            particleCount: 150,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#c5a059', '#e50914', '#ffffff']
        });

    } catch (err) {
        alert('Giveaway Error: ' + err.message);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Retry Registration';
    }
});

// Roulette Wheel Logic
function drawWheel() {
    if (!ctx) return;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = centerX - 10;
    const step = (Math.PI * 2) / names.length;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    names.forEach((name, i) => {
        const startAngle = rotation + i * step;
        const endAngle = startAngle + step;

        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.arc(centerX, centerY, radius, startAngle, endAngle);
        ctx.closePath();

        ctx.fillStyle = i % 2 === 0 ? '#1a1a1a' : '#111';
        ctx.fill();
        ctx.strokeStyle = '#333';
        ctx.stroke();

        // Draw Name (smoother and auto-adjusting)
        if (names.length < 60) {
            ctx.save();
            ctx.translate(centerX, centerY);
            ctx.rotate(startAngle + step / 2);
            ctx.textAlign = 'right';
            ctx.fillStyle = i % 2 === 0 ? '#c5a059' : '#fff';
            ctx.font = `bold ${Math.max(12, 24 - names.length/5)}px Outfit`;
            ctx.fillText(name.substring(0, 12), radius - 30, 5);
            ctx.restore();
        }
    });

    // Draw Smooth Outer Ring
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#c5a059';
    ctx.lineWidth = 5;
    ctx.stroke();
}

function startSpin(prize, winnerName) {
    if (isSpinning) return;
    isSpinning = true;
    if (rouletteStatus) rouletteStatus.textContent = `🎰 SPINNING FOR: ${prize}`;
    spinSpeed = 0.5 + Math.random() * 0.1;
    
    const winnerIndex = names.indexOf(winnerName);
    if (winnerIndex !== -1) {
        const step = (Math.PI * 2) / names.length;
        const winnerCenter = winnerIndex * step + (step / 2);
        targetAngle = (Math.PI * 1.5) - winnerCenter;
    }
}

function animate() {
    if (isSpinning) {
        rotation += spinSpeed;
        if (spinSpeed > 0.01) {
            spinSpeed *= 0.985;
            if (Math.sin(rotation * names.length) > 0.9) {
                if (soundTick) { soundTick.currentTime = 0; soundTick.play(); }
            }
        } else {
            isSpinning = false;
            spinSpeed = 0;
            finalizeWinner();
        }
    } else {
        rotation += 0.002;
    }
    drawWheel();
    requestAnimationFrame(animate);
}

function finalizeWinner() {
    if (soundWin) soundWin.play();
    supabase.from('giveaway_state').select('*').eq('id', 1).single().then(({ data }) => {
        winnerDisplay.textContent = data.winner_name;
        winnerModal.style.display = 'flex';
        if (rouletteStatus) rouletteStatus.textContent = "Waiting for next spin...";
        confetti({ particleCount: 300, spread: 160, origin: { y: 0.5 } });
    });
}

// UI Helpers
function addEntryToRoulette(entry) {
    const item = document.createElement('div');
    item.className = 'entry-item';
    item.innerHTML = `
        <span class="entry-name">${entry.full_name}</span>
        <span class="entry-time">${new Date(entry.created_at).toLocaleTimeString()}</span>
    `;
    rouletteList?.prepend(item);
}

function renderEntries() {
    if (!rouletteList) return;
    rouletteList.innerHTML = '';
    [...state.entries].forEach(addEntryToRoulette);
}

function updateEntryCount() {
    if (entryCountDisplay) entryCountDisplay.textContent = state.entries.length;
}

// Winner Selection (Admin Trigger Bypass for UI)
const adminBtn = document.getElementById('admin-trigger');
adminBtn?.addEventListener('dblclick', () => {
    if (state.entries.length === 0) return;
    startSpin("Manual Test", state.entries[0].full_name);
});

window.closeModal = () => { winnerModal.style.display = 'none'; };
