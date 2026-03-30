import QRCode from 'qrcode';
import { createClient } from '@supabase/supabase-js';

// Supabase Configuration
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
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
        .order('created_at', { ascending: false })
        .limit(50);

    if (error) {
        console.error('Error fetching entries:', error);
        return;
    }

    state.entries = data;
    updateEntryCount();
    renderEntries();
}

function subscribeToChanges() {
    supabase
        .channel('registrations-channel')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'registrations' }, payload => {
            const newEntry = payload.new;
            state.entries.unshift(newEntry);
            addEntryToRoulette(newEntry);
            updateEntryCount();
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
    e.preventDefault(); // Prevent immediate navigation
    const storeLink = downloadBtn.href;

    // 1. Show Step 2 instantly for better mobile experience
    state.isDownloaded = true;
    showStep(2);
    
    // 2. Change button text during the transition
    downloadBtn.textContent = "🚀 Opening Google Play...";
    downloadBtn.classList.add('btn-outline');

    // 3. Trigger Store Redirect after a 1000ms (1 second) delay
    // This gives the user time to see the Form Pop-up first.
    setTimeout(() => {
        window.open(storeLink, '_blank');
        
        // Reset button text after navigation
        setTimeout(() => {
            downloadBtn.textContent = "👉 Open Store & Take Screenshot";
        }, 3000);
    }, 1000);
});

// Step 2: Registration & Upload
registrationForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = registrationForm.querySelector('button');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Uploading...';

    try {
        const name = document.getElementById('full-name').value;
        const email = document.getElementById('email').value;
        const phone = document.getElementById('phone').value;
        const fileInput = document.getElementById('screenshot');
        const file = fileInput.files[0];

        if (!supabaseUrl || !supabaseAnonKey) {
            throw new Error("Supabase Config Error: URL or Key is missing from Environment Variables.");
        }

        // 1. Upload Screenshot to Supabase Storage
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
        const filePath = `entries/${fileName}`;

        console.log("Attempting upload to bucket 'screenshots'...");
        const { data: uploadData, error: uploadError } = await supabase.storage
            .from('screenshots')
            .upload(filePath, file);

        if (uploadError) {
            console.error("Upload Error Details:", uploadError);
            throw new Error(`Upload Failed: ${uploadError.message}. Make sure the 'screenshots' bucket exists and is Public.`);
        }

        const { data: { publicUrl } } = supabase.storage
            .from('screenshots')
            .getPublicUrl(filePath);

        // 2. Insert Record into Database
        console.log("Attempting database entry for:", name);
        const { error: insertError } = await supabase
            .from('registrations')
            .insert([{ 
                full_name: name, 
                email: email, 
                phone: phone, 
                screenshot_url: publicUrl 
            }]);

        if (insertError) {
            console.error("Database Error Details:", insertError);
            throw new Error(`Registration Failed: ${insertError.message}. Check your table permissions (RLS).`);
        }

        showStep(3);
        confetti({
            particleCount: 150,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#c5a059', '#e50914', '#ffffff']
        });

    } catch (err) {
        console.error("FULL ERROR:", err);
        alert('Giveaway Error: ' + err.message);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Retry Registration';
    }
});

// Roulette Simulation
function addEntryToRoulette(entry) {
    const item = document.createElement('div');
    item.className = 'entry-item';
    item.innerHTML = `
        <span class="entry-name">${entry.full_name}</span>
        <span class="entry-time">${new Date(entry.created_at).toLocaleTimeString()}</span>
    `;
    rouletteList.prepend(item);
}

function renderEntries() {
    rouletteList.innerHTML = '';
    [...state.entries].forEach(addEntryToRoulette);
}

function updateEntryCount() {
    if (entryCountDisplay) {
        entryCountDisplay.textContent = state.entries.length;
    }
}

// Winner Selection (Admin)
const adminBtn = document.getElementById('admin-trigger');
adminBtn.addEventListener('dblclick', () => {
    if (state.entries.length === 0) {
        alert("No entries yet!");
        return;
    }
    startWinnerSequence();
});

function startWinnerSequence() {
    let count = 0;
    const interval = setInterval(() => {
        const randomIndex = Math.floor(Math.random() * state.entries.length);
        winnerDisplay.textContent = state.entries[randomIndex].full_name;
        count++;
        if (count > 20) {
            clearInterval(interval);
            showFinalWinner();
        }
    }, 100);
}

function showFinalWinner() {
    const finalWinner = state.entries[Math.floor(Math.random() * state.entries.length)];
    winnerDisplay.textContent = finalWinner.full_name;
    winnerModal.style.display = 'flex';
    confetti({
        particleCount: 300,
        spread: 160,
        origin: { y: 0.5 },
        colors: ['#c5a059', '#f1c40f']
    });
}

window.closeModal = () => {
    winnerModal.style.display = 'none';
};
