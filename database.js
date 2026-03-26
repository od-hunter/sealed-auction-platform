const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');

class AuctionDatabase {
  constructor(dbPath = './auctions.db') {
    this.dbPath = path.resolve(__dirname, dbPath);
    this.db = new Database(this.dbPath);
    this.initializeSchema();
  }

  initializeSchema() {
    // Enable foreign keys
    this.db.pragma('foreign_keys = ON');

    // Create users table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        hashed_password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create auctions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auctions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        starting_bid REAL NOT NULL,
        current_highest_bid REAL DEFAULT 0,
        end_time DATETIME NOT NULL,
        creator_id TEXT NOT NULL,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'closed', 'cancelled')),
        winner_id TEXT,
        winning_bid_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (creator_id) REFERENCES users(id),
        FOREIGN KEY (winner_id) REFERENCES users(id)
      )
    `);

    // Create bids table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bids (
        id TEXT PRIMARY KEY,
        auction_id TEXT NOT NULL,
        bidder_id TEXT NOT NULL,
        amount REAL NOT NULL,
        encrypted_bid TEXT NOT NULL,
        encrypted_iv TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        revealed INTEGER DEFAULT 0,
        FOREIGN KEY (auction_id) REFERENCES auctions(id) ON DELETE CASCADE,
        FOREIGN KEY (bidder_id) REFERENCES users(id)
      )
    `);

    // Create indexes for better performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions(status);
      CREATE INDEX IF NOT EXISTS idx_auctions_end_time ON auctions(end_time);
      CREATE INDEX IF NOT EXISTS idx_bids_auction_id ON bids(auction_id);
      CREATE INDEX IF NOT EXISTS idx_bids_bidder_id ON bids(bidder_id);
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    `);
  }

  // User operations
  createUser(id, username, password) {
    const hashedPassword = bcrypt.hashSync(password, 10);
    const stmt = this.db.prepare(`
      INSERT INTO users (id, username, hashed_password)
      VALUES (?, ?, ?)
    `);
    return stmt.run(id, username, hashedPassword);
  }

  getUserByUsername(username) {
    const stmt = this.db.prepare('SELECT * FROM users WHERE username = ?');
    return stmt.get(username);
  }

  getUserById(id) {
    const stmt = this.db.prepare('SELECT * FROM users WHERE id = ?');
    return stmt.get(id);
  }

  // Auction operations
  createAuction(auction) {
    const stmt = this.db.prepare(`
      INSERT INTO auctions (id, title, description, starting_bid, current_highest_bid, end_time, creator_id, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      auction.id,
      auction.title,
      auction.description || null,
      auction.startingBid,
      auction.startingBid,
      auction.endTime.toISOString(),
      auction.creator,
      auction.status
    );
  }

  getAuction(id) {
    const stmt = this.db.prepare('SELECT * FROM auctions WHERE id = ?');
    return stmt.get(id);
  }

  getAllAuctions() {
    const stmt = this.db.prepare('SELECT * FROM auctions ORDER BY created_at DESC');
    return stmt.all();
  }

  getActiveAuctions() {
    const stmt = this.db.prepare("SELECT * FROM auctions WHERE status = 'active' ORDER BY created_at DESC");
    return stmt.all();
  }

  getPaginatedAuctions(page = 1, limit = 10, status = null) {
    const offset = (page - 1) * limit;
    let query = 'SELECT * FROM auctions';
    let countQuery = 'SELECT COUNT(*) as total FROM auctions';
    
    if (status) {
      query += " WHERE status = ?";
      countQuery += " WHERE status = ?";
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    
    const countStmt = this.db.prepare(countQuery);
    const auctionsStmt = this.db.prepare(query);
    
    const totalResult = status ? countStmt.get(status) : countStmt.get();
    const auctions = status ? auctionsStmt.all(status, limit, offset) : auctionsStmt.all(limit, offset);
    
    return {
      auctions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalResult.total,
        totalPages: Math.ceil(totalResult.total / limit),
        hasMore: offset + auctions.length < totalResult.total
      }
    };
  }

  updateAuction(id, updates) {
    const fields = [];
    const values = [];
    
    Object.keys(updates).forEach(key => {
      fields.push(`${key} = ?`);
      values.push(updates[key]);
    });
    
    values.push(id);
    
    const stmt = this.db.prepare(`
      UPDATE auctions SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `);
    return stmt.run(...values);
  }

  closeAuction(id, winnerId, winningBidId) {
    const stmt = this.db.prepare(`
      UPDATE auctions 
      SET status = 'closed', winner_id = ?, winning_bid_id = ?, updated_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);
    return stmt.run(winnerId, winningBidId, id);
  }

  // Bid operations
  createBid(bid) {
    const stmt = this.db.prepare(`
      INSERT INTO bids (id, auction_id, bidder_id, amount, encrypted_bid, encrypted_iv)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      bid.id,
      bid.auctionId,
      bid.bidderId,
      bid.amount,
      bid.encryptedBid.encrypted,
      bid.encryptedBid.iv
    );
  }

  getBidsForAuction(auctionId) {
    const stmt = this.db.prepare('SELECT * FROM bids WHERE auction_id = ? ORDER BY amount DESC');
    return stmt.all(auctionId);
  }

  getBidCount(auctionId) {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM bids WHERE auction_id = ?');
    const result = stmt.get(auctionId);
    return result.count;
  }

  getHighestBid(auctionId) {
    const stmt = this.db.prepare('SELECT MAX(amount) as highest FROM bids WHERE auction_id = ?');
    const result = stmt.get(auctionId);
    return result.highest;
  }

  // Utility methods
  close() {
    this.db.close();
  }

  // Export for in-memory compatibility (temporary)
  toMap() {
    const auctions = new Map();
    const bids = new Map();
    const users = new Map();

    this.getAllAuctions().forEach(auction => {
      auctions.set(auction.id, auction);
    });

    this.db.prepare('SELECT * FROM bids').all().forEach(bid => {
      bids.set(bid.id, bid);
    });

    this.db.prepare('SELECT * FROM users').all().forEach(user => {
      users.set(user.id, user);
    });

    return { auctions, bids, users };
  }
}

module.exports = AuctionDatabase;
