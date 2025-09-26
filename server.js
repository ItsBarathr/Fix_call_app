const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// 🎯 DATABASE SIMULATION 🎯
// Replaces a permanent database (e.g., PostgreSQL/MongoDB). 
// Key: Fixed User ID. Value: User Data.
let nextUserId = 1004;
const USER_DB = {
    '1001': { id: '1001', name: 'Barath', email: 'barath@example.com', password: 'password_1' },
    '1002': { id: '1002', name: 'John', email: 'john@example.com', password: 'password_2' },
    '1003': { id: '1003', name: 'Jane', email: 'jane@example.com', password: 'password_3' },
};

// Runtime map: Fixed User ID -> Socket ID (ONLY for currently connected users)
const activeUsers = {}; 

app.use(express.json()); // Middleware to parse incoming JSON bodies
app.use(express.static('public')); // Serve static files from the 'public' folder

// 📌 HTTP ROUTE: NEW USER REGISTRATION
app.post('/register', (req, res) => {
    const { name, email, password } = req.body;

    // Check if user already exists
    if (Object.values(USER_DB).some(user => user.email === email)) {
        return res.status(409).json({ success: false, message: 'Email already registered.' });
    }

    // Generate a new Fixed User ID
    const newId = String(nextUserId++);
    
    // Store new user in the "database" (In production: Hash the password!)
    const newUser = {
        id: newId,
        name: name,
        email: email,
        password: password, 
    };
    USER_DB[newId] = newUser;

    console.log(`New user registered: ID ${newId}, Name: ${name}`);
    res.json({ success: true, fixed_user_id: newId, name: name, message: 'Registration successful. Use this ID to log in.' });
});


// 📌 SOCKET.IO: REAL-TIME COMMUNICATION
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // [1] USER LOGIN
    socket.on('login_user_id', (fixedUserId) => {
        const user = USER_DB[fixedUserId];

        if (user) {
            // User found in DB. Mark them as active.
            activeUsers[fixedUserId] = socket.id;
            socket.fixedUserId = fixedUserId; // Store ID on socket object
            
            console.log(`User ${user.name} (ID: ${fixedUserId}) logged in.`);
            
            // Send login success and user data back to client
            socket.emit('login_success', user);

            // Notify all clients to update their online list
            io.emit('update_user_list', Object.keys(activeUsers).map(id => ({ 
                id: id, 
                name: USER_DB[id].name 
            })));
            
        } else {
            console.log(`Login failed for unknown ID: ${fixedUserId}`);
            socket.emit('login_error', 'Invalid Fixed User ID');
        }
    });

    // [2] CALL REQUEST (Initial signal)
    socket.on('call_request', (calleeId) => {
        const callerId = socket.fixedUserId;
        const calleeSocketId = activeUsers[calleeId];
        const callerName = USER_DB[callerId]?.name || 'Unknown User';

        if (!callerId) return socket.emit('error', 'Please log in first.');
        
        if (calleeSocketId) {
            console.log(`Call request from ${callerId} to ${calleeId}`);
            // Forward the call notification to the callee's specific socket
            io.to(calleeSocketId).emit('incoming_call', { callerId, callerName });
        } else {
            socket.emit('call_rejected', `${calleeId} is currently offline.`);
        }
    });
    
    // [3] GENERAL SIGNAL RELAY (Offer, Answer, ICE Candidates)
    socket.on('signal', (data) => {
        const calleeSocketId = activeUsers[data.recipientId];
        
        if (calleeSocketId) {
            io.to(calleeSocketId).emit('signal', { 
                senderId: data.senderId,
                signal: data.signal 
            });
        }
    });

    // [4] DISCONNECT / LOGOUT
    socket.on('disconnect', () => {
        if (socket.fixedUserId) {
            delete activeUsers[socket.fixedUserId];
            
            // Update user list
            io.emit('update_user_list', Object.keys(activeUsers).map(id => ({ 
                id: id, 
                name: USER_DB[id].name 
            })));
            console.log(`User ${socket.fixedUserId} unregistered.`);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Signaling Server running on http://localhost:${PORT}`);
    console.log(`Pre-registered users: 1001, 1002, 1003`);
});