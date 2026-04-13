import QRCode from 'qrcode';
import { createClient } from '@supabase/supabase-js';
import confetti from 'canvas-confetti';

// Supabase Configuration
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Easy Configuration: Change Slider Photos Here
const SLIDER_CONFIG = {
    images: [
        '/cookies.png',
        '/jayrsiaboc.png',
        '/midnasty.png',
        '/mistalefty.png',
        '/winstonlee.png',
        '/6.png',
        '/atoni16specialperformance.png',
        '/atoni16.png'
    ]
};

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
let spinStartTime = 0;
const SPIN_DURATION = 8000; // 8 seconds
let startRotation = 0;
let totalRotation = 0;

let idleTimer = null;
let lastActionTime = Date.now();

// Initialize
init();

async function init() {
    console.log("🚀 Initializing BisayaFlix Giveaway...");
    if (!supabaseUrl || !supabaseAnonKey) {
        console.error("❌ CRITICAL: Supabase config missing! Check your Vercel Environment Variables or local .env file.");
        alert("Giveaway System is not connected. Please check configuration.");
        return;
    }
    console.log("✅ Supabase Connected to:", supabaseUrl);
    
    generateQRCode();
    renderSlider(); // Render slider from config
    try {
        await fetchInitialEntries();
        await fetchRecentWinners();
        // fetchPrizes(); // Removed in favor of static Giveaway.png
        subscribeToChanges();
        if (canvas) {
            setupCanvas(canvas);
            drawWheel();
            animate();
        }
    } catch (e) {
        console.error("❌ Initialization failed:", e);
    }
}

function renderSlider() {
    const track = document.getElementById('slider-track');
    if (!track) return;
    
    // Create the images from config
    const imagesHtml = SLIDER_CONFIG.images.map(src => `<img src="${src}" alt="Highlight">`).join('');
    track.innerHTML = imagesHtml;
    
    // Adjust track width based on image count
    track.style.width = `${SLIDER_CONFIG.images.length * 100}%`;
    
    // Update CSS animation if needed (though the CSS is hardcoded for 8 images, 
    // we'll keep it simple for now as per user request to change photos easily)
}

function setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return ctx;
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

async function fetchPrizes() {
    const { data, error } = await supabase
        .from('prizes')
        .select('*')
        .order('name', { ascending: true });

    if (error) {
        console.error('Error fetching prizes:', error);
        return;
    }

    renderPrizes(data);
}

function renderPrizes(prizes) {
    // Disabled: Using static Giveaway.png in index.html
    return;
}

function subscribeToChanges() {
    // 1. Listen for new registrations to keep names in sync
    supabase
        .channel('registrations-feed')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'registrations' }, payload => {
            const newEntry = payload.new;
            console.log("New registration received (main):", newEntry.full_name);
            
            state.entries.unshift(newEntry);
            
            // Fix: remove placeholder if it's the first real entry
            if (names[0] === "Join the Contest!") names = [];
            names.unshift(newEntry.full_name);
            
            addEntryToRoulette(newEntry);
            updateEntryCount();
            if (canvas) drawWheel();
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'registrations' }, payload => {
            console.log("Entry deleted (main). Refreshing...");
            fetchInitialEntries().then(() => { if (canvas) drawWheel(); });
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations' }, payload => {
            if (payload.eventType === 'DELETE' || payload.eventType === 'TRUNCATE') {
                console.log("Full Wipe detected (main).");
                state.entries = [];
                names = ["Join the Contest!"];
                updateEntryCount();
                renderEntries();
                if (canvas) drawWheel();
            }
        })
        .subscribe(status => console.log('Main Registrations Sync:', status));

    // 2. Listen for Admin "Spin" triggers
    supabase
        .channel('giveaway-control')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'giveaway_state' }, payload => {
            const status = payload.new;
            if (status.is_spinning && !isSpinning) {
                startSpin(status.current_prize, status.winner_name);
            }
        })
        .subscribe();

    // 3. Listen for new winners
    supabase
        .channel('winners-feed')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'winners' }, payload => {
            console.log("New winner announced:", payload.new.winner_name);
            renderWinnerItem(payload.new, true);
        })
        .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'winners' }, () => {
            fetchRecentWinners();
        })
        .subscribe();

    // 4. Listen for prize updates
    supabase
        .channel('prizes-feed')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'prizes' }, () => {
            fetchPrizes();
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

// Step 2: Registration (With Screenshot Upload)
const screenshotInput = document.getElementById('screenshot-file');
const filePreview = document.getElementById('file-preview');

screenshotInput?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file && filePreview) {
        const reader = new FileReader();
        reader.onload = (event) => {
            filePreview.innerHTML = `<img src="${event.target.result}" alt="Preview">`;
            filePreview.classList.add('has-image');
        };
        reader.readAsDataURL(file);
    }
});

registrationForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = registrationForm.querySelector('button');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Uploading Screenshot...';

    try {
        const name = document.getElementById('full-name').value;
        const email = document.getElementById('email').value;
        const phone = document.getElementById('phone').value;
        const screenshotFile = screenshotInput.files[0];

        if (!screenshotFile) throw new Error("Please select a screenshot first!");

        // 1. Upload Screenshot to Supabase Storage
        const fileExt = screenshotFile.name.split('.').pop();
        const fileName = `${Date.now()}_${name.replace(/\s+/g, '_')}.${fileExt}`;
        const filePath = `entries/${fileName}`;

        const { error: uploadError } = await supabase.storage
            .from('screenshots')
            .upload(filePath, screenshotFile);

        if (uploadError) throw new Error("Upload Failed: " + uploadError.message);

        const { data: { publicUrl } } = supabase.storage
            .from('screenshots')
            .getPublicUrl(filePath);

        // 2. Insert Record into Database
        submitBtn.textContent = 'Saving Registration...';
        const { error: insertError } = await supabase
            .from('registrations')
            .insert([{ 
                full_name: name, 
                email: email, 
                phone: phone,
                screenshot_url: publicUrl
            }]);

        if (insertError) throw insertError;

        // 3. Sync to Google Sheets
        const sheetsUrl = import.meta.env.VITE_GOOGLE_SHEETS_URL;
        if (sheetsUrl && sheetsUrl.includes('script.google.com')) {
            console.log("Syncing to Google Sheets...");
            fetch(sheetsUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ 
                    full_name: name, 
                    email: email, 
                    phone: phone,
                    screenshot_url: publicUrl,
                    timestamp: new Date().toISOString()
                })
            });
        }

        showStep(3);
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
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const radius = Math.min(centerX, centerY) - 10;
    const step = (Math.PI * 2) / names.length;

    ctx.clearRect(0, 0, rect.width, rect.height);

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

        // Improved Name Rendering (Dynamic Scale + Multi-line)
        if (names.length < 300) {
            ctx.save();
            ctx.translate(centerX, centerY);
            ctx.rotate(startAngle + step / 2);
            ctx.textAlign = 'right';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = i % 2 === 0 ? '#c5a059' : '#fff';
            
            // Subtle shadow for that "smooth" high-end feel
            ctx.shadowColor = 'rgba(0,0,0,0.3)';
            ctx.shadowBlur = 2;
            
            // 1. Initial Font Size Calculation
            let fontSize = Math.max(9, 24 - names.length/4);
            
            // 2. Prep Text (Split if long and has space)
            const cleanName = name.toUpperCase().trim();
            const words = cleanName.split(' ');
            let lines = [cleanName];
            
            if (cleanName.length > 14 && words.length > 1) {
                const mid = Math.ceil(words.length / 2);
                lines = [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
            }

            // 3. Final Shrink-to-Fit Check
            ctx.font = `800 ${fontSize}px Inter`;
            let maxWidth = radius - 50; 
            let currentMaxWidth = 0;
            lines.forEach(l => {
                const w = ctx.measureText(l).width;
                if (w > currentMaxWidth) currentMaxWidth = w;
            });

            if (currentMaxWidth > maxWidth) {
                fontSize *= (maxWidth / currentMaxWidth);
                ctx.font = `800 ${fontSize}px Inter`;
            }

            // 4. Draw!
            if (lines.length > 1) {
                const spacing = fontSize * 0.6;
                ctx.fillText(lines[1], radius - 30, spacing);
                ctx.fillText(lines[0], radius - 30, -spacing);
            } else {
                ctx.fillText(lines[0], radius - 30, 0);
            }
            
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
    
    // Ensure names are fresh before calculation
    fetchInitialEntries().then(() => {
        isSpinning = true;
        spinStartTime = Date.now();
        startRotation = rotation % (Math.PI * 2);
        lastActionTime = Date.now();
        
        if (rouletteStatus) rouletteStatus.textContent = `🎰 SPINNING FOR: ${prize}`;
        
        const winnerIndex = names.indexOf(winnerName);
        if (winnerIndex !== -1) {
            const step = (Math.PI * 2) / names.length;
            
            // Goal: land with pointer (1.5 * PI) at winnerCenter
            // We want the winner's slice center to be exactly at 1.5 * PI (270 degrees)
            // The position of the winner slice is winnerIndex * step
            const winnerCenter = (winnerIndex * step) + (step / 2);
            
            // The rotation needed to bring winnerCenter to 1.5 * PI is:
            targetAngle = (Math.PI * 1.5) - winnerCenter;
            
            // Normalize target
            while (targetAngle < 0) targetAngle += Math.PI * 2;
            targetAngle %= Math.PI * 2;

            // Total rotation: current + some full spins + distance to target
            // More spins (7-12) for higher velocity feel
            const extraSpins = 7 + Math.floor(Math.random() * 5);
            let dist = targetAngle - startRotation;
            while (dist < 0) dist += Math.PI * 2;
            
            totalRotation = (extraSpins * Math.PI * 2) + dist;
        }
    });
}

function animate() {
    const now = Date.now();
    
    if (isSpinning) {
        const elapsed = now - spinStartTime;
        const progress = Math.min(elapsed / SPIN_DURATION, 1);
        
        // Quintic out for much smoother, more "natural" glide to stop
        const easeOutQuint = 1 - Math.pow(1 - progress, 5);
        
        rotation = startRotation + (totalRotation * easeOutQuint);

        // Sound tick based on steps - adjust volume based on speed
        const currentStep = Math.floor((rotation * names.length) / (Math.PI * 2));
        if (currentStep !== animate.lastStep) {
            if (soundTick) { 
                soundTick.currentTime = 0; 
                // Fade out sound as it slows down
                soundTick.volume = Math.max(0.1, 1 - progress);
                soundTick.play().catch(() => {}); 
            }
            animate.lastStep = currentStep;
        }

        if (progress >= 1) {
            isSpinning = false;
            finalizeWinner();
        }
    } else {
        // Idle slow rotation
        const idleSpeed = (now - lastActionTime > 10000) ? 0.01 : 0.002;
        rotation += idleSpeed;
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

// Winner UI Helpers
async function fetchRecentWinners() {
    const { data, error } = await supabase
        .from('winners')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

    if (error) {
        console.error('Error fetching winners:', error);
        return;
    }

    const winnersFeed = document.getElementById('winners-feed');
    if (!winnersFeed) return;
    
    winnersFeed.innerHTML = '';
    if (data.length === 0) {
        winnersFeed.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 1rem;">No winners yet. Be the first!</p>';
        return;
    }

    // Since we fetch DESC, we append them in that order to keep newest at top
    data.forEach(w => renderWinnerItem(w, false));
}

function renderWinnerItem(w, isNew = false) {
    const winnersFeed = document.getElementById('winners-feed');
    if (!winnersFeed) return;

    // Deduplication check
    if (document.getElementById(`winner-${w.id}`)) return;

    // Remove placeholder if exists
    const placeholder = winnersFeed.querySelector('p');
    if (placeholder && placeholder.textContent.includes("No winners yet")) {
        winnersFeed.innerHTML = '';
    }

    const item = document.createElement('div');
    item.id = `winner-${w.id}`;
    item.className = 'winner-item';
    const time = new Date(w.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    item.innerHTML = `
        <div class="winner-info">
            <span class="winner-name-text">${w.winner_name}</span>
            <span class="winner-prize-text">Won: ${w.prize_won}</span>
        </div>
        <span class="winner-timestamp">${time}</span>
    `;

    if (isNew) {
        winnersFeed.prepend(item);
    } else {
        winnersFeed.appendChild(item);
    }
}

// UI Helpers
function addEntryToRoulette(entry) {
    const item = document.createElement('div');
    item.className = 'entry-item new-entry-flash';
    item.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 8px; height: 8px; background: var(--primary-gold); border-radius: 50%;"></div>
            <span class="entry-name">${entry.full_name}</span>
        </div>
        <span class="entry-time">${new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
    `;
    rouletteList?.prepend(item);
    
    // Remove flash class after animation finishes
    setTimeout(() => item.classList.remove('new-entry-flash'), 2000);
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
