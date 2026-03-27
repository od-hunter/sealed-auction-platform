const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { Server, Keypair, TransactionBuilder, Networks, BASE_FEE, Asset } = require('stellar-sdk');


const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Security middleware
app.use(helmet());

// Security monitoring endpoint (admin only)
app.get('/api/security/stats', (req, res) => {
  try {
    // In production, add admin authentication here
    const stats = db.getSecurityStats();
    res.json(stats);
  } catch (error) {
    console.error('Error getting security stats:', error);
    res.status(500).json({ error: 'Failed to get security stats' });
  }
});

app.get('/api/security/logs', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    // In production, add admin authentication here
    const logs = db.getQueryLog(limit);
    res.json(logs);
  } catch (error) {
    console.error('Error getting query logs:', error);
    res.status(500).json({ error: 'Failed to get query logs' });
  }
});

// Restrictive CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:3000', 'http://localhost:3001'];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  maxAge: 86400 // 24 hours
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.static('public'));

// Session middleware for OAuth
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-session-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Backup directory
const backupDir = path.join(__dirname, 'backups');

// In-memory storage (in production, use a proper database)
let auctions = new Map();
let bids = new Map();
let users = new Map();

// Auction class
class Auction {
  constructor(id, title, description, startingBid, endTime, creator) {
    this.id = id;
    this.title = title;
    this.description = description;
    this.startingBid = startingBid;
    this.currentHighestBid = startingBid;
    this.endTime = endTime;
    this.creator = creator;
    this.status = 'active';
    this.bids = [];
    this.winner = null;
    this.winningBid = null;
    this.createdAt = new Date();
  }

  addBid(bid) {
    this.bids.push(bid);
    if (bid.amount > this.currentHighestBid) {
      this.currentHighestBid = bid.amount;
    }
  }

  close() {
    this.status = 'closed';
    if (this.bids.length > 0) {
      const winningBid = this.bids.reduce((prev, current) => 
        prev.amount > current.amount ? prev : current
      );
      this.winner = winningBid.bidderId;
      this.winningBid = winningBid;
    }
  }
}

// Bid class
class Bid {
  constructor(id, auctionId, bidderId, amount, encryptedBid) {
    this.id = id;
    this.auctionId = auctionId;
    this.bidderId = bidderId;
    this.amount = amount;
    this.encryptedBid = encryptedBid;
    this.timestamp = new Date();
    this.revealed = false;
  }
}

// User class
class User {
  constructor(id, username, hashedPassword, email = null, provider = null, providerId = null) {
    this.id = id;
    this.username = username;
    this.hashedPassword = hashedPassword;
    this.email = email;
    this.provider = provider;
    this.providerId = providerId;
    this.createdAt = new Date();
  }
}

// Helper functions
function generateAuctionId() {
  return uuidv4();
}

// JWT Authentication Middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  if (tokenBlacklist.has(token)) {
    return res.status(401).json({ error: 'Token has been revoked' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// Generate JWT Token
function generateToken(user) {
  return jwt.sign(
    { userId: user.id, username: user.username },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function encryptBid(bidAmount, secretKey) {
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(secretKey, 'salt', 32);
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(bidAmount.toString(), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return {
    encrypted,
    iv: iv.toString('hex')
  };
}

function decryptBid(encryptedData, secretKey) {
  const algorithm = 'aes-256-cbc';
  const key = crypto.scryptSync(secretKey, 'salt', 32);
  const iv = Buffer.from(encryptedData.iv, 'hex');
  
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return parseFloat(decrypted);
}

// --- Backup and Restore ---
function backupData() {
  try {
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    fs.writeFileSync(path.join(backupDir, 'auctions.json'), JSON.stringify(Array.from(auctions.entries()), null, 2));
    fs.writeFileSync(path.join(backupDir, 'bids.json'), JSON.stringify(Array.from(bids.entries()), null, 2));
    fs.writeFileSync(path.join(backupDir, 'users.json'), JSON.stringify(Array.from(users.entries()), null, 2));
    console.log(`[${new Date().toISOString()}] Data backup successful.`);
  } catch (error) {
    console.error('Data backup failed:', error);
  }
}

function restoreData() {
  try {
    const auctionsPath = path.join(backupDir, 'auctions.json');
    if (fs.existsSync(auctionsPath)) {
      const data = JSON.parse(fs.readFileSync(auctionsPath));
      const restoredAuctions = data.map(([id, plainAuction]) => {
        const auction = Object.assign(new Auction(), plainAuction);
        auction.endTime = new Date(auction.endTime);
        auction.createdAt = new Date(auction.createdAt);
        auction.bids = auction.bids.map(plainBid => Object.assign(new Bid(), plainBid));
        return [id, auction];
      });
      auctions = new Map(restoredAuctions);
      console.log(`Restored ${auctions.size} auctions from backup.`);
    }

    const bidsPath = path.join(backupDir, 'bids.json');
    if (fs.existsSync(bidsPath)) {
      const data = JSON.parse(fs.readFileSync(bidsPath));
      const restoredBids = data.map(([id, plainBid]) => {
        const bid = Object.assign(new Bid(), plainBid);
        bid.timestamp = new Date(bid.timestamp);
        return [id, bid];
      });
      bids = new Map(restoredBids);
      console.log(`Restored ${bids.size} bids from backup.`);
    }

    const usersPath = path.join(backupDir, 'users.json');
    if (fs.existsSync(usersPath)) {
      const data = JSON.parse(fs.readFileSync(usersPath));
      const restoredUsers = data.map(([id, plainUser]) => {
        const user = Object.assign(new User(), plainUser);
        user.createdAt = new Date(user.createdAt);
        return [id, user];
      });
      users = new Map(restoredUsers);
      console.log(`Restored ${users.size} users from backup.`);
    }
  } catch (error) {
    console.error('Failed to restore data from backup. Starting with a clean state.', error);
    auctions = new Map();
    bids = new Map();
    users = new Map();
  }
}

// Restore data on startup
restoreData();

// Routes
app.get('/api/auctions', 
  validateRequest.query({
    page: { type: 'number' },
    limit: { type: 'number' },
    status: { type: 'status' }
  }),
  (req, res) => {
  try {
    const { page = 1, limit = 10, status = null } = req.sanitizedQuery || {};
    
    // Additional validation for limit to prevent excessive data loading
    const validatedLimit = Math.min(limit, 100);
    
    const result = db.getPaginatedAuctions(page, validatedLimit, status);
    
    const auctionList = result.auctions.map(auction => ({
      id: auction.id,
      title: auction.title,
      description: auction.description,
      startingBid: auction.starting_bid,
      currentHighestBid: auction.current_highest_bid || auction.starting_bid,
      endTime: auction.end_time,
      status: auction.status,
      bidCount: db.getBidCount(auction.id),
      creator: auction.creator_id
    }));
    
    res.json({
      auctions: auctionList,
      pagination: result.pagination
    });
  } catch (error) {
    console.error('Error fetching auctions:', error);
    res.status(500).json({ error: 'Failed to fetch auctions' });
  }
});


    }

    const auctionId = generateAuctionId();
    const auction = new Auction(auctionId, title, description, startingBid, new Date(endTime), userId);
    
    try {
      auctions.set(auctionId, auction);
      io.emit('auctionCreated', auction);
      res.status(201).json(auction);
    } catch (transactionError) {
      auctions.delete(auctionId);
      throw transactionError;
    }
  } catch (error) {
    console.error('Auction creation failed:', error);
    res.status(500).json({ error: 'Failed to create auction' });
  }
});

app.get('/api/auctions/:id', (req, res) => {

  const auction = auctions.get(req.params.id);
  if (!auction) {
    return res.status(404).json({ error: 'Auction not found' });
  }
});


      return res.status(404).json({ error: 'Auction not found' });
    }

    if (auctionDb.status !== 'active') {
      return res.status(400).json({ error: 'Auction is not active' });
    }

    // Validate bid amount against current highest bid
    const minimumBid = Math.max(auctionDb.starting_bid, auctionDb.current_highest_bid || auctionDb.starting_bid);
    if (amount <= minimumBid) {
      return res.status(400).json({ error: `Bid must be higher than ${minimumBid}` });
    }

    const encryptedBid = encryptBid(amount, secretKey);
    const bidId = uuidv4();
    const bid = new Bid(bidId, auctionId, bidderId, amount, encryptedBid);
    
    // Transaction: Save state for potential rollback
    const originalBidsLength = auction.bids.length;
    const originalHighestBid = auction.currentHighestBid;

    try {
      bids.set(bidId, bid);
      auction.addBid(bid);
      
      io.emit('bidPlaced', { auctionId, bidCount: auction.bids.length });
      res.status(201).json({ message: 'Bid placed successfully', bidId });
    } catch (transactionError) {
      // Rollback on failure
      bids.delete(bidId);
      auction.bids.length = originalBidsLength;
      auction.currentHighestBid = originalHighestBid;
      throw transactionError;
    }
  } catch (error) {
    console.error('Bid placement failed:', error);
    res.status(500).json({ error: 'Failed to place bid' });
  }
});


app.post('/api/auctions/:id/close', (req, res) => {
  try {
    const auctionId = req.sanitizedParams.id;
    
    const auctionDb = db.getAuction(auctionId);
    if (!auctionDb) {
      return res.status(404).json({ error: 'Auction not found' });
    }


      return res.status(400).json({ error: 'Auction is already closed' });
    }

    // Get all bids and find winner
    const allBids = db.getBidsForAuction(auctionId);
    let winnerId = null;
    let winningBidId = null;
    
    if (allBids.length > 0) {
      const highestBid = allBids[0]; // Already ordered by amount DESC
      winnerId = highestBid.bidder_id;
      winningBidId = highestBid.id;
    }
    
    // Update auction in database
    db.closeAuction(auctionId, winnerId, winningBidId);
    
    // Update in-memory
    const auction = auctions.get(auctionId);
    if (auction) {
      auction.close();
    }
    
    io.emit('auctionClosed', { ...auctionDb, status: 'closed', winner: winnerId, winningBid: winningBidId });
    res.json({ ...auctionDb, status: 'closed', winner: winnerId, winningBid: winningBidId });
  } catch (error) {
    console.error('Error closing auction:', error);
    res.status(500).json({ error: 'Failed to close auction' });
  }
});

app.post('/api/users/register', 
  validateRequest.body({
    username: { type: 'username', required: true },
    password: { type: 'password', required: true }
  }),
  async (req, res) => {
  try {
    const { username, password } = req.sanitizedBody;
    

    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const userId = uuidv4();
    // Create user in database
    db.createUser(userId, username, password);
    

  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

app.post('/api/users/login', 
  validateRequest.body({
    username: { type: 'string', required: true },
    password: { type: 'string', required: true }
  }),
  async (req, res) => {
  try {
    const { username, password } = req.sanitizedBody;
    
    // Get user from database
    const user = db.getUserByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValid = await bcrypt.compare(password, user.hashed_password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate JWT token
    const token = generateToken(user);
    
    res.json({ 
      userId: user.id, 
      username: user.username,
      token: token,
      expiresIn: '24h'
    });
  } catch (error) {
    console.error('Error logging in user:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

// New logout endpoint
app.post('/api/users/logout', authenticateToken, (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token) {
      tokenBlacklist.add(token);
    }
    
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to logout' });
  }
});

// New token validation endpoint
app.get('/api/users/verify', authenticateToken, (req, res) => {
  res.json({ 
    valid: true, 
    user: { 
      userId: req.user.userId, 
      username: req.user.username 
    } 
  });
});

// OAuth Routes
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback', 
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    const token = generateToken(req.user);
    res.redirect(`/?token=${token}&username=${req.user.username}`);
  }
);

app.get('/auth/github', passport.authenticate('github', { scope: ['user:email'] }));

app.get('/auth/github/callback',
  passport.authenticate('github', { failureRedirect: '/login' }),
  (req, res) => {
    const token = generateToken(req.user);
    res.redirect(`/?token=${token}&username=${req.user.username}`);
  }
);

// OAuth status endpoint
app.get('/api/auth/status', (req, res) => {
  res.json({
    google: !!GOOGLE_CLIENT_ID,
    github: !!GITHUB_CLIENT_ID
  });
});

// Socket.io connections
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('joinAuction', (auctionId) => {
    socket.join(auctionId);
  });
  
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Auto-close expired auctions
setInterval(() => {
  const now = new Date();
  const activeAuctions = db.getActiveAuctions();
  
  for (const auction of activeAuctions) {
    if (new Date(auction.end_time) <= now) {
      // Get all bids and find winner
      const allBids = db.getBidsForAuction(auction.id);
      let winnerId = null;
      let winningBidId = null;
      
      if (allBids.length > 0) {
        const highestBid = allBids[0];
        winnerId = highestBid.bidder_id;
        winningBidId = highestBid.id;
      }
      
      // Update auction in database
      db.closeAuction(auction.id, winnerId, winningBidId);
      
      io.emit('auctionClosed', { ...auction, status: 'closed', winner: winnerId, winningBid: winningBidId });
    }
  }
}, 60000); // Check every minute

// Schedule regular backups
const BACKUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
setInterval(backupData, BACKUP_INTERVAL);
console.log(`Automated backup scheduled to run every ${BACKUP_INTERVAL / 60000} minutes.`);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Sealed-Bid Auction server running on port ${PORT}`);
});
