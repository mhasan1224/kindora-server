# Kindora – Backend API

Kindora is a social development events platform. This repository contains the Express.js REST API that powers event discovery, event management, participation, newsletter subscriptions, and JWT-protected resources.

## Repositories

- **Frontend:** [https://github.com/mhasan1224/kindora-client](https://github.com/mhasan1224/kindora-client)
- **Backend:** [https://github.com/mhasan1224/kindora-server](https://github.com/mhasan1224/kindora-server)

## Technologies Used

| Area | Tools |
|---|---|
| Runtime | Node.js (ES modules) |
| Framework | Express.js 5 |
| Database | MongoDB with the native MongoDB driver |
| Authentication | JWT verification with JOSE (JWKS from Better Auth) |
| Middleware | CORS, `express.json` with a 1 MB body limit |
| Configuration | dotenv |
| Deployment | Vercel serverless functions |

## Architecture Overview

The backend is a single Express application (`index.js`) with a small, explicit middleware pipeline:

1. **CORS:** Requests are allowed only from `http://localhost:3000` and the origin configured in `FRONTEND_URL`. Credentials are enabled.
2. **JSON parsing:** `express.json({ limit: "1mb" })` rejects oversized request bodies.
3. **Database connection guard:** Every request awaits a shared MongoDB connection promise before reaching a route. If the connection fails, the API returns `500 Database connection failed`.
4. **Routes:** Public routes are defined directly; protected routes use the `verifyJWT` middleware.
5. **Startup:** The server connects to MongoDB and listens on `PORT` unless it is running on Vercel (`VERCEL=1`), where the Express app is exported instead.

MongoDB collections used by the API:

- `events` — event documents created by organizers.
- `eventParticipants` — one document per user/event join, with a unique index on `{ eventId, userEmail }`.
- `newsletterSubscribers` — newsletter subscriptions, with a unique index on `{ email }`.
- Better Auth manages its own authentication collections in the same `kindora` database.

## Key Features

- **Event management:** Create, read, update, and delete events.
- **Upcoming events:** Retrieve the latest six upcoming events or the full upcoming list.
- **Event details:** Fetch a single event by its MongoDB ObjectId.
- **Join events:** Authenticated users can join events, with duplicate joins and self-joins rejected.
- **Joined events:** Retrieve the authenticated user's joined events with join timestamps.
- **Ownership protection:** Only the creator of an event can update or delete it.
- **JWT authentication:** Access tokens issued by Better Auth are verified against a remote JWKS.
- **Server-side validation:** Event payloads and newsletter emails are validated before being stored.
- **Newsletter subscriptions:** Public subscription endpoint with duplicate detection.
- **CORS restrictions:** Only the configured frontend origins may call the API.

## Getting Started

### Prerequisites

- Node.js and npm
- A MongoDB database
- The Kindora frontend running (for issuing JWTs through Better Auth)

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/mhasan1224/kindora-server.git
   ```

2. Navigate into the project directory:

   ```bash
   cd kindora-server
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Create a `.env` file in the project root and configure the environment variable names listed below.

5. Start the server:

   ```bash
   node index.js
   ```

The API listens on `http://localhost:8000` by default.

> This package does not define a `dev` or `start` script. Start the server with `node index.js`.

### Environment Variables

Set these variable **names**; values depend on your environment and must never be committed.

| Name | Purpose |
|---|---|
| `PORT` | Port the HTTP server listens on. Defaults to `8000`. |
| `MONGO_URI` | MongoDB connection string. Required — the server throws on startup if it is missing. |
| `FRONTEND_URL` | Origin of the frontend. Used for the CORS allowlist, the JWKS URL, and the expected JWT issuer/audience. Defaults to `http://localhost:3000`. |

`VERCEL` is set automatically by the platform and is used only to skip `app.listen()` in serverless deployments.

## API Reference

All responses are JSON except `GET /`, which returns plain text. Protected endpoints require:

```http
Authorization: Bearer <access-token>
```

### Public Routes

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Returns `Hello Kindora!` as plain text. |
| `GET` | `/events` | Returns the latest six events dated today or later (Asia/Dhaka), sorted by date. |
| `GET` | `/upcoming-events` | Returns all upcoming events, sorted by date. |
| `GET` | `/events/:id` | Returns a single event. `400` for an invalid ObjectId, `404` if not found. |
| `POST` | `/newsletter/subscribe` | Subscribes an email address to the newsletter. |

#### Newsletter Subscription

Request:

```http
POST /newsletter/subscribe
Content-Type: application/json
```

```json
{
  "email": "user@example.com"
}
```

The email is trimmed and lowercased, and must be a valid address of at most 254 characters.

| Status | Response message |
|---|---|
| `201` | `You're subscribed to the Kindora newsletter` |
| `400` | `Please provide a valid email address` |
| `409` | `This email is already subscribed` |
| `500` | `Failed to subscribe. Please try again later.` |

### Protected Routes

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/jwt-test` | Verifies the token and returns the authenticated user. |
| `GET` | `/my-events` | Events created by the authenticated user. |
| `POST` | `/events` | Creates an event. |
| `PUT` | `/events/:id` | Updates an event owned by the authenticated user. |
| `DELETE` | `/events/:id` | Deletes an event owned by the authenticated user and removes its participants. |
| `POST` | `/events/:id/join` | Joins an event as the authenticated user. |
| `GET` | `/my-joined-events` | Events the authenticated user has joined, including `joinedAt`. |

#### Create Event Payload

```json
{
  "title": "Community Cleanup",
  "description": "A short description of the event and its purpose.",
  "eventType": "Community Cleanup",
  "thumbnailUrl": "https://example.com/event-image.jpg",
  "location": "Dhaka, Bangladesh",
  "eventDate": "2026-12-31"
}
```

Validation rules:

| Field | Rule |
|---|---|
| `title` | 5–100 characters |
| `description` | 20–2000 characters |
| `eventType` | One of: Tree Plantation, Community Cleanup, Food Donation, Education Support, Blood Donation, Clothes Distribution, Community Support, Health Awareness |
| `thumbnailUrl` | Valid HTTPS URL |
| `location` | 3–150 characters |
| `eventDate` | `YYYY-MM-DD`, a real date, strictly after today (Asia/Dhaka) |

Invalid payloads return `400` with a `Validation failed` message and an `errors` object keyed by field.

#### Join Event Responses

| Status | Meaning |
|---|---|
| `201` | Joined successfully. |
| `400` | Invalid event ID, or the user is the event creator. |
| `404` | Event not found. |
| `409` | The user has already joined this event. |

## JWT Verification with Better Auth JWKS

The backend never issues tokens and stores no shared signing secret. It relies on the frontend's Better Auth instance:

1. Better Auth is mounted on the frontend at `/api/auth/[...all]` and exposes JSON Web Key Sets at `/api/auth/jwks`.
2. The frontend's Better Auth JWT plugin issues access tokens, which the client retrieves with `authClient.token()`.
3. `index.js` creates a remote key set once:

   ```js
   const JWKS = createRemoteJWKSet(
     new URL(`${FRONTEND_URL}/api/auth/jwks`),
   );
   ```

4. The `verifyJWT` middleware validates the bearer token with `jwtVerify`, checking:
   - The signature against the JWKS.
   - `issuer === FRONTEND_URL`.
   - `audience === FRONTEND_URL`.

5. A token must contain a string `sub` and `email` claim. The middleware then populates `req.user` with `{ id, email, name }` for downstream routes.

Missing, malformed, or expired tokens return `401` with a generic message. Because the issuer and audience are derived from `FRONTEND_URL`, that variable must match the deployed frontend origin in production.

## Database and Indexes

Database name: `kindora`.

Indexes created at startup:

| Collection | Index | Options |
|---|---|---|
| `eventParticipants` | `{ eventId: 1, userEmail: 1 }` | unique |
| `newsletterSubscribers` | `{ email: 1 }` | unique |

The participant index prevents the same user from joining an event twice, and the newsletter index prevents duplicate subscriptions. Only one document is stored per email address.

## Deployment

The backend includes a `vercel.json` that builds `index.js` with `@vercel/node` and routes all requests to it.

Before deploying:

1. Set `MONGO_URI` and `FRONTEND_URL` in the hosting platform's environment settings.
2. Set `FRONTEND_URL` to the production frontend origin (for CORS, JWKS fetching, and JWT issuer/audience checks).
3. Ensure the deployed frontend exposes `/api/auth/jwks` and that it is reachable from the backend.
4. Point the frontend's `NEXT_PUBLIC_API_URL` at the deployed backend URL.

Any Node.js-compatible host works, but the included configuration targets Vercel. On Vercel, the exported Express app handles requests without calling `app.listen()`.

## License

This project was developed as part of an assignment.