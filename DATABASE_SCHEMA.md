# Database Schema Documentation

## Overview
This document describes the normalized database schema for the Sealed-Bid Auction Platform. The schema is designed to ensure data integrity, eliminate redundancy, and support efficient querying.

## Database Type
- **Engine**: SQLite (via better-sqlite3)
- **File**: `auctions.db` (configurable via DATABASE_PATH environment variable)

## Entity Relationship Diagram

```
users (1) ----< (N) auctions (creator_id)
users (1) ----< (N) auctions (winner_id)
users (1) ----< (N) bids
auctions (1) --< (N) bids
```

## Tables

### 1. users
Stores user account information for auction creators and bidders.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY | Unique user identifier (UUID v4) |
| username | TEXT | UNIQUE, NOT NULL | User's unique username |
| hashed_password | TEXT | NOT NULL | Bcrypt-hashed password |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | Account creation timestamp |
| updated_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | Last update timestamp |

**Indexes:**
- `idx_users_username` on `username` column

### 2. auctions
Stores auction listing information.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY | Unique auction identifier (UUID v4) |
| title | TEXT | NOT NULL | Auction title |
| description | TEXT | NULLABLE | Auction item description |
| starting_bid | REAL | NOT NULL | Minimum starting bid amount |
| current_highest_bid | REAL | DEFAULT 0 | Current highest bid (updated on each bid) |
| end_time | DATETIME | NOT NULL | Auction end timestamp |
| creator_id | TEXT | NOT NULL, FK → users(id) | User who created the auction |
| status | TEXT | CHECK(status IN ('active', 'closed', 'cancelled')) | Auction status |
| winner_id | TEXT | NULLABLE, FK → users(id) | Winning bidder (if closed) |
| winning_bid_id | TEXT | NULLABLE, FK → bids(id) | Winning bid reference |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | Auction creation timestamp |
| updated_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | Last update timestamp |

**Indexes:**
- `idx_auctions_status` on `status` column
- `idx_auctions_end_time` on `end_time` column

**Foreign Keys:**
- `creator_id` references `users(id)`
- `winner_id` references `users(id)`
- `winning_bid_id` references `bids(id)`

### 3. bids
Stores sealed bid submissions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | TEXT | PRIMARY KEY | Unique bid identifier (UUID v4) |
| auction_id | TEXT | NOT NULL, FK → auctions(id) | Associated auction |
| bidder_id | TEXT | NOT NULL, FK → users(id) | User who placed the bid |
| amount | REAL | NOT NULL | Bid amount (stored encrypted in application layer) |
| encrypted_bid | TEXT | NOT NULL | AES-256-CBC encrypted bid amount |
| encrypted_iv | TEXT | NOT NULL | Initialization vector for decryption |
| timestamp | DATETIME | DEFAULT CURRENT_TIMESTAMP | Bid placement timestamp |
| revealed | INTEGER | DEFAULT 0 | Boolean flag (0/1) for bid reveal status |

**Indexes:**
- `idx_bids_auction_id` on `auction_id` column
- `idx_bids_bidder_id` on `bidder_id` column

**Foreign Keys:**
- `auction_id` references `auctions(id)` with ON DELETE CASCADE
- `bidder_id` references `users(id)`

## Normalization Analysis

### First Normal Form (1NF)
✓ All tables have atomic values (no repeating groups or arrays)
✓ Each column contains only one value
✓ Each row is unique (primary keys defined)

### Second Normal Form (2NF)
✓ All non-key attributes are fully dependent on the primary key
✓ No partial dependencies exist

### Third Normal Form (3NF)
✓ All non-key attributes are dependent only on the primary key
✓ No transitive dependencies exist
✓ Example: User information is stored separately from auctions and bids

## Referential Integrity

### Foreign Key Constraints
All foreign keys are enforced with `PRAGMA foreign_keys = ON`

### Cascade Rules
- **DELETE on auctions**: All associated bids are automatically deleted (ON DELETE CASCADE)
- **DELETE on users**: Should be handled at application level (no CASCADE to preserve auction history)

## Performance Optimizations

### Indexes
1. **User lookup by username**: `idx_users_username`
2. **Filter active auctions**: `idx_auctions_status`
3. **Sort by end time**: `idx_auctions_end_time`
4. **Get bids for auction**: `idx_bids_auction_id`
5. **Get bids by bidder**: `idx_bids_bidder_id`

### Query Patterns Supported
- Fetch all active auctions ordered by creation time
- Get all bids for a specific auction
- Find user by username for authentication
- Get auction details with creator/winner information
- Count bids per auction
- Find highest bid for an auction

## Security Considerations

1. **Password Storage**: Bcrypt hashing with salt rounds = 10
2. **Bid Encryption**: AES-256-CBC encryption with random IV
3. **SQL Injection Prevention**: Parameterized queries using prepared statements
4. **Foreign Key Enforcement**: Enabled to maintain data integrity

## Migration Strategy

### From In-Memory to Database
The system maintains backward compatibility during the transition:
1. Data is written to both database and in-memory Maps
2. API routes read from database first, fallback to memory
3. Gradual migration ensures zero downtime

### Future Migrations
For production deployment, consider:
- PostgreSQL for better concurrency
- Connection pooling
- Read replicas for scaling
- Partitioning for large datasets

## Environment Variables

```bash
DATABASE_PATH=./auctions.db
```

## Example Queries

### Get Active Auctions with Bid Counts
```sql
SELECT 
    a.*,
    COUNT(b.id) as bid_count,
    u.username as creator_username
FROM auctions a
LEFT JOIN bids b ON a.id = b.auction_id
LEFT JOIN users u ON a.creator_id = u.id
WHERE a.status = 'active'
GROUP BY a.id
ORDER BY a.created_at DESC;
```

### Get Winning Bid for Closed Auction
```sql
SELECT 
    b.*,
    u.username as bidder_username
FROM bids b
JOIN auctions a ON b.auction_id = a.id
JOIN users u ON b.bidder_id = u.id
WHERE a.id = ?
ORDER BY b.amount DESC
LIMIT 1;
```

### Get User's Active Bids
```sql
SELECT 
    b.*,
    a.title as auction_title,
    a.end_time
FROM bids b
JOIN auctions a ON b.auction_id = a.id
WHERE b.bidder_id = ? AND a.status = 'active'
ORDER BY a.end_time ASC;
```

## Maintenance

### Vacuum Database
Periodically reclaim unused space:
```sql
VACUUM;
```

### Integrity Check
Verify database integrity:
```sql
PRAGMA integrity_check;
```

### Backup Strategy
Regular backups of the `.db` file recommended, especially before schema migrations.
