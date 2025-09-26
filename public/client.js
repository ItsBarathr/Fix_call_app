const RENDER_URL = 'https://fix-call-app.onrender.com/';

const socket = io(RENDER_URL, { 
    transports: ["websocket"] 
});

// UI Elements
const myIdInput = document.getElementById('myIdInput');
const statusP = document.getElementById('status');
const userListDiv = document.getElementById('user-list');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const incomingCallBox = document.getElementById('incoming-call-box');
const callerInfoP = document.getElementById('caller-info');
const hangUpBtn = document.getElementById('hangup-btn');
const regNameInput = document.getElementById('regName');
const regEmailInput = document.getElementById('regEmail');
const regPasswordInput = document.getElementById('regPassword');
const regMessageP = document.getElementById('regMessage');

// State Variables
let myFixedId = null;
let myName = null;
let currentPeer = null; 
let localStream = null;
let incomingCallerId = null; 


function setupPeerConnection(initiator, targetId) {
    currentPeer = new SimplePeer({
        // ...
        config: { 
            iceServers: [
                // Global STUN server (free and reliable)
                { urls: 'stun:stun.l.google.com:19302' }, 
                // ⚠️ RECOMMENDED: Add a GLOBAL TURN server here 
                // { urls: 'turn:YOUR_GLOBAL_TURN_SERVER_URL', username: 'user', credential: 'password' } 
            ] 
        }
    });
    // ...
}

// --- REGISTRATION & LOGIN ---

async function registerNewUser() {
    const name = regNameInput.value.trim();
    const email = regEmailInput.value.trim();
    const password = regPasswordInput.value.trim();

    if (!name || !email || !password) {
        regMessageP.textContent = 'Please fill all fields.';
        return;
    }
    regMessageP.textContent = 'Registering...';

    try {
        const response = await fetch('/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password })
        });
        
        const data = await response.json();

        if (data.success) {
            regMessageP.textContent = `Success! Your Fixed ID is: ${data.fixed_user_id}. Name: ${data.name}. Please log in below.`;
        } else {
            regMessageP.textContent = `Registration failed: ${data.message}`;
        }
    } catch (error) {
        regMessageP.textContent = 'An error occurred during registration.';
        console.error('Registration fetch error:', error);
    }
}

function loginId() {
    const id = myIdInput.value.trim();
    if (id) {
        // Use 'login_user_id' event to authenticate and register with Socket.IO
        socket.emit('login_user_id', id);
    }
}


// --- SOCKET.IO HANDLERS ---

socket.on('login_success', (userData) => {
    myFixedId = userData.id;
    myName = userData.name;
    statusP.textContent = `Status: Online as User ${myName} (ID: ${myFixedId})`;
    myIdInput.disabled = true;
    
    // Attempt to get the media stream immediately upon successful login
    getLocalStream();
});

socket.on('login_error', (message) => {
    alert(`Login failed: ${message}`);
    statusP.textContent = 'Status: Offline';
});

// Update the list of online users
socket.on('update_user_list', (users) => {
    userListDiv.innerHTML = '';
    const otherUsers = users.filter(user => user.id !== myFixedId);
    
    if (otherUsers.length === 0) {
        userListDiv.textContent = 'No other users online.';
        return;
    }

    otherUsers.forEach(user => {
        const item = document.createElement('div');
        item.className = 'user-item online';
        item.textContent = `${user.id} (${user.name})`;
        item.onclick = () => callUser(user.id);
        userListDiv.appendChild(item);
    });
});

// Handle incoming call notification
socket.on('incoming_call', ({ callerId, callerName }) => {
    if (currentPeer) {
        // Send a busy signal back (not implemented in server.js but good practice)
        return; 
    }
    
    incomingCallerId = callerId;
    callerInfoP.textContent = `Incoming call from ${callerName} (ID ${callerId})!`;
    incomingCallBox.style.display = 'block';
});

// Handle signaling messages (Offer, Answer, ICE)
socket.on('signal', (data) => {
    // If we receive a signal and haven't created a peer yet (Callee received Offer first)
    if (!currentPeer && !myFixedId) {
        console.error('Signal received before login.');
        return;
    }
    
    if (!currentPeer && data.signal.type === 'offer') {
        // We are the callee, setup peer now to process the offer
        setupPeerConnection(false, data.senderId); 
    }
    
    if (currentPeer) {
        currentPeer.signal(data.signal);
    }
});

socket.on('call_rejected', (message) => {
    alert(message);
    hangUp();
});


// --- WEBRTC & MEDIA FUNCTIONS ---

async function getLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        return localStream;
    } catch (err) {
        console.error('Failed to get local media stream:', err);
        alert('Could not access camera and microphone. Please allow permissions.');
        return null;
    }
}

async function callUser(calleeId) {
    if (!myFixedId) return alert('Please log in first.');
    if (currentPeer) return alert('Already in a call!');

    const stream = await getLocalStream();
    if (!stream) return;

    // Initiator is true for the caller
    setupPeerConnection(true, calleeId);
    
    // Send initial call request to the server
    socket.emit('call_request', calleeId);
    
    hangUpBtn.style.display = 'block';
}

async function acceptCall() {
    incomingCallBox.style.display = 'none';
    const calleeId = incomingCallerId;
    
    const stream = await getLocalStream();
    if (!stream) return rejectCall();

    // Initiator is false for the callee. 
    // If currentPeer is null, it will be set up inside the signal handler when the offer arrives.
    if (!currentPeer) {
        // The offer might have arrived before the user clicked 'Accept'.
        // If it hasn't, the peer will be created in the signal handler when the offer arrives.
        // If it has, the peer is created, and we just need to wait for the next signal.
    }
    
    hangUpBtn.style.display = 'block';
    incomingCallerId = null; 
}

function rejectCall() {
    incomingCallBox.style.display = 'none';
    incomingCallerId = null;
    // Send a rejection signal back to the server (Optional)
    // socket.emit('call_rejected_by_callee', incomingCallerId); 
}

function hangUp() {
    if (currentPeer) {
        currentPeer.destroy(); 
        currentPeer = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localVideo.srcObject = null;
        localStream = null;
    }
    remoteVideo.srcObject = null;
    incomingCallBox.style.display = 'none';
    hangUpBtn.style.display = 'none';
    
    // Re-request local media after hanging up so the user can see their stream again.
    // getLocalStream(); 
    console.log('Call ended.');
}


function setupPeerConnection(initiator, targetId) {
    currentPeer = new SimplePeer({
        initiator: initiator,
        stream: localStream,
        config: { 
            // Google's public STUN server for NAT traversal
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] 
        }
    });

    // Simple-Peer sends signaling data (Offer/Answer/ICE)
    currentPeer.on('signal', (signal) => {
        socket.emit('signal', {
            senderId: myFixedId,
            recipientId: targetId,
            signal: signal
        });
    });

    // Remote stream received 
    currentPeer.on('stream', (stream) => {
        remoteVideo.srcObject = stream;
    });

    currentPeer.on('connect', () => {
        console.log('WebRTC P2P connection established!');
    });

    currentPeer.on('close', () => {
        console.log('Peer closed the connection');
        hangUp();
    });

    currentPeer.on('error', (err) => {
        console.error('Peer error:', err);
        hangUp();
    });
}
