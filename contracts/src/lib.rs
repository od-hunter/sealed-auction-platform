#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec, Symbol, symbol_short, map, bytes};

// Maximum bid amount to prevent overflow (in stroops)
const MAX_BID_AMOUNT: u64 = u64::MAX / 2; // Use half of u64::MAX for safety

// Contract type definitions
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AuctionStatus {
    Created = 0,
    Active = 1,
    Ended = 2,
    Cancelled = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BidStatus {
    Committed = 0,
    Revealed = 1,
    Refunded = 2,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Auction {
    pub auction_id: u64,
    pub creator: Address,
    pub title: String,
    pub description: String,
    pub starting_bid: u64,
    pub end_time: u64,
    pub bid_count: u64,
    pub highest_bidder: Address,
    pub highest_bid: u64,
    pub status: AuctionStatus,
    pub created_at: u64,
    pub ended_at: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Bid {
    pub bid_id: u64,
    pub auction_id: u64,
    pub bidder: Address,
    pub commitment: String,
    pub bid_amount: u64,
    pub secret: String,
    pub status: BidStatus,
    pub committed_at: u64,
    pub revealed_at: u64,
}

// Storage keys
const AUCTION_COUNTER: Symbol = symbol_short!("A_CNT");
const BID_COUNTER: Symbol = symbol_short!("B_CNT");
const AUCTIONS: Symbol = symbol_short!("AUCTIONS");
const BIDS: Symbol = symbol_short!("BIDS");
const USER_AUCTIONS: Symbol = symbol_short!("U_AUCT");
const USER_BIDS: Symbol = symbol_short!("U_BIDS");
const HAS_COMMITTED: Symbol = symbol_short!("HAS_COM");
const HAS_REVEALED: Symbol = symbol_short!("HAS_REV");
const REENTRANCY_GUARD: Symbol = symbol_short!("NO_LOCK");

#[contract]
pub struct SealedBidAuction;

#[contractimpl]
impl SealedBidAuction {
    // Reentrancy guard helper functions
    fn require_not_locked(env: &Env) {
        let is_locked: bool = env.storage().instance().get(&REENTRANCY_GUARD).unwrap_or(false);
        if is_locked {
            panic!("Reentrancy detected");
        }
    }

    fn set_lock(env: &Env) {
        env.storage().instance().set(&REENTRANCY_GUARD, &true);
    }

    fn remove_lock(env: &Env) {
        env.storage().instance().set(&REENTRANCY_GUARD, &false);
    }

    /// Create a new auction
    pub fn create_auction(
        env: Env,
        title: String,
        description: String,
        starting_bid: u64,
        duration: u64,
    ) -> u64 {
        // Reentrancy guard
        Self::require_not_locked(&env);
        Self::set_lock(&env);

        let creator = env.current_contract_address();
        
        // Validate inputs
        if starting_bid == 0 {
            Self::remove_lock(&env);
            panic!("Starting bid must be greater than 0");
        }
        if duration == 0 {
            Self::remove_lock(&env);
            panic!("Duration must be greater than 0");
        }
        
        // Overflow check for starting bid
        if starting_bid > MAX_BID_AMOUNT {
            Self::remove_lock(&env);
            panic!("Starting bid exceeds maximum allowed amount");
        }
        
        // Overflow check for duration (max 1 year in seconds)
        const MAX_DURATION: u64 = 365 * 24 * 60 * 60; // 1 year
        if duration > MAX_DURATION {
            Self::remove_lock(&env);
            panic!("Duration too long");
        }
        
        // Get next auction ID with overflow check
        let current_counter: u64 = env.storage().instance().get(&AUCTION_COUNTER).unwrap_or(0);
        let auction_id = current_counter.checked_add(1)
            .unwrap_or_else(|| panic!("Auction counter overflow"));
        env.storage().instance().set(&AUCTION_COUNTER, &auction_id);
        
        let end_time = env.ledger().timestamp() + duration;
        
        // Create auction
        let auction = Auction {
            auction_id,
            creator: creator.clone(),
            title: title.clone(),
            description,
            starting_bid,
            end_time,
            bid_count: 0,
            highest_bidder: creator.clone(), // Initialize with creator address
            highest_bid: 0,
            status: AuctionStatus::Active,
            created_at: env.ledger().timestamp(),
            ended_at: 0,
        };
        
        // Store auction
        let mut auctions = env.storage().instance().get(&AUCTIONS).unwrap_or(Vec::new(&env));
        auctions.push_back(auction.clone());
        env.storage().instance().set(&AUCTIONS, &auctions);
        
        // Add to user's auctions
        let mut user_auctions = env.storage().instance().get(&USER_AUCTIONS).unwrap_or(map!(&env));
        let mut user_list = user_auctions.get(creator.clone()).unwrap_or(Vec::new(&env));
        user_list.push_back(auction_id);
        user_auctions.set(creator, user_list);
        env.storage().instance().set(&USER_AUCTIONS, &user_auctions);
        
        // Emit event
        env.events().publish(
            (symbol_short!("auction_created"), auction_id),
            (title, starting_bid, end_time),
        );
        
        // Remove lock
        Self::remove_lock(&env);
        
        auction_id
    }
    
    /// Commit a sealed bid
    pub fn commit_bid(
        env: Env,
        auction_id: u64,
        commitment: String,
        bid_amount: u64,
    ) -> u64 {
        // Reentrancy guard
        Self::require_not_locked(&env);
        Self::set_lock(&env);

        let bidder = env.current_contract_address();
        
        // Get auction
        let auctions = env.storage().instance().get(&AUCTIONS).unwrap_or(Vec::new(&env));
        let auction = auctions.get(auction_id as u32).unwrap_or_else(|| panic!("Auction not found"));
        
        // Validate auction
        if auction.status != AuctionStatus::Active {
            panic!("Auction not active");
        }
        if env.ledger().timestamp() >= auction.end_time {
            panic!("Auction ended");
        }
        
        // Check if already committed
        let mut has_committed = env.storage().instance().get(&HAS_COMMITTED).unwrap_or(map!(&env));
        if has_committed.get((auction_id, bidder.clone())).unwrap_or(false) {
            panic!("Already committed");
        }
        
        // Validate bid amount
        if bid_amount < auction.starting_bid {
            Self::remove_lock(&env);
            panic!("Bid below starting amount");
        }
        
        // Overflow check for bid amount
        if bid_amount > MAX_BID_AMOUNT {
            Self::remove_lock(&env);
            panic!("Bid amount exceeds maximum allowed");
        }
        
        // Get next bid ID with overflow check
        let current_bid_counter: u64 = env.storage().instance().get(&BID_COUNTER).unwrap_or(0);
        let bid_id = current_bid_counter.checked_add(1)
            .unwrap_or_else(|| panic!("Bid counter overflow"));
        env.storage().instance().set(&BID_COUNTER, &bid_id);
        
        // Create bid
        let bid = Bid {
            bid_id,
            auction_id,
            bidder: bidder.clone(),
            commitment: commitment.clone(),
            bid_amount: 0, // Will be set on reveal
            secret: String::from_str(&env, ""),
            status: BidStatus::Committed,
            committed_at: env.ledger().timestamp(),
            revealed_at: 0,
        };
        
        // Store bid
        let mut bids = env.storage().instance().get(&BIDS).unwrap_or(Vec::new(&env));
        bids.push_back(bid.clone());
        env.storage().instance().set(&BIDS, &bids);
        
        // Update auction bid count with overflow check
        let mut auctions = env.storage().instance().get(&AUCTIONS).unwrap_or(Vec::new(&env));
        let mut auction = auctions.get(auction_id as u32).unwrap();
        
        // Safe increment with overflow check
        auction.bid_count = auction.bid_count.checked_add(1)
            .unwrap_or_else(|| panic!("Bid count overflow"));
        
        auctions.set(auction_id as u32, auction);
        env.storage().instance().set(&AUCTIONS, &auctions);
        
        // Mark as committed
        has_committed.set((auction_id, bidder.clone()), true);
        env.storage().instance().set(&HAS_COMMITTED, &has_committed);
        
        // Add to user's bids
        let mut user_bids = env.storage().instance().get(&USER_BIDS).unwrap_or(map!(&env));
        let mut user_list = user_bids.get(bidder.clone()).unwrap_or(Vec::new(&env));
        user_list.push_back(bid_id);
        user_bids.set(bidder, user_list);
        env.storage().instance().set(&USER_BIDS, &user_bids);
        
        // Emit event
        env.events().publish(
            (symbol_short!("bid_committed"), auction_id, bid_id),
            (bidder, commitment),
        );
        
        // Remove lock
        Self::remove_lock(&env);
        
        bid_id
    }
    
    /// Reveal a committed bid
    pub fn reveal_bid(
        env: Env,
        bid_id: u64,
        bid_amount: u64,
        secret: String,
    ) {
        // Reentrancy guard
        Self::require_not_locked(&env);
        Self::set_lock(&env);

        let bids = env.storage().instance().get(&BIDS).unwrap_or(Vec::new(&env));
        let mut bid = bids.get(bid_id as u32).unwrap_or_else(|| panic!("Bid not found"));
        
        // Validate bid
        if bid.bidder != env.current_contract_address() {
            panic!("Not bid owner");
        }
        if bid.status != BidStatus::Committed {
            panic!("Bid already revealed");
        }
        
        // Get auction
        let auctions = env.storage().instance().get(&AUCTIONS).unwrap_or(Vec::new(&env));
        let mut auction = auctions.get(bid.auction_id as u32).unwrap();
        
        if env.ledger().timestamp() >= auction.end_time {
            panic!("Reveal period ended");
        }
        
        // Verify commitment
        let expected_commitment = Self::get_commitment(env, bid_amount, secret.clone());
        if expected_commitment != bid.commitment {
            Self::remove_lock(&env);
            panic!("Invalid commitment");
        }
        
        // Overflow check for bid amount
        if bid_amount > MAX_BID_AMOUNT {
            Self::remove_lock(&env);
            panic!("Bid amount exceeds maximum allowed");
        }
        
        // Update bid
        bid.bid_amount = bid_amount;
        bid.secret = secret;
        bid.status = BidStatus::Revealed;
        bid.revealed_at = env.ledger().timestamp();
        
        // Update bid storage
        let mut bids = env.storage().instance().get(&BIDS).unwrap_or(Vec::new(&env));
        bids.set(bid_id as u32, bid.clone());
        env.storage().instance().set(&BIDS, &bids);
        
        // Update highest bid if necessary with overflow check
        if bid_amount > auction.highest_bid {
            // Safe comparison - no overflow possible here since we're just comparing
            auction.highest_bid = bid_amount;
            auction.highest_bidder = bid.bidder.clone();
        }
        
        // Update auction storage
        let mut auctions = env.storage().instance().get(&AUCTIONS).unwrap_or(Vec::new(&env));
        auctions.set(bid.auction_id as u32, auction);
        env.storage().instance().set(&AUCTIONS, &auctions);
        
        // Emit event
        env.events().publish(
            (symbol_short!("bid_revealed"), bid.auction_id, bid_id),
            (bid.bidder.clone(), bid_amount),
        );
        
        // Remove lock
        Self::remove_lock(&env);
    }
    
    /// End an auction
    pub fn end_auction(env: Env, auction_id: u64) {
        // Reentrancy guard
        Self::require_not_locked(&env);
        Self::set_lock(&env);

        let mut auctions = env.storage().instance().get(&AUCTIONS).unwrap_or(Vec::new(&env));
        let mut auction = auctions.get(auction_id as u32).unwrap_or_else(|| panic!("Auction not found"));
        
        // Validate auction
        if auction.status != AuctionStatus::Active {
            panic!("Auction not active");
        }
        if env.ledger().timestamp() < auction.end_time {
            panic!("Auction not ended");
        }
        
        // End auction
        auction.status = AuctionStatus::Ended;
        auction.ended_at = env.ledger().timestamp();
        
        // Update storage
        auctions.set(auction_id as u32, auction.clone());
        env.storage().instance().set(&AUCTIONS, &auctions);
        
        // Emit event
        env.events().publish(
            (symbol_short!("auction_ended"), auction_id),
            (auction.highest_bidder.clone(), auction.highest_bid),
        );
        
        // Remove lock
        Self::remove_lock(&env);
    }
    
    /// Cancel an auction
    pub fn cancel_auction(env: Env, auction_id: u64) {
        // Reentrancy guard
        Self::require_not_locked(&env);
        Self::set_lock(&env);

        let mut auctions = env.storage().instance().get(&AUCTIONS).unwrap_or(Vec::new(&env));
        let mut auction = auctions.get(auction_id as u32).unwrap_or_else(|| panic!("Auction not found"));
        
        // Validate auction and creator
        if auction.creator != env.current_contract_address() {
            panic!("Not auction creator");
        }
        if auction.status != AuctionStatus::Active {
            panic!("Auction not active");
        }
        
        // Cancel auction
        auction.status = AuctionStatus::Cancelled;
        auction.ended_at = env.ledger().timestamp();
        
        // Update storage
        auctions.set(auction_id as u32, auction.clone());
        env.storage().instance().set(&AUCTIONS, &auctions);
        
        // Emit event
        env.events().publish(
            (symbol_short!("auction_cancelled"), auction_id),
            (),
        );
        
        // Remove lock
        Self::remove_lock(&env);
    }
    
    /// Get auction details
    pub fn get_auction(env: Env, auction_id: u64) -> Auction {
        let auctions = env.storage().instance().get(&AUCTIONS).unwrap_or(Vec::new(&env));
        auctions.get(auction_id as u32).unwrap_or_else(|| panic!("Auction not found"))
    }
    
    /// Get bid details
    pub fn get_bid(env: Env, bid_id: u64) -> Bid {
        let bids = env.storage().instance().get(&BIDS).unwrap_or(Vec::new(&env));
        bids.get(bid_id as u32).unwrap_or_else(|| panic!("Bid not found"))
    }
    
    /// Get user's auctions
    pub fn get_user_auctions(env: Env, user: Address) -> Vec<u64> {
        let user_auctions = env.storage().instance().get(&USER_AUCTIONS).unwrap_or(map!(&env));
        user_auctions.get(user).unwrap_or(Vec::new(&env))
    }
    
    /// Get user's bids
    pub fn get_user_bids(env: Env, user: Address) -> Vec<u64> {
        let user_bids = env.storage().instance().get(&USER_BIDS).unwrap_or(map!(&env));
        user_bids.get(user).unwrap_or(Vec::new(&env))
    }
    
    /// Get total number of auctions
    pub fn get_total_auctions(env: Env) -> u64 {
        env.storage().instance().get(&AUCTION_COUNTER).unwrap_or(0)
    }
    
    /// Get total number of bids
    pub fn get_total_bids(env: Env) -> u64 {
        env.storage().instance().get(&BID_COUNTER).unwrap_or(0)
    }
    
    /// Generate commitment hash for bid
    pub fn get_commitment(env: Env, bid_amount: u64, secret: String) -> String {
        let combined = format!("{}{}", bid_amount, secret);
        let hash = env.crypto().sha256(&combined.into_bytes(&env));
        String::from_str(&env, &hash.to_string())
    }
}
