# JWT Authentication Implementation

## Overview
This implementation adds JSON Web Token (JWT) based authentication to the sealed-auction-platform, replacing the previous basic authentication system.

## Features Added

### 1. JWT Token Generation
- Automatic token generation on user registration and login
- Tokens contain user ID and username
- 24-hour expiration time
- Secure signing using JWT_SECRET environment variable

### 2. Authentication Middleware
- `authenticateToken` middleware protects sensitive endpoints
- Validates JWT tokens on each request
- Checks against token blacklist for revoked tokens
- Returns appropriate HTTP status codes (401, 403)

### 3. New API Endpoints

#### POST /api/users/register
```json
Request:
{
  "username": "testuser",
  "password": "password123"
}

Response:
{
  "userId": "uuid",
  "username": "testuser",
  "token": "jwt-token-here",
  "expiresIn": "24h"
}
```

#### POST /api/users/login
```json
Request:
{
  "username": "testuser",
  "password": "password123"
}

Response:
{
  "userId": "uuid",
  "username": "testuser",
  "token": "jwt-token-here",
  "expiresIn": "24h"
}
```

#### POST /api/users/logout
```json
Headers: Authorization: Bearer <token>
Response:
{
  "message": "Logged out successfully"
}
```

#### GET /api/users/verify
```json
Headers: Authorization: Bearer <token>
Response:
{
  "valid": true,
  "user": {
    "userId": "uuid",
    "username": "testuser"
  }
}
```

### 4. Protected Endpoints
The following endpoints now require JWT authentication:

- `POST /api/auctions` - Create new auction
- `POST /api/bids` - Place a bid
- `POST /api/auctions/:id/close` - Close an auction
- `POST /api/users/logout` - Logout user
- `GET /api/users/verify` - Verify token validity

### 5. Security Enhancements
- Password minimum length validation (6 characters)
- Token blacklist for logout functionality
- Authorization header requirement: `Bearer <token>`
- Only auction creators can close their auctions
- User ID automatically extracted from JWT token

## Usage Examples

### Register a new user
```bash
curl -X POST http://localhost:3000/api/users/register \
  -H "Content-Type: application/json" \
  -d '{"username": "testuser", "password": "password123"}'
```

### Login
```bash
curl -X POST http://localhost:3000/api/users/login \
  -H "Content-Type: application/json" \
  -d '{"username": "testuser", "password": "password123"}'
```

### Create an auction (with token)
```bash
curl -X POST http://localhost:3000/api/auctions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"title": "Test Auction", "description": "A test auction", "startingBid": 100, "endTime": "2024-12-31T23:59:59Z"}'
```

### Place a bid (with token)
```bash
curl -X POST http://localhost:3000/api/bids \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"auctionId": "auction-uuid", "amount": 150, "secretKey": "my-secret-key"}'
```

### Logout
```bash
curl -X POST http://localhost:3000/api/users/logout \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Environment Variables
Create a `.env` file in the root directory:

```env
JWT_SECRET=your-super-secret-jwt-key-here
PORT=3000
```

**Important**: Use a strong, random JWT_SECRET in production!

## Dependencies Added
- `jsonwebtoken: ^9.0.2` - For JWT token generation and verification

## Security Considerations

1. **JWT Secret**: Always use a strong, random JWT_SECRET in production
2. **Token Storage**: Store JWT tokens securely on the client side (e.g., httpOnly cookies)
3. **Token Expiration**: 24-hour expiration balances security and usability
4. **HTTPS**: Use HTTPS in production to prevent token interception
5. **Token Revocation**: Blacklist system allows immediate token invalidation

## Error Responses

### 401 Unauthorized
```json
{
  "error": "Access token required"
}
```

### 403 Forbidden
```json
{
  "error": "Invalid or expired token"
}
```

### 400 Bad Request
```json
{
  "error": "Username and password required"
}
```

## Migration Notes

- Existing users will need to re-login to get JWT tokens
- Client applications must be updated to include `Authorization: Bearer <token>` headers
- The `userId` parameter is no longer needed in request bodies for protected endpoints

## Testing

The implementation includes comprehensive error handling and validation. Test cases should cover:

1. Successful registration and login
2. Token generation and validation
3. Protected endpoint access with valid tokens
4. Protected endpoint access rejection with invalid tokens
5. Token blacklist functionality (logout)
6. Authorization checks (auction creator permissions)
7. Input validation and error responses
